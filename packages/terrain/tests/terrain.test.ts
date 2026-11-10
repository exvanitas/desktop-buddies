/* The terrain contract, written against its interface. */
import assert from 'node:assert';
import { test } from 'vitest';
import { createTerrain as make, type Rectangle, type Surface, type SurfaceKind, type Terrain } from '../src/terrain';
import { DESK, screen, windowRect } from './fixtures';

const of = (t: Terrain, owner: string, kind?: SurfaceKind) => t.surfaces().filter(s => s.owner === owner && (!kind || s.kind === kind));
const normal = (s: Surface) => [s.normal.x, s.normal.y];

test('a screen has a floor, two walls and a ceiling, all facing inward', () => {
  const t = make([screen('s', 0, 0, 800, 600)]);
  assert.strictEqual(t.surfaces().length, 4);
  const floor = of(t, 's', 'floor')[0]!!, ceil = of(t, 's', 'ceil')[0]!!, walls = of(t, 's', 'wall');
  assert.deepStrictEqual(normal(floor), [0, -1]); assert.strictEqual(floor.at, 600);
  assert.deepStrictEqual(normal(ceil), [0, 1]); assert.strictEqual(ceil.at, 0);
  assert.deepStrictEqual(walls.map(normal).sort(), [[-1, 0], [1, 0]]);
  for (const s of t.surfaces()) assert.ok(s.from < s.to);
});

test('a window has all four edges facing outward: top a floor, bottom a ceiling', () => {
  const t = make([screen('s', 0, 0, 800, 600), windowRect('w', 100, 100, 200, 100)]);
  const floor = of(t, 'w', 'floor')[0]!!, ceil = of(t, 'w', 'ceil')[0]!!, walls = of(t, 'w', 'wall');
  assert.strictEqual(floor.at, 100); assert.deepStrictEqual(normal(floor), [0, -1]);
  assert.strictEqual(ceil.at, 200); assert.deepStrictEqual(normal(ceil), [0, 1]);
  assert.deepStrictEqual(walls.find(w => w.at === 100)!.normal, { x: -1, y: 0 });
  assert.deepStrictEqual(walls.find(w => w.at === 300)!.normal, { x: 1, y: 0 });
});

test('a window side and a screen wall on the same side of a buddy share a normal', () => {
  const t = make([screen('s', 0, 0, 800, 600), windowRect('w', 100, 100, 200, 100)]);
  const screenRight = of(t, 's', 'wall').find(w => w.at === 800)!, windowLeft = of(t, 'w', 'wall').find(w => w.at === 100)!;
  assert.deepStrictEqual(screenRight.normal, windowLeft.normal);
});

for (const [name, rects, owner] of <[string, Rectangle[], string][]>[['screen', [screen('s', 0, 0, 800, 600)], 's'], ['window', [screen('s', 0, 0, 800, 600), windowRect('w', 100, 100, 200, 100)], 'w']]) {
  test(`corners link a ${name} into a loop`, () => {
    const t = make(rects), all = of(t, owner);
    for (const s of all) {
      const n = t.surfaceById(s.next)!, p = t.surfaceById(s.prev)!;
      assert.ok(n && p, `${s.id} has both neighbours`);
      assert.ok(n.prev === s.id || n.next === s.id, 'next links back');
      assert.ok(p.prev === s.id || p.next === s.id, 'prev links back');
    }
    const floor = of(t, owner, 'floor')[0], ends = [t.surfaceById(floor.prev)!, t.surfaceById(floor.next)!];
    assert.deepStrictEqual(ends.map(e => e.kind), ['wall', 'wall']);
    assert.ok(ends[0]!.at < ends[1]!.at, 'prev is at the from end, next at the to end');
  });
}

test('surfaceById and a place along a surface', () => {
  const t = make([screen('s', 10, 20, 800, 600)]);
  const f = of(t, 's', 'floor')[0]!, w = of(t, 's', 'wall')[0]!;
  assert.strictEqual(t.surfaceById(f.id), f); assert.strictEqual(t.surfaceById('nope'), null);
  assert.deepStrictEqual(t.pointOn(f, 30), { x: 40, y: 620 });
  assert.deepStrictEqual(t.pointOn(w, 30), { x: 10, y: 50 });
});

