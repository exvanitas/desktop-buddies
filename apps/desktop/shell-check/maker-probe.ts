/* The smoke run's probe of the Maker. It stands in for maker.js in its own copy of the app, so the
   real page logic runs in the real window on the real hub, and it sits beside manager.js to ask for
   the window through the hub's real command. It never ships. It reports through the app's log, and
   smoke.ps1 judges from that. Its place in the story is kept in the data folder, because a run's
   last moments can't count on the browser's own storage reaching the disk. */
import { POSES, imageNames, read, readManifest, unpack, write, type Buddy, type Pose, type PoseKey } from '@buddies/buddy-file';
import { fromFile } from '../src/handed';
import type { HubState, MakerOpened, Said } from '../src/manager-api';
import { createManagerClient, type ManagerClient } from '../src/manager-client';
import { pageIO } from '../src/maker-env';
import { mountMaker, type MakerPage } from '../src/maker-page';
import { createMakerView } from '@buddies/maker-view';
import { MAKER } from '../src/maker-window';
import { MANAGER } from '../src/manager-window';
import { createShell, text } from '../src/shell';
import { broadcastWire } from '../src/wire';
import { stalls } from './firsts';

const shell = createShell(window.__TAURI__);
const say = (line: string) => shell.log('PROBE ' + line);
const check = (name: string, ok: boolean, detail: unknown = '') => say(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`);
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

const note = {
  get: (name: string) => shell.dataRead(`probe-${name}.txt`).then(text, () => null),
  set: (name: string, v: string) => shell.dataWrite(`probe-${name}.txt`, v),
  clear: (name: string) => shell.dataDelete(`probe-${name}.txt`)
};

function clientFor(session: string, close: () => Promise<void>) {
  return createManagerClient({
    wire: broadcastWire(), session,
    after: (ms, f) => { const t = setTimeout(f, ms); return () => clearTimeout(t); },
    shimeji: async () => null,
    closeWindow: close
  });
}
const ready = (client: ManagerClient) => new Promise<HubState>(done => { const stop = client.subscribe(s => { if (s.ready) { queueMicrotask(() => stop()); done(s); } }); });
async function until(what: string, f: () => unknown, tries = 200) {
  for (let i = 0; i < tries; i++) { if (f()) return true; await pause(50); }
  void say(`gave up waiting: ${what}`);
  return false;
}

/* In the Manager's page: asks for the Maker, and does what the Maker's own page can't once it's gone. */
async function opener() {
  const client = clientFor('opener' + Date.now(), () => shell.windowClose(MANAGER.label)), s = await ready(client);
  /* What each save costs a Manager that's only listening: the channel hands it a copy. */
  new BroadcastChannel('desktop-buddies').onmessage = e => {
    const c = e.data.k === 'do' && e.data.cmd;
    if (c && c.k === 'maker-save') void say(`INFO manager_got ${JSON.stringify({ t: Date.now(), mb: +(c.file.length / 1e6).toFixed(1), heapMb: Math.round((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1e6) })}`);
  };
  const first = await note.get('id') ?? s.buddies[0]!.id;
  await note.set('id', first);
  const opened = await client.editBuddy(first);
  check('opens_through_the_hub', opened.ok, opened);
  /* Whether the Maker's window is there, by the label its page wrote down: each window has its own. */
  const makerGone = async () => { const label = await note.get('label'); return !label || await shell.windowMinimized(label).catch(() => null) === null; };
  setInterval(() => { void (async () => {
    const ask = await note.get('ask');
    if (ask) { await note.clear('ask'); await client.editBuddy(ask); }
    const measure = await note.get('measure');
    if (measure) { await note.clear('measure'); await note.set('measured', JSON.stringify(await urlCosts(measure))); }
    if (await note.get('reopen')) {
      if (await makerGone()) { await note.clear('reopen'); await client.editBuddy(await note.get('id') ?? first); }
    }
    /* Once the Maker's window has gone, or a quit would cut off what it's flushing. */
    if (await note.get('quit') && await makerGone()) { await note.clear('quit'); await shell.quit(); }
  })(); }, 200);
}

const png = (colour: string) => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d')!; x.fillStyle = colour; x.fillRect(16, 8, 32, 48);
  return c.toDataURL('image/png');
};
const manifest = async (id: string) => (JSON.parse(text(await shell.dataRead(`library/${id}/buddy.json`))) as { buddy: Buddy }).buddy;
const saved = (page: MakerPage) => { page.maker.saveNow(); return page.store.flush(); };
/* A button in the real view's status, as soon as there is one. */
async function offered(label: string, tries = 300) {
  const find = () => [...document.querySelectorAll<HTMLButtonElement>('.save-fail button, dialog.closing button')].find(b => b.textContent === label && b.offsetParent !== null);
  await until(label, find, tries);
  return find() ?? null;
}
const closeButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
const status = (page: MakerPage) => new Promise<string>(done => { const stop = page.host.onSave(s => { done(JSON.stringify(s)); queueMicrotask(() => stop()); }); });
const started = (page: MakerPage) => until('the start', () => page.maker.state);
/* Her folder holds her manifest and what it names, nothing else. */
async function tidy(id: string) {
  const named = imageNames(readManifest(text(await shell.dataRead(`library/${id}/buddy.json`)))), there = await shell.dataList(`library/${id}`);
  return { ok: there.length === named.length + 1 && named.every(n => there.some(e => e.name === n)), files: there.length, named: named.length };
}
/* What a page pays to show every image of hers: each one loaded, decoded and drawn small, as an
   overlay does for its hit mask. With `v`, each URL carries that cache-buster. */
async function loadAll(id: string, v?: string) {
  const urls = imageNames(readManifest(text(await shell.dataRead(`library/${id}/buddy.json`)))).map(n => `library/${id}/${n}${v ? `?v=${v}` : ''}`);
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  let missed = 0;
  const t = performance.now();
  for (let i = 0; i < urls.length; i += 32) {
    await Promise.all(urls.slice(i, i + 32).map(async u => {
      const im = new Image(); im.src = u;
      try { await im.decode(); x.drawImage(im, 0, 0, 64, 64); x.getImageData(0, 0, 64, 64); } catch { missed++; }
    }));
  }
  return { ms: Math.round(performance.now() - t), n: urls.length, missed };
}
/* Fresh URLs, the same again, then a new cache-buster, then plain URLs twice: after a save, a
   cache-buster makes every page pay the first and third, and none makes it pay the last. */
async function urlCosts(id: string) {
  const tag = String(Date.now());
  return { fresh: await loadAll(id, tag), again: await loadAll(id, tag), newBuster: await loadAll(id, tag + 'b'), plain: await loadAll(id), plainAgain: await loadAll(id) };
}

/* An image of noise, as no two of hers are alike, and every pose of the largest real buddy we've seen. */
function shapedNoise() {
  const c = document.createElement('canvas'); c.width = c.height = 60;
  const x = c.getContext('2d')!, im = x.createImageData(60, 60);
  crypto.getRandomValues(im.data);
  for (let i = 3; i < im.data.length; i += 4) im.data[i] = 128 + (im.data[i]! >> 1);
  x.putImageData(im, 0, 0);
  return { src: c.toDataURL('image/png'), bb: { x0: 0, y0: 0, x1: 1, y1: 1 } };
}
function shapedPoses() {
  const poses: Partial<Record<PoseKey, Pose>> = {};
  POSES.slice(0, 40).forEach((p, i) => { poses[p.key as PoseKey] = { frames: Array.from({ length: i < 25 ? 29 : 28 }, shapedNoise), fps: 6, scale: 1 }; });
  return poses;
}

/* At least 50 quick saves of a buddy out on the desktop, with a loop reading her images the whole
   time as well as the overlay, so the folder swaps under anything that can hold a file open. */
async function stress(page: MakerPage, client: ManagerClient, id: string) {
  const row = () => client.state!.buddies.find(b => b.id === id)!, copies = row().copies;
  const p = page.maker.current()!, times: number[] = [], fails: string[] = [];
  let reading = true, loads = 0, missed = 0;
  const reader = (async () => {
    while (reading) {
      await new Promise<void>(done => { const i = new Image(); i.onload = () => { loads++; done(); }; i.onerror = () => { missed++; done(); }; i.src = row().image; });
      await pause(5);
    }
  })();
  for (let n = 0; n < 60; n++) {
    p.base = { src: png(`hsl(${n * 6} 80% 50%)`), bb: p.base.bb };
    const t = performance.now(), ok = await saved(page);
    times.push(Math.round(performance.now() - t));
    if (!ok) { fails.push(`save ${n}: ${await status(page)}`); await pause(200); }
  }
  reading = false;
  await reader;
  times.sort((a, b) => a - b);
  check('stress', !fails.length, { saves: times.length, failed: fails.length, firstFailures: fails.slice(0, 3), medianMs: times[times.length >> 1], maxMs: times.at(-1), imageReads: loads, imageMisses: missed });
  check('stress_who_is_out', row().status === 'out' && row().copies === copies, row());
  const back = await page.store.ask<MakerOpened>({ k: 'maker-open', id });
  check('stress_read_back', back.ok && !!back.value?.file && (JSON.parse(back.value.file) as { buddy: Buddy }).buddy.base.src === p.base.src);
}

const phases: Record<string, (page: MakerPage & { postTimes: number[] }, client: ManagerClient, id: string) => Promise<void>> = {
  /* Opened, edited, tried on screen, saved over and over, exported, closed by its own button. */
  async first(page, client, id) {
    const before = (await shell.dataList(`library/${id}`)).find(f => f.name === 'buddy.json')!.modified;
    check('opened', page.maker.current()?.character === id && (window.__BUDDIES__ as { id?: string }).id === id, page.maker.current()?.name);
    check('holds_only_her', page.maker.state.pets.length === 1 && page.maker.state.started === true);
    /* The runner's screen is 1024 wide, so only the minimum can be asked for. */
    check('window_size', document.title === MAKER.title && innerWidth >= MAKER.minWidth! && innerHeight >= MAKER.minHeight!, [innerWidth, innerHeight, devicePixelRatio]);
    await pause(2500);
    check('no_edit_no_write', (await shell.dataList(`library/${id}`)).find(f => f.name === 'buddy.json')!.modified === before);

    const image = client.state!.buddies.find(b => b.id === id)!.image;
    page.maker.setSize(150);
    page.maker.setName('Autosaved');
    const landed = await until('the autosave', () => client.state!.buddies.find(b => b.id === id)!.name === 'Autosaved');
    check('autosave', landed && (await manifest(id)).size === 150 && (await manifest(id)).name === 'Autosaved');
    /* An image is named by its bytes: a new name keeps it, a new picture changes it. */
    check('rename_keeps_url', client.state!.buddies.find(b => b.id === id)!.image === image);
    const cur = page.maker.current()!;
    cur.base = { src: png('#f80'), bb: cur.base.bb };
    await saved(page);
    check('new_image_url', await until('the new image', () => client.state!.buddies.find(b => b.id === id)!.image !== image));

    await client.dismiss(id);
    await until('her to go', () => client.state!.buddies.find(b => b.id === id)!.status === 'home');
    page.host.tryOnScreen!(page.maker.current()!.id, 'dance');
    check('try_on_screen', await until('her out', () => client.state!.buddies.find(b => b.id === id)!.status === 'out') && client.state!.buddies.find(b => b.id === id)!.copies === 1);

    await stress(page, client, id);

    /* The driver answers these two, one dialog at a time. */
    void say('STEP dialog buddy');
    page.host.saveBuddyFile(page.maker.current()!.id);
    await pause(12000);
    void say('STEP dialog page');
    page.host.exportPage!();
    await pause(20000);

    await note.set('phase', 'second');
    await note.set('quit', '1');
    page.maker.setName('Closed Edit');
    void say('STEP closing');
    closeButton()!.click();
  },

  /* A new run. What the title bar's Close flushed is there. Then a real minimize, and a real Edit.
     API 1 flushes, closes and opens a fresh window, whose page goes on as `hard`. API 2 restores
     this one, so this page goes on itself. */
  async second(page, client, id) {
    const p = page.maker.current()!;
    check('read_back_after_restart', p.name === 'Closed Edit' && p.size === 150, [p.name, p.size]);
    await note.set('phase', 'hard');
    p.name = 'Minimized Edit';
    page.host.window!.minimize();
    await pause(800);
    await note.set('ask', p.character!);
    if ((await shell.info()).api < 2) return;
    for (let i = 0; i < 300 && await shell.windowMinimized(page.label); i++) await pause(50);
    await page.store.flush();
    await phases.hard!(page, client, id);
  },

  /* API 1: flushed and reopened. API 2: restored, the same window. Then an edit left waiting, and
     the driver closes the window on it. */
  async hard(page, _, id) {
    const p = page.maker.current()!;
    check('minimized_kept', p.name === 'Minimized Edit' && (await manifest(id)).name === 'Minimized Edit', p.name);
    await note.set('phase', 'third');
    await note.set('reopen', '1');
    page.maker.setName('Hard Edit');
    await say('STEP hard close');
  },

  /* A close from outside waited for the edit. */
  async third(page) {
    check('hard_close_kept', page.maker.current()!.name === 'Hard Edit', page.maker.current()!.name);
    await note.set('phase', 'conflict');
    await note.set('reopen', '1');
    closeButton()!.click();
  },

  /* A real import replaces her while she's open, answered Replace as a person would, and the real
     view's button keeps the edit. */
  async conflict(page, client, id) {
    const opened = await page.store.ask<MakerOpened>({ k: 'maker-open', id });
    const replaced = JSON.parse(opened.ok ? opened.value!.file : '{}') as { buddy: Buddy };
    replaced.buddy.name = 'Replaced';
    const [asked] = await client.importFiles([fromFile(new File([JSON.stringify(replaced)], 'replaced.buddy'), 'replaced.buddy')]);
    check('import_asks', !!(asked?.ok && asked.value?.asked), asked);
    if (asked?.ok && asked.value?.asked) await client.answerReplace(asked.value.asked, 'replace');
    await until('the import', () => client.state!.buddies.some(b => b.name === 'Replaced'));
    page.maker.setName('Kept Edit');
    const keep = await offered('Keep as a new buddy');
    check('conflict_offers', !!keep && (await manifest(id)).name === 'Replaced', (await manifest(id)).name);
    keep?.click();
    const kept = await until('the new buddy', () => client.state!.buddies.some(b => b.name === 'Kept Edit' && b.id !== id));
    check('keep_as_new', kept && client.state!.buddies.some(b => b.id === id && b.name === 'Replaced'), client.state!.buddies.map(b => b.name));
    await note.set('phase', 'silent');
    await note.set('reopen', '1');
    closeButton()!.click();
  },

  /* This page's wire goes nowhere, so to it the hub never answers. The driver asks it to close: it
     has to stay, ask within the limit, and go when told. */
  async silent(page) {
    const bb = { x0: 0, y0: 0, x1: 1, y1: 1 };
    page.maker.addPet({ name: 'Unheard', base: { src: png('#0af'), bb }, poses: {} }, true);
    await say('STEP silent close');
    const t = performance.now();
    const stay = await offered('Keep editing', 800);
    check('silent_asks', !!stay, { ms: Math.round(performance.now() - t) });
    /* The way back, for real: the dialog goes, and the page is in use. */
    stay?.click();
    check('keep_editing', !document.querySelector('dialog.closing') && !!closeButton());
    closeButton()!.click();
    check('close_stops_input', !!document.querySelector('dialog.closing')?.matches(':modal'));
    const anyway = await offered('Close anyway', 800);
    await say('STEP silent asked');
    await pause(1500);
    await note.set('phase', 'shaped');
    await note.set('reopen', '1');
    anyway?.click();
  },

  /* A buddy the shape of the largest real one we've seen: 40 poses, 1145 frames, about 23 MB, all
     synthetic. How long she takes, and what each save of her costs with a Manager open and without. */
  async shaped(page, client) {
    const noise = () => {
      const c = document.createElement('canvas'); c.width = c.height = 60;
      const x = c.getContext('2d')!, im = x.createImageData(60, 60);
      crypto.getRandomValues(im.data);
      for (let i = 3; i < im.data.length; i += 4) im.data[i] = 128 + (im.data[i]! >> 1);
      x.putImageData(im, 0, 0);
      return { src: c.toDataURL('image/png'), bb: { x0: 0, y0: 0, x1: 1, y1: 1 } };
    };
    const keys = POSES.slice(0, 40).map(p => p.key as PoseKey), poses: Partial<Record<PoseKey, Pose>> = {};
    let t = performance.now();
    keys.forEach((k, i) => { poses[k] = { frames: Array.from({ length: i < 25 ? 29 : 28 }, noise), fps: 6, scale: 1 }; });
    const made = Math.round(performance.now() - t);
    const p = page.maker.addPet({ name: 'Shaped', base: noise(), poses }, true)!;
    const shape = { poses: Object.keys(p.poses).length, frames: Object.values(p.poses).reduce((n, q) => n + q.frames.length, 0), mb: +(write(p).length / 1e6).toFixed(1), madeMs: made };
    t = performance.now();
    const first = await saved(page), firstMs = Math.round(performance.now() - t);
    const saves = async (n: number, word: string) => {
      const times: number[] = [];
      for (let i = 0; i < n; i++) { page.maker.setName(`${word} ${i}`); await pause(300); const a = performance.now(); if (!await saved(page)) times.push(-1); times.push(Math.round(performance.now() - a)); }
      return times;
    };
    const withManager = await saves(3, 'Managed');
    await shell.windowClose(MANAGER.label);
    await pause(1000);
    const without = await saves(3, 'Alone');
    await shell.windowOpen(MANAGER);
    await until('the Manager again', () => client.state, 100);
    await pause(3000);
    /* One image changed. */
    const walk = p.poses.walk!.frames;
    walk[3] = noise();
    t = performance.now();
    const one = await saved(page), oneMs = Math.round(performance.now() - t);
    /* What showing her costs a page after a save, here and in the Manager. */
    const here = await urlCosts(p.character!);
    await note.set('measure', p.character!);
    let there = '';
    for (let i = 0; i < 600 && !there; i++) { there = await note.get('measured') ?? ''; if (!there) await pause(100); }
    await note.clear('measured');
    void say(`INFO url_costs ${JSON.stringify({ maker: here, manager: there ? JSON.parse(there) as unknown : 'no answer' })}`);
    /* Her first save after an upgrade: her folder as an older build left it, under the names unpack
       gives, written behind the hub's back. Nothing listens for that. */
    const dir = `library/${p.character!}`, hashed = await shell.dataList(dir), legacy = unpack(read(write(p)));
    t = performance.now();
    for (const f of legacy.images) await shell.dataWrite(`${dir}/${f.name}`, f.bytes);
    await shell.dataWrite(`${dir}/buddy.json`, legacy.manifest);
    for (const e of hashed) if (e.name !== 'buddy.json') await shell.dataDelete(`${dir}/${e.name}`);
    const legacyMs = Math.round(performance.now() - t);
    /* The Manager coming back asked for its own buddy, so she has to be picked again. */
    page.maker.select(p.id);
    page.maker.setName('Upgraded');
    t = performance.now();
    const upgraded = await saved(page), upgradeMs = Math.round(performance.now() - t), after = await tidy(p.character!);
    /* The Maker waits on while the hub gets somewhere, so a slow save is a stall, not a reply timeout:
       her first save and her upgrade against the same files written one by one from this page, on
       the same machine. One far past the other two is listed, and smoke.ps1's save-judge.mjs says
       from the log whether it was the disk or us. */
    const times = [firstMs, upgradeMs, legacyMs], kinds = ['first', 'upgrade', 'legacy'] as const;
    const judged = stalls(times).stalled.map(i => ({ id: p.character!, kind: kinds[i]!, ms: times[i]! }));
    const ok = first && one && upgraded && after.ok && (await manifest(p.character!)).name === 'Upgraded' && !withManager.includes(-1) && !without.includes(-1);
    check('shaped', ok, { ...shape, stalls: judged, firstSaveMs: firstMs, renameWithManagerMs: withManager, renameMs: without, oneImageMs: oneMs, upgradeSaveMs: upgradeMs, legacyWriteMs: legacyMs, after, postMs: page.postTimes });
    page.maker.select(p.id);
    page.maker.setName('Shaped Closed');
    await note.set('id', p.character!);
    await note.set('shape', JSON.stringify(shape));
    await note.set('phase', 'shaped_back');
    await note.set('reopen', '1');
    await note.set('closed', String(Date.now()));
    closeButton()!.click();
  },

  /* She read back whole after the window closed on an edit. Then on to the largest allowed. */
  async shaped_back(page, client, id) {
    const p = page.maker.current(), shape = JSON.parse(await note.get('shape') ?? '{}') as { poses: number; frames: number };
    const closed = Number(await note.get('closed'));
    check('shaped_back', !!p && p.character === id && p.name === 'Shaped Closed' && Object.keys(p.poses).length === shape.poses && Object.values(p.poses).reduce((n, q) => n + q.frames.length, 0) === shape.frames,
      { closeToOpenMs: Date.now() - closed, pageOpenMs: Math.round(performance.now()), name: p?.name });
    await note.set('phase', 'shaped_firsts');
    await phases.shaped_firsts!(page, client, id);
  },

  /* The runner's stalls were all a new big buddy's first save, so this makes five of them: each one
     new, saved straight after she's made, timed until the hub says she's in the library, which can
     be past the Maker's own wait for an answer. Each goes from this window once she's in, so the
     page holds one at a time. A first save past STALL_MS and STALL_X times the median is a stall,
     listed for smoke.ps1's save-judge.mjs; one that never lands fails here. */
  async shaped_firsts(page, client, id) {
    const firsts: { ms: number; ok: boolean; id: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const p = page.maker.addPet({ name: `First ${i}`, base: shapedNoise(), poses: shapedPoses() }, true)!, c = p.character!;
      const t = performance.now();
      let ok = await saved(page);
      if (!ok) ok = await until(`first save ${i}`, () => client.state?.buddies.some(b => b.id === c), 3000);
      const ms = Math.round(performance.now() - t);
      firsts.push({ ms, ok, id: c });
      void say(`INFO shaped_first ${JSON.stringify({ i, ms, ok, id: c })}`);
      page.maker.remove();
      await page.settled();
      await pause(300);
    }
    /* A stall is listed, not failed here: this page can't read the log, and smoke.ps1's save-judge.mjs
       says from it whether that was the disk or us. One that never landed fails here. */
    const ms = firsts.map(f => f.ms), { median, stalled } = stalls(ms);
    check('shaped_firsts', firsts.every(f => f.ok), { firstSaveMs: ms, median, stalls: stalled.map(i => ({ id: firsts[i]!.id, kind: 'first', ms: firsts[i]!.ms })), failed: firsts.filter(f => !f.ok).map(f => f.id) });
    page.maker.select(page.maker.state.pets.find(p => p.character === id)?.id ?? page.maker.state.pets[0]!.id);
    await note.set('phase', 'big');
    await phases.big!(page, client, id);
  },

  /* The largest allowed buddy, and a quit in the middle of saving her. */
  async big(page) {
    const noise = () => { let s = ''; const a = new Uint8Array(3 << 14); while (s.length < 7_400_000) { crypto.getRandomValues(a); s += btoa(String.fromCharCode(...a)).replace(/=+$/, ''); } s = s.slice(0, 7_400_000 - 7_400_000 % 4); return `data:image/png;base64,iVBORw0KGgo${s.slice(11)}`; };
    const bb = { x0: 0, y0: 0, x1: 1, y1: 1 }, frames = Array.from({ length: 8 }, () => ({ src: noise(), bb }));
    const big = page.maker.addPet({ name: 'Big', base: frames[0]!, poses: { walk: { frames: frames.slice(1) } } }, true)!;
    const size = JSON.stringify(big).length;
    let t = performance.now(), ok = await saved(page);
    const first = Math.round(performance.now() - t);
    page.maker.setName('Big Again');
    t = performance.now(); ok = await saved(page) && ok;
    const again = Math.round(performance.now() - t);
    t = performance.now();
    const read = await page.store.ask<MakerOpened>({ k: 'maker-open', id: big.character! });
    check('largest', ok && read.ok, { mb: +(size / 1e6).toFixed(1), firstSaveMs: first, saveMs: again, openMs: Math.round(performance.now() - t), state: ok ? 'saved' : await status(page) });

    await note.set('id', big.character!);
    await note.set('phase', 'after_quit');
    /* Every image new, so the quit lands among her writes, not after a manifest of one rename. */
    page.maker.setName('Cut Off');
    for (const f of [big.base, ...big.poses.walk!.frames]) f.src = f.src.slice(0, -8) + 'AAAAAAAA';
    page.maker.saveNow();
    void page.store.flush();
    /* The quit goes as soon as her first new image is on disk. */
    const dir = `library/${big.character!}`, had = (await shell.dataList(dir)).length;
    for (let i = 0; i < 500 && (await shell.dataList(dir)).length <= had; i++) await pause(10);
    await say('STEP quitting');
    await shell.quit();
  },

  /* She's whole after a quit in the middle of a save, one copy or the other, and nothing's left over. */
  async after_quit(page, _, id) {
    const p = page.maker.current(), list = await shell.dataList('library');
    const waiting = list.some(e => e.name === '.outgoing') ? await shell.dataList('library/.outgoing') : [];
    const cut = p ? [p.base, ...p.poses.walk!.frames].filter(f => f.src.endsWith('AAAAAAAA')).length : -1;
    const copy = p?.name === 'Big Again' && cut === 0 ? 'old' : p?.name === 'Cut Off' && cut === 8 ? 'new' : 'mixed';
    check('quit_left_her_whole', !!p && p.character === id && p.poses.walk!.frames.length === 7 && copy !== 'mixed', { name: p?.name, copy, cut });
    check('quit_left_nothing', !waiting.length && !list.some(e => e.name === '.incoming'), list.map(e => e.name));
    /* What a stop left beside her goes at her next save. */
    const before = await tidy(id);
    page.maker.setName('Tidied');
    const ok = await saved(page), after = await tidy(id);
    check('quit_then_tidied', ok && after.ok, { before, after });
    await note.set('phase', 'done');
    await note.set('quit', '1');
    page.host.window!.close();
  }
};

async function makerPage() {
  const phase = await note.get('phase') ?? 'first', id = await note.get('id');
  const io = pageIO(createMakerView), deaf = { post() {}, listen() {}, close() {} }, postTimes: number[] = [];
  /* How long handing a save to the channel holds up this page, which is where the copy's made. */
  const timed = { ...io.wire, post(m: Said) { const a = performance.now(); io.wire.post(m); if (m.k === 'do' && m.cmd.k === 'maker-save') postTimes.push(Math.round(performance.now() - a)); } };
  const page = Object.assign(mountMaker({ ...io, wire: phase === 'silent' ? deaf : timed }), { postTimes });
  await note.set('label', page.label);
  void shell.log(`maker page up as ${page.label}`);
  await started(page);
  await page.settled();
  const client = clientFor('watcher' + Date.now(), () => Promise.resolve());
  await ready(client);
  void say(`phase ${phase}`);
  await phases[phase]?.(page, client, id!);
}

void (location.pathname.endsWith('maker.html') ? makerPage() : opener()).catch(e => check('threw', false, String(e)));
