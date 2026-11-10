/* A buddy's own lift: every pose drawn that much further from what she stands or hangs on, as a share
   of her size, one value for the floor, walls and ceilings. Never while held or in the air. Two worlds on one seed, one with the lift, step together:
   only where she's drawn may differ. */
import assert from 'node:assert';
import { test } from 'vitest';
import type { Lift } from '@buddies/buddy-file';
import type { BuddyData, Pet, Viewport } from '../src/index';
import { LIFT_FROM } from '../src/look';
import { BUDDY, mulberry32, screen, world, type TestWorld } from './support';

const VP: Viewport = { x: 0, y: 0, scale: 1 };
const art = (n: string) => ({ frames: [{ src: `data:image/png;base64,${n}`, bb: { x0: .2, y0: .1, x1: .8, y1: .9 } }] });
const OWN = { climb: art('Yw'), wall: art('Ww'), crawl: art('Cw'), hang: art('SA') };

const floor = (x: number): Lift => ({ floor: x });

function pair(lift: Lift | undefined, more: Partial<BuddyData> = {}, scale = 1) {
  const make = (l: Lift | undefined) => {
    const w = world([screen('s', 0, 0, 1600, 900, scale)], { seed: 7 }), pet = w.add(BUDDY('a', { ...more, ...l === undefined ? {} : { lift: l } }));
    return { w, pet };
  };
  const a = make(undefined), b = make(lift);
  const both = { a, b,
    step(n = 1) { for (let i = 0; i < n; i++) { a.w.frame(); b.w.frame(); } },
    until(f: (p: Pet, w: TestWorld) => unknown, max = 4000) { for (let i = 0; i < max; i++) { if (f(a.pet, a.w)) return true; both.step(); } return false; },
    do(f: (p: Pet, w: TestWorld) => void) { f(a.pet, a.w); f(b.pet, b.w); },
    /* how far the drawing moved, by the point effects come from */
    moved() { a.pet.frame(VP); b.pet.frame(VP); const p = a.pet.center(), q = b.pet.center(); return [Math.round((q.x - p.x) * 1e6) / 1e6 + 0, Math.round((q.y - p.y) * 1e6) / 1e6 + 0]; },
    same() { assert.deepStrictEqual([b.pet.P.state, b.pet.P.surf, b.pet.P.x, b.pet.P.y], [a.pet.P.state, a.pet.P.surf, a.pet.P.x, a.pet.P.y], 'she is where she was'); }
  };
  return both;
}
const settled = (p: Pet) => p.P.surf === 'floor' && p.P.state !== 'land';

test('on the floor, she is drawn her lift higher, and the box a hit test reads moves with her', () => {
  const s = pair(floor(.1));
  assert.ok(s.until(settled));
  s.do(p => { p.go('sit'); p.P.dur = 1e9; });
  s.step();
  s.same();
  assert.deepStrictEqual(s.moved(), [0, -12]);
  const f = s.a.pet.frame(VP), g = s.b.pet.frame(VP);
  assert.deepStrictEqual([g.box.t - f.box.t, g.box.oy, g.box.l, g.origin, g.body], [-12, f.box.oy, f.box.l, f.origin, f.body], 'the whole drawing moves, nothing in it');
  /* the bottom of her art, where a hit lands on it */
  assert.strictEqual(g.box.t + g.box.size, s.b.pet.P.y - 12);
});

