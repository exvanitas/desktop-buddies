/* The world: buddies, particles and pair meetings, with no page attached. Input goes in through
 `input`, and `frame(viewport)` gives back what a view should show. */
import type { Rectangle, Terrain } from '@buddies/terrain';
import { assertBook } from './check';
import { lively, type Pace } from './pace';
import { createPet, type Pet } from './create-pet';
import type { Frame, Input, Particle, ParticleFrame, ParticleKind, ParticleOptions, SyncState, Viewport, WorldState } from './world';

export interface SimOptions {
  terrain: Terrain; pace?: Pace; random: () => number; now: () => number;
  after: (ms: number, f: () => void) => number; cancel: (id: number) => void;
}
export type Sim = ReturnType<typeof createSim>;

export function createSim(opt: SimOptions) {
  assertBook();
  const random = opt.random, pace = opt.pace || lively;
  const between = (a: number, b: number) => a + random() * (b - a);
  const pick = <V>(a: readonly V[]) => a[random() * a.length | 0]!;
  const terrain = opt.terrain;
  let fxId = 0;
  const world: WorldState = {
    terrain, bubbles: true, names: true, chatter: 'normal', mouse: { x: -1e4, y: -1e4, still: 0 }, fx: [], random, now: opt.now, after: opt.after, cancel: opt.cancel, pace, tick: 0, planned: -1,
    /* particles */
    spawn(kind: ParticleKind, x: number, y: number, o?: ParticleOptions) {
      const size = (o && o.size) || 20;
      const tint = kind === 'heart' ? pick(['#ff6f9a', '#ff8fb1', '#ff5c8a', '#ffa3c0']) : kind === 'star' ? pick(['#ffd34d', '#ffe27a', '#ffc130']) : null;
      world.fx.push(Object.assign({ id: ++fxId, kind, tint, size, x, y, vx: 0, vy: 0, g: 0, life: 0, max: 60, rot: 0, vr: 0, sway: 0, ph: random() * 6, k: 1, drawn: false, opacity: 1, sc: 1 }, o || {}, { size }));
    }
  };
  const pets = new Map<string, Pet>();
  const pairCool = new Map<string, number>();
  let last = opt.now();

  function fxStep(dt: number) {
    for (let i = world.fx.length - 1; i >= 0; i--) {
      const p = world.fx[i]!; p.life += dt;
      if (p.until && !p.until()) p.life = Math.max(p.life, p.max - 10);
      if (p.follow) { const q = p.follow(p); p.x = q.x; p.y = q.y; }
      else { p.vy += p.g * p.k * dt; p.x += (p.vx * dt + Math.sin(p.life * .12 + p.ph) * p.sway) * p.k; p.y += p.vy * dt * p.k; }
      p.rot += p.vr * dt;
      if (p.orient) p.rot = Math.atan2(p.vy, p.vx) * 180 / Math.PI - 90; /* point trails the motion */
      const k = p.life / p.max;
      if (p.floor != null && p.y > p.floor && p.rest) { /* land and sit there, then fade */
        p.y = p.floor; p.vx = p.vy = p.g = p.vr = 0; p.life = Math.max(p.life, p.max - p.rest); p.floor = null;
      }
      if (k >= 1 || (p.floor != null && p.y > p.floor)) { world.fx.splice(i, 1); continue; }
      p.sc = p.grow ? Math.min(1, .15 + p.life / p.grow) : p.pop ? Math.min(1, p.life / 8) : 1;
      p.opacity = k > .7 ? (1 - k) / .3 : 1;
      p.drawn = true;
    }
  }
  const fxFrame = (p: Particle, vp: Viewport): ParticleFrame => ({
    id: p.id, kind: p.kind, tint: p.tint, color: p.color, text: p.text, size: p.size, h: p.h,
    opacity: p.drawn ? p.opacity : null,
    tf: p.drawn ? `translate(${(p.x - vp.x) / vp.scale}px,${(p.y - vp.y) / vp.scale}px) translate(-50%,-50%) rotate(${p.rot}deg) scale(${p.sc})` : null
  });

  function pairs() {
    const arr = [...pets.values()];
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i]!, b = arr[j]!;
      const fa = a.here(), fb = b.here();
      if (!fa || !fb || fa.kind !== 'floor' || fa.id !== fb.id || !a.calm() || !b.calm()) continue;
      const key = a.id < b.id ? a.id + b.id : b.id + a.id;
      if ((pairCool.get(key) || 0) > 0) continue;
      if (Math.abs(a.P.x - b.P.x) > (a.bw() + b.bw()) * .45) continue;
      pairCool.set(key, between(pace.pairCool[0], pace.pairCool[1]));
      a.faceTo(b.P.x); b.faceTo(a.P.x);
      const r = random();
      if (r < .45) {
        a.go('wave'); a.say(a.line('greet'));
        /* By then she may be in someone's hand, in the air or on a wall. */
        opt.after(pace.pairGreetMs, () => { if (b.here()?.kind === 'floor') { b.go('wave'); b.say(b.line('greet')); } });
      }
      else if (r < .75) { a.go('love', { line: a.line('hug') }); b.go('love', { line: '' }); }
      else { a.say(a.line('bump')); b.say(b.line('bumped')); a.go('walk', { dir: a.P.x < b.P.x ? -1 : 1 }); b.go('walk', { dir: b.P.x < a.P.x ? -1 : 1 }); }
    }
    pairCool.forEach((v, k) => pairCool.set(k, v - 1));
  }

  function step(dt: number) { world.tick++; pets.forEach(p => p.tick(dt)); pairs(); fxStep(dt); }
  const pet = (id: string, f: (p: Pet) => void) => { const p = pets.get(id); if (p) f(p); };

  return {
    world, pets,
    /* The rectangles changed. Buddies on a screen stay with it; windows carry theirs at the next tick. */
    setRects(rects: Rectangle[]) { terrain.set(rects); pets.forEach(p => p.fit()); },
    /* one display frame */
    advance(t: number) {
      /* A first animation frame can be stamped before the world was made. */
      const dt = Math.max(0, Math.min(3, (t - last) / 16.667)); last = t;
      if (world.paused) return;
      world.mouse.still += dt;
      step(dt);
    },
    step(n = 1) { for (let i = 0; i < n; i++) step(1); },
    sync(state: SyncState) {
      world.bubbles = state.bubbles !== false; world.names = state.names !== false; world.chatter = state.chatter || 'normal';
      const ids = new Set(state.pets.map(p => p.id));
      pets.forEach((p, id) => { if (!ids.has(id)) pets.delete(id); });
      state.pets.forEach(d => { if (pets.has(d.id)) pets.get(d.id)!.update(d); else pets.set(d.id, createPet(world, d)); });
    },
    /* One buddy by her id, whatever it is. Everyone is its own call, so no id can mean everyone. */
    act(id: string, a: string) { pets.get(id)?.act(a); },
    actAll(a: string) { pets.forEach(p => p.act(a)); },
    /* A line in her bubble, marked as from the app that asked. */
    say(id: string, text: string, from: string) { pets.get(id)?.say(text, from); },
    /* to the screen under a point, dropping in near its top at its x */
    bring(id: string, at: { x: number; y: number }) { pets.get(id)?.bring(at); },
    /* a burst of stars where a buddy is (used when it's dismissed) */
    poof(id: string) {
      const p = pets.get(id); if (!p) return; const c = p.center();
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; world.spawn('star', c.x, c.y, { vx: Math.cos(a) * 3.2, vy: Math.sin(a) * 3.2 - 1, size: Math.max(12, c.s * .14), max: 38, vr: 6, pop: true, k: c.k }); }
    },
    input: {
      pointer(x: number, y: number) { world.mouse.x = x; world.mouse.y = y; world.mouse.still = 0; },
      down: (id: string, x: number, y: number) => pet(id, p => p.pressed(x, y)),
      move: (id: string, x: number, y: number) => pet(id, p => p.moved(x, y)),
      up: (id: string) => pet(id, p => p.released()),
      enter: (id: string) => pet(id, p => p.entered()),
      leave: (id: string) => pet(id, p => p.left())
    } as Input,
    frame(vp: Viewport): Frame {
      const shown = (p: Particle) => vp.w === undefined || ((p.x - vp.x) / vp.scale > -200 && (p.x - vp.x) / vp.scale < vp.w + 200 && (p.y - vp.y) / vp.scale > -200 && (p.y - vp.y) / vp.scale < vp.h! + 200);
      return { pets: [...pets.values()].map(p => p.frame(vp)), fx: world.fx.filter(shown).map(p => fxFrame(p, vp)) };
    }
  };
}
