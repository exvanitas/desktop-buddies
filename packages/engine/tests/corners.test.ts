/* Round a window's outer corner near a screen's edge, where the usual swing has no room: she steps
   past the corner and tips over it. Measured on her turned box as drawn, over the turn, against how
   she's drawn the tick before it and once it's over (her climbing tips her into a wall a little
   anyway) and against the same corner with room all round. */
import assert from 'node:assert';
import { test, vi } from 'vitest';
import { corners, label, run, type Corner, type Run } from './corners';

/* every tick, whether she was drawn going round a corner, and stepping past it */
const seen = vi.hoisted(() => ({ corner: false, tip: false }));
vi.mock('../src/ease', async real => {
  const ease = await real<typeof import('../src/ease')>();
  return { ...ease, eased: (...a: Parameters<typeof ease.eased>) => { const r = ease.eased(...a); if (r && a[0].corner) { seen.corner = true; if (a[0].tip) seen.tip = true; } return r; } };
});
const { eased } = await import('../src/ease');
type Easing = import('../src/ease').Easing;
type Size = import('../src/ease').Size;

const key = (c: Corner) => `${c.way} ${c.side} ${c.size} ${c.shape} ${c.art}`;
const roomy = (c: Corner) => c.gap >= 5 * c.size && c.above >= 5 * c.size && c.below >= 5 * c.size;
let runs: Run[] | null = null;
/* every corner once, for all the tests below */
function all() {
  if (!runs) runs = corners({ both: true }).map(c => run(c, { easing: seen }));
  return runs;
}
const twins = () => new Map(all().filter(r => roomy(r.corner)).map(r => [key(r.corner), r]));
/* the window tucked into a screen's corner, with less room either way than her art needs to tip:
   g sin(a) + t cos(a) >= h + w sin(a) cos(a) at every turn a fails for art as wide as she is tall */
const boxedIn = (c: Corner) => c.gap < 5 * c.size && (c.above < 5 * c.size || c.below < 5 * c.size) && c.shape === 'square' && Math.min(c.gap, c.above, c.below) / c.size < 1.1;

test('round a window\'s corner near a screen\'s edge, she always goes round, and the turn is over before she\'s measured after it', () => {
  assert.deepStrictEqual(all().filter(r => !r.went || r.done < 0).map(r => label(r.corner)), []);
}, 120000);

test('near a screen\'s edge, she steps past the corner and tips over it: never into the window deeper than at either end or than with room', () => {
  const twin = twins(), seen: string[] = [];
  for (const r of all()) {
    if (roomy(r.corner) || boxedIn(r.corner)) continue;
    const bound = Math.max(r.ends.win, twin.get(key(r.corner))!.deepest), over = Math.max(...r.wins) - bound;
    /* a 150th of her size: 3.4 px for a 512 px buddy. The swing she had went up to 0.15 of her size. */
    if (over > r.corner.size / 150) seen.push(`${label(r.corner)}: ${over.toFixed(1)} px deeper`);
  }
  assert.deepStrictEqual(seen, []);
}, 120000);

test('near a screen\'s edge, she\'s never drawn further off the screen than at either end', () => {
  const seen = all().filter(r => r.offs.some(d => d > r.ends.off + .5)).map(r => `${label(r.corner)}: ${Math.max(...r.offs).toFixed(1)} px off, ${r.ends.off.toFixed(1)} at the ends`);
  assert.deepStrictEqual(seen, []);
}, 120000);

/* The most she moves and turns in a tick round any corner with room, at her size: the bar for no
   snap. Her middle, the edge of her box that moves most, and her turn. */
function bar(size: number) {
  const room = all().filter(r => r.corner.size === size && roomy(r.corner));
  return { mid: Math.max(...room.map(r => r.mid)), move: Math.max(...room.map(r => r.move)), turn: Math.max(...room.map(r => r.turn)) };
}

/* Stepping past, she moves no more in a tick than round any corner with room at her size, and
   turns no more than round the same corner with room. Measured at most 25.9 px of her middle at
   512 px, against 42.5 with room, and her turn at least 0.2 degrees under the same corner's. */
test('stepping past and tipping over, she moves in a tick no more than round any corner with room at her size, and turns no more than round the same corner with room', () => {
  const twin = twins(), out: string[] = [];
  const tips = all().filter(r => r.tip);
  /* at a twentieth more than her size of room on one side, her turned art always steps past */
  assert.ok(tips.length >= 183, `${tips.length} stepped past`);
  for (const r of tips) {
    const t = twin.get(key(r.corner))!;
    if (r.turn > t.turn) out.push(`${label(r.corner)}: turned ${r.turn.toFixed(2)} degrees in a tick, ${t.turn.toFixed(2)} with room`);
    const most = bar(r.corner.size);
    if (r.mid > most.mid || r.move > most.move) out.push(`${label(r.corner)}: moved ${r.move.toFixed(1)} px, her middle ${r.mid.toFixed(1)}, in a tick, against ${most.move.toFixed(1)} and ${most.mid.toFixed(1)} with room`);
  }
  assert.deepStrictEqual(out, []);
}, 120000);

