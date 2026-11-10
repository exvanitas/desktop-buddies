/* The dotted cut line a sticker leaves on the sheet, worked out from an image's alpha. Pure: no
   page and no canvas, so it runs anywhere. outline-canvas.ts reads the pixels.

   Steps, from docs/design/round-1/peel/bake-outlines.py:
    1. Body: alpha at 50% or more, so glows and feathering don't pull the line away.
    2. Drop specks under 0.2% of the body.
    3. Parts within a third of the art get a thin bridge to the body. Further ones keep their own loop.
    4. Fill holes. Only the outer silhouette counts.
    5. Grow by the offset, measured in sheet pixels.
    6. Close narrow inlets and blur, so fur and pixel steps become a smooth cut.
    7. Trace each loop, and resample it evenly.
   Art with no silhouette gets a rounded rectangle. */

/* one byte of alpha per pixel */
export interface Alpha { width: number; height: number; data: ArrayLike<number> }
/* a closed path in alpha pixels: x, y, x, y, ... with no repeat of the first point */
export interface Loop { points: number[]; length: number }
/* traced: the art's shape. rectangle: opaque art. unread: the pixels couldn't be read. */
export type Shape = 'traced' | 'rectangle' | 'unread';
export interface Outline { w: number; h: number; loops: Loop[]; shape: Shape }

export const OFFSET = 5; /* the gap from the art to the line, in sheet pixels */
export const DOT = 2.8, GAP = 7; /* in sheet pixels */
const STEP = 3; /* distance between points, in alpha pixels */
const SOLID = 128, SPECK = .002, REACH = 1 / 3, MIN_POINTS = 12;
const RECTANGLE = .96; /* how much of its box a body fills to count as a rectangle */
const FAR = 1e12;

type Mask = Uint8Array;

/* Each 8-connected part gets a number from 1, and `areas[n]` is its size. */
function parts(mask: Mask, w: number, h: number) {
  const labels = new Int32Array(w * h), areas = [0], stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i]) continue;
    const n = areas.length; let area = 0;
    labels[i] = n; stack.push(i);
    while (stack.length) {
      const j = stack.pop()!, x = j % w, y = (j - x) / w; area++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, k = ny * w + nx;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[k] && !labels[k]) { labels[k] = n; stack.push(k); }
      }
    }
    areas.push(area);
  }
  return { labels, areas };
}

/* Exact distance from every pixel to the nearest set one, and which one that is. Two passes: down
   each column, then a lower envelope of parabolas along each row. */
export function distances(mask: Mask, w: number, h: number) {
  const dist = new Float64Array(w * h), near = new Int32Array(w * h), rowOf = new Int32Array(w * h), col = new Float64Array(w * h);
  for (let x = 0; x < w; x++) {
    let last = -1;
    for (let y = 0; y < h; y++) { if (mask[y * w + x]) last = y; rowOf[y * w + x] = last; }
    last = -1;
    for (let y = h - 1; y >= 0; y--) {
      const i = y * w + x;
      if (mask[i]) last = y;
      if (last >= 0 && (rowOf[i]! < 0 || last - y < y - rowOf[i]!)) rowOf[i] = last;
      col[i] = rowOf[i]! < 0 ? FAR : (rowOf[i]! - y) ** 2;
    }
  }
  const v = new Int32Array(w), z = new Float64Array(w + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w, f = (x: number) => col[row + x]!;
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < w; q++) {
      let s: number;
      for (;;) {
        const p = v[k]!;
        s = (f(q) + q * q - f(p) - p * p) / (2 * (q - p));
        if (s > z[k]!) break;
        k--;
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let x = 0; x < w; x++) {
      while (z[k + 1]! < x) k++;
      const p = v[k]!, i = row + x;
      dist[i] = Math.sqrt((x - p) ** 2 + f(p));
      near[i] = rowOf[row + p]! * w + p;
    }
  }
  return { dist, near };
}

const within = (dist: Float64Array, r: number): Mask => {
  const out = new Uint8Array(dist.length);
  for (let i = 0; i < out.length; i++) out[i] = dist[i]! <= r ? 1 : 0;
  return out;
};

