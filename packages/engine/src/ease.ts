/* A move drawn over a few ticks instead of in one: round a corner, onto a wall she caught, into a
   hand, up to the floor. Only the drawing eases. Where she is changes at once, so physics is the
   same whether a move is drawn eased or not. Time is the world's, counted in 60 Hz frames. */
import type { Bounds, Point } from '@buddies/terrain';

/* A corner she goes round: its point, which way round she goes (1 clockwise, -1 not), the open
   sides of the surface she leaves and the one she comes onto, and whether it's an inner corner. */
export interface Corner { pivot: Point; wind: number; na: Point; nb: Point; inner: boolean }
/* A surface she's leaving: its open side and a point on it. */
export interface Away { n: Point; p: Point }
/* What the body or hands ask for: a move over `n` frames from where she was last drawn, carried
   along by the cursor from `by` when there is one, round a corner when there is one, clear of a
   surface she's leaving when there is one. A move over 0 frames stops any under way. */
export interface Ease { n: number; by?: Point; corner?: Corner; away?: Away }
/* A move under way: when it started and for how long; her turn at the start, wound so it goes the
   short way and keeps that way as her own turn moves on; her middle at the start, and how far it
   was from where she was then, which is what fades out of a plain move; round what; and the surface
   she was on when it started, the one it's heading for (none in the air or the hand). */
export interface Easing {
  from: number; n: number; rot: number; c: Point; d: Point; corner: Corner | null; on: string | null; timed?: boolean;
  /* the monitors a corner's path has to stay on, and a surface she's leaving */
  room?: Bounds[]; away?: Away | null;
  /* her drawn box when it started */
  size0?: Size;
}
/* her drawn box, in world px, and her monitor's scale */
export interface Size { w: number; h: number; k: number }

const DEG = Math.PI / 180;
/* an angle in degrees, the short way: -180 to 180 */
export const norm = (d: number) => ((d % 360) + 540) % 360 - 180;
const smooth = (u: number) => u * u * (3 - 2 * u);
/* steps a corner's path is measured in */
const PATH = 32;

/* How far a box of this size, turned this far, with its middle at m, reaches past the line through
   p onto the side away from n. */
function past(n: Point, p: Point, m: Point, rot: number, size: Size) {
  const r = rot * DEG, up = Math.abs(n.x * Math.sin(r) - n.y * Math.cos(r)), side = Math.abs(n.x * Math.cos(r) + n.y * Math.sin(r));
  return up * size.h / 2 + side * size.w / 2 - (n.x * (m.x - p.x) + n.y * (m.y - p.y));
}
/* Keeps a box swinging round a corner on its open side: out of both surfaces at an inner corner,
   out of what's behind both at an outer one. Only as far as it was clear where the move started
   and where it ends, so the move still starts and ends where she's drawn. */
function clear(k: Corner, m: Point, rot: number, s: number, ends: [Point, number, Point, number], size: Size, size0 = size): Point {
  const [c0, r0, c1, r1] = ends, out = { ...m };
  const over = (n: Point, c: Point, r: number, z = size) => Math.max(0, past(n, k.pivot, c, r, z));
  const allow = (n: Point) => over(n, c0, r0, size0) * (1 - s) + over(n, c1, r1) * s;
  const push = (n: Point, by: number) => { if (by > 0) { out.x += n.x * by; out.y += n.y * by; } };
  if (k.inner) { for (const n of [k.na, k.nb]) push(n, over(n, out, rot) - allow(n)); return out; }
  /* Out of both by the depth she's in the lesser: never switching from one surface to the other, so
     her drawing doesn't jump where the two meet. */
  const both = (c: Point, r: number) => Math.min(over(k.na, c, r), over(k.nb, c, r)), room = Math.min(over(k.na, c0, r0, size0), over(k.nb, c0, r0, size0)) * (1 - s) + both(c1, r1) * s;
  const by = both(out, rot) - room;
  push(k.na, by); push(k.nb, by);
  return out;
}

/* How far a box of this size, turned this far, with its middle at m, reaches off the monitors:
   the furthest any of its corners is from the nearest of them. None, and it's 0. */
function off(m: Point, rot: number, size: Size, room: Bounds[]) {
  if (!room.length) return 0;
  const r = rot * DEG, u = { x: Math.sin(r) * size.h / 2, y: -Math.cos(r) * size.h / 2 }, v = { x: Math.cos(r) * size.w / 2, y: Math.sin(r) * size.w / 2 };
  let worst = 0;
  for (const [i, j] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = m.x + i! * u.x + j! * v.x, y = m.y + i! * u.y + j! * v.y;
    worst = Math.max(worst, Math.min(...room.map(b => Math.max(0, b.x - x, x - b.x - b.w, b.y - y, y - b.y - b.h))));
  }
  return worst;
}

/* The monitor a corner is on: the one it's in, or failing that the nearest. */
function monitorOf(p: Point, room: Bounds[]) {
  let best: Bounds | null = null, gap = Infinity;
  for (const b of room) { const d = Math.max(0, b.x - p.x, p.x - b.x - b.w, b.y - p.y, p.y - b.y - b.h); if (d < gap) { gap = d; best = b; } }
  return best;
}
/* Keeps a box swinging round a corner on its monitor: where it would reach past an edge further
   than it does at the start and end, it's drawn in from that edge. Each edge on its own, so the
   correction never jumps. Kept on the monitor wins over kept off the corner's window: drawn over
   its corner a moment is better than drawn off the screen. */
