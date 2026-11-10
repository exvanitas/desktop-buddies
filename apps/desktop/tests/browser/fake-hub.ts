/* The hub half of the browser check: the real hub on the fake exe, in a page of its own, on the real
   BroadcastChannel. The built Manager page talks to it exactly as it talks to the real one. */
import { processBase } from '@buddies/art';
import { outlineOf, type Outline } from '@buddies/art/outline';
import { DETAIL, alphaOf, outlineOfImage } from '@buddies/art/outline-canvas';
import { newCharacter, write, type Buddy } from '@buddies/buddy-file';
import { isMenu } from '../../src/buddy-menu';
import { createHub } from '../../src/hub-core';
import { createLibrary } from '../../src/library';
import type { Said } from '../../src/manager-api';
import { createManagerClient } from '../../src/manager-client';
import { fit } from '../../src/manager/sticker';
import { createFakeExe } from '../../src/shell-fake';
import { MENU_CHANNEL, broadcastWire, type Wire } from '../../src/wire';

export interface Seed { name: string; art: string; out?: number }
export interface Boot {
  buddies: Seed[];
  /* the real seed instead, with nothing else in the library */
  firstRun?: boolean;
  /* the disk refuses to list anything, so the hub can't get ready */
  stuck?: boolean;
  /* this many rows reach the page with their image as a data URL */
  dataRows?: number;
  /* the apps with a window open */
  apps?: string[];
}

const monitor = { i: 0, name: 'A', primary: true, scale: 1, x: 0, y: 0, w: 1920, h: 1040, full: { x: 0, y: 0, w: 1920, h: 1080 } };
const dataUrl = (b: Blob) => new Promise<string>(done => { const r = new FileReader(); r.onload = () => done(r.result as string); r.readAsDataURL(b); });
const fetched = async (url: string) => dataUrl(await (await fetch(url)).blob());

const frames = new Map<string, Promise<Buddy['base']>>();
const baseOf = (art: string) => {
  if (!frames.has(art)) frames.set(art, fetched(art).then(src => processBase(src)).then(b => b!.frame));
  return frames.get(art)!;
};

async function boot(o: Boot) {
  const exe = createFakeExe({ monitors: [monitor] }), library = createLibrary(exe.shell, () => {});
  const out: string[] = [], ids: Record<string, string> = {};
  for (const s of o.buddies) {
    const character = newCharacter(), buddy: Buddy = { character, name: s.name, base: await baseOf(s.art), poses: {} };
    await library.add(write(buddy));
    for (let i = 0; i < (s.out || 0); i++) out.push(character);
    ids[s.name] = character;
  }
  if (!o.firstRun) await exe.shell.dataWrite('settings.json', JSON.stringify({ out, noSeed: true }));
  const unstick = o.stuck ? exe.failUntil('data_list', 'the disk is busy', () => true) : () => {};

  const real = broadcastWire<Said>();
  const dataRows = o.dataRows || 0;
  const pictures = new Map<string, string>();
  const wire: Wire<Said> = {
    ...real,
    post(m) {
      if (m.k !== 'state' || !dataRows) return real.post(m);
      void (async () => {
        const buddies = await Promise.all(m.state.buddies.map(async (b, i) => {
          if (i >= dataRows) return b;
          if (!pictures.has(b.image)) { const bytes = await exe.shell.dataRead(b.image.split('?')[0]!); pictures.set(b.image, await dataUrl(new Blob([bytes as BlobPart], { type: 'image/png' }))); }
          return { ...b, image: pictures.get(b.image)! };
        }));
        real.post({ ...m, state: { ...m.state, buddies } });
      })();
    }
  };
  const hub = createHub({ shell: exe.shell, send: () => {}, seed: async () => (await fetch('/__sample.json')).text(), after: (ms, f) => { setTimeout(f, ms); }, wire, menuWire: broadcastWire<Said>(MENU_CHANNEL) });
  exe.setWindows((o.apps || []).map((exe, i) => ({ id: i + 1, x: 200, y: 300, w: 800, h: 500, z: i, max: false, topmost: false, tool: false, layered: false, class: 'App', exe })));
  await hub.start();
  const client = createManagerClient({
    wire: broadcastWire<Said>(), session: 'harness' + Math.random(),
    after: (ms, f) => { const t = setTimeout(f, ms); return () => clearTimeout(t); },
    shimeji: async () => null, closeWindow: async () => {}
  });
  return { exe, hub, client, ids, unstick };
}

type Run = Awaited<ReturnType<typeof boot>>;
let run: Run;
const asker = broadcastWire<Said>(MENU_CHANNEL);

const b64 = (bytes: Uint8Array) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
/* The bake on one image, with where the time goes. */
async function bakeTimes(url: string, rounds = 12) {
  const shown = (w: number, h: number) => fit(w, h);
  const im = await new Promise<HTMLImageElement>((done, fail) => { const i = new Image(); i.onload = () => done(i); i.onerror = fail; i.src = url; });
  const [w, h] = shown(im.naturalWidth, im.naturalHeight), aw = Math.round(w * DETAIL), ah = Math.round(h * DETAIL);
  const times = { read: [] as number[], core: [] as number[], whole: [] as number[] };
  let o: Outline | null = null;
  for (let i = 0; i < rounds; i++) {
    const a = performance.now(), alpha = alphaOf(im, aw, ah), b = performance.now();
    o = outlineOf(alpha, w / aw);
    const c = performance.now();
    await outlineOfImage(url, shown);
    const d = performance.now();
    times.read.push(b - a); times.core.push(c - b); times.whole.push(d - c);
  }
  const mid = (l: number[]) => [...l].sort((x, y) => x - y)[l.length >> 1]!;
  return { first: times.whole[0]!, read: mid(times.read), core: mid(times.core), whole: mid(times.whole), natural: [im.naturalWidth, im.naturalHeight], shown: [w, h], shape: o!.shape, loops: o!.loops.map(l => ({ scaled: l.length / (aw / im.naturalWidth) })) };
}

Object.assign(window, {
  H: {
    boot: async (o: Boot) => { run = await boot(o); await run.hub.settled; return run.ids; },
    state: () => run.client.state,
    settled: () => run.hub.settled,
    /* what the exe's asset provider would serve */
    file: (path: string) => { const f = run.exe.files.get(path); return f ? b64(f) : null; },
    unstick: () => run.unstick(),
    client: () => run.client,
    exe: () => run.exe,
    /* A right-click on her, as an overlay says it, on the menu's own channel. */
    ask: (copy: string, her = { x: 500, y: 400, w: 160, h: 160 }, at = { x: 580, y: 450 }) =>
      asker.post({ k: 'menu-ask', copy, her, at, t: performance.timeOrigin + performance.now() }),
    /* the menu window as the fake exe holds it, and the exe calls about it */
    /* the menu's window: each has a label of its own, so the one there is now */
    menuLabel: () => [...run.exe.windows.keys()].find(isMenu) ?? null,
    menu: () => { const l = [...run.exe.windows.keys()].find(isMenu), w = l ? run.exe.windows.get(l) as { hidden: boolean; x?: number; y?: number; w?: number; h?: number } : undefined; return w ? { hidden: w.hidden, x: w.x, y: w.y, w: w.w, h: w.h } : null; },
    menuCalls: () => run.exe.calls.filter(c => c.cmd.startsWith('window_') && JSON.stringify(c.args).includes('buddy-menu')).map(c => c.cmd),
    bakeTimes
  }
});
