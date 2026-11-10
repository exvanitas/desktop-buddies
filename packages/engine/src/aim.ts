/* Working out a homing jump: what she could aim at from where she stands, and the arc that gets her
   there. It only asks. Nothing here moves her or spends a random number, so a world with no windows
   runs exactly as it would without it. */
import type { Bounds, Crossing, Point, Surface, Terrain } from '@buddies/terrain';
import type { Reach } from './pace';
import { GRAB_SPEED, GRAV } from './state';

/* a buddy standing on a floor, as far as a jump cares */
export interface Jumper extends Point { k: number; side: number; up: number; ext: number; zone: Bounds; on: Surface; turn: number; reach: Reach }
export interface Arc { vx: number; vy: number; frames: number }
/* where she'd land or grab, and what to take off with */
export interface Aim extends Point { owner: string; way: 'top' | 'side'; vx: number; vy: number; frames: number }
/* a place along a surface to jump for a window from */
export interface Spot { owner: string; t: number }

/* what one tick's search found: what she can jump for now, and where to walk for the rest */
export interface Plan { hops: Aim[]; walks: Spot[] }
/* arcs a search has left */
interface Budget { flights: number }

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const budget = (me: Jumper): Budget => ({ flights: me.reach.flights });
/* how many windows a walk chooses between */
const WALKS = 3;
/* the fewest windows a search for walks gets through */
const SHARES = 10;

/* Takes off at `from` and arrives at `to`, `rise` over the higher of the two. The frame count comes
   from the smooth curve, and the speeds from the sums airTick really does. An aimed flight runs in
   whole frames, so she's there exactly. */
export function arc(from: Point, to: Point, rise: number, k: number): Arc {
  const g = GRAV * k, top = Math.min(from.y, to.y) - rise;
  const frames = Math.max(1, Math.round(Math.sqrt(2 * (from.y - top) / g) + Math.sqrt(2 * (to.y - top) / g)));
  return { vx: (to.x - from.x) / frames, vy: (to.y - from.y) / frames - g * (frames + 1) / 2, frames };
}

/* What she'd meet first on that arc, and how fast she'd be falling, stepping as airTick does. All of
   her stays on this screen: past its edges is another world. */
function flight(terrain: Terrain, me: Jumper, a: Arc) {
  const box = { side: me.side, up: me.up, k: me.k }, g = GRAV * me.k, { x, y, w, h } = me.zone, steps = a.frames + 3;
  /* Only what the arc could touch is worth sweeping past, every frame of it. */
  let high = me.y, low = me.y, fall = a.vy, at = me.y;
  for (let i = 0; i < steps; i++) { fall += g; at += fall; high = Math.min(high, at); low = Math.max(low, at); }
  const left = Math.min(me.x, me.x + a.vx * steps) - box.side - 1, right = Math.max(me.x, me.x + a.vx * steps) + box.side + 1;
  const among = terrain.near({ x: left, y: high - box.up - 1, w: right - left, h: low - high + box.up + 2 });
  let p: Point = me, vy = a.vy;
  for (let i = 0; i < steps; i++) {
    vy += g;
    const q = { x: p.x + a.vx, y: p.y + vy }, hit = terrain.sweep(p, q, { box, among });
    if (hit) return { hit, vy };
    if (q.x - box.side < x || q.x + box.side > x + w || q.y - box.up < y || q.y > y + h) return null;
    p = q;
  }
  return null;
}

const inReach = (me: Jumper, to: Point) => Math.abs(to.x - me.x) <= me.reach.across * me.k && me.y - to.y <= me.reach.up * me.k && to.y - me.y <= me.reach.down * me.k;
/* How far off to one side a rectangle is. */
const gap = (me: Point, r: Bounds) => Math.max(r.x - me.x, me.x - r.x - r.w, 0);
/* Could anything on this rectangle be in reach? It takes no arc to say no. */
const inRange = (me: Jumper, r: Bounds) => gap(me, r) <= me.reach.across * me.k + me.side && me.y - (r.y + r.h) <= me.reach.up * me.k && r.y - me.y <= me.reach.down * me.k;

/* The lowest arc that gets her there, if any does. */
function arcTo(terrain: Terrain, me: Jumper, left: Budget, to: Point, lands: (hit: Crossing, vx: number, vy: number) => boolean) {
  if (!inReach(me, to)) return null;
  for (const rise of me.reach.rises) {
    const a = arc(me, to, rise * me.k, me.k);
    if (Math.abs(a.vx) > me.reach.speed * me.k) continue;
    if (left.flights <= 0) return null;
    left.flights--;
    const end = flight(terrain, me, a);
    if (end && lands(end.hit, a.vx, end.vy)) return a;
  }
  return null;
}

/* A window top: a stretch she fits on with nothing hiding it, and room above her there. */
function top(terrain: Terrain, me: Jumper, s: Surface, left: Budget): Aim | null {
  const { side: m, zone } = me;
  for (const [a, b] of terrain.open(s)) {
    const l = Math.max(a, zone.x), r = Math.min(b, zone.x + zone.w), lo = l + m, hi = r - m, pad = (hi - lo) * .15;
    if (r - l < 2 * m * me.reach.ledge) continue;
    for (const x of [(lo + hi) / 2, clamp(me.x, lo + pad, hi - pad)]) {
      /* the landing would be refused anyway: this saves the flights */
      if (terrain.behind(s, { x, y: s.at }, me)) continue;
      const to = { x, y: s.at }, got = arcTo(terrain, me, left, to, hit => hit.surface.id === s.id);
      if (got) return { ...to, owner: s.owner, way: 'top', vx: got.vx, vy: got.vy, frames: got.frames };
    }
  }
  return null;
}

