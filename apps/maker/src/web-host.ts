/* The web host: joins the simulation to a page. Everything it needs from the browser comes
   through `env`, so tests can run it with a fake one. */
import { createSim, type Pace } from '@buddies/engine';
import { createTerrain, type Rectangle } from '@buddies/terrain';
import { createView } from '@buddies/view';

export interface PageEnv {
  random(): number;
  now(): number;
  after(ms: number, f: () => void): number;
  cancel(id: number): void;
  frame(f: (now: number) => void): void;
  listen(type: string, f: (e: never) => void, o?: AddEventListenerOptions): void;
}
export interface WorldOptions {
  root: HTMLElement;
  bounds(): { w: number; h: number };
  onMenu?: (id: string, x: number, y: number) => void;
  pace?: Pace;
  env?: PageEnv;
}

const browser = (): PageEnv => ({
  random: () => Math.random(), now: () => performance.now(),
  after: (ms, f) => setTimeout(f, ms) as unknown as number, cancel: id => clearTimeout(id),
  frame: f => { requestAnimationFrame(f); },
  listen: (type, f, o) => addEventListener(type, f as EventListener, o)
});

const PAGE = { x: 0, y: 0, scale: 1 };

export function createWorld(opt: WorldOptions) {
  const root = opt.root, env = opt.env || browser();
  const page = (): Rectangle[] => { const b = opt.bounds(); return [{ id: 'page', kind: 'screen', rect: { x: 0, y: 0, w: b.w, h: b.h }, z: 0, terrain: true, scale: 1 }]; };
  const sim = createSim({ terrain: createTerrain(page()), pace: opt.pace, random: env.random, now: env.now, after: env.after, cancel: env.cancel });
  const view = createView({ root, input: sim.input, viewport: PAGE, onMenu: opt.onMenu });
  const world = Object.assign(sim.world, { root, onMenu: opt.onMenu || null });

  env.listen('resize', () => sim.setRects(page()));
  env.listen('pointermove', (e: PointerEvent) => {
    const r = root.getBoundingClientRect();
    sim.input.pointer(e.clientX - r.left, e.clientY - r.top);
  }, { passive: true });

  function frame(now: number) {
    sim.advance(now);
    view.apply(sim.frame(PAGE));
    env.frame(frame);
  }
  env.frame(frame);

  return {
    world, sync: sim.sync, act: sim.act, actAll: sim.actAll,
    /* debugging: advance n frames by hand, inspect buddies */
    step: sim.step, pets: sim.pets,
    pause(v = true) { world.paused = v; },
    poof: sim.poof
  };
}
export type World = ReturnType<typeof createWorld>;
