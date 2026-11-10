/* Where the right-click menu goes, and where she is on screen. Physical pixels throughout. */
import assert from 'node:assert';
import { test, vi } from 'vitest';
import type { PetFrame } from '@buddies/engine';
import { herOnScreen, pointOnScreen } from '../src/menu-ask';
import { beside, workAt } from '../src/menu-place';
import type { Monitor, Rect } from '../src/shell';

const monitor = (x: number, y: number, w: number, h: number, scale = 1, bar = 48): Monitor =>
  ({ i: 0, name: `${x},${y}`, primary: x === 0 && y === 0, scale, x, y, w, h: h - bar, full: { x, y, w, h } });
const ONE = [monitor(0, 0, 1920, 1080)];
/* a 150% monitor to the left and above, and a 100% one at the origin */
const TWO = [monitor(0, 0, 1920, 1080), monitor(-2560, -360, 2560, 1440, 1.5, 72)];
const MENU = { w: 200, h: 300 };
const over = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: Rect, w: Rect) => a.x >= w.x && a.y >= w.y && a.x + a.w <= w.x + w.w && a.y + a.h <= w.y + w.h;
const mid = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

test('the work area is the monitor the click was on, taskbar left out, with its scale', () => {
  assert.deepStrictEqual(workAt(ONE, { x: 10, y: 10 }), { x: 0, y: 0, w: 1920, h: 1032, scale: 1 });
  assert.deepStrictEqual(workAt(TWO, { x: -100, y: 0 }), { x: -2560, y: -360, w: 2560, h: 1368, scale: 1.5 });
  /* over the taskbar is still that monitor */
  assert.deepStrictEqual(workAt(ONE, { x: 900, y: 1070 })?.h, 1032);
  /* off every monitor: the nearest */
  assert.deepStrictEqual(workAt(TWO, { x: 3000, y: 500 })?.x, 0);
  assert.deepStrictEqual(workAt(TWO, { x: -3000, y: 0 })?.scale, 1.5);
  assert.strictEqual(workAt([], { x: 0, y: 0 }), null);
});

test('to her right when there is room, top at the click, the size it was asked', () => {
  const her = { x: 500, y: 400, w: 160, h: 160 }, work = workAt(ONE, mid(her))!;
  const r = beside(her, { x: 580, y: 450 }, work, MENU);
  assert.deepStrictEqual(r, { x: 660, y: 450, w: 200, h: 300 });
});

test('at the right edge it goes to her left', () => {
  const her = { x: 1800, y: 400, w: 160, h: 160 }, work = workAt(ONE, mid(her))!;
  const r = beside(her, { x: 1850, y: 420 }, work, MENU);
  assert.deepStrictEqual(r, { x: 1600, y: 420, w: 200, h: 300 });
});

test('above the taskbar: a click low down moves it up, never under the bar', () => {
  const her = { x: 500, y: 880, w: 160, h: 160 }, work = workAt(ONE, mid(her))!;
  const r = beside(her, { x: 560, y: 1000 }, work, MENU);
  assert.strictEqual(r.y + r.h, 1032);
  assert.strictEqual(r.x, 660);
});

test('a buddy as wide as the screen: below her, or above, never over her', () => {
  const work = workAt(ONE, { x: 0, y: 0 })!;
  const top = { x: 0, y: 100, w: 1920, h: 300 };
  const below = beside(top, { x: 900, y: 200 }, work, MENU);
  assert.ok(!over(below, top) && inside(below, work) && below.y === 400, JSON.stringify(below));
  const low = { x: 0, y: 700, w: 1920, h: 300 };
  const above = beside(low, { x: 900, y: 800 }, work, MENU);
  assert.ok(!over(above, low) && inside(above, work) && above.y + above.h === 700, JSON.stringify(above));
});

test('a menu bigger than the work area is cut to it, and placed after the cut', () => {
  const work = { x: 0, y: 0, w: 1280, h: 680 }, her = { x: 500, y: 300, w: 160, h: 160 };
  const r = beside(her, { x: 580, y: 350 }, work, { w: 564, h: 900 });
  assert.deepStrictEqual(r, { x: 660, y: 0, w: 564, h: 680 });
  const wide = beside(her, { x: 580, y: 350 }, work, { w: 2000, h: 100 });
  assert.ok(inside(wide, work) && wide.w === 1280, JSON.stringify(wide));
});

test('nowhere free: it stays inside the work area anyway', () => {
  const work = workAt(ONE, { x: 0, y: 0 })!, her = { x: -50, y: -50, w: 2100, h: 1200 };
  assert.ok(inside(beside(her, { x: 900, y: 500 }, work, MENU), work));
});

test('on a second monitor at another scale it stays on that monitor', () => {
  const her = { x: -300, y: 200, w: 240, h: 240 }, work = workAt(TWO, mid(her))!;
  const size = { w: Math.ceil(MENU.w * work.scale), h: Math.ceil(MENU.h * work.scale) };
  const r = beside(her, { x: -200, y: 250 }, work, size);
  assert.ok(inside(r, work) && !over(r, her), JSON.stringify(r));
  assert.deepStrictEqual([r.x + r.w, r.w, r.h], [-300, 300, 450], 'her left, since her right is the next monitor');
});

