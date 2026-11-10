/* An overlay's window is its monitor less one pixel, on the edge away from the taskbar, so Windows
   never takes it for a full-screen app. Everything that turns screen pixels into the overlay's CSS
   pixels, or back, starts from that same window. */
import assert from 'node:assert';
import type { PetFrame } from '@buddies/engine';
import { test } from 'vitest';
import { pointed } from '../src/hit';
import { viewport, type Area } from '../src/host';
import { herOnScreen, pointOnScreen } from '../src/menu-ask';
import { overlayRect } from '../src/overlay-rect';
import type { Rect } from '../src/shell';

type Side = 'bottom' | 'top' | 'left' | 'right' | 'none';
const SIDES: Side[] = ['bottom', 'top', 'left', 'right', 'none'];
/* A screen at x, y with a taskbar 40 CSS px thick on one side, or none (hidden, or no taskbar). */
function monitor(side: Side, x = 0, y = 0, scale = 1, w = 1920, h = 1080): Area {
  const full = { x, y, w, h }, t = 40 * scale;
  const work = side === 'bottom' ? { ...full, h: h - t } : side === 'top' ? { ...full, y: y + t, h: h - t }
    : side === 'left' ? { ...full, x: x + t, w: w - t } : side === 'right' ? { ...full, w: w - t } : full;
  return { i: 0, scale, ...work, full };
}
/* The taskbar's strip: the screen less the work area on its side. */
function strip(side: Side, a: Area): Rect | null {
  const f = a.full;
  return side === 'bottom' ? { x: f.x, y: a.y + a.h, w: f.w, h: f.y + f.h - (a.y + a.h) }
    : side === 'top' ? { x: f.x, y: f.y, w: f.w, h: a.y - f.y }
    : side === 'left' ? { x: f.x, y: f.y, w: a.x - f.x, h: f.h }
    : side === 'right' ? { x: a.x + a.w, y: f.y, w: f.x + f.w - (a.x + a.w), h: f.h } : null;
}
const inside = (r: Rect, o: Rect) => r.x >= o.x && r.y >= o.y && r.x + r.w <= o.x + o.w && r.y + r.h <= o.y + o.h;
const same = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

test('the pixel comes off the edge across from the taskbar, and off the top with no taskbar to tell', () => {
  assert.deepStrictEqual(overlayRect(monitor('bottom')), { x: 0, y: 1, w: 1920, h: 1079 });
  assert.deepStrictEqual(overlayRect(monitor('top', 1920, 0, 1.5)), { x: 1920, y: 0, w: 1920, h: 1079 });
  assert.deepStrictEqual(overlayRect(monitor('left', -2560, -1440, 2, 2560, 1440)), { x: -2560, y: -1440, w: 2559, h: 1440 });
  assert.deepStrictEqual(overlayRect(monitor('right', -1920, 300)), { x: -1919, y: 300, w: 1919, h: 1080 });
  assert.deepStrictEqual(overlayRect(monitor('none', -2560, -1440, 1.5, 2560, 1440)), { x: -2560, y: -1439, w: 2560, h: 1439 });
});

test('every side, origin and scale: never the monitor, always inside it, one line short, the whole strip covered', () => {
  for (const side of SIDES) for (const [x, y] of [[0, 0], [-2560, -1440], [1920, -300], [-1920, 1080]] as const) for (const scale of [1, 1.5, 2]) {
    const a = monitor(side, x, y, scale), r = overlayRect(a), at = `${side} ${x},${y} x${scale}`;
    assert.ok(!same(r, a.full), `${at}: not the monitor`);
    assert.ok(inside(r, a.full), `${at}: inside it`);
    assert.strictEqual(r.w * r.h, a.full.w * a.full.h - (r.w === a.full.w ? a.full.w : a.full.h), `${at}: one row or column short`);
    assert.ok(Number.isInteger(r.x) && Number.isInteger(r.y) && Number.isInteger(r.w) && Number.isInteger(r.h), `${at}: whole physical pixels`);
    const s = strip(side, a);
    if (s) assert.ok(inside(s, r), `${at}: the whole strip is under the window`);
    else assert.ok(r.y === a.full.y + 1 && r.h === a.full.h - 1, `${at}: off the top`);
  }
});

test('a work area short on two sides: the bigger gap is the taskbar, and the pixel comes off across from it', () => {
  const full = { x: 0, y: 0, w: 1920, h: 1080 };
  /* a 40 px taskbar at the bottom and a 100 px docked bar on the left: the left is the taskbar here */
  const twoSides = { i: 0, scale: 1, x: 100, y: 0, w: 1820, h: 1040, full };
  assert.deepStrictEqual(overlayRect(twoSides), { x: 0, y: 0, w: 1919, h: 1080 });
  /* 60 at the top, 20 on the right: the top's */
  assert.deepStrictEqual(overlayRect({ x: 0, y: 60, w: 1900, h: 1020, full }), { x: 0, y: 0, w: 1920, h: 1079 });
  /* 30 at the bottom, 50 on the right: the right's */
  assert.deepStrictEqual(overlayRect({ x: 0, y: 0, w: 1870, h: 1050, full }), { x: 1, y: 0, w: 1919, h: 1080 });
});

test('the viewport, the cursor, her box and the click on screen all start from the window\'s own corner', () => {
  const frame = { id: 'a', off: false, size: '1', src: 'x', box: { l: 0, t: 0, size: 100, ox: 50, oy: 50 }, body: null } as unknown as PetFrame;
  for (const side of SIDES) for (const scale of [1, 1.5, 2]) {
    const a = monitor(side, -1920, -360, scale), r = overlayRect(a), v = viewport(a), at = `${side} x${scale}`;
    assert.deepStrictEqual(v, { x: r.x, y: r.y, scale, w: r.w / scale, h: r.h / scale }, at);
    const view = { w: v.w, h: v.h };
    assert.deepStrictEqual(pointed([], { x: r.x, y: r.y }, a, view), { x: 0, y: 0, inside: true, id: null }, `${at}: the window's corner is CSS 0,0`);
    const last = pointed([], { x: r.x + r.w - 1, y: r.y + r.h - 1 }, a, view);
    assert.ok(last.inside && Math.abs(last.x - (r.w - 1) / scale) < 1e-9 && Math.abs(last.y - (r.h - 1) / scale) < 1e-9, `${at}: its far corner is inside`);
    /* the line the window leaves out is past its edge */
    const gone = side === 'top' ? { x: r.x, y: r.y + r.h } : side === 'left' ? { x: r.x + r.w, y: r.y } : side === 'right' ? { x: r.x - 1, y: r.y } : { x: r.x, y: r.y - 1 };
    assert.strictEqual(pointed([], gone, a, view).inside, false, `${at}: the missing line isn't the window's`);
    assert.deepStrictEqual(pointOnScreen(a, 0, 0), { x: r.x, y: r.y }, at);
    assert.deepStrictEqual(pointOnScreen(a, 10, 20), { x: Math.round(r.x + 10 * scale), y: Math.round(r.y + 20 * scale) }, at);
    assert.deepStrictEqual(herOnScreen(frame, a), { x: r.x, y: r.y, w: Math.ceil(r.x + 100 * scale) - r.x, h: Math.ceil(r.y + 100 * scale) - r.y }, at);
  }
});
