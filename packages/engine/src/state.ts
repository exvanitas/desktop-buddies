/* What a buddy is right now: the numbers every part of it shares. */
import type { Aim, Spot } from './aim';
import type { Ease } from './ease';
import type { BuddyData } from './world';
import type { Surface } from '@buddies/terrain';
import type { Arg, Playing } from './runner';
import type { Tools } from './tools';

export const GRAV = 0.6;
/* a wall can be grabbed below this speed, in px per frame */
export const GRAB_SPEED = 34;

interface Footing { surface: Surface; t: number }
export interface PetState extends Playing {
  x: number; y: number; on: Footing | null; k: number; home: string; pierce: boolean; bound: { id: string; up: boolean } | null;
  /* what a jump in the air was meant for, and where a walk to a jump is headed */
  aim: Aim | null; spot: Spot | null;
  vx: number; vy: number; dir: number; arg: Arg | null;
  /* `thrown` only picks the Thrown pose. `catches` is what lets her grab a wall or the ceiling she
     flies into: a throw sets both, a ceiling leap only `catches`. */
  thrown: boolean; hard: boolean; sp: number; chatT: number; awake: number;
  catches: boolean;
  /* `rollBy`: the latest a roll may run to, set as it starts so walls can't keep it going */
  swing: number; swv: number; hx: number; hy: number; roll: number; rollBy: number; cool: number; shyDone: boolean; hover: boolean; lastSay: number;
  crumbT: number; clicks: number[]; impact: number; still: number;
  /* the hand holding her shook her hard since the last tick */
  shaken: boolean;
  /* a move the body or hands made at once, for the look to draw over a few ticks at its next drawing */
  ease: Ease | null;
  /* How many times she's been put somewhere rather than moved there: called or brought, found lost, dropped
     in from the top, moved by a refit, let go. Nothing drawn carries across one: an animation's hand-on, or
     an overlay's drawing between frames. Leaving a wall or the ceiling isn't one: it's drawn as a move. */
  placed: number;
  readonly surf: 'air' | 'floor' | 'ceil' | 'left' | 'right';
}

/* who it is, which can change under it while it runs */
export interface Character { data: BuddyData; size: number; natural: number }

export function createState({ between }: Tools): PetState {
  const P: PetState = {
    x: 0, y: 0, on: null, k: 1, home: '', pierce: false, bound: null, aim: null, spot: null, vx: 0, vy: 0, dir: 1, state: 'air', t: 0, dur: 0, arg: null,
    thrown: false, catches: false, hard: false, sp: between(.9, 1.12), chatT: between(300, 900), awake: 0,
    swing: 0, swv: 0, hx: 0, hy: 0, roll: 0, rollBy: NaN, next: null, cool: 0, shyDone: false, hover: false, lastSay: 0, crumbT: 0, clicks: [], impact: 0, still: 0, shaken: false, ease: null, placed: 0, clip: null,
    /* the pose family a surface asks for: left and right mean which way it faces, not which side of a screen it is */
    get surf() { const s = P.on && P.on.surface; return !s ? 'air' : s.kind !== 'wall' ? s.kind : s.normal.x > 0 ? 'left' : 'right'; }
  };
  return P;
}