test('boxed into a screen\'s corner with no room to tip, she still goes round on the screen without a jump', () => {
  const out: string[] = [];
  for (const r of all().filter(r => boxedIn(r.corner))) {
    if (r.tip) out.push(`${label(r.corner)}: stepped past`);
    if (r.mid > Math.max(45, r.corner.size / 9)) out.push(`${label(r.corner)}: her middle moved ${r.mid.toFixed(1)} px in a tick`);
    /* On the screen beats clear of the window: drawn over its corner a moment, as she always was
       there. Measured up to 0.19 of her size past her ends. */
    if (Math.max(...r.wins) > r.corner.size / 5 + r.ends.win) out.push(`${label(r.corner)}: ${Math.max(...r.wins).toFixed(1)} px into the window`);
  }
  assert.deepStrictEqual(out, []);
}, 120000);

/* ---------- one corner, frame by frame ---------- */

/* An outer corner turning clockwise, from standing on a window's top onto its right side: its
   point, a buddy as wide as she is tall (120 px unless said), where she's drawn at the start and
   where she is. */
function corner(pivot: { x: number; y: number }, screen: { w: number; h: number }, px = 120) {
  const size: Size = { w: px, h: px, k: 1 };
  const k = { pivot: { ...pivot }, wind: 1, na: { x: 0, y: -1 }, nb: { x: 1, y: 0 }, inner: false };
  const c0 = { x: pivot.x - px / 2, y: pivot.y - px / 2 }, c1 = { x: pivot.x + px / 2, y: pivot.y + px / 2 };
  const e: Easing = { from: 0, n: 12, rot: 0, c: c0, d: { x: 0, y: 0 }, corner: k, on: 'w', room: [{ x: 0, y: 0, w: screen.w, h: screen.h }], size0: size };
  return { e, c1, size };
}
type Pt = { x: number; y: number };
/* Drives a turn tick by tick until it's over. `move` is how far the window goes each of the first
   `ticks` (a fixed step, or one for each tick), carrying the corner and both ends with it, as the
   look does; `on` how far she goes along the side each tick; `at` where she is on the side at each
   tick, from where she'd be standing still. */
function drive(e: Easing, c1: Pt, size: Size, o: { move?: Pt | ((t: number) => Pt); ticks?: number; on?: Pt; at?: (t: number) => Pt } = {}) {
  const out: { c: Pt; rot: number; to: Pt }[] = [], to = { ...c1 };
  for (let now = 0; now < 600; now++) {
    const m = typeof o.move === 'function' ? o.move(now) : o.move;
    if (now && m && now <= (o.ticks ?? Infinity)) { e.corner!.pivot.x += m.x; e.corner!.pivot.y += m.y; e.c = { x: e.c.x + m.x, y: e.c.y + m.y }; to.x += m.x; to.y += m.y; }
    if (now && o.on) { to.x += o.on.x; to.y += o.on.y; }
    const d = o.at ? o.at(now) : { x: 0, y: 0 }, there = { x: to.x + d.x, y: to.y + d.y };
    const at = eased(e, now, there, 90, size);
    if (!at) return out;
    out.push({ ...at, to: there });
  }
  throw new Error('the turn never ended');
}
const most = (seq: { c: { x: number; y: number }; rot: number }[]) => {
  let move = 0, turn = 0;
  for (let i = 1; i < seq.length; i++) { move = Math.max(move, Math.hypot(seq[i]!.c.x - seq[i - 1]!.c.x, seq[i]!.c.y - seq[i - 1]!.c.y)); turn = Math.max(turn, Math.abs(seq[i]!.rot - seq[i - 1]!.rot)); }
  return { move, turn };
};
/* how far her turned box, its middle at c, reaches past the screen's edges */
const offScreen = (c: { x: number; y: number }, rot: number, size: Size, w: number, h: number) => {
  const a = rot * Math.PI / 180, ex = Math.abs(Math.cos(a)) * size.w / 2 + Math.abs(Math.sin(a)) * size.h / 2, ey = Math.abs(Math.sin(a)) * size.w / 2 + Math.abs(Math.cos(a)) * size.h / 2;
  return Math.max(0, ex - c.x, c.x + ex - w, ey - c.y, c.y + ey - h);
};

