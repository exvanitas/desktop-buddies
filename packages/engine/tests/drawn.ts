/* Where she's drawn, worked out from the frame a view gets: the same transform strings the DOM
   applies, turned into a box in world px and the angle her art is turned by. */
import type { PetFrame } from '../src/index';

export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface Drawn extends Box { rot: number; flip: boolean }
type M = [number, number, number, number, number, number];
const I: M = [1, 0, 0, 1, 0, 0];
const mul = (p: M, q: M): M => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
function parse(tf: string): M {
  let m = I;
  for (const [, fn, args] of tf.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = args!.split(',').map(s => parseFloat(s));
    let q = I;
    if (fn === 'rotate') { const a = v[0]! * Math.PI / 180; q = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]; }
    else if (fn === 'translate') q = [1, 0, 0, 1, v[0]!, v[1] ?? 0];
    else if (fn === 'translateY') q = [1, 0, 0, 1, 0, v[0]!];
    else if (fn === 'scale') q = [v[0]!, 0, 0, v[1] ?? v[0]!, 0, 0];
    m = mul(m, q);
  }
  return m;
}

/* The part of her image `bb` covers (in shares of the image, the whole image by default), as drawn,
   and how far it's turned. A mirrored drawing's angle is read as the mirror's, so a turn round reads 0. */
export function drawn(f: PetFrame, bb: Box = { x0: 0, y0: 0, x1: 1, y1: 1 }): Drawn {
  const S = f.box.size, [ox, oy] = f.origin!.split(' ').map(s => parseFloat(s)) as [number, number];
  const m = mul([1, 0, 0, 1, f.box.l + ox, f.box.t + oy], mul(parse(f.body!), [1, 0, 0, 1, -ox, -oy]));
  const pts = [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x0, bb.y1], [bb.x1, bb.y1]].map(([u, v]) => [m[0] * u! * S + m[2] * v! * S + m[4], m[1] * u! * S + m[3] * v! * S + m[5]] as const);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const flip = m[0] * m[3] - m[1] * m[2] < 0, rot = (flip ? Math.atan2(-m[1], -m[0]) : Math.atan2(m[1], m[0])) * 180 / Math.PI;
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), rot, flip };
}

/* How far one drawing is from the next: the edge that moved most, in px, and the turn, in degrees. */
export function step(a: Drawn, b: Drawn) {
  return { px: Math.max(Math.abs(b.x0 - a.x0), Math.abs(b.x1 - a.x1), Math.abs(b.y0 - a.y0), Math.abs(b.y1 - a.y1)), deg: Math.abs(((b.rot - a.rot + 540) % 360) - 180) };
}

/* The largest single-tick step over a run of drawings. */
export function worst(seq: Drawn[]) {
  let px = 0, deg = 0;
  for (let i = 1; i < seq.length; i++) { const s = step(seq[i - 1]!, seq[i]!); px = Math.max(px, s.px); deg = Math.max(deg, s.deg); }
  return { px, deg };
}

/* The turn from one drawing to the next past a turn round. Turning round mirrors her drawing, which
   mirrors its angle too, so that much is the turn round itself and not counted. */
export function turnPastMirror(a: Drawn, b: Drawn) {
  const from = a.flip !== b.flip ? -a.rot : a.rot;
  return Math.abs(((b.rot - from + 540) % 360) - 180);
}
