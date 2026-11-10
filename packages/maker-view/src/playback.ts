/* How a pose plays in the tray, the way the engine plays it. A play-once pose runs through once and
   holds its last frame. A two-frame swing isn't a walk: frame 1 is gentle and frame 2 strong, picked by
   how hard she's swung, so it shows one and then the other. Everything else loops. */
import type { PoseKey } from '@buddies/buddy-file';
import { ONCE } from './facts';

export type Motion = 'still' | 'loop' | 'once' | 'swing';
export const motionOf = (k: PoseKey, frames: number): Motion =>
  frames < 2 ? 'still' : (k === 'dragL' || k === 'dragR') && frames === 2 ? 'swing' : ONCE.has(k) ? 'once' : 'loop';

/* How long each swing shows when played. */
export const SWING_MS = 700;

export interface PlayerIO { every(ms: number, f: () => void): () => void }

/* Shows frames through `show`. It only ever runs one thing at a time. */
export function createPlayer(io: PlayerIO, show: (i: number) => void, changed: () => void = () => {}) {
  let stop = () => {}, running = false;
  const end = () => { stop(); stop = () => {}; if (running) { running = false; changed(); } };
  const run = (ms: number, step: () => boolean) => {
    stop(); running = true;
    stop = io.every(ms, () => { if (!step()) end(); });
    changed();
  };
  return {
    get running() { return running; },
    stop: end,
    /* Starts over from the first frame. */
    play(motion: Motion, count: number, fps: number) {
      end(); show(0);
      if (motion === 'still') return;
      let i = 0;
      if (motion === 'loop') run(1000 / fps, () => { i = (i + 1) % count; show(i); return true; });
      else if (motion === 'once') run(1000 / fps, () => { show(++i); return i < count - 1; });
      else run(SWING_MS, () => { i++; show(i % 2); return i < 2; });
    }
  };
}
