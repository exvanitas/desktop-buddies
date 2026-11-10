/* A simulation driven by hand: seeded random, a manual clock, timers that fire when the clock
   passes them. */
import { createTerrain, type Rectangle, type TerrainOptions } from '@buddies/terrain';
import { createSim, type BuddyData, type Pace } from '../src/index';
import { screen, windowRect } from '../../terrain/tests/fixtures';

export { DESK, screen, windowRect } from '../../terrain/tests/fixtures';

export function mulberry32(a: number) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export const BUDDY = (id = 'a', o?: Partial<BuddyData>): BuddyData => Object.assign({ id, name: 'Olive', size: 120, faces: 'right' as const, poses: {}, base: { src: 'data:image/png;base64,AAAA', bb: { x0: .2, y0: 0, x1: .8, y1: 1 } } }, o);

/* A desktop as people leave it: `n` overlapping windows of everyday sizes, stacked in a random order. */
export function messy(seed: number, w = 1920, h = 1040, n = 12): Rectangle[] {
  const draw = mulberry32(seed), between = (a: number, b: number) => a + Math.floor(draw() * (b - a));
  const kinds = [[900, 1500, 600, 950], [500, 900, 350, 700], [260, 500, 160, 420]] as const;
  return [screen('s', 0, 0, w, h), ...Array.from({ length: n }, (_, i) => {
    const [a, b, c, d] = kinds[between(0, 3)]!, ww = Math.min(between(a, b), w), hh = Math.min(between(c, d), h);
    return windowRect('w' + i, between(0, w - ww), between(0, h - hh), ww, hh, i + 1);
  })];
}

/* One thing a person does to their windows: a nudge, a drag, closing one, opening one, or raising
   one over the others. */
export function churn(rects: Rectangle[], draw: () => number): Rectangle[] {
  const wins = rects.filter(r => r.kind === 'window'), one = wins[Math.floor(draw() * wins.length)], top = Math.max(0, ...rects.map(r => r.z)) + 1, act = draw();
  const change = (f: (r: Rectangle) => Rectangle) => rects.map(r => r === one ? f(r) : r);
  const by = (r: Rectangle, x: number, y: number) => ({ ...r, rect: { ...r.rect, x: r.rect.x + x, y: r.rect.y + y } });
  if (!one || act < .1) return [...rects, windowRect('n' + top, draw() * 1200, draw() * 600, 200 + draw() * 600, 150 + draw() * 400, top, { terrain: draw() < .85 })];
  if (act < .5) return change(r => by(r, (draw() - .5) * 12, (draw() - .5) * 12));
  if (act < .7) return change(r => by(r, (draw() - .5) * 700, (draw() - .5) * 500));
  if (act < .85) return rects.filter(r => r !== one);
  return change(r => ({ ...r, z: top }));
}

interface WorldOptions { seed?: number; random?: () => number; pace?: Pace; terrain?: TerrainOptions }

export function world(rects: Rectangle[], o: WorldOptions = {}) {
  const now = { t: 1000 }, timers: { id: number; at: number; f: () => void }[] = [];
  let seq = 0, pets: BuddyData[] = [];
  const terrain = createTerrain(rects, o.terrain);
  const sim = createSim({
    terrain, pace: o.pace, random: o.random || mulberry32(o.seed || 1), now: () => now.t,
    after: (ms, f) => { timers.push({ id: ++seq, at: now.t + ms, f }); return seq; },
    cancel: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); }
  });
  const frame = () => {
    now.t += 16.667;
    for (const t of timers.filter(u => u.at <= now.t)) { timers.splice(timers.indexOf(t), 1); t.f(); }
    sim.advance(now.t);
  };
  const run = (n: number) => { for (let i = 0; i < n; i++) frame(); };
  const until = (test: () => unknown, max = 60000) => { for (let i = 0; i < max; i++) { if (test()) return true; frame(); } return false; };
  return { sim, terrain, run, frame, until, now, add(d = BUDDY()) { sim.sync({ pets: (pets = pets.concat([d])) }); return sim.pets.get(d.id)!; } };
}
export type TestWorld = ReturnType<typeof world>;
