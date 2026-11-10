// @vitest-environment happy-dom
/* She can sink past the work area's edge, onto the taskbar's strip, and still be seen and held there:
   each overlay is its monitor's screen less one line across from the taskbar, while the world's floor,
   walls and ceiling stay the work area's. The cursor over the strip and not over her is never taken from the taskbar. On the
   real host and engine, with a made-up buddy. */
import assert from 'node:assert';
import type { Frame, Pose, PoseKey } from '@buddies/buddy-file';
import type { BuddyData, PetFrame, Frame as ViewFrame } from '@buddies/engine';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { addDangle, createPoser, type At } from '../shell-check/edge-world';
import { make, pointed } from '../src/hit';
import { createHost, viewport, type Area, type Message, type Port } from '../src/host';
import { overlayRect } from '../src/overlay-rect';

const BB = { x0: .25, y0: .1, x1: .75, y1: .9 };
let img = 0;
const frame = (): Frame => ({ src: `data:image/png;base64,T${++img}`, bb: BB });
const pose = (): Pose => ({ frames: [frame()], fps: 6 });
const POSES: Partial<Record<PoseKey, Pose>> = { stand: pose(), walk: pose(), hang: pose(), wall: pose(), climb: pose() };
/* sunk well into every surface: 36 of the strip's 40 px at her size */
const BUDDY: BuddyData = { id: 'b0', size: 120, faces: 'right', base: frame(), poses: POSES, lift: { floor: -.3, wall: -.3, ceiling: -.3 } };

