/* The edge shots' page probe. edge-shots.ps1 adds it to hub.html in its own copy of the app, with
   world-probe.js in place of world.js. It imports a buddy the way the Manager does, through the real
   hub, calls her out, then puts her in each pose that meets an edge, on the real screen floor and on
   a real window, and says where she's drawn. The driver takes a screenshot at each step and answers
   through the data folder. It never ships. Nothing here logs a buddy's name or id. */
import { fromFile } from '../src/handed';
import type { HubState } from '../src/manager-api';
import { createManagerClient } from '../src/manager-client';
import { createShell, text } from '../src/shell';
import { broadcastWire } from '../src/wire';
import { afterDizzy, DANGLE, type At, type Op } from './edge-world';

const shell = createShell(window.__TAURI__);
const say = (line: string) => shell.log('PROBE ' + line);
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
/* how long a pose is left for the overlay to draw before the screenshot */
const SETTLE_MS = 1000;

type Reply = { k: 'probe'; n: number; ok: boolean; why?: string } & Record<string, unknown>;
interface Rect { id: string; kind: string; rect: { x: number; y: number; w: number; h: number }; z: number; terrain: boolean; cut: string[] }
interface Scene { ok: boolean; areas: { i: number }[]; rects: Rect[]; pets: { id: string; state: string; on: string }[]; art: Record<string, Record<string, { shows: string; frames: number }>> }

const port = new SharedWorker('world.js', { name: 'world' }).port;
const waiting = new Map<number, (r: Reply) => void>();
let asked = 0;
port.onmessage = e => { if (e.data && e.data.k === 'probe') waiting.get(e.data.n)?.(e.data); };
port.start();
function ask(m: Op) {
  return new Promise<Reply>(done => { const n = ++asked; waiting.set(n, r => { waiting.delete(n); done(r); }); port.postMessage({ k: 'probe', n, ...m }); });
}
const scene = async () => (await ask({ op: 'scene' })) as unknown as Scene;

async function until(what: string, f: () => unknown | Promise<unknown>, ms = 20000) {
  for (const t = Date.now(); Date.now() - t < ms;) { if (await f()) return true; await pause(100); }
  void say(`gave up waiting: ${what}`);
  return false;
}

let shots = 0;
async function acked(n: number) {
  return until(`ack ${n}`, async () => (await shell.dataRead('probe-ack.txt').then(text, () => '')).trim() === String(n), 30000);
}
async function step(name: string, numbers: unknown) {
  const n = ++shots;
  await say(`STEP shot ${n} ${name} ${JSON.stringify(numbers)}`);
  await acked(n);
}
/* `name` can be worked out from the reply, for a shot named by what's drawn. */
async function shot(name: string | ((r: Reply) => string), m: Omit<Extract<Op, { op: 'pose' }>, 'op'>) {
  const r = await ask({ op: 'pose', ...m });
  if (typeof name !== 'string') name = r.ok ? name(r) : 'unnamed';
  if (!r.ok) { await say(`FAIL shot ${name} ${r.why}`); return; }
  const { k: _k, n: _n, ok: _ok, ...numbers } = r;
  await pause(SETTLE_MS);
  await step(name, numbers);
}
/* the first, middle and last frames */
const spread = (n: number) => [...new Set([0, (n - 1) >> 1, n - 1])].filter(i => i >= 0);