test('anywhere she is, at any scale, on either monitor: inside the work area and never over her', () => {
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
  for (let i = 0; i < 4000; i++) {
    const m = TWO[i % 2]!, scale = [1, 1.25, 1.5, 1.75, 2, 3][i % 6]!;
    const s = Math.round((40 + rand() * 300) * scale);
    const her = { x: Math.round(m.full.x - s / 2 + rand() * m.full.w), y: Math.round(m.full.y - s / 2 + rand() * m.full.h), w: s, h: s };
    const at = { x: her.x + Math.round(rand() * s), y: her.y + Math.round(rand() * s) };
    const work = workAt(TWO, at)!, size = { w: Math.ceil(180 * scale), h: Math.ceil((60 + rand() * 260) * scale) };
    const r = beside(her, at, work, size);
    assert.ok(inside(r, work), `inside ${i} ${JSON.stringify({ her, at, r, work })}`);
    assert.deepStrictEqual([r.w, r.h], [size.w, size.h]);
    /* Room on some side means she's never covered. */
    const room = her.x - work.x >= size.w || work.x + work.w - (her.x + her.w) >= size.w || her.y - work.y >= size.h || work.y + work.h - (her.y + her.h) >= size.h;
    if (room) assert.ok(!over(r, her), `over her ${i} ${JSON.stringify({ her, r, work })}`);
  }
});

const frame = (box: PetFrame['box'], body: string | null = null): PetFrame =>
  ({ id: 'a', size: '1', src: 'x', origin: null, body, grab: false, stage: '', parts: null, off: false, box, tf: null, bubble: null as never, tag: null as never });

/* Overlays cover their monitor less one line across from the taskbar, taskbar and all, so the
   overlay's CSS pixels start at that window's corner, not the work area's. These have a taskbar along
   the top, so the window starts at the screen's corner; BOTTOM's starts a line down. */
const TOP = { i: 0, x: 0, y: 48, w: 1920, h: 1032, scale: 1, full: { x: 0, y: 0, w: 1920, h: 1080 } };
const BOTTOM = { i: 0, x: 0, y: 0, w: 1920, h: 1032, scale: 1, full: { x: 0, y: 0, w: 1920, h: 1080 } };

test('where she is on screen: the overlay\'s CSS box, scaled and moved to its window\'s corner', () => {
  const me = { i: 1, x: -2560, y: -288, w: 2560, h: 1368, scale: 1.5, full: { x: -2560, y: -360, w: 2560, h: 1440 } };
  assert.deepStrictEqual(herOnScreen(frame({ l: 100, t: 40, size: 80, ox: 40, oy: 40 }), me), { x: -2410, y: -300, w: 120, h: 120 });
  assert.deepStrictEqual(pointOnScreen(me, 120, 60), { x: -2380, y: -270 });
  assert.deepStrictEqual(pointOnScreen(TOP, 10.4, 20.6), { x: 10, y: 21 });
  assert.deepStrictEqual(pointOnScreen(BOTTOM, 10.4, 20.6), { x: 10, y: 22 });
  assert.deepStrictEqual(herOnScreen(frame({ l: 100, t: 40, size: 80, ox: 40, oy: 40 }), BOTTOM), { x: 100, y: 41, w: 80, h: 80 });
});

test('turned, she\'s where her body transform puts her, as the hit test reads it', () => {
  /* a quarter turn about her origin: x, y becomes -y, x */
  vi.stubGlobal('DOMMatrix', class { constructor(public s: string) {} transformPoint(p: { x: number; y: number }) { return this.s === 'rotate(90deg)' ? { x: -p.y, y: p.x } : p; } });
  try {
    const me = TOP;
    /* origin at her feet, 150,200: the box 100..200 x 100..200 turns to 150..250 x 150..250 */
    assert.deepStrictEqual(herOnScreen(frame({ l: 100, t: 100, size: 100, ox: 50, oy: 100 }, 'rotate(90deg)'), me), { x: 150, y: 150, w: 100, h: 100 });
    assert.deepStrictEqual(herOnScreen(frame({ l: 100, t: 100, size: 100, ox: 50, oy: 100 }, 'none'), me), { x: 100, y: 100, w: 100, h: 100 });
  } finally { vi.unstubAllGlobals(); }
});

test('with no DOMMatrix to read her transform, the box grows to hold her however she turns', () => {
  const me = TOP;
  const r = herOnScreen(frame({ l: 100, t: 100, size: 100, ox: 50, oy: 100 }, 'rotate(90deg)'), me);
  /* about her feet, the far corners are √(50² + 100²) ≈ 112 away */
  assert.ok(r.x <= 38 && r.y <= 88 && r.x + r.w >= 262 && r.y + r.h >= 312, JSON.stringify(r));
});
