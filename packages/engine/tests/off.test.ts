/* How far off the monitors a turned box reaches: any point of it, not just its corners. */
import assert from 'node:assert';
import { test } from 'vitest';
import { boxAt, offAll } from './off';

const STEP = [{ x: 0, y: 0, w: 1920, h: 1080 }, { x: 1920, y: 360, w: 1920, h: 1080 }];

test('a box turned over a step between monitors: its corners are on them, the middle of an edge isn\'t', () => {
  /* 120 px, turned 45 degrees over the step's corner: the top corner on the first monitor, the right
     one on the second, and the edge between them 32.43 px past both */
  const box = boxAt({ x: 1910, y: 370 }, 45, { w: 120, h: 120 });
  assert.ok(Math.abs(offAll(box, STEP) - 32.43) < .5, String(offAll(box, STEP)));
});

test('one monitor, or all of her on one of two: her corners say it, and it\'s exact', () => {
  const one = [{ x: 0, y: 0, w: 1000, h: 800 }];
  assert.strictEqual(offAll(boxAt({ x: 990, y: 400 }, 0, { w: 100, h: 100 }), one), 40);
  assert.strictEqual(offAll(boxAt({ x: 500, y: 400 }, 30, { w: 100, h: 100 }), one), 0);
  assert.strictEqual(offAll(boxAt({ x: 1000, y: 700 }, 0, { w: 100, h: 100 }), STEP), 0);
  /* straddling the seam where the two meet edge to edge: on them all along */
  assert.ok(offAll(boxAt({ x: 1920, y: 700 }, 20, { w: 100, h: 100 }), STEP) < .5);
});

test('a hole between monitors under the middle of her box is counted', () => {
  /* two monitors 100 px apart, her box over the gap, all four corners on one or the other */
  const gap = [{ x: 0, y: 0, w: 1000, h: 1000 }, { x: 1100, y: 0, w: 1000, h: 1000 }];
  const off = offAll(boxAt({ x: 1050, y: 500 }, 0, { w: 400, h: 200 }), gap);
  assert.ok(Math.abs(off - 50) < .5, String(off));
});