test('mid-spin, she turns where she is drawn: her lift moves the whole drawing, not the point she turns round', () => {
  const s = pair(floor(.5));
  assert.ok(s.until(settled));
  s.do(p => p.go('spin'));
  s.step(15);
  s.same();
  assert.strictEqual(s.a.pet.P.state, 'spin');
  assert.ok(/rotate\(0deg\).*rotate\((?!0\.0deg)/.test(s.a.pet.frame(VP).body!), s.a.pet.frame(VP).body!);
  const f = s.a.pet.frame(VP), g = s.b.pet.frame(VP);
  assert.deepStrictEqual([g.box.t - f.box.t, g.box.l - f.box.l, g.origin, g.body], [-60, 0, f.origin, f.body]);
  assert.deepStrictEqual(s.moved(), [0, -60], 'labels and effects come from the same place');
});

test('her lift is a share of her size, whatever the pose is scaled to', () => {
  const s = pair(floor(.1), { poses: { sit: { ...art('Si'), scale: 2 } } });
  assert.ok(s.until(settled));
  s.do(p => { p.go('sit'); p.P.dur = 1e9; });
  s.step();
  assert.deepStrictEqual(s.moved(), [0, -12]);
});

test('on a scaled screen, her lift scales with her', () => {
  const s = pair(floor(.1), {}, 1.5);
  assert.ok(s.until(settled));
  s.step();
  assert.deepStrictEqual(s.moved(), [0, -18]);
});

test('a lift below zero sinks her into the floor', () => {
  const s = pair(floor(-.05));
  assert.ok(s.until(settled));
  s.step();
  assert.deepStrictEqual(s.moved(), [0, 6]);
});

/* Floor, wall and ceiling in turn, saying how far she's drawn from where she'd be with no lift. */
function tour(lift: Lift, more: Partial<BuddyData>) {
  const s = pair(lift, more), out: Record<string, number[]> = {};
  assert.ok(s.until(settled));
  s.step(); out.floor = s.moved();
  s.do(p => p.act('climbGo'));
  assert.ok(s.until(p => p.P.surf === 'left' || p.P.surf === 'right'));
  s.step(); s.same();
  const away = s.a.pet.here()!.normal.x;
  out.wall = s.moved().map(x => x * away + 0);
  s.do(p => p.act('drop'));
  assert.ok(s.until(settled));
  s.do(p => p.act('ceilGo'));
  assert.ok(s.until(p => p.P.surf === 'ceil'));
  s.step(); s.same();
  out.ceiling = s.moved();
  return out;
}
for (const [what, more] of [['her main image turned', {}], ['her own art', { poses: OWN }]] as const) {
  test(`each surface's lift moves ${what} only on that surface, along its own axis, away from it`, () => {
    assert.deepStrictEqual(tour({ floor: .1 }, more), { floor: [0, -12], wall: [0, 0], ceiling: [0, 0] });
    assert.deepStrictEqual(tour({ wall: .1 }, more), { floor: [0, 0], wall: [12, 0], ceiling: [0, 0] }, 'out from the wall, on x');
    assert.deepStrictEqual(tour({ ceiling: .1 }, more), { floor: [0, 0], wall: [0, 0], ceiling: [0, 12] }, 'down from the ceiling, on y');
    assert.deepStrictEqual(tour({ floor: .05, wall: -.1, ceiling: .2 }, more), { floor: [0, -6], wall: [-12, 0], ceiling: [0, 24] });
  });
}

for (const move of ['spin', 'roll']) test(`mid-${move}, only her floor lift moves her, and only up`, () => {
  for (const [lift, want] of [[{ wall: .4, ceiling: .4 }, [0, 0]], [{ floor: .25 }, [0, -30]]] as const) {
    const s = pair(lift);
    assert.ok(s.until(settled));
    s.do(p => p.go(move));
    s.step(12);
    s.same();
    assert.strictEqual(s.a.pet.P.state, move);
    const f = s.a.pet.frame(VP), g = s.b.pet.frame(VP);
    assert.deepStrictEqual([g.box.t - f.box.t, g.box.l - f.box.l, g.origin, g.body], [want[1], want[0], f.origin, f.body], JSON.stringify(lift));
    assert.deepStrictEqual(s.moved(), [...want]);
  }
});

test('held or in the air, the lift is gone', () => {
  const s = pair(floor(.1));
  assert.ok(s.until(settled));
  s.do((p, w) => { w.sim.input.down('a', p.P.x, p.P.y - 30); for (let i = 1; i <= 5; i++) { w.sim.input.move('a', 400 + i * 30, 300); w.frame(); } });
  s.same();
  assert.strictEqual(s.a.pet.P.state, 'held');
  assert.deepStrictEqual(s.moved(), [0, 0]);
  s.do((_, w) => w.sim.input.up('a'));
  s.step();
  assert.strictEqual(s.a.pet.P.surf, 'air');
  assert.deepStrictEqual(s.moved(), [0, 0]);
});

test('which value each kind of surface takes is one list', () => {
  assert.deepStrictEqual(LIFT_FROM, { floor: 'floor', wall: 'wall', ceil: 'ceiling' });
});

for (const [what, zero] of [['all three at 0', { floor: 0, wall: 0, ceiling: 0 }], ['an empty lift', {}]] as const) test(`${what} draws exactly what no lift does, frame by frame`, () => {
  const s = pair(zero, { poses: OWN }), draw = mulberry32(3);
  for (let i = 0; i < 3000; i++) {
    if (i % 300 === 120) s.do((p, w) => { w.sim.input.down('a', p.P.x, p.P.y - 20); });
    if (i % 300 === 150) { const x = 200 + draw() * 1000, y = 200 + draw() * 400; s.do((_, w) => { w.sim.input.move('a', x, y); }); }
    if (i % 300 === 170) s.do((_, w) => { w.sim.input.up('a'); });
    if (i % 500 === 250) s.do(p => p.act(['climbGo', 'ceilGo', 'dance', 'jump'][Math.floor(i / 500) % 4]!));
    s.step();
    assert.strictEqual(JSON.stringify(s.b.w.sim.frame(VP)), JSON.stringify(s.a.w.sim.frame(VP)), `frame ${i}`);
  }
});
