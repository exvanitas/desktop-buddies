/* The Maker, put together. A view reads `state`, `selected`, `current()` and `openPose`, calls the
   changes, and redraws what `subscribe` tells it to. Call `start()` once the view is listening. */
import type { MakerDeps } from './deps';
import { createImports } from './imports';
import { createKit } from './kit';
import { createPoses } from './poses';
import { createRoster } from './roster';
import { createSession } from './session';

export function createMaker(deps: MakerDeps) {
  const s = createSession(deps), roster = createRoster(s, deps);
  return {
    get state() { return s.state; },
    get selected() { return s.selected; },
    get openPose() { return s.openPose; },
    current: s.current, subscribe: s.subscribe, start: s.start,
    adopt: s.adopt, deselect: s.deselect,
    /* Hands the store what's waiting on the pause, now. */
    saveNow: () => s.save(true),
    thumb: deps.samples.thumb,
    ...roster, ...createPoses(s, deps), ...createKit(s, deps), ...createImports(s, deps, roster)
  };
}
export type Maker = ReturnType<typeof createMaker>;
