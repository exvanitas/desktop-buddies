/* The edge shots' hold on the real world: puts a buddy in a pose at a place on the real terrain,
   holds the world still, and says where the overlay draws her. Probe only: world-probe.ts wraps the
   real host with it, and edge-shots.ps1 puts that in place of world.js in its own copy of the app.
   The shipped app never has it. */
import { POSE, type ContentBox, type Frame, type PoseKey } from '@buddies/buddy-file';
import { BOOK, type BuddyData, type Sim } from '@buddies/engine';
import type { Bounds, Surface } from '@buddies/terrain';
import { viewport, type Area, type Message } from '../src/host';

/* Dangle legs has no behaviour yet. This one shows it as sit is shown, by the floor rule. */
export const DANGLE = 'probe_dangle';
export function addDangle() {
  if (!BOOK.behaviours[DANGLE]) BOOK.behaviours[DANGLE] = { on: ['floor'], main: { pose: 'dangle_legs', hold: 'sit', anim: 'settle' }, then: 'idle' };
}

/* Where to put her: a rectangle's surface of one kind, `side` -1 or 1 for a wall's normal, `f` how far along. */
export interface At { owner: string; kind: Surface['kind']; side?: -1 | 1; f?: number }
export type Op =
| { op: 'scene' }
/* `finish` ends the behaviour's hold as time would, into whatever comes after it. `frame` is then
   the frame of what shows. */
| { op: 'pose'; id: string; at: At; state: string; frame: number; dir: 1 | -1; finish?: boolean }
| { op: 'release' };
export type Ask = { k: 'probe'; n: number } & Op;

interface Box { x0: number; y0: number; x1: number; y1: number }
/* how far either side of the surface line a crop reaches, past her if she's past it, and beyond her along it */
const BAND = 72, PAST = 16, ALONG = 24;
/* A tick of no time reads as a slip off a window, so she's drawn with a tick of next to none. */
const STILL = 1e-6;

/* A pose through its fallbacks, as the look finds it. */
export function resolve(data: BuddyData, key: string) {
  for (let k: string | null = key; k && k[0] !== '@'; k = POSE[k as PoseKey]?.fb ?? null) {
    const p = data.poses[k as PoseKey];
    if (p && p.frames.length) return { key: k, frames: p.frames, fps: p.fps || 6 };
  }
  return { key: 'base', frames: [data.base], fps: 1 };
}
const union = (frames: Frame[]): ContentBox => frames.reduce((a, f) => ({ x0: Math.min(a.x0, f.bb.x0), y0: Math.min(a.y0, f.bb.y0), x1: Math.max(a.x1, f.bb.x1), y1: Math.max(a.y1, f.bb.y1) }), { ...frames[0]!.bb });

/* Which pose and frame an image is, read back from what's drawn. */
function drawnAs(data: BuddyData, src: string | null | undefined) {
  for (const [key, p] of Object.entries(data.poses)) {
    const i = p ? p.frames.findIndex(f => f.src === src) : -1;
    if (i >= 0) return { key, frame: i, of: p!.frames };
  }
  return src === data.base.src ? { key: 'base', frame: 0, of: [data.base] } : null;
}

/* A crop around where she meets the surface: a band either side of its line, widened to anything of
   hers past the line, and her extent along it. Screen pixels. */
/* What follows Dizzy, read from a finished Dizzy's reply: Stand up after a Dizzy drawn low, and
   straight on to whatever comes next after one drawn standing. Shots are named for what's drawn. */
export function afterDizzy(r: Record<string, unknown>) {
  if (!r.ok) return null;
  const shows = r.shows as { pose: string; frames: number } | null | undefined;
  const pose = shows ? shows.pose : 'base', frames = shows ? shows.frames : 1;
  return { pose, frames, name: (f: number) => `${pose}.f${f}` };
}

export function cropFor(s: Pick<Surface, 'kind' | 'at' | 'normal'>, box: Box): Bounds {
  const r = (b: Box) => { const x = Math.floor(b.x0), y = Math.floor(b.y0); return { x, y, w: Math.ceil(b.x1) - x, h: Math.ceil(b.y1) - y }; };
  if (s.kind === 'wall') {
    const b = { x0: s.at - BAND, x1: s.at + BAND, y0: box.y0 - ALONG, y1: box.y1 + ALONG };
    if (s.normal.x < 0) b.x1 = Math.max(b.x1, box.x1 + PAST); else b.x0 = Math.min(b.x0, box.x0 - PAST);
    return r(b);
  }
  const b = { x0: box.x0 - ALONG, x1: box.x1 + ALONG, y0: s.at - BAND, y1: s.at + BAND };
  if (s.normal.y < 0) b.y1 = Math.max(b.y1, box.y1 + PAST); else b.y0 = Math.min(b.y0, box.y0 - PAST);
  return r(b);
}