/* Where along a wall or ceiling she's held, from where she met it: all of her on it. The one rule
   for a grab, flown or thrown. */
export const gripAt = (s: Surface, along: number, ext: number) => clamp(along - s.from, ext, s.to - s.from - ext);

/* A window side, tall enough to hold on to, with nothing hiding where she'd cling. Only the one
   facing her can be flown to. She aims a little into it, so she can't stop just short. */
function side(terrain: Terrain, me: Jumper, s: Surface, left: Budget): Aim | null {
  const { side: m, up: h, ext, k } = me, n = s.normal.x, x = s.at + n * (m - k);
  /* Where a contact with her feet at y leaves her holding on, as airTick puts her there, and whether she can stay. */
  const holds = (y: number) => {
    const at = s.from + gripAt(s, y - h / 2, ext);
    return !terrain.behind(s, { x: s.at, y: at }, me);
  };
  if (s.to - s.from < 2 * ext) return null;
  const grip = s.to - h * .3;
  for (const [a, b] of terrain.open(s)) {
    const lo = Math.max(a + h, s.from + ext + h / 2), hi = Math.min(b, grip - 1), pad = (hi - lo) * .15;
    if (hi < lo) continue;
    for (const y of [(lo + hi) / 2, clamp(me.y - h, lo + pad, hi - pad)]) {
      const to = { x, y };
      const got = arcTo(terrain, me, left, to, (hit, vx, vy) => hit.surface.id === s.id && hit.y < grip && Math.hypot(vx, vy) < GRAB_SPEED * k && holds(hit.y));
      if (got) return { ...to, owner: s.owner, way: 'side', vx: got.vx, vy: got.vy, frames: got.frames };
    }
  }
  return null;
}

/* What she could jump for from here, or for that one window, nearest first, as far as the flights
   go. Never the one she's on. */
export function aims(terrain: Terrain, me: Jumper, only?: string, left = budget(me)) {
  return aimsAt(terrain, me, targets(terrain, me).filter(s => !only || s.owner === only), left);
}
/* What a window can be jumped to by: its top and sides. */
const targets = (terrain: Terrain, me: Jumper) => terrain.surfaces().filter(s => s.kind !== 'ceil' && s.owner !== me.on.owner && terrain.rectById(s.owner)!.kind === 'window');
function aimsAt(terrain: Terrain, me: Jumper, among: Surface[], left: Budget) {
  const out: Aim[] = [], rect = (s: Surface) => terrain.rectById(s.owner)!.rect;
  for (const s of among.filter(s => inRange(me, rect(s))).sort((a, b) => gap(me, rect(a)) - gap(me, rect(b)))) {
    const aim = s.kind === 'floor' ? top(terrain, me, s, left) : side(terrain, me, s, left);
    if (aim) out.push(aim);
  }
  return out;
}

/* For the nearest windows she can't jump for from here, the nearest place on this surface she could. */
export function spots(terrain: Terrain, me: Jumper, hops = aims(terrain, me), left = budget(me)) {
  const s = me.on, there = new Set(hops.map(a => a.owner)), out: Spot[] = [];
  const lo = s.from + me.side, hi = s.to - me.side, far = me.reach.across * me.k * .7, near = me.side * 3;
  if (hi < lo) return out;
  const edges = new Map<string, Surface[]>();
  for (const e of targets(terrain, me)) if (!there.has(e.owner)) edges.set(e.owner, [...edges.get(e.owner) || [], e]);
  const rest = [...edges.keys()].map(id => terrain.rectById(id)!);
  for (const r of rest.sort((a, b) => gap(me, a.rect) - gap(me, b.rect))) {
    if (out.length === WALKS || left.flights <= 0) break;
    const { x, w } = r.rect, near4 = [x - near, x + w + near, x - far, x + w + far].map(v => clamp(v, lo, hi)).sort((p, q) => Math.abs(p - me.x) - Math.abs(q - me.x));
    /* A window she'll never reach can't have the whole search: it gets a share. One place can spend
       all of it, so each search starts from the next: she gets to the rest in turn. */
    const first = me.turn % near4.length, tries = [...near4.slice(first), ...near4.slice(0, first)];
    const share = { flights: Math.min(left.flights, Math.ceil(me.reach.flights / SHARES)) }, had = share.flights;
    const at = tries.find(v => share.flights > 0 && !terrain.behind(s, { x: v, y: s.at }, me) && aimsAt(terrain, { ...me, x: v, y: s.at }, edges.get(r.id)!, share).length);
    left.flights -= had - share.flights;
    if (at !== undefined) out.push({ owner: r.id, t: at - s.from });
  }
  return out;
}

/* One search: what she can do from here. */
export function plan(terrain: Terrain, me: Jumper): Plan {
  const hops = aims(terrain, me);
  return { hops, walks: spots(terrain, me, hops) };
}