(async () => {
  const info = await shell.info(), flag = info.args.indexOf('--edge-window');
  if (flag < 0) return;
  const [wx, wy, ww, wh] = info.args[flag + 1]!.split(',').map(Number) as [number, number, number, number];
  try {
    const monitors = await shell.monitors();
    await say(`monitors ${JSON.stringify(monitors)}`);
    await say(`system ${JSON.stringify(await shell.system())}`);
    const client = createManagerClient({
      wire: broadcastWire(), session: 'edge' + Date.now(),
      after: (ms, f) => { const t = setTimeout(f, ms); return () => clearTimeout(t); },
      shimeji: async () => null, closeWindow: async () => {}
    });
    const first = await new Promise<HubState>(done => { const stop = client.subscribe(s => { if (s.ready) { queueMicrotask(() => stop()); done(s); } }); });

    const near = (r: Rect['rect']) => Math.abs(r.x - wx) <= 2 && Math.abs(r.y - wy) <= 2 && Math.abs(r.w - ww) <= 2 && Math.abs(r.h - wh) <= 2;
    let s: Scene | null = null;
    const windowUp = () => until('the window', async () => { s = await scene(); return s.ok && s.pets.length > 0 && s.rects.some(r => r.kind === 'window' && r.terrain && near(r.rect)); }, 30000);
    if (!await windowUp()) { await say(`FAIL window ${JSON.stringify((s as Scene | null)?.rects ?? null)}`); return; }
    const win = s!.rects.find(r => r.kind === 'window' && r.terrain && near(r.rect))!;
    const primary = monitors.find(m => m.primary) ?? monitors[0]!;
    const screen = `monitor${primary.i}`, floorName = primary.h < primary.full.h ? 'taskbar' : 'screen-floor';
    /* what's in front of the window and reaches into it, which would hide its edges */
    const over = s!.rects.filter(r => r.kind === 'window' && r.z > win.z && r.rect.x < win.rect.x + win.rect.w && r.rect.x + r.rect.w > win.rect.x && r.rect.y < win.rect.y + win.rect.h && r.rect.y + r.rect.h > win.rect.y);
    await say(`scene ${JSON.stringify({ window: win, screen: s!.rects.find(r => r.id === screen), floor: floorName, over })}`);

    /* The control: the seed buddy on the floor, then hidden, which is also what every shot is compared against. */
    const seed = s!.pets[0]!;
    await shot(`control.${floorName}`, { id: seed.id, at: { owner: screen, kind: 'floor', f: .15 }, state: 'idle', frame: 0, dir: 1 });
    await client.setHidden(true);
    await until('hidden', () => client.state?.hidden);
    await pause(1500);
    await step('control.hidden', {});
    await client.setHidden(false);
    await until('shown', () => client.state && !client.state.hidden);
    if (!await windowUp()) return say('FAIL window back');
    await ask({ op: 'release' });
    await client.dismiss(first.buddies[0]!.id);
    if (!await until('the seed gone', async () => (await scene()).pets.length === 0)) return say('FAIL seed gone');

    /* Her, the way the Manager brings in a file. */
    const bytes = await shell.dataRead('probe-in/buddy.buddy');
    const t = Date.now();
    const [answer] = await client.importFiles([fromFile(new File([bytes as BlobPart], 'edge.buddy'), 'edge.buddy')], { call: true });
    await shell.dataDelete('probe-in');
    /* A big buddy can take the hub longer than the client waits for an answer, so she counts once she's out. */
    await say(`import ${JSON.stringify({ ok: !!answer?.ok, ms: Date.now() - t, why: answer && !answer.ok ? answer.failure.why : null })}`);
    let her: Scene['pets'][number] | undefined;
    if (!await until('her out', async () => { s = await scene(); her = s.pets[0]; return her && her.on !== 'air'; }, 120000)) return say('FAIL her out');
    await pause(1500);
    const art = s!.art[her!.id]!;
    await say(`art ${JSON.stringify(Object.fromEntries(Object.entries(art).filter(([k, v]) => k === v.shows).map(([k, v]) => [k, v.frames])))}`);
    const id = her!.id, frames = (pose: string) => spread(art[pose]!.frames);

    const floors: [string, At][] = [['window-top', { owner: win.id, kind: 'floor', f: .5 }], [floorName, { owner: screen, kind: 'floor', f: .15 }]];
    const FLOOR: [string, string][] = [['stand', 'idle'], ['think', 'think'], ['walk', 'walk'], ['sit', 'sit'], ['watch_cursor', 'watch_cursor'], ['tap_screen', 'tap_screen'], ['knocked_out', 'knocked_out'], ['sprawl', 'trip'], ['dangle_legs', DANGLE]];
    for (const [where, at] of floors) {
      for (const [pose, state] of FLOOR) for (const f of frames(pose)) await shot(`${pose}.${where}.f${f}`, { id, at, state, frame: f, dir: 1 });
      /* Dizzy's last frame, then what really follows as her hold ends, so the jump between them shows:
         Stand up after a Dizzy drawn low, straight on after one drawn standing. */
      await shot(`dizzy.${where}.last`, { id, at, state: 'dizzy', frame: art.dizzy!.frames - 1, dir: 1 });
      const next = { id, at, state: 'dizzy', finish: true, dir: 1 } as const, after = afterDizzy(await ask({ op: 'pose', ...next, frame: 0 }));
      if (!after) await say(`FAIL shot after-dizzy.${where} nothing to show`);
      else for (let f = 0; f < Math.min(4, after.frames); f++) await shot(r => `after-dizzy.${where}.${afterDizzy(r)!.name(f)}`, { ...next, frame: f });
    }
    for (const [where, side] of [['window-left', -1], ['window-right', 1]] as const) {
      for (const pose of ['climb', 'wall']) for (const f of frames(pose)) await shot(`${pose}.${where}.f${f}`, { id, at: { owner: win.id, kind: 'wall', side, f: .5 }, state: pose, frame: f, dir: 1 });
    }
    for (const pose of ['hang', 'crawl']) for (const f of frames(pose)) await shot(`${pose}.window-bottom.f${f}`, { id, at: { owner: win.id, kind: 'ceil', f: .5 }, state: pose, frame: f, dir: 1 });
    await say('STEP done');
  } catch (e) { await say(`FAIL threw ${String(e)}`); }
  finally { await pause(500); await shell.quit(); }
})();