test('sweep finds the first surface crossed, however fast', () => {
  const t = make([screen('s', 0, 0, 800, 600), windowRect('a', 100, 300, 200, 50), windowRect('b', 100, 400, 200, 50)]);
  const hit = t.sweep({ x: 200, y: 100 }, { x: 200, y: 590 })!;
  assert.strictEqual(hit.surface.owner, 'a'); assert.strictEqual(hit.surface.kind, 'floor'); assert.strictEqual(hit.y, 300);
  assert.strictEqual(t.sweep({ x: 200, y: 299 }, { x: 200, y: 335 })!.surface.owner, 'a', 'a 35 px step does not skip a line');
  assert.strictEqual(t.sweep({ x: 500, y: 100 }, { x: 500, y: 300 }), null);
  assert.strictEqual(t.sweep({ x: 200, y: 100 }, { x: 200, y: 590 }, { kind: 'wall' }), null);
});

test('sweep misses past the ends of a surface', () => {
  const t = make([windowRect('w', 100, 100, 200, 100, 1), screen('s', 0, 0, 800, 600)]);
  assert.strictEqual(t.sweep({ x: 99, y: 50 }, { x: 99, y: 150 }, { kind: 'floor' }), null);
  assert.strictEqual(t.sweep({ x: 301, y: 50 }, { x: 301, y: 150 }, { kind: 'floor' }), null);
  assert.ok(t.sweep({ x: 100, y: 50 }, { x: 100, y: 150 }, { kind: 'floor' }));
});

test('catches are one-way', () => {
  const t = make([screen('s', 0, 0, 800, 600), windowRect('w', 100, 200, 200, 100)]);
  const down = (x: number, a: number, b: number) => t.sweep({ x, y: a }, { x, y: b });
  assert.strictEqual(down(200, 150, 250)!.surface.kind, 'floor', 'floor from above');
  assert.strictEqual(down(200, 250, 150), null, 'not from below');
  assert.strictEqual(down(200, 350, 250)!.surface.kind, 'ceil', 'ceiling from below');
  assert.strictEqual(down(200, 250, 350), null, 'not from above');
  const side = (a: number, b: number) => t.sweep({ x: a, y: 250 }, { x: b, y: 250 });
  assert.strictEqual(side(50, 150)!.surface.at, 100, 'left side, moving right');
  assert.strictEqual(side(150, 50), null, 'not moving left out of it');
  assert.strictEqual(side(350, 250)!.surface.at, 300, 'right side, moving left');
  assert.strictEqual(side(250, 350), null, 'not moving right out of it');
});

test('screen edges catch one-way too: inward surfaces, reached from inside', () => {
  const t = make([screen('s', 0, 0, 800, 600)]);
  assert.strictEqual(t.sweep({ x: 400, y: 590 }, { x: 400, y: 610 })!.surface.kind, 'floor');
  assert.strictEqual(t.sweep({ x: 400, y: 610 }, { x: 400, y: 590 }), null);
  assert.strictEqual(t.sweep({ x: 400, y: 10 }, { x: 400, y: -10 })!.surface.kind, 'ceil');
  assert.strictEqual(t.sweep({ x: 10, y: 300 }, { x: -10, y: 300 })!.surface.at, 0);
  assert.strictEqual(t.sweep({ x: -10, y: 300 }, { x: 10, y: 300 }), null);
  assert.strictEqual(t.sweep({ x: 790, y: 300 }, { x: 810, y: 300 })!.surface.at, 800);
});

test('a body catches at its own edges', () => {
  const t = make([screen('s', 0, 0, 800, 600)]), box = { side: 40, up: 100 };
  assert.strictEqual(t.sweep({ x: 45, y: 300 }, { x: 35, y: 300 }, { box })!.surface.at, 0);
  assert.strictEqual(t.sweep({ x: 400, y: 105 }, { x: 400, y: 95 }, { box })!.surface.kind, 'ceil');
});

