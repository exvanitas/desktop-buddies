/* Per-pixel hit testing: a small alpha mask per image, so an overlay only takes the mouse over
 pixels you can see. */
import type { PetFrame } from '@buddies/engine';
import { overlayRect } from './overlay-rect';
import type { Rect } from './shell';

interface Mask { ready: boolean; failed: number | null; a: Uint8Array }

/* An image's URL is named by its bytes, so each changed image gets a new one and the old stays here.
   The oldest go, or an evening's edits would all stay. One that failed to load is remembered as
   failed for FAILED_MS from when the failure came, then the next ask loads it again: the same image
   can come back under the same name, or a load can fail once and work the next time. The cursor is
   checked many times a second, so a broken frame under it costs one load a period at most, and an
   image back on disk takes clicks again within the period. */
export const FAILED_MS = 5000;
const N = 64, KEPT = 1024, masks = new Map<string, Mask>();
/* Where a mask that couldn't load is said: the overlay's log. */
let note = (_: string) => {};
export const noteWith = (f: (line: string) => void) => { note = f; };
export function make(src: string) {
  const had = masks.get(src);
  if (had && (had.failed === null || performance.now() - had.failed < FAILED_MS)) return had;
  if (had) masks.delete(src);
  const m: Mask = { ready: false, failed: null, a: new Uint8Array(N * N) };
  if (masks.size >= KEPT) masks.delete(masks.keys().next().value!);
  masks.set(src, m);
  const im = new Image();
  im.onload = () => {
    const c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(im, 0, 0, N, N);
    const d = x.getImageData(0, 0, N, N).data;
    for (let i = 0; i < N * N; i++) m.a[i] = d[i * 4 + 3]! > 40 ? 1 : 0;
    m.ready = true;
  };
  /* Once per URL a period at most, since that's how often it's tried. */
  im.onerror = () => { m.failed = performance.now(); note(`mask couldn't load ${src}, next try in ${FAILED_MS} ms`); };
  im.src = src;
  return m;
}
/* u and v run 0 to 1 across the image. */
function at(src: string, u: number, v: number) {
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
  const m = make(src);
  return m.ready && m.a[(v * N | 0) * N + (u * N | 0)] === 1;
}
/* What the hit test makes of a CSS point, for a log: the topmost frame near it, where it was drawn,
   and the answer, or the mask's state if it has none yet. It never starts a load. */
export function explain(frames: PetFrame[], x: number, y: number) {
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i]!;
    if (f.off || !f.size || !f.src) continue;
    const b = f.box, dx = x - b.l - b.ox, dy = y - b.t - b.oy;
    if (Math.hypot(dx, dy) > b.size * 2) continue;
    const q = new DOMMatrix(f.body!).inverse().transformPoint({ x: dx, y: dy });
    const u = (q.x + b.ox) / b.size, v = (q.y + b.oy) / b.size, m = masks.get(f.src);
    const answer = !m ? 'no mask yet' : m.failed !== null ? `couldn't load, next try in ${Math.max(0, Math.round(FAILED_MS - (performance.now() - m.failed)))} ms`
      : !m.ready ? 'loading' : u < 0 || u >= 1 || v < 0 || v >= 1 ? 'miss, outside her image' : m.a[(v * N | 0) * N + (u * N | 0)] === 1 ? 'hit' : 'miss, a clear pixel';
    return { id: f.id, src: f.src, box: b, u, v, answer };
  }
  return null;
}
/* The buddy under a CSS point: frames as the view last applied them, topmost last. A buddy can
   be rotated and mirrored, so the point is taken back through its body transform. */
export function under(frames: PetFrame[], x: number, y: number) {
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i]!;
    if (f.off || !f.size || !f.src) continue;
    const b = f.box, dx = x - b.l - b.ox, dy = y - b.t - b.oy;
    if (Math.hypot(dx, dy) > b.size * 2) continue;
    const q = new DOMMatrix(f.body!).inverse().transformPoint({ x: dx, y: dy });
    if (at(f.src, (q.x + b.ox) / b.size, (q.y + b.oy) / b.size)) return f.id;
  }
  return null;
}
/* A CSS point over one of her solid pixels that this overlay shows, for the smoke run to aim the real
   cursor at: of her solid cells inside `view`, the one nearest their middle, inside her if it can be,
   so she can move a little before the press and still be under it. Null while her mask isn't ready,
   or when none of her shows here: an overlay keeps a frame a little past its edges, drawn but unseen.
   It never starts a load. */
export function aim(f: PetFrame, view: { w: number; h: number }) {
  const m = f.src ? masks.get(f.src) : undefined;
  if (f.off || !f.size || !m || !m.ready) return null;
  const b = f.box, body = new DOMMatrix(f.body!);
  /* a cell's middle on the overlay, out through the body transform, the way `under` comes in */
  const at = (i: number, j: number) => {
    const p = body.transformPoint({ x: (i + .5) / N * b.size - b.ox, y: (j + .5) / N * b.size - b.oy });
    return { x: p.x + b.l + b.ox, y: p.y + b.t + b.oy };
  };
  const solid = (i: number, j: number) => i >= 0 && j >= 0 && i < N && j < N && m.a[j * N + i] === 1;
  const shown: { i: number; j: number; p: { x: number; y: number } }[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (!solid(i, j)) continue;
    const p = at(i, j);
    if (p.x >= 0 && p.y >= 0 && p.x < view.w && p.y < view.h) shown.push({ i, j, p });
  }
  if (!shown.length) return null;
  const ci = shown.reduce((a, c) => a + c.i, 0) / shown.length, cj = shown.reduce((a, c) => a + c.j, 0) / shown.length;
  let best = shown[0]!, bestInner = false, d = Infinity;
  for (const c of shown) {
    const { i, j } = c, inner = solid(i - 1, j) && solid(i + 1, j) && solid(i, j - 1) && solid(i, j + 1), e = (i - ci) ** 2 + (j - cj) ** 2;
    if ((inner && !bestInner) || (inner === bestInner && e < d)) { best = c; bestInner = inner; d = e; }
  }
  return best.p;
}
/* An overlay's window is overlayRect(), so screen and CSS pixels meet at its origin. */
type Placed = Rect & { full: Rect; scale: number };

/* Where the cursor is on this overlay, in CSS pixels, whether it's inside the window, and the buddy
   whose visible pixels are under it, if any. Only that takes the mouse, so whatever is under the rest
   of the window, the taskbar too, keeps its clicks. */
export function pointed(frames: PetFrame[], c: { x: number; y: number }, me: Placed, view: { w: number; h: number }) {
  const o = overlayRect(me), x = (c.x - o.x) / me.scale, y = (c.y - o.y) / me.scale;
  const inside = x >= 0 && y >= 0 && x < view.w && y < view.h;
  return { x, y, inside, id: inside ? under(frames, x, y) : null };
}

/* The trace's line for a buddy this overlay shows: where she's drawn, and the aim in screen pixels.
   Null when her box is all past the overlay's edges, so only an overlay that shows her says where. */
export function huntLine(f: PetFrame, me: Placed) {
  const o = overlayRect(me), b = f.box, view = { w: o.w / me.scale, h: o.h / me.scale };
  if (f.off || !f.size || b.l + b.size <= 0 || b.t + b.size <= 0 || b.l >= view.w || b.t >= view.h) return null;
  const a = aim(f, view);
  return `hunt ${f.id} drawn ${Math.round(b.l)},${Math.round(b.t)} size ${Math.round(b.size)}` + (a ? `, aim ${Math.round(o.x + a.x * me.scale)},${Math.round(o.y + a.y * me.scale)}` : ', no aim yet');
}
