/* Image processing: turns uploaded art into a buddy's frames, in the page, with a canvas. */
import { SHIMEJI_FPS, SHIMEJI_MAP, type Buddy, type ContentBox, type Frame, type ImageRef, type Pose, type PoseKey } from '@buddies/buddy-file';

/* a canvas that remembers the size of the image it came from */
type Art = HTMLCanvasElement & { _ow?: number; _oh?: number };
interface Packable { c: Art; ox: number; oy: number }
interface Square { x0: number; y0: number; side: number }
interface Processed { frames: Frame[]; scale: number }

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const MAX_SRC = 1024, MAX_OUT = 320;
/* Art kept at its own pixels, as Shimeji are, up to the largest size a buddy can have. */
const MAX_NATIVE = 512;
function loadImg(src: string) { return new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; }); }
function canvasOf(im: HTMLImageElement) {
  const k = Math.min(1, MAX_SRC / Math.max(im.naturalWidth, im.naturalHeight));
  const c: Art = document.createElement('canvas');
  c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
  c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
  c._ow = im.naturalWidth; c._oh = im.naturalHeight;
  return c;
}
function isOpaque(c: Art) {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let n = 0, t = 0; for (let i = 3; i < d.length; i += 64) { n++; if (d[i]! < 250) t++; }
  return t / n < 0.01;
}
/* AI-generated art usually sits on a plain background (white, grey, flat colour).
   If the border is mostly one colour, flood-fill that colour away from the edges.
   Returns null when the background isn't plain, so real photos still become stickers. */
function removePlainBg(c: Art, TOL = 30, SOFT = 75) {
  const w = c.width, h = c.height, x = c.getContext('2d')!, img = x.getImageData(0, 0, w, h), d = img.data;
  const border: number[] = [];
  for (let i = 0; i < w; i++) border.push(i, (h - 1) * w + i);
  for (let j = 1; j < h - 1; j++) border.push(j * w, j * w + w - 1);
  const diff = (i: number, r: number[]) => Math.max(Math.abs(d[i * 4]! - r[0]!), Math.abs(d[i * 4 + 1]! - r[1]!), Math.abs(d[i * 4 + 2]! - r[2]!));
  let ref: number[] = [], best = 0;
  for (const ci of [0, w - 1, (h - 1) * w, h * w - 1]) {
    const r = [d[ci * 4]!, d[ci * 4 + 1]!, d[ci * 4 + 2]!];
    let n = 0; for (let k = 0; k < border.length; k += 7) if (diff(border[k]!, r) < TOL) n++;
    if (n > best) { best = n; ref = r; }
  }
  if (best / Math.ceil(border.length / 7) < 0.8) return null;
  const mark = new Uint8Array(w * h), stack: number[] = [];
  for (const i of border) if (!mark[i] && diff(i, ref) < TOL) { mark[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop()!, px = i % w;
    const nb = [px > 0 ? i - 1 : -1, px < w - 1 ? i + 1 : -1, i - w, i + w];
    for (const n of nb) if (n >= 0 && n < w * h && !mark[n] && diff(n, ref) < TOL) { mark[n] = 1; stack.push(n); }
  }
  for (let i = 0; i < w * h; i++) {
    if (mark[i]) { d[i * 4 + 3] = 0; continue; }
    /* soften the anti-aliased fringe next to the removed area */
    const px = i % w;
    if ((px > 0 && mark[i - 1]) || (px < w - 1 && mark[i + 1]) || (i >= w && mark[i - w]) || (i + w < w * h && mark[i + w])) {
      const df = diff(i, ref); if (df < SOFT) d[i * 4 + 3] = Math.round(255 * (df - TOL) / (SOFT - TOL));
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}
/* A photo with no transparency becomes a rounded sticker. */
function sticker(c: Art) {
  const s = Math.min(c.width, c.height), side = 360, b = 12, r = 48;
  const o: Art = document.createElement('canvas'); o.width = o.height = side;
  const x = o.getContext('2d')!;
  const rr = (p: number, rad: number) => { x.beginPath(); x.roundRect(p, p, side - 2 * p, side - 2 * p, rad); };
  x.save(); x.shadowColor = 'rgba(0,0,0,.25)'; x.shadowBlur = 8; x.shadowOffsetY = 3; rr(6, r); x.fillStyle = '#fff'; x.fill(); x.restore();
  x.save(); rr(6 + b, r - b); x.clip();
  x.drawImage(c, (c.width - s) / 2, (c.height - s) / 2, s, s, 6 + b, 6 + b, side - 2 * (6 + b), side - 2 * (6 + b));
  x.restore();
  o._ow = o._oh = -1; // never matches a sprite canvas
  return o;
}
function alphaBox(c: Art): ContentBox | null {
  const w = c.width, h = c.height, d = c.getContext('2d')!.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3]! > 24) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}
function union(a: ContentBox | null, b: ContentBox | null) { if (!a) return b; if (!b) return a; return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }; }
/* Draw canvases (with offsets) into a square region and export frames with normalized content boxes.
   `native` keeps the art's own pixels, past the usual 32 to 320 px, up to MAX_NATIVE. Drawn at its own
   size, a picture lands on whole pixels: a half-pixel offset would blend every pixel with its neighbour. */