test('past: a screen edge has nothing behind it', () => {
  const t = make([screen('s', 0, 0, 800, 600)]), s = t.rectById('s')!, box = { side: 40, up: 100 };
  assert.strictEqual(t.past('floor', { x: 400, y: 900 }, box, s)!.kind, 'floor');
  assert.strictEqual(t.past('wall', { x: 20, y: 300 }, box, s)!.at, 0);
  assert.strictEqual(t.past('wall', { x: 790, y: -500 }, box, s)!.at, 800, 'whatever the height');
  assert.strictEqual(t.past('ceil', { x: 400, y: 50 }, box, s)!.at, 0);
  assert.strictEqual(t.past('floor', { x: 400, y: 599 }, box, s), null);
  assert.strictEqual(t.past('wall', { x: 400, y: 300 }, box, s), null);
});

test('past: a floor or ceiling stops at its monitor, when another monitor is what lies beyond', () => {
  const t = make([screen('a', 0, 0, 1000, 800), screen('b', 1000, 0, 1000, 400)]), b = t.rectById('b')!, box = { side: 40, up: 100 };
  assert.strictEqual(t.past('floor', { x: 995, y: 400.5 }, box, b), null, 'over a\'s side now');
  assert.strictEqual(t.past('ceil', { x: 995, y: 50 }, box, b), null);
  assert.strictEqual(t.past('floor', { x: 1005, y: 400.5 }, box, b)!.owner, 'b');
  const one = make([screen('s', 0, 0, 800, 600)]), s = one.rectById('s')!;
  assert.strictEqual(one.past('floor', { x: -50, y: 900 }, box, s)!.kind, 'floor', 'with nothing beyond, past the end still counts');
});

test('covered: only what is above, blockers included, queried at a point', () => {
  const t = make([screen('s', 0, 0, 800, 600), windowRect('a', 100, 100, 200, 200, 1), windowRect('b', 150, 50, 200, 200, 2), windowRect('max', 0, 0, 10, 10, 3, { terrain: false })]);
  assert.strictEqual(t.covered(1, { x: 200, y: 100 }), true);
  assert.strictEqual(t.covered(2, { x: 200, y: 100 }), false);
  assert.strictEqual(t.covered(1, { x: 110, y: 100 }), false);
  assert.strictEqual(t.covered(0, { x: 5, y: 5 }), true, 'a blocker hides what is behind it');
  assert.strictEqual(of(t, 'max').length, 0, 'and cannot be walked on');
});

test('covered is about being behind, not touching, and screens stay the world\'s edges', () => {
  const t = make([screen('s', 0, 0, 800, 600), windowRect('a', 100, 300, 200, 100, 1), windowRect('b', 100, 200, 200, 100, 2), windowRect('tall', 500, 100, 200, 500, 1)]);
  assert.strictEqual(t.covered(1, { x: 200, y: 300 }), false, 'b sits exactly on a\'s top edge');
  assert.ok(t.sweep({ x: 600, y: 590 }, { x: 600, y: 610 }, { kind: 'floor' }), 'a window down to the floor doesn\'t hide it');
  const floor = of(t, 's', 'floor')[0]!;
  assert.strictEqual(t.hidden(floor, { x: 600, y: 600 }), false);
});

test('a covered part of an edge catches nothing, and edges are not clipped', () => {
  const t = make([screen('s', 0, 0, 800, 600), windowRect('a', 100, 200, 200, 100, 1), windowRect('b', 150, 150, 50, 100, 2)]);
  assert.strictEqual(of(t, 'a', 'floor').length, 1, 'whole edges are kept');
  assert.strictEqual(t.sweep({ x: 120, y: 190 }, { x: 120, y: 210 }, { kind: 'floor' })!.surface.owner, 'a');
  assert.strictEqual(t.sweep({ x: 175, y: 190 }, { x: 175, y: 210 }, { kind: 'floor' }), null);
});