export function createPoser(host: { readonly sim: Sim | null }) {
  let areas: Area[] = [], frozen = false, hubPaused = false;
  const data = new Map<string, BuddyData>();
  const sim = () => host.sim!;
  const quiet = () => { const w = sim().world; w.names = false; w.bubbles = false; };

  function surfaceFor(at: At) {
    const all = sim().world.terrain.surfaces().filter(s => s.owner === at.owner && s.kind === at.kind && (s.kind !== 'wall' || Math.sign(s.normal.x) === at.side));
    return all.sort((a, b) => (b.to - b.from) - (a.to - a.from))[0] ?? null;
  }

  function pose(m: Extract<Ask, { op: 'pose' }>) {
    const pet = sim().pets.get(m.id), d = data.get(m.id), s = surfaceFor(m.at);
    if (!pet || !d) return { ok: false, why: 'no such buddy' };
    if (!s) return { ok: false, why: 'no such surface' };
    if (!BOOK.behaviours[m.state]) return { ok: false, why: 'no such behaviour' };
    const w = sim().world;
    w.paused = true; frozen = true; quiet(); w.fx.length = 0;
    const P = pet.P, len = s.to - s.from, edge = s.kind === 'floor' ? pet.bw() / 2 : 0;
    const t = Math.min(len - edge, Math.max(edge, len * (m.at.f ?? .5)));
    P.on = { surface: s, t };
    const p = w.terrain.pointOn(s, t);
    P.x = p.x; P.y = p.y; P.vx = P.vy = 0;
    P.thrown = P.catches = P.hard = P.pierce = false; P.aim = null; P.spot = null; P.bound = null; P.next = null;
    pet.go(m.state);
    P.dir = m.dir;
    if (!BOOK.behaviours[m.state]!.main.once) P.dur = 1e9;
    /* its time up on a pass's end, so what follows comes now, not after her art's pass */
    if (m.finish) { P.dur = 0; P.t = 1; pet.tick(STILL); }
    const showing = P.clip ? P.clip.pose : BOOK.behaviours[P.state]!.main.pose, art = resolve(d, showing);
    P.t = (m.frame + .5) * 60 / art.fps;
    pet.tick(STILL);
    if (P.on?.surface.id !== s.id) return { ok: false, why: `off the surface, as ${P.state}` };

    const area = areas.find(a => 'monitor' + a.i === P.home) ?? areas[0]!, vp = viewport(area), k = vp.scale;
    const f = sim().frame(vp).pets.find(x => x.id === m.id)!;
    const el = { x: vp.x + f.box.l * k, y: vp.y + f.box.t * k, size: f.box.size * k };
    const onScreen = (b: ContentBox) => ({ x0: el.x + b.x0 * el.size, y0: el.y + b.y0 * el.size, x1: el.x + b.x1 * el.size, y1: el.y + b.y1 * el.size });
    const shown = drawnAs(d, f.src);
    const box = onScreen(shown ? shown.of[shown.frame]!.bb : d.base.bb);
    return {
      ok: true, state: P.state, clip: !!P.clip, asked: { pose: showing, resolved: art.key, frame: m.frame, frames: art.frames.length, fps: art.fps },
      shows: shown && { pose: shown.key, frame: shown.frame, frames: shown.of.length }, dir: P.dir, scale: k,
      surface: { kind: s.kind, at: s.at, from: s.from, to: s.to, normal: s.normal, on: sim().world.terrain.rectById(s.owner)!.kind },
      anchor: { x: el.x + f.box.ox * k, y: el.y + f.box.oy * k }, el, box, union: shown ? onScreen(union(shown.of)) : null,
      origin: f.origin, body: f.body, crop: cropFor(s, box)
    };
  }

  return {
    /* What the host is told. Returns false for what it shouldn't hear: the hub's pause waits while she's held still. */
    heard(m: Message) {
      if (m.k === 'start' || m.k === 'monitors') areas = m.all;
      if (m.k === 'start' || m.k === 'pets') for (const p of m.pets) data.set(p.id, p);
      if (m.k === 'pause') { hubPaused = m.on; return !frozen; }
      return true;
    },
    /* After the host heard it: a new list of buddies brings names and bubbles back. */
    after(m: Message) { if (frozen && m.k === 'pets') quiet(); },
    ask(m: Ask) {
      if (!host.sim) return { k: 'probe', n: m.n, ok: false, why: 'no world yet' };
      if (m.op === 'scene') {
        const t = sim().world.terrain;
        return {
          k: 'probe', n: m.n, ok: true, areas,
          rects: t.rects().map(r => ({ id: r.id, kind: r.kind, rect: r.rect, z: r.z, terrain: r.terrain, cut: r.cut ?? [] })),
          pets: [...sim().pets.values()].map(p => ({ id: p.id, state: p.P.state, x: p.P.x, y: p.P.y, on: p.P.surf })),
          art: Object.fromEntries([...sim().pets.keys()].map(id => [id, Object.fromEntries(Object.keys(POSE).map(key => { const r = resolve(data.get(id)!, key); return [key, { shows: r.key, frames: r.frames.length }]; }))]))
        };
      }
      if (m.op === 'release') {
        frozen = false;
        const w = sim().world; w.paused = hubPaused; w.names = true; w.bubbles = true;
        return { k: 'probe', n: m.n, ok: true };
      }
      return { k: 'probe', n: m.n, ...pose(m) };
    }
  };
}
