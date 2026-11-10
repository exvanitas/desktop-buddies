/* Everything behaviours can reach, in one place: cues, conditions and motions take this. */
import type { Signature } from '@buddies/buddy-file';
import type { Terrain } from '@buddies/terrain';
import type { Body } from './body';
import type { Look } from './look';
import type { Pace } from './pace';
import type { Actor as RunnerActor, Arg } from './runner';
import type { PetState } from './state';
import type { Tools } from './tools';
import type { Voice } from './voice';
import type { WorldState } from './world';

export interface Actor extends RunnerActor, Tools, Omit<Body, 'moves' | 'place'>, Pick<Look, 'fx' | 'fxSize' | 'head' | 'geo'>, Pick<Voice, 'say' | 'line'> {
  P: PetState; world: WorldState; pace: Pace; terrain: Terrain;
  size(): number;
  signature(): Signature | undefined;
  /* the hold on her gives way, after a clip of it */
  struggle(): void;
  emit(event: string, arg?: Arg): void;
  dragHistory(): { x: number; y: number; t: number }[] | null;
}