test('behind: her body on a window\'s edge, reached into by anything in front, touching not counted', () => {
  /* a: left side at 100, right at 300, top at 200, bottom at 300. Her body is 40 wide and 60 tall. */
  const body = { side: 20, up: 60 }, a = windowRect('a', 100, 200, 200, 100, 1);
  const at = (more: Rectangle[], kind: SurfaceKind, side?: 'left' | 'right') => {
    const t = make([screen('s', 0, 0, 800, 600), a, ...more]);
    const s = of(t, 'a', kind).find(e => !side || (side === 'left') === (e.normal.x < 0))!;
    return t.behind(s, kind === 'wall' ? { x: s.at, y: 250 } : { x: 200, y: s.at }, body);
  };
  const b = (x: number, y: number, w: number, h: number, z = 2, more?: Partial<Rectangle>) => windowRect('b', x, y, w, h, z, more);
  /* a top: her body x 180 to 220, y 140 to 200 */
  assert.strictEqual(at([b(150, 100, 100, 50)], 'floor'), true, 'over her head, not the top');
  assert.strictEqual(at([b(150, 60, 100, 80)], 'floor'), false, 'touching her head');
  assert.strictEqual(at([b(221, 100, 100, 200)], 'floor'), false, 'beside her');
  assert.strictEqual(at([b(150, 100, 100, 50, 1)], 'floor'), false, 'level with hers is not in front');
  assert.strictEqual(at([b(150, 100, 100, 50, 0, { terrain: false })], 'floor'), false, 'behind hers');
  assert.strictEqual(at([b(150, 100, 100, 50, 2, { terrain: false })], 'floor'), true, 'a blocker in front');
  /* a ceiling: her body x 180 to 220, y 300 to 360 */
  assert.strictEqual(at([b(150, 340, 100, 50)], 'ceil'), true);
  assert.strictEqual(at([b(150, 360, 100, 50)], 'ceil'), false, 'touching her feet');
  /* a left side: her body x 60 to 100, y 220 to 280, her middle at 250 */
  assert.strictEqual(at([b(0, 270, 99, 50)], 'wall', 'left'), true, 'beside it, into her feet');
  assert.strictEqual(at([b(0, 280, 200, 50)], 'wall', 'left'), false, 'touching her feet');
  assert.strictEqual(at([b(0, 170, 59, 200)], 'wall', 'left'), false, 'short of her back');
  /* a right side: her body x 300 to 340 */
  assert.strictEqual(at([b(339, 200, 100, 100)], 'wall', 'right'), true);
  assert.strictEqual(at([b(340, 200, 100, 100)], 'wall', 'right'), false, 'touching her back');
  assert.strictEqual(at([b(0, 200, 99, 100)], 'wall', 'right'), false, 'the other side');
  const screenOnly = make([screen('s', 0, 0, 800, 600), b(0, 0, 800, 600)]);
  assert.strictEqual(screenOnly.behind(of(screenOnly, 's', 'floor')[0]!, { x: 400, y: 600 }, body), false, 'a screen\'s edges never are');
});

test('behind, with the scale she is at: her body sized for the monitor holding the spot', () => {
  /* a's top at y 300 on the upper monitor, at 100%; she is 40 by 60 at 200% */
  const t = make([screen('u', 0, 0, 800, 400, 1), screen('d', 0, 400, 800, 400, 2), windowRect('a', 100, 300, 400, 300, 1), windowRect('b', 150, 200, 100, 50, 2)]);
  const top = of(t, 'a', 'floor')[0]!, body = { side: 20, up: 60, k: 2 };
  assert.strictEqual(t.behind(top, { x: 200, y: 300 }, body), false, 'there she is 20 by 30: clear of b');
  assert.strictEqual(t.behind(top, { x: 200, y: 300 }, { side: 20, up: 60 }), true, 'without k, the size given');
  assert.strictEqual(t.behind(top, { x: 200, y: 300 }, { side: 40, up: 120, k: 2 }), true, 'twice that, 40 by 60 there: into b');
  const beside = make([...t.rects().filter(r => r.id !== 'b'), windowRect('c', 225, 250, 75, 49, 2)]);
  assert.strictEqual(beside.behind(of(beside, 'a', 'floor')[0]!, { x: 200, y: 300 }, { side: 40, up: 120, k: 2 }), false, '20 a side there, clear of c at 25');
  /* the same body on a's left side down on the 200% monitor stays the size given */
  const left = of(t, 'a', 'wall').find(s => s.normal.x < 0)!;
  assert.strictEqual(make([...t.rects(), windowRect('c', 50, 470, 15, 20, 3)]).behind(left, { x: 100, y: 500 }, body), true, 'her back at 60, at full size');
});

