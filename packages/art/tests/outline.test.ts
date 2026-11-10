/* The bake on drawn alpha, in sheet pixels: 1 alpha pixel is 1 sheet pixel unless a test says so. */
import assert from 'node:assert';
import { test } from 'vitest';
import { DOT, GAP, OFFSET, distances, dotsOn, outlineOf, pathOf, rectangle, type Alpha, type Loop } from '../src/outline';
import { outlineOfImage } from '../src/outline-canvas';

type Pixel = (x: number, y: number) => number;
const art = (width: number, height: number, ...shapes: Pixel[]): Alpha => {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = Math.max(0, ...shapes.map(s => s(x, y)));
  return { width, height, data };
};
const disc = (cx: number, cy: number, r: number, a = 255): Pixel => (x, y) => Math.hypot(x - cx, y - cy) <= r ? a : 0;
const box = (x0: number, y0: number, x1: number, y1: number, a = 255): Pixel => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1 ? a : 0;

const pairs = (l: Loop) => Array.from({ length: l.points.length / 2 }, (_, i) => [l.points[2 * i]!, l.points[2 * i + 1]!] as const);
const bounds = (l: Loop) => {
  const p = pairs(l), xs = p.map(q => q[0]), ys = p.map(q => q[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};
const steps = (l: Loop) => pairs(l).map(([x, y], i, all) => { const [a, b] = all[(i + 1) % all.length]!; return Math.hypot(a - x, b - y); });
const near = (a: number, b: number, by: number, what: string) => assert.ok(Math.abs(a - b) <= by, `${what}: ${a}, want ${b} within ${by}`);

test('a round body gets one round loop, the offset away from the art', () => {
  const o = outlineOf(art(120, 120, disc(60, 60, 40)), 1);
  assert.strictEqual(o.shape, 'traced');
  assert.strictEqual(o.loops.length, 1);
  for (const [x, y] of pairs(o.loops[0]!)) near(Math.hypot(x - 60, y - 60), 40 + OFFSET, 1.5, 'distance from the centre');
  near(o.loops[0]!.length, 2 * Math.PI * (40 + OFFSET), 6, 'length');
});

test('the offset is in sheet pixels, so art shown at half size is grown twice as far in its own pixels', () => {
  const o = outlineOf(art(120, 120, disc(60, 60, 40)), .5);
  for (const [x, y] of pairs(o.loops[0]!)) near(Math.hypot(x - 60, y - 60), 40 + OFFSET * 2, 2, 'distance from the centre');
});

test('a loop closes with no seam: even steps all the way round, the last back to the first', () => {
  for (const a of [art(120, 120, disc(60, 60, 40)), art(160, 100, disc(40, 50, 30), disc(120, 50, 30), box(40, 40, 120, 60))]) {
    const l = outlineOf(a, 1).loops[0]!, s = steps(l), mean = s.reduce((x, y) => x + y) / s.length;
    assert.ok(Math.max(...s) < mean * 2 && Math.min(...s) > mean * .35, `steps run ${Math.min(...s)} to ${Math.max(...s)}, mean ${mean}`);
    near(s[s.length - 1]!, mean, mean, 'the closing step');
    assert.match(pathOf(l), /^M[\d. -]+(L[\d. -]+)+Z$/);
  }
});

test('dots divide a loop into a whole number of steps, at any scale, and stay about 7 px apart', () => {
  const l = outlineOf(art(120, 120, disc(60, 60, 40)), 1).loops[0]!;
  for (const scale of [.5, 1, 1.96]) {
    const n = dotsOn(l, scale);
    assert.ok(Number.isInteger(n));
    near(l.length * scale / n, GAP, .3, `gap at ${scale}`);
  }
  assert.strictEqual(DOT, 2.8);
});

test('the body is alpha at 50%: a soft glow below that adds nothing, and one above it does', () => {
  const faint = outlineOf(art(160, 160, disc(80, 80, 60, 100), disc(80, 80, 30)), 1).loops[0]!;
  const strong = outlineOf(art(160, 160, disc(80, 80, 60, 140), disc(80, 80, 30)), 1).loops[0]!;
  near(bounds(faint).x1 - 80, 30 + OFFSET, 2, 'faint glow');
  near(bounds(strong).x1 - 80, 60 + OFFSET, 2, 'strong glow');
});

test('specks under 0.2% of the body are dropped', () => {
  const clean = outlineOf(art(240, 200, disc(100, 100, 50)), 1);
  const dusty = outlineOf(art(240, 200, disc(100, 100, 50), box(220, 10, 223, 13), box(10, 180, 12, 182)), 1);
  assert.strictEqual(dusty.loops.length, 1);
  assert.deepStrictEqual(bounds(dusty.loops[0]!), bounds(clean.loops[0]!));
});

test('a part just over the speck size stays', () => {
  const body = disc(100, 100, 50), part = box(200, 10, 210, 20); /* 100 pixels on a body of 7,800 */
  const o = outlineOf(art(240, 200, body, part), 1);
  assert.ok(Math.max(...o.loops.map(l => bounds(l).x1)) > 205);
});

test('a part close by is bridged inside the one line', () => {
  const o = outlineOf(art(240, 160, disc(70, 80, 50), disc(175, 80, 14)), 1);
  assert.strictEqual(o.loops.length, 1);
  assert.ok(bounds(o.loops[0]!).x1 > 185, 'the line goes round the sparkle');
});

test('a part out of reach gets its own small loop', () => {
  const o = outlineOf(art(400, 140, disc(70, 70, 50), disc(370, 40, 16)), 1);
  assert.strictEqual(o.loops.length, 2);
  const [big, small] = [...o.loops].sort((a, b) => b.length - a.length);
  near(bounds(big!).x1, 120 + OFFSET, 2, 'the body keeps its line');
  near(bounds(small!).x0, 354 - OFFSET, 2, 'the far part has its own');
});

test('holes are filled: only the outer silhouette counts', () => {
  const ring: Pixel = (x, y) => { const d = Math.hypot(x - 80, y - 80); return d <= 50 && d >= 25 ? 255 : 0; };
  const o = outlineOf(art(160, 160, ring), 1);
  assert.strictEqual(o.loops.length, 1);
  near(bounds(o.loops[0]!).x1 - 80, 50 + OFFSET, 2, 'outer edge');
});

test('narrow inlets close, and fur and pixel steps come out smooth', () => {
  const comb: Pixel = (x, y) => y >= 60 && y < 140 && x >= 40 && x < 160 && (y < 120 || x % 6 < 4) ? 255 : 0;
  const o = outlineOf(art(200, 200, comb), 1), l = o.loops[0]!;
  assert.strictEqual(o.loops.length, 1);
  const bottom = pairs(l).filter(([x, y]) => x > 60 && x < 140 && y > 120).map(p => p[1]);
  assert.ok(Math.max(...bottom) - Math.min(...bottom) < 1.5, 'the teeth are gone from the line');
});

test('art on an opaque rectangle gets a rounded rectangle round it', () => {
  const o = outlineOf(art(100, 80, box(0, 0, 100, 80)), 1), l = o.loops[0]!, b = bounds(l);
  assert.strictEqual(o.shape, 'rectangle');
  assert.strictEqual(o.loops.length, 1);
  near(b.x0, -OFFSET, .5, 'left'); near(b.x1, 100 + OFFSET, .5, 'right'); near(b.y0, -OFFSET, .5, 'top'); near(b.y1, 80 + OFFSET, .5, 'bottom');
  assert.ok(!pairs(l).some(([x, y]) => Math.hypot(x + OFFSET, y + OFFSET) < 1), 'its corner is rounded off');
  const s = steps(l), mean = s.reduce((x, y) => x + y) / s.length;
  assert.ok(Math.max(...s) < mean * 1.5, 'even steps round it');
});

test('a rounded photo sticker with a clear margin still counts as a rectangle, round its own box', () => {
  const inside: Pixel = (x, y) => {
    const dx = Math.max(30 - x, x - 169, 0), dy = Math.max(30 - y, y - 169, 0);
    return x >= 10 && x < 190 && y >= 10 && y < 190 && Math.hypot(dx, dy) <= 20 ? 255 : 0;
  };
  const o = outlineOf(art(200, 200, inside), 1);
  assert.strictEqual(o.shape, 'rectangle');
  near(bounds(o.loops[0]!).x0, 10 - OFFSET, .5, 'left');
});

test('a shape that only half fills its box is traced, not boxed', () => {
  assert.strictEqual(outlineOf(art(100, 100, (x, y) => x + y < 100 ? 255 : 0), 1).shape, 'traced');
});

test('art with no solid body gets the line for art it can\'t read, not nothing', () => {
  for (const a of [art(64, 64), art(64, 64, disc(32, 32, 28, 90))]) {
    const o = outlineOf(a, 1);
    assert.strictEqual(o.shape, 'unread');
    assert.strictEqual(o.loops.length, 1);
  }
});

test('art right up against the edges is still fully round', () => {
  const o = outlineOf(art(100, 100, disc(50, 50, 50), disc(0, 0, 20)), 1), b = bounds(o.loops[0]!);
  assert.ok(b.x0 < 0 && b.y0 < 0 && b.x1 > 100 && b.y1 > 100);
});

test('rectangle() rounds the whole image', () => {
  const o = rectangle(184, 184, .5), b = bounds(o.loops[0]!);
  assert.strictEqual(o.shape, 'unread');
  near(b.x0, -10, .5, 'left'); near(b.y1, 194, .5, 'bottom');
});

test('distances are exact, and name the nearest pixel', () => {
  const w = 9, h = 7, m = new Uint8Array(w * h); m[2 * w + 1] = 1; m[5 * w + 7] = 1;
  const { dist, near: nearest } = distances(m, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = Math.hypot(x - 1, y - 2), b = Math.hypot(x - 7, y - 5), i = y * w + x;
    assert.ok(Math.abs(dist[i]! - Math.min(a, b)) < 1e-9, `${x},${y}`);
    if (a !== b) assert.strictEqual(nearest[i], a < b ? 2 * w + 1 : 5 * w + 7, `${x},${y}`);
  }
});

const image = { naturalWidth: 300, naturalHeight: 150 } as HTMLImageElement;
const fit = (w: number, h: number): [number, number] => [Math.round(w * 92 / h), 92];

test('the canvas wrapper bakes at the same detail, whatever the image\'s size', async () => {
  const sizes: number[][] = [];
  const o = await outlineOfImage('library/a/base.png?v=1', fit, (_, w, h) => { sizes.push([w, h]); return art(w, h, disc(w / 2, h / 2, h / 3)); }, async () => image);
  assert.deepStrictEqual(sizes, [[276, 138]]);
  assert.strictEqual(o.shape, 'traced');
  assert.deepStrictEqual([o.w, o.h], [276, 138]);
});

test('an image that won\'t load still gets a rounded rectangle', async () => {
  const o = await outlineOfImage('library/gone.png', fit, () => { throw new Error('no read'); }, () => Promise.reject(new Error('404')));
  assert.strictEqual(o.shape, 'unread');
  assert.strictEqual(o.loops.length, 1);
});

test('an image with no size still gets a real line', async () => {
  const o = await outlineOfImage('zero.svg', fit, () => { throw new Error('no read'); }, async () => ({ naturalWidth: 0, naturalHeight: 0 }) as HTMLImageElement);
  assert.strictEqual(o.shape, 'unread');
  assert.ok(Number.isFinite(o.w) && o.w > 0 && Number.isFinite(o.h) && o.h > 0);
  assert.ok(o.loops[0]!.length > 0 && o.loops[0]!.points.every(Number.isFinite));
});

test('an image that loads and can\'t be read, as a tainted canvas does, gets one at its own size', async () => {
  const o = await outlineOfImage('https://elsewhere/a.png', fit, () => { throw new DOMException('tainted', 'SecurityError'); }, async () => image);
  assert.strictEqual(o.shape, 'unread');
  assert.deepStrictEqual([o.w, o.h], [276, 138]);
});
