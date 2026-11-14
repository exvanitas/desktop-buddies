/* Paper that measures instead of drawing: the box the ink of each picture covers, taken through the
   pen's own turns, flips and moves, so tests can see where a picture's art is without a canvas. Curves
   are measured at points along them, and a stroke counts half its width either side. */
import type { ArtTools } from '../src';
import type { Paper, Pen } from '../src';
import { REF, png } from './harness';

export interface Box { x0: number; y0: number; x1: number; y1: number }
type M = [number, number, number, number, number, number];
const mul = (p: M, q: M): M => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
const STEPS = 48;

export function measuringPaper() {
  /* each picture's box in paper px, by its data URL, and the side of the paper it was drawn on */
  const boxes = new Map<string, Box>(), sides = new Map<string, number>();
  let n = 0;
  const paper: Paper = side => {
    let m: M = [1, 0, 0, 1, 0, 0], path: [number, number][] = [], at: [number, number] = [0, 0];
    const stack: { m: M; w: number }[] = [], box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const add = (x: number, y: number) => { path.push([m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]); at = [x, y]; };
    const ink = (pad: number) => { for (const [x, y] of path) { box.x0 = Math.min(box.x0, x - pad); box.y0 = Math.min(box.y0, y - pad); box.x1 = Math.max(box.x1, x + pad); box.y1 = Math.max(box.y1, y + pad); } };
    const sweep = (from: number, to: number, f: (a: number) => [number, number]) => { if (to < from) to += Math.PI * 2; for (let i = 0; i <= STEPS; i++) add(...f(from + (to - from) * i / STEPS)); };
    const pen: Pen = {
      lineJoin: '', lineCap: '', strokeStyle: '', fillStyle: '', lineWidth: 1, globalAlpha: 1,
      save() { stack.push({ m, w: pen.lineWidth }); },
      restore() { const s = stack.pop(); if (s) { m = s.m; pen.lineWidth = s.w; } },
      beginPath() { path = []; }, closePath() {},
      fill() { ink(0); }, stroke() { ink(pen.lineWidth / 2); },
      moveTo: add, lineTo: add,
      arc(cx, cy, r, from, to) { sweep(from, to, a => [cx + Math.cos(a) * r, cy + Math.sin(a) * r]); },
      ellipse(cx, cy, rx, ry, rot, from, to) { const c = Math.cos(rot), s = Math.sin(rot); sweep(from, to, a => { const x = Math.cos(a) * rx, y = Math.sin(a) * ry; return [cx + x * c - y * s, cy + x * s + y * c]; }); },
      quadraticCurveTo(cx, cy, x, y) { const [x0, y0] = at; for (let i = 1; i <= 8; i++) { const t = i / 8, u = 1 - t; add(u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y); } },
      translate(x, y) { m = mul(m, [1, 0, 0, 1, x, y]); },
      rotate(a) { m = mul(m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); },
      scale(x, y) { m = mul(m, [x, 0, 0, y, 0, 0]); }
    };
    return { pen, png: () => { const src = png('picture ' + ++n); boxes.set(src, { ...box }); sides.set(src, side); return src; } };
  };
  /* A picture's art as shares of its paper, the way the art pipeline gives a frame's box. */
  const share = (src: string): Box => { const b = boxes.get(src)!, s = sides.get(src)!; return { x0: b.x0 / s, y0: b.y0 / s, x1: b.x1 / s, y1: b.y1 / s }; };
  /* Art tools that cut nothing: each frame keeps its paper, so its box is where it was drawn. */
  const art: Pick<ArtTools, 'processBase' | 'processFrames'> = {
    processBase: async src => ({ frame: { src, bb: share(src) }, ref: REF, photo: false }),
    processFrames: async srcs => ({ frames: srcs.map(src => ({ src, bb: share(src) })), scale: 1 })
  };
  return { paper, art, boxes, share };
}