test('a floor crossing behind a window catches nothing: all of her where she would stand, not just the point', () => {
  const t = make([screen('s', 0, 0, 800, 600), windowRect('a', 100, 200, 200, 100, 1), windowRect('b', 150, 100, 50, 80, 2)]);
  const body = { side: 20, up: 60 };
  assert.strictEqual(t.sweep({ x: 175, y: 190 }, { x: 175, y: 210 }, { kind: 'floor' })!.surface.owner, 'a', 'the point alone is clear');
  assert.strictEqual(t.sweep({ x: 175, y: 190 }, { x: 175, y: 210 }, { kind: 'floor', box: body }), null, 'her head would be behind b');
  assert.strictEqual(t.sweep({ x: 240, y: 190 }, { x: 240, y: 210 }, { kind: 'floor', box: body })!.surface.owner, 'a', 'clear of it');
  /* sized for the monitor holding the spot: here at 100%, a body of 40 by 60 at 200% is half that */
  const two = make([screen('s', 0, 0, 800, 600), windowRect('a', 100, 200, 200, 100, 1), windowRect('b', 150, 100, 50, 120, 2)]);
  assert.strictEqual(two.sweep({ x: 175, y: 190 }, { x: 175, y: 210 }, { kind: 'floor', box: { side: 40, up: 120, k: 2 } }), null, 'into her head');
  assert.strictEqual(two.sweep({ x: 230, y: 190 }, { x: 230, y: 210 }, { kind: 'floor', box: { side: 40, up: 120, k: 2 } })!.surface.owner, 'a', 'clear of it at her size there, not at 40 a side');
});

test('a wall or ceiling crossing needs only the edge where she touches it: holding on is for the grab', () => {
  /* onto a's left side with her feet at 290 */
  const side = (more: Rectangle[]) => make([screen('s', 0, 0, 800, 600), windowRect('a', 100, 200, 200, 100, 1), ...more]).sweep({ x: 50, y: 290 }, { x: 90, y: 290 }, { kind: 'wall', box: { side: 20, up: 60 } });
  assert.strictEqual(side([])!.surface.owner, 'a');
  assert.strictEqual(side([windowRect('b', 0, 220, 70, 20, 2)])!.surface.owner, 'a', 'into her hands, not over the edge');
  assert.strictEqual(side([windowRect('b', 80, 280, 40, 20, 2, { terrain: false })]), null, 'over the edge where she touches it');
  /* up into a's bottom with her head at x 150 */
  const under = (more: Rectangle[]) => make([screen('s', 0, 0, 800, 600), windowRect('a', 100, 200, 200, 100, 1), ...more]).sweep({ x: 150, y: 370 }, { x: 150, y: 350 }, { kind: 'ceil', box: { side: 20, up: 60 } });
  assert.strictEqual(under([])!.surface.owner, 'a');
  assert.strictEqual(under([windowRect('b', 160, 300, 50, 50, 2)])!.surface.owner, 'a', 'beside where she touches it');
  assert.strictEqual(under([windowRect('b', 140, 290, 50, 50, 2, { terrain: false })]), null, 'over it where she touches it');
});

