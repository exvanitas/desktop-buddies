/* The smoke run adds this to its own copy of manager.html, so the real client runs in the real
   Manager window against the real hub. It never ships. It reports through the app's log, and
   smoke.ps1 judges from that. A window opened later picks up at the next phase. */
import { fromShimeji } from '@buddies/art';
import { outlineOfImage } from '@buddies/art/outline-canvas';
import { write, type Buddy } from '@buddies/buddy-file';
import { fromFile, type Handed } from '../src/handed';
import type { BuddyRow, HubState } from '../src/manager-api';
import { createManagerClient } from '../src/manager-client';
import { fit } from '../src/manager/sticker';
import { MANAGER } from '../src/manager-window';
import { createShell } from '../src/shell';
import { broadcastWire } from '../src/wire';

const shell = createShell(window.__TAURI__);
const say = (line: string) => shell.log('PROBE ' + line);
const check = (name: string, ok: boolean, detail: unknown = '') => say(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`);
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

const client = createManagerClient({
  wire: broadcastWire(), session: 'probe' + Date.now(),
  after: (ms, f) => { const t = setTimeout(f, ms); return () => clearTimeout(t); },
  shimeji: fromShimeji,
  closeWindow: () => shell.windowClose(MANAGER.label)
});

function state() {
  return new Promise<HubState>(done => { const stop = client.subscribe(s => { if (s.ready) { queueMicrotask(() => stop()); done(s); } }); });
}
async function until(what: string, f: (s: HubState) => boolean) {
  for (let i = 0; i < 100; i++) { if (client.state && f(client.state)) return true; await pause(50); }
  void say(`gave up waiting: ${what} ${JSON.stringify(client.state)}`);
  return false;
}
const row = (id: string) => client.state!.buddies.find(b => b.id === id);
const handed = (name: string, body: string, path = name): Handed => fromFile(new File([body], name), path);

function png(colour: string) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d')!; x.fillStyle = colour; x.fillRect(16, 8, 32, 48);
  return new Promise<Blob>(done => c.toBlob(b => done(b!), 'image/png'));
}
const smallBuddy = async (character: string, name: string): Promise<string> => {
  const url = await new Promise<string>(done => { const r = new FileReader(); r.onload = () => done(r.result as string); void png('#c0f').then(b => r.readAsDataURL(b)); });
  const buddy: Buddy = { character, name, base: { src: url, bb: { x0: 0, y0: 0, x1: 1, y1: 1 } }, poses: {} };
  return write(buddy);
};

const sheet = () => document.querySelector<HTMLElement>('.st');
async function looked(what: string, f: () => unknown) {
  for (let i = 0; i < 100; i++) { if (f()) return true; await pause(50); }
  void say(`gave up looking for ${what}`);
  return false;
}

/* The real view in the real window: what it looks like, and what a click on it does. */
async function view(she: BuddyRow) {
  check('view', await looked('a sticker', sheet) && document.querySelector('.st b')?.textContent === she.name && getComputedStyle(document.querySelector('.sheet')!).borderRadius === '18px', document.title);
  check('drag_region', document.querySelector('.bar')!.hasAttribute('data-tauri-drag-region'));
  await document.fonts.ready;
  const faces = [...document.fonts].map(f => `${f.family} ${f.status}`), loaded = (font: string) => document.fonts.check(font);
  check('fonts', loaded('13px Lexend') && loaded('500 13.5px DynaPuff') && faces.length === 2 && faces.every(f => f.endsWith('loaded')) && getComputedStyle(document.querySelector('.st b')!).fontFamily.startsWith('DynaPuff'), faces);
  check('title_scale', true, { dpr: devicePixelRatio, inner: [innerWidth, innerHeight] });

  /* A library image, on the real origin, read by the real canvas. */
  check('cut_line', await looked('the line', () => document.querySelector('.cutline')) && document.querySelector<SVGElement>('.cutline')!.dataset.line === 'traced', she.image);
  const times: number[] = [];
  for (let i = 0; i < 6; i++) { const t = performance.now(); await outlineOfImage(she.image, (w, h) => fit(w, h)); times.push(performance.now() - t); }
  check('bake_ms', times.every(t => t < 500), times.map(t => +t.toFixed(1)));

  sheet()!.querySelector<HTMLElement>('.acts .btn')!.click();
  check('click_dismiss', await until('home', () => row(she.id)?.status === 'home') && await looked('the sticker back', () => !document.querySelector('.cutline') && document.querySelector('.st img.cut')));
  await pause(500);
  sheet()!.querySelector<HTMLElement>('.art')!.click();
  check('click_call', await until('out', () => row(she.id)?.status === 'out') && await looked('the line back', () => document.querySelector('.cutline')));
  await pause(500);
  sheet()!.querySelector<HTMLElement>('.dots')!.click();
  const menu = document.querySelector('.menu')?.getBoundingClientRect();
  const items = [...document.querySelectorAll('.menu button')].map(b => b.textContent);
  check('menu', !!menu && menu.right <= innerWidth && menu.bottom <= innerHeight, items);
  check('menu_offers', ['Bring here', 'Give a treat', 'Chase my mouse'].every(w => items.includes(w)), items);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  check('menu_closes', !document.querySelector('.menu'));
}

/* The ••• menu's asks for someone out, then the tray's Bring everyone here, sent the way the exe sends
   a tray click, since a runner can't click the tray. smoke.ps1 reads the rest from the log: the
   overlay closed and came back, and the world still had her. */
async function bringing(she: BuddyRow) {
  check('can', row(she.id)!.can.join() === 'eat,chase', row(she.id)!.can);
  check('bring_here', (await client.bringHere(she.id)).ok);
  check('treat', (await client.giveTreat(she.id)).ok);
  check('chase', (await client.chaseMouse(she.id)).ok);
  const out = () => client.state!.buddies.map(b => `${b.id}:${b.copies}`).join();
  const before = out();
  void say('STEP bring everyone');
  const tauri = window.__TAURI__ as unknown as { event: { emit(name: string, payload: unknown): Promise<void> } };
  await tauri.event.emit('tray', { id: 'bring' });
  await pause(3000);
  check('bring_everyone', out() === before, out());
}

/* Everything a view can ask for, through the real hub. */
async function first() {
  const s = await state(), she = s.buddies[0]!;
  check('state', s.buddies.length === 1 && she.status === 'out' && she.copies === 1, s);
  const image = await new Promise<boolean>(done => { const i = new Image(); i.onload = () => done(i.naturalWidth > 0); i.onerror = () => done(false); i.src = she.image; });
  check('image', image, she.image);
  await view(she);

  check('another', (await client.callAnother(she.id)).ok && await until('two copies', () => row(she.id)?.copies === 2));
  check('dismiss_one', (await client.dismissOne(she.id)).ok && await until('one copy', () => row(she.id)?.copies === 1));
  await client.callAnother(she.id);
  check('dismiss_all', (await client.dismiss(she.id)).ok && await until('none out', () => row(she.id)?.status === 'home'));
  check('call', (await client.call(she.id)).ok && await until('out again', () => row(she.id)?.status === 'out'));
  await bringing(she);
  check('pause', (await client.setPaused(true)).ok && await until('paused', s2 => s2.paused));
  await client.setPaused(false);
  check('hide', (await client.setHidden(true)).ok && await until('hidden', s2 => s2.hidden));
  await client.setHidden(false);

  const good = await client.importFiles([handed('pip.buddy', await smallBuddy('probe-pip', 'Pip'))]);
  check('import', !!good[0]?.ok && await until('pip listed', () => !!row('probe-pip')), good);

  const bad = await client.importFiles([handed('broken.buddy', '{"app":"nope"}')]);
  const failure = !bad[0]!.ok ? bad[0]!.failure : null;
  check('import_refused', !!failure && failure.title === "broken didn't come in" && !!failure.why && !!failure.fix, failure);
  check('failure_published', await until('failure in state', s2 => s2.failures.some(f => f.title === "broken didn't come in")));

  const frames = await Promise.all([1, 2, 3, 4].map(async n => fromFile(new File([await png(`hsl(${n * 40} 80% 50%)`)], `shime${n}.png`, { type: 'image/png' }), `Mochi/img/shime${n}.png`)));
  const shime = await client.importFiles(frames);
  check('shimeji', !!shime[0]?.ok && await until('Mochi listed', s2 => s2.buddies.some(b => b.name === 'Mochi')), shime);
  const none = await client.importFiles([handed('readme.txt', 'x', 'Empty/readme.txt')]);
  check('shimeji_refused', !none[0]!.ok && none[0]!.failure.why === 'No shime1.png in that folder.', none);

  /* The driver answers the dialog. */
  void say('STEP dialog cancel');
  const cancelled = await client.exportBuddy('probe-pip');
  check('export_cancelled', cancelled.ok && cancelled.value?.saved === false, cancelled);
  void say('STEP dialog save');
  const saved = await client.exportBuddy('probe-pip');
  check('export_saved', saved.ok && saved.value?.saved === true, saved);

  check('delete', (await client.deleteBuddy('probe-pip', row('probe-pip')!.rev)).ok && await until('pip gone', () => !row('probe-pip')));
  check('maker_hook', client.state!.maker === true && [...document.querySelectorAll<HTMLElement>('button')].some(b => /New buddy/.test(b.textContent ?? '') && !b.hidden));
  await client.clearFailures();
  check('failures_cleared', await until('no failures', s2 => !s2.failures.length));

  /* Sent, and the window goes before the answer can come. The next window looks for it. */
  localStorage.setItem('probe-phase', 'second');
  void client.importFiles([handed('late.buddy', await smallBuddy('probe-late', 'Late'))]);
  await pause(0);
  void say('closing mid-command');
  void client.close();
}

async function second() {
  const s = await state();
  check('after_close', await until('late listed', () => !!row('probe-late')), s.buddies.map(b => b.name));
  localStorage.setItem('probe-phase', 'done');
  void say('phase two done');
}

void (async () => {
  try {
    const phase = localStorage.getItem('probe-phase');
    if (phase === 'second') await second();
    else if (!phase) await first();
  } catch (e) { check('threw', false, String(e)); }
})();