test('stepping past starts where the swing starts and ends where it ends: where she was drawn, then where she is', () => {
  const { e, c1, size } = corner({ x: 1474, y: 300 }, { w: 1600, h: 900 }), c0 = { ...e.c };
  const seq = drive(e, c1, size);
  assert.ok(e.tip || seq.length, 'drawn');
  const first = seq[0]!, last = seq[seq.length - 1]!;
  assert.ok(Math.hypot(first.c.x - c0.x, first.c.y - c0.y) < 1e-6 && Math.abs(first.rot) < 1e-6, `first tick ${JSON.stringify(first)}`);
  /* the tick after the last is drawn where she is: the last is no further from it than a step */
  assert.ok(Math.hypot(last.c.x - c1.x, last.c.y - c1.y) <= 20 && Math.abs(last.rot - 90) <= 12, `last tick ${JSON.stringify(last)}`);
  /* the swing starts where she was drawn too */
  const room = corner({ x: 1474, y: 300 }, { w: 9000, h: 900 }), swing = eased(room.e, 0, room.c1, 90, room.size)!;
  assert.ok(!room.e.tip, 'with room she swings');
  assert.ok(Math.hypot(swing.c.x - c0.x, swing.c.y - c0.y) < 1e-6 && Math.abs(swing.rot) < 1e-6, `swing's first tick ${JSON.stringify(swing)}`);
});

test('stepping past, she moves and turns in a tick no more than the same corner\'s swing with room, her side moving on or not', () => {
  for (const on of [undefined, { x: 0, y: 2 }]) {
    const tight = corner({ x: 1474, y: 300 }, { w: 1600, h: 900 }), steps = most(drive(tight.e, tight.c1, tight.size, { on }));
    assert.ok(tight.e.tip !== undefined || steps.move > 0);
    const room = corner({ x: 1474, y: 300 }, { w: 9000, h: 900 }), swing = most(drive(room.e, room.c1, room.size, { on }));
    const name = on ? 'her side moving on' : 'standing';
    assert.ok(steps.move <= swing.move, `${name}: her middle moved ${steps.move.toFixed(2)} px in a tick, ${swing.move.toFixed(2)} with room`);
    assert.ok(steps.turn <= swing.turn, `${name}: turned ${steps.turn.toFixed(2)} degrees in a tick, ${swing.turn.toFixed(2)} with room`);
  }
});

test('stepping past while her window moves, into the screen\'s edge or away from it, she stays on the screen and never jumps', () => {
  for (const dy of [-1, 1]) {
    const { e, c1, size } = corner({ x: 1474, y: 130 }, { w: 1600, h: 1000 });
    const seq = drive(e, c1, size, { move: { x: 0, y: dy }, ticks: 10 }), name = dy < 0 ? 'up into the screen\'s top' : 'down, away from it';
    const off = Math.max(...seq.map(s => offScreen(s.c, s.rot, size, 1600, 1000)));
    /* both ends stay on the screen however far the window goes: 10 px up from 10 px below its top */
    assert.ok(off <= .5, `${name}: drawn ${off.toFixed(2)} px off the screen`);
    const s = most(seq), b = bar(120);
    assert.ok(s.move <= b.mid && s.turn <= b.turn, `${name}: moved ${s.move.toFixed(1)} px, turned ${s.turn.toFixed(1)} degrees in a tick, against ${b.mid.toFixed(1)} and ${b.turn.toFixed(1)} with room`);
  }
}, 120000);

/* Codex's case: a corner a twentieth more than her size from the screen's right edge, where she's
   going on the side wobbling 3 px from tick to tick, while her window stands, drifts down 1.5 px a
   tick, sways up and down by up to 2 px a tick, or drifts away from the edge 1 px a tick. (Towards
   the edge it would carry her ends off the screen, which no way round can help.) The way is worked
   out again every tick, so as drawn she can move a little more than its own pace: the bar is no
   snap, steps and turns no bigger than round any corner with room at her size, on the screen. */
test('stepping past while her window moves and where she\'s going wobbles, at 120 and 512 px, she stays on the screen and never moves or turns more in a tick than with room', () => {
  const out: string[] = [];
  for (const px of [120, 512]) {
    const b = bar(px), pivot = { x: px === 512 ? 1083 : 1600 - 126, y: 600 };
    for (const [name, move] of [['standing', undefined], ['drifting down', { x: 0, y: 1.5 }], ['swaying', (t: number) => ({ x: 0, y: 2 * Math.sin(.15 * t) })], ['drifting away', { x: -1, y: 0 }]] as const) {
      const { e, c1, size } = corner(pivot, { w: 1600, h: 1600 }, px);
      const seq = drive(e, c1, size, { move, at: t => ({ x: 3 * Math.sin(.2 * t), y: 0 }) });
      if (!e.tip) out.push(`${px} ${name}: swung rather than stepping past`);
      const off = Math.max(...seq.map(s => offScreen(s.c, s.rot, size, 1600, 1600))), s = most(seq);
      if (off > .5) out.push(`${px} ${name}: drawn ${off.toFixed(2)} px off the screen`);
      if (s.move > b.mid || s.turn > b.turn) out.push(`${px} ${name}: moved ${s.move.toFixed(1)} px, turned ${s.turn.toFixed(2)} degrees in a tick, against ${b.mid.toFixed(1)} and ${b.turn.toFixed(2)} with room`);
    }
  }
  assert.deepStrictEqual(out, []);
}, 120000);