test('side by side: the shared edge is open, and the floors join', () => {
  const t = make([screen('a', 0, 0, 800, 600), screen('b', 800, 0, 800, 600)]);
  assert.deepStrictEqual(t.surfaces().filter(s => s.kind === 'wall').map(s => s.at).sort((x, y) => x - y), [0, 1600]);
  const fa = of(t, 'a', 'floor')[0]!, fb = of(t, 'b', 'floor')[0]!;
  assert.strictEqual(fa.next, fb.id); assert.strictEqual(fb.prev, fa.id);
  assert.strictEqual(t.sweep({ x: 790, y: 300 }, { x: 810, y: 300 }), null, 'nothing mid-desktop to hit');
});

test('different heights: open where they meet, a wall where they do not', () => {
  const t = make([screen('a', 0, 0, 800, 600), screen('b', 800, 100, 800, 300)]);
  const mid = t.surfaces().filter(s => s.kind === 'wall' && s.at === 800 && s.owner === 'a').sort((p, q) => p.from - q.from);
  assert.deepStrictEqual(mid.map(s => [s.from, s.to]), [[0, 100], [400, 600]]);
  assert.strictEqual(of(t, 'b', 'wall').filter(s => s.at === 800).length, 0);
  /* the step up to b's floor is a corner like any other */
  const step = mid[1], fb = of(t, 'b', 'floor')[0]!;
  assert.strictEqual(step.prev, fb.id); assert.strictEqual(fb.prev, step.id);
  assert.strictEqual(step.next, of(t, 'a', 'floor')[0]!.id);
});

test('stacked monitors keep their floors and ceilings: each is a whole world', () => {
  const t = make(DESK());
  assert.deepStrictEqual(of(t, 'top', 'floor').map(s => [s.from, s.to, s.at]), [[0, 3440, 1392]]);
  assert.deepStrictEqual(of(t, 'low', 'ceil').map(s => [s.from, s.to, s.at]), [[720, 2640, 1440]]);
  assert.deepStrictEqual(of(t, 'low', 'wall').map(s => [s.at, s.from, s.to]).sort((a, b) => a[0] - b[0]), [[720, 1440, 2448], [2640, 1440, 2448]]);
  assert.strictEqual(t.surfaces().length, 8);
  for (const owner of ['top', 'low']) {
    const seen = new Set(); let s = of(t, owner)[0], cameBy = null;
    while (!seen.has(s.id)) {
      seen.add(s.id);
      assert.strictEqual(s.owner, owner);
      const n = s.next !== cameBy ? s.next : s.prev;
      assert.ok(n, `${s.id} continues`); cameBy = s.id; s = t.surfaceById(n)!;
    }
    assert.strictEqual(seen.size, 4, 'a closed loop of its own');
  }
});

test('touching exactly, stacked is still stacked', () => {
  const t = make([screen('a', 0, 0, 800, 600), screen('b', 0, 600, 800, 600)]);
  assert.strictEqual(of(t, 'a', 'floor').length, 1); assert.strictEqual(of(t, 'b', 'ceil').length, 1);
  assert.strictEqual(t.surfaceById(of(t, 'a', 'floor')[0]!.next)!.owner, 'a', 'corners stay on their own monitor');
});

test('across: who is on the far side of a floor or ceiling', () => {
  const t = make(DESK()), floor = of(t, 'top', 'floor')[0]!, ceil = of(t, 'low', 'ceil')[0]!;
  assert.strictEqual(t.across(floor, 1000)!.id, 'low', 'a taskbar\'s gap is no gap');
  assert.strictEqual(t.across(floor, 300), null, 'not where nothing is stacked');
  assert.strictEqual(t.across(ceil, 1000)!.id, 'top');
  assert.strictEqual(t.across(of(t, 'low', 'floor')[0]!, 1000), null);
  assert.strictEqual(t.across(of(t, 'top', 'ceil')[0]!, 1000), null);
  assert.strictEqual(t.across(of(t, 'low', 'wall')[0]!, 1600), null);
  const far = make([screen('a', 0, 0, 800, 600), screen('b', 0, 1000, 800, 600)]);
  assert.strictEqual(far.across(of(far, 'a', 'floor')[0]!, 100), null, 'too far apart to be stacked');
  const one = make([screen('s', 0, 0, 800, 600)]);
  for (const s of one.surfaces()) assert.strictEqual(one.across(s, 100), null);
  const w = make([screen('s', 0, 0, 800, 600), windowRect('w', 100, 100, 200, 100)]);
  assert.strictEqual(w.across(of(w, 'w', 'floor')[0]!, 150), null);
});