function pack(items: Packable[], reg: Square, native = false): Frame[] {
  const O = native ? Math.min(Math.ceil(reg.side), MAX_NATIVE) : clamp(Math.ceil(reg.side), 32, MAX_OUT);
  const k = native && reg.side <= MAX_NATIVE ? 1 : O / reg.side, at = (n: number) => k === 1 ? Math.round(n) : n * k;
  return items.map(({ c, ox, oy }) => {
    const o = document.createElement('canvas'); o.width = o.height = O;
    const x = o.getContext('2d')!; x.imageSmoothingQuality = 'high';
    x.drawImage(c, at(ox - reg.x0), at(oy - reg.y0), c.width * k, c.height * k);
    const b = alphaBox(o);
    return { src: o.toDataURL('image/png'), bb: b ? { x0: b.x0 / O, y0: b.y0 / O, x1: b.x1 / O, y1: b.y1 / O } : { x0: 0, y0: 0, x1: 1, y1: 1 } };
  });
}
function squareAround(cx: number, bottom: number, box: ContentBox): Square {
  const half = Math.max(cx - box.x0, box.x1 - cx);
  const side = Math.max(2 * half, bottom - box.y0, 8);
  return { x0: cx - side / 2, y0: bottom - side, side };
}
/* Main image: trim empty margins, feet on the bottom edge. Returns the frame and a
   reference so later pose frames drawn on the same-size canvas keep the same scale. */
export async function processBase(src: string, opts?: { native?: boolean }) {
  const im = await loadImg(src).catch(() => null); if (!im) return null;
  let c = canvasOf(im);
  let photo = false; if (isOpaque(c)) { if (!removePlainBg(c)) { photo = true; c = sticker(c); } }
  const box = alphaBox(c) || { x0: 0, y0: 0, x1: c.width, y1: c.height };
  const cx = (box.x0 + box.x1) / 2, reg = squareAround(cx, box.y1, box);
  const [frame] = pack([{ c, ox: 0, oy: 0 }], reg, !!(opts && opts.native) && !photo);
  return { frame: frame!, photo, ref: { ow: c._ow!, oh: c._oh!, w: c.width, h: c.height, cx, by: box.y1, side: reg.side } };
}
/* Pose frames: all frames in a batch share one crop so the animation stays aligned. */
export async function processFrames(srcs: string[], ref?: ImageRef | null, opts?: { independent?: boolean; native?: boolean }): Promise<Processed | null> {
  if (opts && opts.independent) ref = null;
  /* repeated frames (e.g. walk 1,2,1,3) are processed once and shared */
  const uniq = [...new Set(srcs)], cs: Art[] = [], idx = new Map<string, number>();
  for (const s of uniq) { try { let c = canvasOf(await loadImg(s)); if (isOpaque(c) && !removePlainBg(c)) c = sticker(c); idx.set(s, cs.length); cs.push(c); } catch (e) { /* skip */ } }
  if (!cs.length) return null;
  const order = srcs.filter(s => idx.has(s)).map(s => idx.get(s)!);
  const out = await processCanvases(cs, ref, !!(opts && opts.native));
  const all = out.frames; out.frames = order.map(i => all[i]!);
  return out;
}
async function processCanvases(cs: Art[], ref?: ImageRef | null, native = false): Promise<Processed> {
  const same = ref && cs.every(c => c._ow === ref.ow && c._oh === ref.oh && c.width === ref.w);
  if (same) {
    let U: ContentBox | null = null; for (const c of cs) U = union(U, alphaBox(c));
    U = U || { x0: 0, y0: 0, x1: ref!.w, y1: ref!.h };
    const reg = squareAround(ref!.cx, Math.max(ref!.by, U.y1), union(U, { x0: ref!.cx - ref!.side / 2, y0: ref!.by - ref!.side, x1: ref!.cx + ref!.side / 2, y1: ref!.by })!);
    return { frames: pack(cs.map(c => ({ c, ox: 0, oy: 0 })), reg, native), scale: +(reg.side / ref!.side).toFixed(3) };
  }
  const mw = Math.max(...cs.map(c => c.width)), mh = Math.max(...cs.map(c => c.height));
  const items = cs.map(c => ({ c, ox: (mw - c.width) / 2, oy: mh - c.height }));
  let U: ContentBox | null = null;
  for (const it of items) { const b = alphaBox(it.c); if (b) U = union(U, { x0: b.x0 + it.ox, y0: b.y0 + it.oy, x1: b.x1 + it.ox, y1: b.y1 + it.oy }); }
  U = U || { x0: 0, y0: 0, x1: mw, y1: mh };
  const reg = squareAround((U.x0 + U.x1) / 2, U.y1, U);
  return { frames: pack(items, reg, native), scale: 1 };
}
/* Size matching for separately generated images. AI images come out at slightly different
   sizes, and trimming each frame on its own makes poses with raised arms look smaller.
   The body (largest connected blob, so floating notes, zzz and tears don't count) should
   cover the same area as in the main image, so scale = sqrt(main area / pose area). */
