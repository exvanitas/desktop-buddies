/* How a behaviour moves the art when it has no frames of its own, or a little when it does. */
import type { PetState } from './state';

export interface Anim { dx: number; dy: number; rot: number; sx: number; sy: number; pivot: number }
export type AnimFn = (A: Anim, P: PetState, exact: boolean, ch: number, cw: number) => void;

const DEG = Math.PI / 180;
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const lift = (A: Anim, P: PetState, ch: number, k: number) => { A.dy -= Math.abs(Math.sin(P.t * k)) * ch; };

export const ANIMS: Record<string, AnimFn> = {
  breathe(A, P, ex) { if (!ex) { A.sy = 1 + Math.sin(P.t * .07) * .018; A.sx = 2 - A.sy; } },
  settle(A, _, ex) { if (!ex) { A.sy = .9; A.sx = 1.07; } },
  ponder(A, P, ex) { if (!ex) A.rot = Math.sin(P.t * .035) * 6; },
  doze(A, P, ex) { if (!ex) { A.sy = .86 + Math.sin(P.t * .045) * .025; A.sx = 1.1; } },
  bounce(A, P, ex, ch) { lift(A, P, ch * (ex ? .05 : .12), .17); if (!ex) { const k = Math.abs(Math.cos(P.t * .17)); A.sy = 1 - k * .06 * (1 - Math.abs(Math.sin(P.t * .17))); } },
  sob(A, P, ex) { if (!ex) { A.dx = Math.sin(P.t * 1.1) * 1.6; A.sy = .95 + Math.sin(P.t * .3) * .02; } },
  fume(A, P, ex) { A.dx = Math.sin(P.t * 1.4) * (ex ? 1 : 2.5); if (!ex) { A.sy = 1 + Math.sin(P.t * .5) * .04; } },
  fidget(A, P, ex) { if (!ex) { A.sy = .94; A.sx = 1.03; A.rot = Math.sin(P.t * .05) * 4 - 3 * P.dir; } },
  chew(A, P, ex) { if (!ex) A.sy = 1 + Math.sin(P.t * .45) * .045; },
  groove(A, P, ex, ch) { A.rot = Math.sin(P.t * .15) * (ex ? 5 : 14); if (!ex) lift(A, P, ch * .07, .3); },
  croon(A, P, ex) { if (!ex) A.rot = Math.sin(P.t * .06) * 7; },
  greet(A, P, ex, ch) { if (!ex && P.t < 60) { A.rot = Math.sin(P.t * .35) * 9; lift(A, P, ch * .03, .35); } },
  /* a full turn over her time, and no further while her art finishes its pass */
  whirl(A, P, _, ch) { A.pivot = ch / 2; A.rot = Math.min(1, P.t / P.dur) * 360 * P.dir; },
  faceplant(A, P, ex, _, cw) { if (!ex) { A.dy = -cw / 2; A.rot = 90 * P.dir; } },
  wobble(A, P, ex) { A.rot = Math.sin(P.t * .14) * (ex ? 4 : 12); },
  stroll(A, P, ex, ch) { if (!ex) { lift(A, P, ch * .045, .22); A.rot = Math.sin(P.t * .22) * 4; } },
  sprint(A, P, ex, ch) { if (!ex) { lift(A, P, ch * .07, .4); A.rot = 6 * P.dir + Math.sin(P.t * .4) * 4; } },
  dash(A, P, ex, ch) { if (!ex) { lift(A, P, ch * .06, .35); A.rot = 5 * P.dir; } },
  lean(A, P, ex, ch) { if (!ex) { lift(A, P, ch * .07, .4); A.rot = 6 * P.dir; } },
  /* Roll art already turns, so only Stand is turned */
  tumble(A, P, ex, ch) { if (!ex) { A.pivot = ch / 2; A.rot = P.roll / (ch / 2) / DEG; } },
  scrabble(A, P, ex) { if (!ex) A.rot = Math.sin(P.t * .25) * 5; },
  dangle(A, P, ex) { if (!ex) A.rot = Math.sin(P.t * .05) * 6; },
  flight(A, P, ex) { if (!ex) { A.sy = 1 + clamp(Math.abs(P.vy) * .006, 0, .08); A.sx = 2 - A.sy; } A.rot = clamp(P.vx * 1.6, -25, 25); },
  squash(A, P, ex) { if (!ex) { const k = 1 - P.t / P.dur; A.sy = 1 - .22 * k; A.sx = 1 + .16 * k; } },
  swing(A, P, ex) { A.rot = P.swing * (ex ? .25 : 1); }
};