test('side by side with a taskbar between: the gap counts as shared, for walls', () => {
  const t = make([screen('a', 0, 0, 800, 600), screen('b', 860, 0, 800, 600)]);
  assert.deepStrictEqual(t.surfaces().filter(s => s.kind === 'wall').map(s => s.at).sort((x, y) => x - y), [0, 1660]);
  const fa = of(t, 'a', 'floor')[0]!, fb = of(t, 'b', 'floor')[0]!;
  assert.strictEqual(fa.next, fb.id); assert.strictEqual(fb.prev, fa.id);
  assert.strictEqual(fb.from, 800, 'the floor runs on across the gap');
  assert.strictEqual(t.sweep({ x: 790, y: 300 }, { x: 870, y: 300 }), null);
});

test('a gap too wide to be a taskbar is a real gap', () => {
  const t = make([screen('a', 0, 0, 800, 600), screen('b', 1000, 0, 800, 600)]);
  assert.strictEqual(of(t, 'a', 'wall').length, 2); assert.strictEqual(of(t, 'b', 'wall').length, 2);
});

test('a surface keeps its id when its rectangle moves or resizes', () => {
  const t = make([windowRect('w', 100, 100, 200, 100), screen('s', 0, 0, 800, 600)]);
  const id = of(t, 'w', 'floor')[0]!.id;
  t.set([windowRect('w', 300, 200, 250, 100), screen('s', 0, 0, 800, 600)]);
  const f = t.surfaceById(id)!;
  assert.deepStrictEqual([f.from, f.to, f.at], [300, 550, 200]);
  t.set([screen('s', 0, 0, 800, 600)]);
  assert.strictEqual(t.surfaceById(id), null);
});

test('lost: nothing below, off every monitor, inside the desktop', () => {
  const t = make(DESK());
  assert.strictEqual(t.lost({ x: 300, y: 1800 }), true, 'beside the low monitor');
  assert.strictEqual(t.lost({ x: 3000, y: 2000 }), true);
  assert.strictEqual(t.lost({ x: 1000, y: 1000 }), false, 'on a monitor');
  assert.strictEqual(t.lost({ x: 1000, y: 1420 }), false, 'in the taskbar gap');
  assert.strictEqual(t.lost({ x: -300, y: 1800 }), false, 'outside the desktop is the edges\' business');
  const wide = make([screen('a', 500, 0, 800, 600), screen('b', 0, 600, 1800, 600)]);
  assert.strictEqual(wide.lost({ x: 100, y: 300 }), false, 'off every monitor, but a floor is below');
});

test('a single screen has no dead zones', () => {
  const t = make([screen('s', 0, 0, 800, 600)]);
  for (const p of [{ x: -50, y: 300 }, { x: 900, y: 300 }, { x: 400, y: 900 }, { x: 400, y: -200 }]) assert.strictEqual(t.lost(p), false);
});

test('home, nearest and primary', () => {
  const t = make(DESK());
  assert.strictEqual(t.home({ x: 100, y: 100 })!.id, 'top');
  assert.strictEqual(t.home({ x: 1000, y: 2000 })!.id, 'low');
  assert.strictEqual(t.home({ x: 100, y: 2400 })!.id, 'low', 'the closest when on neither');
  assert.strictEqual(t.primary().id, 'top');
});

test('sweep can be held to a list of surfaces', () => {
  const t = make([screen('s', 0, 0, 800, 600), windowRect('a', 100, 300, 200, 100)]), floor = of(t, 's', 'floor');
  assert.strictEqual(t.sweep({ x: 200, y: 100 }, { x: 200, y: 700 }, { among: floor })!.surface.owner, 's');
  assert.strictEqual(t.sweep({ x: 200, y: 100 }, { x: 200, y: 700 })!.surface.owner, 'a');
});