function bodyFrac(c: Art) {
  const N = 128, t = document.createElement('canvas'); t.width = t.height = N;
  const x = t.getContext('2d')!; x.drawImage(c, 0, 0, N, N);
  const d = x.getImageData(0, 0, N, N).data, m = new Uint8Array(N * N), st: number[] = [];
  for (let i = 0; i < N * N; i++) m[i] = d[i * 4 + 3]! > 128 ? 1 : 0;
  let best = 0;
  for (let i = 0; i < N * N; i++) {
    if (m[i] !== 1) continue;
    let n = 0; m[i] = 2; st.push(i);
    while (st.length) {
      const j = st.pop()!, px = j % N; n++;
      if (px > 0 && m[j - 1] === 1) { m[j - 1] = 2; st.push(j - 1); }
      if (px < N - 1 && m[j + 1] === 1) { m[j + 1] = 2; st.push(j + 1); }
      if (j >= N && m[j - N] === 1) { m[j - N] = 2; st.push(j - N); }
      if (j + N < N * N && m[j + N] === 1) { m[j + N] = 2; st.push(j + N); }
    }
    if (n > best) best = n;
  }
  return best / (N * N);
}
const fracCache = new Map<string, number>();
async function frameFrac(src: string) {
  if (!fracCache.has(src)) { try { fracCache.set(src, bodyFrac(canvasOf(await loadImg(src)))); } catch (e) { fracCache.set(src, 0); } }
  return fracCache.get(src)!;
}
/* returns the pose scale that makes these frames match the main image's body size, or null */
export async function matchScale(baseFrame: Frame, frames: Frame[]) {
  const fb = await frameFrac(baseFrame.src); if (!fb) return null;
  const fs = []; for (const s of new Set(frames.map(f => f.src))) { const v = await frameFrac(s); if (v) fs.push(v); }
  if (!fs.length) return null;
  fs.sort((a, b) => a - b);
  const med = fs[fs.length >> 1]!;
  return +clamp(Math.sqrt(fb / med), .4, 2.5).toFixed(3);
}
/* Where a picture's art ends, as a share of its height: what a frame's box bottom is when it's cut.
   Null for a picture that can't be read or has nothing in it. */
export async function bottomOf(src: string): Promise<number | null> {
  const im = await loadImg(src).catch(() => null); if (!im) return null;
  const c = canvasOf(im), b = alphaBox(c);
  return b ? b.y1 / c.height : null;
}
export const natSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/* Build a whole buddy from a Shimeji image folder. files: [{name, src}]
   Shimeji draw their pictures pixel for pixel, so the frames keep their own pixels and her size is the
   main frame's side: at that size the view draws one picture pixel to one screen pixel. Her standing
   art is shime1 itself, kept as Stand so it isn't given the squash a still main image gets. */
export async function fromShimeji(files: { name: string; src: string }[]): Promise<(Buddy & { poses: Partial<Record<PoseKey, Pose>> }) | null> {
  const byNum: Record<number, string> = {};
  files.forEach(f => { const m = /shime(\d+)\.png$/i.exec(f.name); if (m) byNum[+m[1]!] = f.src; });
  if (!byNum[1]) return null;
  const base = await processBase(byNum[1], { native: true }); if (!base) return null;
  const poses: Partial<Record<PoseKey, Pose>> = {};
  for (const [key, nums] of Object.entries(SHIMEJI_MAP) as [PoseKey, number[]][]) {
    if (!nums.every(n => byNum[n])) continue;
    if (key === 'drag') continue; // same as main image
    if (key === 'stand') { poses.stand = { frames: [base.frame], fps: 4, scale: 1 }; continue; }
    const r = await processFrames(nums.map(n => byNum[n]!), base.ref, { native: true });
    if (r) poses[key] = { frames: r.frames, fps: SHIMEJI_FPS[key] || 4, scale: r.scale };
  }
  /* the main frame's side, as pack cut it */
  const side = Math.min(Math.ceil(base.ref.side), MAX_NATIVE);
  return { base: base.frame, ref: base.ref, poses, faces: 'left', size: clamp(side, 16, MAX_NATIVE) };
}
