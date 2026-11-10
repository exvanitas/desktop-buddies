/* What a buddy sees of the world, and what the world hands a view. No page in any of it. */
import type { Buddy } from '@buddies/buddy-file';
import type { Terrain } from '@buddies/terrain';
import type { Pace } from './pace';

/* Where a page's corner sits in world units, and world units per CSS pixel. With a size, in CSS
   pixels, a frame only shows what reaches it. */
export interface Viewport { x: number; y: number; scale: number; w?: number; h?: number }

/* a buddy as the world knows it: what a file holds, plus an id for this run */
export type BuddyData = Buddy & { id: string };

export interface SyncState { pets: BuddyData[]; bubbles?: boolean; names?: boolean; chatter?: Chatter }
export type Chatter = 'off' | 'low' | 'normal' | 'high';

export type ParticleKind = 'heart' | 'star' | 'anger' | 'tear' | 'text' | 'puddle' | 'crumb';
export interface ParticleOptions {
  size?: number; h?: number; vx?: number; vy?: number; g?: number; max?: number; vr?: number; sway?: number;
  pop?: boolean; grow?: number; orient?: boolean; floor?: number | null; rest?: number; color?: string; text?: string; k?: number; ang?: number;
  /* where a follower is, each frame */
  follow?: (p: Particle) => { x: number; y: number };
  /* it fades out once this says no */
  until?: () => boolean;
}
export interface Particle extends ParticleOptions {
  id: number; kind: ParticleKind; tint: string | null; size: number; x: number; y: number;
  vx: number; vy: number; g: number; life: number; max: number; rot: number; vr: number; sway: number; ph: number; k: number;
  drawn: boolean; opacity: number; sc: number;
}

export interface WorldState {
  terrain: Terrain; bubbles: boolean; names: boolean; chatter: Chatter;
  mouse: { x: number; y: number; still: number }; fx: Particle[];
  random: () => number; now: () => number; after: (ms: number, f: () => void) => number; cancel: (id: number) => void;
  pace: Pace; paused?: boolean;
  /* ticks so far, and the last one a buddy planned a jump on: one plan a tick, across the whole sim */
  tick: number; planned: number;
  spawn(kind: ParticleKind, x: number, y: number, o?: ParticleOptions): void;
}

/* `from`: the app that asked for the line, only there when one did */
/* `tf` is the engine's place for the bubble. `at` is what a view needs to move it once it knows its real
   size, in the viewport's CSS pixels: the engine's middle, where its bottom goes above her and its top
   goes below her, and her middle, `her` across for the tail and `mid` down, for which viewport has her. */
export interface BubbleFrame { text: string; from?: string; hidden: boolean; pop: number; below: boolean; tf: string | null; at: { x: number; up: number; down: number; her: number; mid: number } | null }
export interface TagFrame { text: string; hidden: boolean; tf: string | null }
export interface PetFrame {
  id: string; size: string | null; src?: string | null; origin: string | null; body: string | null; grab: boolean; off: boolean;
  box: { l: number; t: number; size: number; ox: number; oy: number }; tf: string | null; bubble: BubbleFrame; tag: TagFrame;
}
export interface ParticleFrame {
  id: number; kind: ParticleKind; tint: string | null; color?: string; text?: string; size: number; h?: number; opacity: number | null; tf: string | null;
}
export interface Frame { pets: PetFrame[]; fx: ParticleFrame[] }

/* pointer events, in world units */
export interface Input {
  pointer(x: number, y: number): void;
  down(id: string, x: number, y: number): void;
  move(id: string, x: number, y: number): void;
  up(id: string): void;
  enter(id: string): void;
  leave(id: string): void;
}