/* Everything the outside can't reach, through the four sides of each pixel. */
function fillHoles(mask: Mask, w: number, h: number): Mask {
  const out = new Uint8Array(w * h).fill(1), stack: number[] = [];
  const visit = (i: number) => { if (!mask[i] && out[i]) { out[i] = 0; stack.push(i); } };
  for (let x = 0; x < w; x++) { visit(x); visit((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { visit(y * w); visit(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop()!, x = i % w;
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i + w < w * h) visit(i + w);
  }
  return out;
}

/* Drops specks, and joins what's within reach to the biggest part with a capsule. */
function tidy(mask: Mask, w: number, h: number, reach: number, width: number): Mask {
  const { labels, areas } = parts(mask, w, h);
  if (areas.length < 3) return mask;
  const biggest = Math.max(...areas), main = areas.indexOf(biggest), kept = mask.slice();
  for (let i = 0; i < kept.length; i++) if (labels[i] && areas[labels[i]!]! < SPECK * biggest) kept[i] = 0;

  const body = new Uint8Array(w * h);
  for (let i = 0; i < body.length; i++) body[i] = labels[i] === main ? 1 : 0;
  const { dist, near } = distances(body, w, h);
  const closest = new Int32Array(areas.length).fill(-1);
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i]!;
    if (!kept[i] || l === main) continue;
    if (closest[l]! < 0 || dist[i]! < dist[closest[l]!]!) closest[l] = i;
  }
  const links = new Uint8Array(w * h);
  let any = false;
  for (const i of closest) {
    if (i < 0 || dist[i]! > reach) continue;
    const x0 = i % w, y0 = (i - x0) / w, to = near[i]!, x1 = to % w, y1 = (to - x1) / w, n = Math.trunc(dist[i]!) + 2;
    for (let t = 0; t < n; t++) links[Math.trunc(y0 + (y1 - y0) * t / (n - 1)) * w + Math.trunc(x0 + (x1 - x0) * t / (n - 1))] = 1;
    any = true;
  }
  if (!any) return kept;
  const bridge = within(distances(links, w, h).dist, width);
  return kept.map((v, i) => v | bridge[i]!);
}

/* One running average along each line of a grid. Off the edges counts as nothing. */
function smear(from: ArrayLike<number>, to: Float64Array, n: number, step: number, lines: number, next: number, r: number) {
  for (let l = 0; l < lines; l++) {
    const at = l * next;
    let sum = 0;
    for (let i = 0; i < r && i < n; i++) sum += from[at + i * step]!;
    for (let i = 0; i < n; i++) {
      if (i + r < n) sum += from[at + (i + r) * step]!;
      if (i > r) sum -= from[at + (i - r - 1) * step]!;
      to[at + i * step] = sum / (2 * r + 1);
    }
  }
}
/* Three box blurs make a gaussian of this sigma, for a tenth of the work. */
function blur(mask: Mask, w: number, h: number, sigma: number) {
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
  const a = new Float64Array(w * h), b = new Float64Array(w * h);
  smear(mask, a, w, 1, h, w, r); smear(a, b, h, w, w, 1, r);
  smear(b, a, w, 1, h, w, r); smear(a, b, h, w, w, 1, r);
  smear(b, a, w, 1, h, w, r); smear(a, b, h, w, w, 1, r);
  return b;
}

/* Marching squares at one level: closed loops, as x, y, x, y, ... Every crossing is named by the
   grid edge it's on, so segments join up exactly. */
function contours(f: Float64Array, w: number, h: number, level = .5) {
  const across = (x: number, y: number) => 2 * (y * w + x), down = (x: number, y: number) => 2 * (y * w + x) + 1;
  const links = new Map<number, number[]>();
  const add = (a: number, b: number) => { const l = links.get(a); if (l) l.push(b); else links.set(a, [b]); };
  const join = (a: number, b: number) => { add(a, b); add(b, a); };
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const i = y * w + x, a = f[i]! >= level, b = f[i + 1]! >= level, c = f[i + w + 1]! >= level, d = f[i + w]! >= level;
    if (a === b && b === c && c === d) continue;
    const top = across(x, y), right = down(x + 1, y), bottom = across(x, y + 1), left = down(x, y);
    const cut: number[] = [];
    if (a !== b) cut.push(top);
    if (b !== c) cut.push(right);
    if (c !== d) cut.push(bottom);
    if (d !== a) cut.push(left);
    if (cut.length === 2) join(cut[0]!, cut[1]!);
    else {
      const high = (f[i]! + f[i + 1]! + f[i + w + 1]! + f[i + w]!) / 4 >= level;
      if (a === high) { join(top, right); join(bottom, left); } else { join(top, left); join(right, bottom); }
    }
  }
  const at = (e: number): [number, number] => {
    const i = e >> 1, x = i % w, y = (i - x) / w, to = e & 1 ? i + w : i + 1, t = (level - f[i]!) / (f[to]! - f[i]!);
    return e & 1 ? [x, y + t] : [x + t, y];
  };
  const seen = new Set<number>(), loops: number[][] = [];
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const loop: number[] = [];
    let e: number | undefined = start;
    while (e !== undefined) {
      seen.add(e); loop.push(...at(e));
      e = links.get(e)!.find(n => !seen.has(n));
    }
    loops.push(loop);
  }
  return loops;
}

