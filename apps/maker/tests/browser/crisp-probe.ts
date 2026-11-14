/* A page for the crisp checks: a made-up Shimeji set through the real import, then the real engine and
   view drawing her standing on one screen at the page's display scale. Sharp-edged pixel art, every
   pixel its own colour, so a pixel blended with any neighbour shows. The browser run takes a screenshot
   in screen pixels and hands it back to `compare`. */
import { fromShimeji } from '../../../../packages/art/src/images';
import { createView } from '../../../../packages/view/src/view';
import { screen, world } from '../../../../packages/engine/tests/support';
import type { Buddy } from '../../../../packages/buddy-file/src/schema';

interface Box { x0: number; y0: number; x1: number; y1: number }
interface Art { side: number; box: Box; d: Uint8ClampedArray }
const W = window as unknown as Record<string, unknown>;
const SEEN = { w: 400, h: 320 };

function art(seed: number, side: number, box: Box): Art & { src: string } {
  const c = document.createElement('canvas'); c.width = c.height = side;
  const x = c.getContext('2d')!, img = x.createImageData(side, side), d = img.data;
  let s = seed >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s >>> 24; };
  for (let y = box.y0; y < box.y1; y++) for (let i = box.x0; i < box.x1; i++) { const k = (y * side + i) * 4; d[k] = r(); d[k + 1] = r(); d[k + 2] = r(); d[k + 3] = 255; }
  x.putImageData(img, 0, 0);
  return { src: c.toDataURL('image/png'), side, box, d };
}
async function pixels(src: string) {
  const im = new Image(); im.src = src; await im.decode();
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(im, 0, 0);
  return { w: c.width, h: c.height, d: x.getImageData(0, 0, c.width, c.height).data };
}
const diff = (a: Uint8ClampedArray, i: number, b: Uint8ClampedArray, j: number) => Math.abs(a[i]! - b[j]!) + Math.abs(a[i + 1]! - b[j + 1]!) + Math.abs(a[i + 2]! - b[j + 2]!);
/* Where a stored frame sits on its source: the whole-pixel shift that matches best, and how well. */
function align(a: Art, f: { w: number; h: number; d: Uint8ClampedArray }) {
  let best = { dx: 0, dy: 0, exact: 0, err: Infinity };
  for (let dy = a.box.y0 - f.h + 1; dy <= a.box.y0; dy++) for (let dx = a.box.x0 - f.w + 1; dx <= a.box.x0; dx++) {
    let n = 0, exact = 0, sum = 0;
    for (let y = a.box.y0; y < a.box.y1; y++) for (let x = a.box.x0; x < a.box.x1; x++) {
      const u = x - dx, v = y - dy; if (u < 0 || v < 0 || u >= f.w || v >= f.h) continue;
      const j = (v * f.w + u) * 4, e = diff(a.d, (y * a.side + x) * 4, f.d, j) + 255 - f.d[j + 3]!;
      n++; sum += e; if (!e) exact++;
    }
    if (n && sum / n < best.err) best = { dx, dy, exact: exact / n, err: sum / n };
  }
  return best;
}

let sources: Art[] = [], buddy: Buddy | null = null, at = { dx: 0, dy: 0 };
/* `n` frames shime1..shimeN of side `side`, the art inside `box`. What the import made of them: her size,
   the main frame's side, whether Stand is her own, and how each distinct stored frame matches its source. */
W.importSet = async (n: number, side: number, box: Box) => {
  const arts = Array.from({ length: n }, (_, i) => art((i + 1) * 7919, side, box));
  sources = arts;
  const b = await fromShimeji(arts.map((a, i) => ({ name: `img/shime${i + 1}.png`, src: a.src })));
  if (!b) throw new Error('no buddy came of the set');
  buddy = b;
  const base = await pixels(b.base.src);
  at = align(arts[0]!, base);
  const seen = new Map<string, number>();
  for (const [k, p] of Object.entries(b.poses)) {
    const want = (({ stand: [1], walk: [1, 2, 1, 3], sit: [11] } as Record<string, number[]>)[k]);
    if (!want) continue;
    p!.frames.forEach((f, i) => seen.set(f.src, want[i]! - 1));
  }
  let worst = 1;
  for (const [src, i] of seen) worst = Math.min(worst, align(arts[i]!, await pixels(src)).exact);
  return { size: b.size, side: base.w, stand: !!b.poses.stand, base: { exact: at.exact, err: +at.err.toFixed(1) }, poses: worst, scales: Object.values(b.poses).map(p => p!.scale) };
};