function within(b: Bounds, m: Point, rot: number, s: number, ends: [Point, number, Point, number], size: Size, size0: Size): Point {
  const reach = (r: number, z: Size) => { const a = r * DEG, c = Math.abs(Math.cos(a)), n = Math.abs(Math.sin(a)); return { x: c * z.w / 2 + n * z.h / 2, y: n * z.w / 2 + c * z.h / 2 }; };
  const over = (c: Point, r: number, z: Size) => { const e = reach(r, z); return [b.x - (c.x - e.x), c.x + e.x - b.x - b.w, b.y - (c.y - e.y), c.y + e.y - b.y - b.h].map(v => Math.max(0, v)); };
  const [c0, r0, c1, r1] = ends, o0 = over(c0, r0, size0), o1 = over(c1, r1, size), now = over(m, rot, size);
  /* a hair's difference in the sums is no reason to move her */
  const by = now.map((v, i) => { const d = v - (o0[i]! * (1 - s) + o1[i]! * s); return d > 1e-6 ? d : 0; });
  return { x: m.x + by[0]! - by[1]!, y: m.y + by[2]! - by[3]! };
}

/* Her middle's swing round a corner, from c0 to c1: where it starts and how far it goes, in
   degrees, and its distance from the corner point at each end. Over an outer corner it swings most
   of a half turn, the way the surfaces turn. Into an inner one it hardly moves, so it takes the
   short way. */
export function swingOf(k: Corner, c0: Point, c1: Point) {
  const p = k.pivot, a0 = Math.atan2(c0.y - p.y, c0.x - p.x) / DEG, a1 = Math.atan2(c1.y - p.y, c1.x - p.x) / DEG;
  let swing = norm(a1 - a0);
  if (k.wind && Math.abs(swing) > 90 && Math.sign(swing) !== k.wind) swing += 360 * k.wind;
  return { a0, swing, r0: Math.hypot(c0.x - p.x, c0.y - p.y), r1: Math.hypot(c1.x - p.x, c1.y - p.y) };
}

/* Her middle and turn part way from the start to where she is now, or null once the move is over,
   or when it has no time left at all. A plain move fades out the gap it started with, so wherever
   she goes meanwhile, the cursor carrying her say, the drawing goes all the way with her. Round a
   corner her middle swings about its point the way the surfaces turn, so she goes over it, not
   through it. */
export function eased(e: Easing, now: number, c: Point, rot: number, size: Size): { c: Point; rot: number } | null {
  if (!(e.n > 0)) return null;
  const u = (now - e.from) / e.n;
  if (!(u < 1)) return null;
  if (!e.corner) {
    const s = smooth(Math.max(0, u)), turn = rot + (e.rot - rot) * (1 - s), m = { x: c.x + e.d.x * (1 - s), y: c.y + e.d.y * (1 - s) };
    /* off a surface, she's kept clear of it as she turns away */
    const a = e.away;
    return { c: a ? clear({ pivot: a.p, wind: 0, na: a.n, nb: a.n, inner: true }, m, turn, s, [e.c, e.rot, c, rot], size, e.size0) : m, rot: turn };
  }
  const k = e.corner, p = k.pivot, { a0, swing, r0, r1 } = swingOf(k, e.c, c), screen = monitorOf(p, e.room || []);
  const along = (s: number) => {
    const a = (a0 + swing * s) * DEG, r = r0 + (r1 - r0) * s, turn = rot + (e.rot - rot) * (1 - s);
    const m = clear(k, { x: p.x + r * Math.cos(a), y: p.y + r * Math.sin(a) }, turn, s, [e.c, e.rot, c, rot], size, e.size0);
    /* On the screen beats clear of the corner, so within() comes last. Over a window's corner her
       turned box needs more room above its top than standing there does (about 170 px against 120
       for a 120 px buddy), and windows often sit closer to a screen's edge than that. Then she's
       drawn over the corner she's rounding for a moment, up to about a third of her size, which
       beats being drawn off the screen or snapping across. */
    return { c: screen ? within(screen, m, turn, s, [e.c, e.rot, c, rot], size, e.size0 || size) : m, rot: turn };
  };
  /* The first time round, the move takes at least the path her middle is drawn on at 20 px a frame
     of her own size. A path that takes her box further off her monitors than she is at either end
     isn't drawn at all: she's drawn where she is. */
  if (!e.timed) {
    e.timed = true;
    const room = e.room || [], out = (s: number) => { const at = along(s); return off(at.c, at.rot, size, room); };
    const ends = Math.max(off(e.c, e.rot, e.size0 || size, room), off(c, rot, size, room)) + 1;
    let len = 0, was = along(0).c;
    for (let i = 1; i <= PATH; i++) {
      if (out(i / PATH) > ends) { e.n = 0; return null; }
      const at = along(i / PATH).c; len += Math.hypot(at.x - was.x, at.y - was.y); was = at;
    }
    if (len / (20 * size.k) > e.n) { e.n = len / (20 * size.k); return eased(e, now, c, rot, size); }
  }
  return along(smooth(Math.max(0, u)));
}