/* Every image's mask is solid over BB, the way her art is: a cell is solid where BB covers it. */
const N = 64;
beforeEach(() => {
  const solid = new Uint8ClampedArray(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if ((i + .5) / N >= BB.x0 && (i + .5) / N < BB.x1 && (j + .5) / N >= BB.y0 && (j + .5) / N < BB.y1) solid[(j * N + i) * 4 + 3] = 255;
  vi.stubGlobal('Image', class { onload: (() => void) | null = null; set src(_: string) { queueMicrotask(() => this.onload?.()); } });
  const real = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((t: string) => t === 'canvas'
    ? { getContext: () => ({ drawImage() {}, getImageData: () => ({ data: solid }) }) } : real(t)) as typeof document.createElement);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

type Side = 'bottom' | 'top' | 'left' | 'right' | 'hidden';
/* a 1920 x 1080 screen at x with a taskbar 40 CSS px thick on one side, or set to hide */
function monitor(i: number, side: Side, x = 0, scale = 1): Area {
  const full = { x, y: 0, w: 1920, h: 1080 }, t = 40 * scale;
  const work = side === 'bottom' ? { ...full, h: 1080 - t } : side === 'top' ? { ...full, y: t, h: 1080 - t }
    : side === 'left' ? { ...full, x: x + t, w: 1920 - t } : side === 'right' ? { ...full, w: 1920 - t } : full;
  return { i, scale, ...work, full };
}

function desk(areas: Area[]) {
  addDangle();
  let t = 0;
  const every: { ms: number; f: () => void; next: number }[] = [];
  const host = createHost({ random: () => .5, now: () => t, note: () => {}, after: () => 0, cancel: () => {}, every: (ms, f) => { every.push({ ms, f, next: ms }); } });
  const poser = createPoser(host), hub: Port = { postMessage() {} };
  host.connect(hub);
  const send = (m: Message) => { if (poser.heard(m)) { host.message(hub, m); poser.after(m); } };
  /* one overlay per monitor, keeping what it's sent */
  const overlays = areas.map((a, n) => {
    /* an image is sent once, so the view keeps the last one it had, as it does */
    let last: PetFrame[] = [];
    const src = new Map<string, string>();
    const port: Port = { postMessage(m) {
      const x = m as { k: string; frame: ViewFrame };
      if (x.k !== 'frame') return;
      last = (JSON.parse(JSON.stringify(x.frame)) as ViewFrame).pets.map(p => { if (p.src) src.set(p.id, p.src); return { ...p, src: src.get(p.id) }; });
    } };
    host.connect(port);
    return { a, port, n, shown: () => last };
  });
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { t += 16; for (const e of every) if (t >= e.next) { e.next += e.ms; e.f(); } } };
  send({ k: 'start', all: areas, pets: [BUDDY] });
  for (const o of overlays) host.message(o.port, { k: 'join', me: o.a, n: o.n });
  tick(60);
  let n = 0;
  const put = (at: At, state: string) => {
    const r = poser.ask({ k: 'probe', n: ++n, op: 'pose', id: 'b0', at, state, frame: 0, dir: 1 }) as Record<string, any>;
    assert.strictEqual(r.ok, true, r.why);
    tick(2);
    return r as { box: { x0: number; y0: number; x1: number; y1: number } };
  };
  return { host, overlays, put, tick };
}

/* the masks load on the next microtask, as an image would */
async function masked(frames: PetFrame[]) { for (const f of frames) if (f.src) make(f.src); await Promise.resolve(); }
/* What an overlay makes of a screen point, in its window's CSS pixels. */
const at = (o: { a: Area; shown(): PetFrame[] }, x: number, y: number) => { const v = viewport(o.a); return pointed(o.shown(), { x, y }, o.a, { w: v.w!, h: v.h! }); };

/* Per side: where she's put, which way past the work area's edge she sinks, and two screen points on
   the strip, one over her solid middle and one well along from her.
   `edge` is the strip's outer line, the screen's last, and `gone` the line across from it that the
   window leaves out. */
const CASES: { side: Exclude<Side, 'hidden'>; where: At; state: string; past(b: Box, a: Area): boolean; on(b: Box, a: Area): [number, number]; beside(b: Box, a: Area): [number, number]; edge(b: Box, a: Area): [number, number]; gone(b: Box, a: Area): [number, number] }[] = [
  { side: 'bottom', where: { owner: 'monitor0', kind: 'floor' }, state: 'walk', past: (b, a) => b.y1 > a.y + a.h, on: (b, a) => [(b.x0 + b.x1) / 2, a.y + a.h + 10], beside: (b, a) => [b.x1 + 300, a.y + a.h + 10], edge: (b, a) => [b.x1 + 300, a.full.y + a.full.h - 1], gone: (b, a) => [b.x1 + 300, a.full.y] },
  { side: 'top', where: { owner: 'monitor0', kind: 'ceil' }, state: 'hang', past: (b, a) => b.y0 < a.y, on: (b, a) => [(b.x0 + b.x1) / 2, a.y - 10], beside: (b, a) => [b.x1 + 300, a.y - 10], edge: (b, a) => [b.x1 + 300, a.full.y], gone: (b, a) => [b.x1 + 300, a.full.y + a.full.h - 1] },
  { side: 'left', where: { owner: 'monitor0', kind: 'wall', side: 1 }, state: 'wall', past: (b, a) => b.x0 < a.x, on: (b, a) => [a.x - 10, (b.y0 + b.y1) / 2], beside: (b, a) => [a.x - 10, b.y1 + 300], edge: (b, a) => [a.full.x, b.y1 + 300], gone: (b, a) => [a.full.x + a.full.w - 1, b.y1 + 300] },
  { side: 'right', where: { owner: 'monitor0', kind: 'wall', side: -1 }, state: 'wall', past: (b, a) => b.x1 > a.x + a.w, on: (b, a) => [a.x + a.w + 10, (b.y0 + b.y1) / 2], beside: (b, a) => [a.x + a.w + 10, b.y1 + 300], edge: (b, a) => [a.full.x + a.full.w - 1, b.y1 + 300], gone: (b, a) => [a.full.x, b.y1 + 300] }
];
type Box = { x0: number; y0: number; x1: number; y1: number };

for (const c of CASES) test(`taskbar on the ${c.side}: a negative lift shows past the edge, she's held there, and the strip keeps every other click`, async () => {
  const a = monitor(0, c.side), d = desk([a]), o = d.overlays[0]!;
  const r = d.put(c.where, c.state), b = r.box;
  assert.ok(c.past(b, a), `she sinks past the work area: ${JSON.stringify(b)} in ${JSON.stringify(a)}`);
  const f = o.shown().find(x => x.id === 'b0')!;
  assert.strictEqual(f.off, false);
  await masked(o.shown());
  const [hx, hy] = c.on(b, a), [mx, my] = c.beside(b, a);
  const hit = at(o, hx, hy), miss = at(o, mx, my);
  assert.ok(hit.inside && miss.inside, 'the strip is inside the overlay\'s window');
  assert.strictEqual(hit.id, 'b0', `over her on the strip at ${hx},${hy}: she takes the mouse`);
  assert.strictEqual(miss.id, null, `over the strip, not her, at ${mx},${my}: the taskbar keeps it`);
  /* one line short of the monitor, across from the taskbar: the strip's outer line is the window's, that one isn't */
  const w = overlayRect(a);
  assert.ok(w.w * w.h === a.full.w * a.full.h - (w.w === a.full.w ? a.full.w : a.full.h), JSON.stringify(w));
  assert.strictEqual(at(o, ...c.edge(b, a)).inside, true, 'the strip\'s outer line is inside the window');
  assert.strictEqual(at(o, ...c.gone(b, a)).inside, false, 'the line across from it is not');
  /* drawn from the window's own corner */
  const desktop = d.host.sim!.frame({ x: 0, y: 0, scale: a.scale }).pets[0]!;
  assert.ok(Math.abs(desktop.box.l - f.box.l - w.x / a.scale) < 1e-9 && Math.abs(desktop.box.t - f.box.t - w.y / a.scale) < 1e-9, `${JSON.stringify(desktop.box)} ${JSON.stringify(f.box)}`);
  /* the terrain didn't move: her surface is still the work area's edge */
  const s = d.host.sim!.pets.get('b0')!.P.on!.surface;
  assert.strictEqual(s.at, c.side === 'bottom' ? a.y + a.h : c.side === 'top' ? a.y : c.side === 'left' ? a.x : a.x + a.w);
});

test('a hidden taskbar: the work area is the whole screen, and the overlay leaves out its top line', () => {
  const a = monitor(0, 'hidden', 0, 1.5);
  assert.deepStrictEqual(viewport(a), { x: 0, y: 1, scale: 1.5, w: 1280, h: 1079 / 1.5 });
});

test('the overlay\'s CSS pixels start at its window\'s corner, on the screen\'s, not the work area\'s', () => {
  const want = { top: [1920, 0, 1280, 1079 / 1.5], left: [1920, 0, 1919 / 1.5, 720] };
  for (const side of ['top', 'left'] as const) {
    const a = monitor(0, side, 1920, 1.5), v = viewport(a);
    assert.deepStrictEqual([v.x, v.y, v.w, v.h], want[side], side);
  }
});

test('two monitors, different taskbars and scales: the one she sinks into shows her and takes the mouse over her, the other never does', async () => {
  const A = monitor(0, 'bottom'), B = monitor(1, 'left', 1920, 1.5), d = desk([A, B]);
  const r = d.put({ owner: 'monitor1', kind: 'wall', side: 1 }, 'wall'), b = r.box;
  assert.ok(b.x0 < B.x && b.x0 >= B.full.x, `into B's strip, still on B: ${JSON.stringify(b)}`);
  const [oa, ob] = d.overlays as [typeof d.overlays[0], typeof d.overlays[0]];
  await masked(ob.shown()); await masked(oa.shown());
  const y = (b.y0 + b.y1) / 2, x = B.x - 10 * B.scale;
  assert.strictEqual(at(ob, x, y).id, 'b0', 'B takes it over her on its strip');
  assert.strictEqual(at(oa, x, y).inside, false, 'the point is past A\'s window');
  assert.strictEqual(at(ob, x, b.y1 + 300).id, null, 'B\'s strip beside her stays the taskbar\'s');
  /* B draws her in its own CSS pixels from its window's corner, the screen's with the line off its right, not its work area's */
  const f = ob.shown().find(p => p.id === 'b0')!, desktop = d.host.sim!.frame({ x: 0, y: 0, scale: B.scale }).pets[0]!;
  assert.strictEqual(f.off, false);
  assert.ok(Math.abs(desktop.box.l - f.box.l - B.full.x / B.scale) < 1e-9, `${desktop.box.l} ${f.box.l}`);
});