test('near: every surface a body inside a box could touch, and none it could not', () => {
  const t = make([screen('s', 0, 0, 800, 600), windowRect('a', 100, 300, 200, 100), windowRect('b', 500, 100, 100, 100)]);
  const ids = (b: { x: number; y: number; w: number; h: number }) => t.near(b).map(s => s.id).sort();
  assert.deepStrictEqual(ids({ x: 90, y: 290, w: 20, h: 20 }), ['a:left:0', 'a:top:0']);
  assert.deepStrictEqual(ids({ x: 350, y: 320, w: 20, h: 20 }), []);
  assert.deepStrictEqual(ids({ x: 0, y: 590, w: 20, h: 20 }), ['s:bottom:0', 's:left:0']);
  assert.ok(ids({ x: 0, y: 0, w: 800, h: 600 }).length === t.surfaces().length, 'all of it');
});

test('open: what is left of a surface once everything in front is taken out', () => {
  const t = make([screen('s', 0, 0, 800, 600), windowRect('a', 100, 200, 400, 200, 1), windowRect('b', 200, 100, 100, 200, 2), windowRect('c', 400, 100, 300, 150, 3, { terrain: false })]);
  const top = of(t, 'a', 'floor')[0]!, left = of(t, 'a', 'wall').find(s => s.at === 100)!, right = of(t, 'a', 'wall').find(s => s.at === 500)!;
  assert.deepStrictEqual(t.open(top), [[100, 200], [300, 400]], 'one window and one blocker');
  assert.deepStrictEqual(t.open(left), [[200, 400]]);
  assert.deepStrictEqual(t.open(right), [[250, 400]], 'along a wall too');
  for (const [a, b] of t.open(top)) assert.strictEqual(t.hidden(top, { x: (a + b) / 2, y: top.at }), false, 'agrees with hidden');
  assert.strictEqual(t.hidden(top, { x: 250, y: top.at }), true);
});

test('open: what is behind, or only touching, hides nothing, and a screen is never hidden', () => {
  const t = make([screen('s', 0, 0, 800, 600), windowRect('a', 100, 200, 400, 200, 2), windowRect('behind', 50, 50, 600, 500, 1), windowRect('touching', 200, 100, 100, 100, 3)]);
  assert.deepStrictEqual(t.open(of(t, 'a', 'floor')[0]!), [[100, 500]]);
  const over = make([screen('s', 0, 0, 800, 600), windowRect('tall', 100, 300, 200, 500, 2)]);
  assert.deepStrictEqual(over.open(of(over, 's', 'floor')[0]!), [[0, 800]]);
});

test('crowded: only what is in front, and touching is not reaching in', () => {
  const t = make([screen('s', 0, 0, 800, 600), windowRect('a', 100, 100, 200, 200, 2), windowRect('blocker', 500, 100, 100, 100, 3, { terrain: false })]);
  assert.strictEqual(t.crowded(1, { x: 290, y: 200, w: 50, h: 50 }), true);
  assert.strictEqual(t.crowded(2, { x: 290, y: 200, w: 50, h: 50 }), false, 'its own z is not in front');
  assert.strictEqual(t.crowded(1, { x: 300, y: 200, w: 50, h: 50 }), false, 'touching');
  assert.strictEqual(t.crowded(1, { x: 550, y: 150, w: 10, h: 10 }), true, 'a blocker counts');
});

test('what is above and below', () => {
  const t = make(DESK());
  assert.strictEqual(t.ceilingAbove({ x: 1000, y: 2448 })!.at, 1440, 'its own ceiling');
  assert.strictEqual(t.floorBelow({ x: 1000, y: 100 })!.at, 1392, 'its own floor');
  assert.strictEqual(t.floorBelow({ x: 1000, y: 1420 })!.at, 2448, 'from the gap, the low monitor\'s');
  assert.strictEqual(t.floorBelow({ x: 100, y: 1400 }), null);
});