/* Her standing on the floor of one screen at the page's display scale, at `size` (hers if left out),
   or a buddy of drawn art `drawn` px across at size 120. Where her picture is, in screen pixels. */
W.draw = async (o: { size?: number; drawn?: number } = {}) => {
  const dpr = devicePixelRatio;
  let b: Buddy = buddy!;
  if (o.drawn) b = { ...b, size: 120, poses: {}, base: { src: art(5, o.drawn, { x0: 30, y0: 10, x1: o.drawn - 30, y1: o.drawn }).src, bb: { x0: .1, y0: .03, x1: .9, y1: 1 } } };
  else if (o.size) b = { ...b, size: o.size };
  const w = world([screen('s', 0, 0, SEEN.w * dpr, SEEN.h * dpr, dpr)]), pet = w.add({ id: 'p', name: '', ...b } as never);
  if (!w.until(() => pet.P.surf === 'floor' && pet.P.state !== 'land', 4000)) throw new Error('she never landed');
  const on = pet.P.on!; on.t = 150.3 * dpr - on.surface.from; pet.P.x = 150.3 * dpr;
  pet.go('idle'); pet.P.dur = 1e9; pet.P.chatT = 1e9;
  for (let i = 0; i < 40; i++) w.frame();
  const root = document.getElementById('root')!; root.replaceChildren();
  const vp = { x: 0, y: 0, scale: dpr, w: SEEN.w, h: SEEN.h };
  createView({ root, input: w.sim.input, viewport: vp }).apply(w.sim.frame(vp));
  const img = root.querySelector('img')!; await img.decode();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const r = img.getBoundingClientRect(), f = pet.frame(vp), cs = getComputedStyle(img);
  return { rect: [r.left * dpr, r.top * dpr, r.width * dpr, r.height * dpr], mirror: !!f.parts && f.parts.sx < 0, body: f.body, rendering: cs.imageRendering, layer: getComputedStyle(root.querySelector('.db-pet')!).willChange };
};

/* The screenshot against her source, in the art's opaque middle: each screen pixel must be exactly the
   source pixel under its centre (nearest-neighbour; on a tie, either side). `side` is the stored
   frame's, `rect` where draw found it. */
W.compare = async (shot: string, rect: number[], side: number, mirror: boolean) => {
  const s = await pixels(shot), a = sources[0]!, [L, T, Wd, Ht] = rect as [number, number, number, number];
  const qx = Wd / side, qy = Ht / side;
  /* a centre within a thousandth of a pixel of a seam is a tie, which the browser's own rounding settles */
  const under = (p: number, q: number) => { const v = p / q, r = Math.round(v); return Math.abs(v - r) < 1e-3 ? [r - 1, r] : [Math.floor(v)]; };
  let n = 0, exact = 0, worst = 0;
  for (let Y = Math.floor(T); Y < Math.ceil(T + Ht); Y++) for (let X = Math.floor(L); X < Math.ceil(L + Wd); X++) {
    if (X < 0 || Y < 0 || X >= s.w || Y >= s.h) continue;
    const us = under(X + .5 - L, qx).map(u => mirror ? side - 1 - u : u), vs = under(Y + .5 - T, qy);
    const inside = us.every(u => vs.every(v => { const x = u + at.dx, y = v + at.dy; return x > a.box.x0 && y > a.box.y0 && x < a.box.x1 - 1 && y < a.box.y1 - 1; }));
    if (!inside) continue;
    let best = Infinity;
    for (const u of us) for (const v of vs) best = Math.min(best, diff(a.d, ((v + at.dy) * a.side + u + at.dx) * 4, s.d, (Y * s.w + X) * 4));
    n++; if (best === 0) exact++; worst = Math.max(worst, best);
  }
  return { n, exact: n ? +(exact / n).toFixed(4) : 0, worst };
};