/* Evenly spaced points along a closed path, moved by `shift`. */
function resample(p: number[], shift: number): Loop {
  const n = p.length / 2, s = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; s[i + 1] = s[i]! + Math.hypot(p[2 * j]! - p[2 * i]!, p[2 * j + 1]! - p[2 * i + 1]!); }
  const length = s[n]!, count = Math.max(MIN_POINTS, Math.floor(length / STEP)), points: number[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const t = k * length / count;
    while (s[seg + 1]! < t) seg++;
    const b = (seg + 1) % n, u = (t - s[seg]!) / (s[seg + 1]! - s[seg]! || 1);
    points.push(p[2 * seg]! + (p[2 * b]! - p[2 * seg]!) * u - shift, p[2 * seg + 1]! + (p[2 * b + 1]! - p[2 * seg + 1]!) * u - shift);
  }
  return { points, length };
}

/* A box's line, with its corners rounded. */
function roundedLoop(x0: number, y0: number, x1: number, y1: number, r: number): Loop {
  const p: number[] = [], arcs = [[x1 - r, y0 + r, -Math.PI / 2], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, Math.PI / 2], [x0 + r, y0 + r, Math.PI]] as const;
  for (const [cx, cy, from] of arcs) for (let i = 0; i <= 8; i++) { const a = from + i * Math.PI / 16; p.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
  return resample(p, 0);
}

/* The line for art that couldn't be read: round the whole image. */
export function rectangle(w: number, h: number, perPx: number): Outline {
  const off = OFFSET / perPx;
  return { w, h, shape: 'unread', loops: [roundedLoop(-off, -off, w + off, h + off, off * 2)] };
}

/* Where the body is and how much of that box it fills, or null if there's no body. */
function boxOf(mask: Mask, w: number, h: number) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, area = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) {
    area++;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return area ? { x0, y0, x1: x1 + 1, y1: y1 + 1, full: area / ((x1 + 1 - x0) * (y1 + 1 - y0)) } : null;
}

/* `perPx` is sheet pixels per alpha pixel. */
export function outlineOf({ width: w, height: h, data }: Alpha, perPx: number): Outline {
  const off = OFFSET / perPx, pad = Math.trunc(off * 3 + 8), W = w + 2 * pad, H = h + 2 * pad;
  let mask: Mask = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[y * w + x]! >= SOLID) mask[(y + pad) * W + x + pad] = 1;

  const box = boxOf(mask, W, H);
  if (!box) return rectangle(w, h, perPx);
  if (box.full >= RECTANGLE) return { w, h, shape: 'rectangle', loops: [roundedLoop(box.x0 - pad - off, box.y0 - pad - off, box.x1 - pad + off, box.y1 - pad + off, off * 2)] };

  mask = fillHoles(tidy(mask, W, H, Math.max(w, h) * REACH, Math.max(2, off * .35)), W, H);
  const grown = within(distances(mask, W, H).dist, off);
  /* closing: grow, then shrink back */
  const r = off * 1.3, far = within(distances(grown, W, H).dist, r);
  const shrunk = distances(far.map(v => v ? 0 : 1), W, H).dist;
  const closed = fillHoles(grown.map((v, i) => v | (shrunk[i]! > r ? 1 : 0)), W, H);
  const loops = contours(blur(closed, W, H, off * .45), W, H).filter(p => p.length / 2 >= MIN_POINTS).map(p => resample(p, pad));
  return loops.length ? { w, h, shape: 'traced', loops } : rectangle(w, h, perPx);
}

/* A loop as an SVG path. */
export function pathOf(loop: Loop) {
  const n = (v: number) => +v.toFixed(1), p = loop.points;
  let d = `M${n(p[0]!)} ${n(p[1]!)}`;
  for (let i = 2; i < p.length; i += 2) d += `L${n(p[i]!)} ${n(p[i + 1]!)}`;
  return d + 'Z';
}
/* How many dots go round a loop: a whole number, so it closes with no seam or short gap. */
export const dotsOn = (loop: Loop, scale: number) => Math.max(3, Math.round(loop.length * scale / GAP));
