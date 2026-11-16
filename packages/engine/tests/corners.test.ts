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

/* Stepping past, the way itself goes at most 17 px and 80% of the fastest turn the same corner's
   swing with room has in a tick (the tests below, on the way alone). As drawn, her own climbing,
   walking and animation go on on top: her middle measured up to 25.9 px a tick at 512 px, 19.3
   over what her climbing moves her once she's round, and her turn up to 0.2 degrees under the
   swing's. */
test('stepping past and tipping over, she turns in a tick no more than round the same corner with room, and her middle moves no more than 20 px over what her own climbing moves her', () => {
  const twin = twins(), out: string[] = [];
  const tips = all().filter(r => r.tip);
  /* at a twentieth more than her size of room on one side, her turned art always steps past */
  assert.ok(tips.length >= 183, `${tips.length} stepped past`);
  for (const r of tips) {
    const t = twin.get(key(r.corner))!;
    if (r.turn > t.turn) out.push(`${label(r.corner)}: turned ${r.turn.toFixed(2)} degrees in a tick, ${t.turn.toFixed(2)} with room`);
    if (r.mid > 20 + r.own.mid) out.push(`${label(r.corner)}: her middle moved ${r.mid.toFixed(1)} px in a tick, ${r.own.mid.toFixed(1)} climbing on after`);
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
   point, a 120 px buddy as wide as she is tall, where she's drawn at the start and where she is. */
function corner(pivot: { x: number; y: number }, screen: { w: number; h: number }) {
  const size: Size = { w: 120, h: 120, k: 1 };
  const k = { pivot: { ...pivot }, wind: 1, na: { x: 0, y: -1 }, nb: { x: 1, y: 0 }, inner: false };
  const c0 = { x: pivot.x - 60, y: pivot.y - 60 }, c1 = { x: pivot.x + 60, y: pivot.y + 60 };
  const e: Easing = { from: 0, n: 12, rot: 0, c: c0, d: { x: 0, y: 0 }, corner: k, on: 'w', room: [{ x: 0, y: 0, w: screen.w, h: screen.h }], size0: size };
  return { e, c1, size };
}
/* Drives a turn tick by tick until it's over. `move` is how far the window goes each of the first
   `ticks`, carrying the corner and both ends with it, as the look does; `on` how far she goes along
   the side each tick. */
function drive(e: Easing, c1: { x: number; y: number }, size: Size, o: { move?: { x: number; y: number }; ticks?: number; on?: { x: number; y: number } } = {}) {
  const out: { c: { x: number; y: number }; rot: number; to: { x: number; y: number } }[] = [], to = { ...c1 };
  for (let now = 0; now < 400; now++) {
    if (now && o.move && now <= (o.ticks ?? Infinity)) { e.corner!.pivot.x += o.move.x; e.corner!.pivot.y += o.move.y; e.c = { x: e.c.x + o.move.x, y: e.c.y + o.move.y }; to.x += o.move.x; to.y += o.move.y; }
    if (now && o.on) { to.x += o.on.x; to.y += o.on.y; }
    const at = eased(e, now, to, 90, size);
    if (!at) return out;
    out.push({ ...at, to: { ...to } });
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

test('stepping past, her middle moves no more than 17 px a tick over her own going, and she turns no faster than with room, her side moving on or not', () => {
  for (const on of [undefined, { x: 0, y: 2 }]) {
    const tight = corner({ x: 1474, y: 300 }, { w: 1600, h: 900 }), steps = most(drive(tight.e, tight.c1, tight.size, { on }));
    assert.ok(tight.e.tip !== undefined || steps.move > 0);
    const room = corner({ x: 1474, y: 300 }, { w: 9000, h: 900 }), swing = most(drive(room.e, room.c1, room.size, { on }));
    const name = on ? 'her side moving on' : 'standing';
    /* where she's going moves on 2 px a tick: that much more is her own going, not the way's */
    assert.ok(steps.move <= 17 + (on ? Math.hypot(on.x, on.y) : 0) + 1e-6, `${name}: her middle moved ${steps.move.toFixed(2)} px in a tick`);
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
    const s = most(seq);
    assert.ok(s.move <= 21 && s.turn <= 15, `${name}: moved ${s.move.toFixed(1)} px, turned ${s.turn.toFixed(1)} degrees in a tick`);
  }
});
