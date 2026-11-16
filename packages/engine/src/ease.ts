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
  /* round a corner with no room to swing, she steps past it and tips over, decided as it starts:
     how fast she turns doing that, in degrees a frame, and how far along she's got, in frames of
     the way, by when */
  tip?: { rate: number; at: number; s: number };
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

/* Her up, turned this far. */
const upOf = (rot: number) => ({ x: Math.sin(rot * DEG), y: -Math.cos(rot * DEG) });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
/* The line she tips over an outer corner on runs through its point, square to her up. Turned no
   further than the open sides of the two surfaces, the whole window is behind it: with all of her
   box in front of it, she's clear of the window whatever her turn. */
function tipping(k: Corner, rot: number): Point {
  const u = upOf(rot), a = dot(u, k.na), b = dot(u, k.nb);
  return a >= 0 && b >= 0 ? u : a > b ? k.na : k.nb;
}
/* How far a box of this size, turned this far, with its middle at m, is into what's behind an
   outer corner: by the least of the ways it could be clear. 0 or less, and it's clear. */
function into(k: Corner, m: Point, rot: number, size: Size) {
  return Math.min(past(k.na, k.pivot, m, rot, size), past(k.nb, k.pivot, m, rot, size), past(tipping(k, rot), k.pivot, m, rot, size));
}
/* Her art turns over the corner with her: from facing off the surface she leaves to facing off the
   one she comes onto. Art drawn upright on a wall doesn't, and swings round as it always has. */
const turnsOver = (k: Corner, r0: number, r1: number) => !k.inner && dot(upOf(r0), k.na) > .85 && dot(upOf(r1), k.nb) > .85;

/* steps the path that steps past a corner is worked out in */
const TIP = 64;
/* Step past, then tip: her way round an outer corner with no room to swing on the screen. Her feet
   run along a line through the corner's point that turns with her. On the surface she's leaving
   she steps out past its end, she tips over the point, and she comes off it along the surface
   she's going onto, her middle as high off that line all the way as it is at the ends. Turned
   between the two surfaces' open sides, that line has all of the window behind it, so she's never
   drawn in it. How far along the line she is, is kept to what's on her monitor, as far past its
   edges as she is at the ends. `fits` says whether her monitor has room for her at every turn. The
   path comes back as points, each with how many frames it takes to get there from the one before:
   20 px a frame of her own size along it, or `rate` degrees a frame of turn, whichever is longer,
   so she slides and turns no faster than she swings round a corner with room. */
export function tipPath(k: Corner, ends: [Point, number, Point, number], size: Size, size0: Size, b: Bounds, rate: number) {
  const [c0, r0, c1] = ends, o = k.pivot;
  /* The path is worked out for her turned square to each surface, facing off it, and the little
     more or less her animation turns her at each end is taken from one end to the other on top. */
  const square = (n: Point, near: number) => near + norm(Math.atan2(n.x, -n.y) / DEG - near);
  const a0 = square(k.na, r0), a1 = a0 + norm(square(k.nb, a0) - a0), d0 = norm(r0 - a0), d1 = norm(ends[3] - a1);
  const side = (r: number) => ({ x: Math.cos(r * DEG), y: Math.sin(r * DEG) }), sign = dot(side(a0), k.nb) < 0 ? -1 : 1;
  /* where her middle is along the line and up off it, turned this far */
  const on = (at: Point, r: number) => { const d = { x: at.x - o.x, y: at.y - o.y }; return [sign * dot(side(r), d), dot(upOf(r), d)] as const; };
  const [p0, q0] = on(c0, a0), [p1, q1] = on(c1, a1);
  const reach = (r: number, z: Size) => { const a = r * DEG, c = Math.abs(Math.cos(a)), n = Math.abs(Math.sin(a)); return { x: c * z.w / 2 + n * z.h / 2, y: n * z.w / 2 + c * z.h / 2 }; };
  /* past the monitor's left, right, top and bottom edges */
  const edges = [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }], at = [-b.x, b.x + b.w, -b.y, b.y + b.h];
  const over = (c: Point, r: number, z: Size) => { const e = reach(r, z); return edges.map((n, i) => Math.max(0, dot(n, c) + (n.x ? e.x : e.y) - at[i]!)); };
  const e0 = over(c0, r0, size0), e1 = over(c1, ends[3], size);
  const rows: { r: number; f: Point; u: Point; q: number; lo: number; hi: number }[] = [];
  let fits = true;
  for (let j = 0; j <= TIP; j++) {
    const s = j / TIP, r = a0 + (a1 - a0) * s, f = side(r), u = upOf(r), q = q0 + (q1 - q0) * s, e = reach(r + d0 + (d1 - d0) * s, size);
    let lo = -Infinity, hi = Infinity;
    for (let i = 0; i < 4; i++) {
      const n = edges[i]!, a = sign * dot(n, f), room = at[i]! + e0[i]! * (1 - s) + e1[i]! * s - (n.x ? e.x : e.y) - dot(n, o) - q * dot(n, u);
      if (a > 1e-9) hi = Math.min(hi, room / a); else if (a < -1e-9) lo = Math.max(lo, room / a); else if (room < -1e-6) fits = false;
    }
    if (lo > hi + 1e-6) fits = false;
    rows.push({ r, f, u, q, lo, hi });
  }
  /* Kept to the room at every turn still to come: she doesn't step out past where she started only
     to step back, nor back from where she ends up only to come on again. Every limit is a least or a
     most of ones that change a little at a time, so the path does too. */
  const hi = rows.map(w => w.hi), lo = rows.map(w => w.lo);
  for (let j = TIP - 1; j >= 0; j--) hi[j] = Math.min(hi[j]!, hi[j + 1]!);
  for (let j = 1; j <= TIP; j++) lo[j] = Math.max(lo[j]!, lo[j - 1]!);
  const out: { c: Point; rot: number; n: number }[] = [];
  rows.forEach((w, j) => {
    const H = Math.max(hi[j]!, Math.min(p0, w.hi)), L = Math.min(lo[j]!, Math.max(p1, w.lo));
    /* the very ends are where she's drawn */
    const p = j === 0 ? p0 : j === TIP ? p1 : Math.min(w.hi, Math.max(w.lo, Math.min(H, Math.max(L, p0 + (p1 - p0) * j / TIP))));
    const c = { x: o.x + sign * w.f.x * p + w.u.x * w.q, y: o.y + sign * w.f.y * p + w.u.y * w.q }, was = out[j - 1];
    const rot = w.r + d0 + (d1 - d0) * j / TIP;
    out.push({ c, rot, n: was ? Math.max(Math.hypot(c.x - was.c.x, c.y - was.c.y) / (20 * size.k), Math.abs(rot - was.rot) / rate) : 0 });
  });
  return { path: out, fits };
}
/* The point a way into such a path, in frames of it. */
function alongTip(path: ReturnType<typeof tipPath>['path'], at: number) {
  for (let j = 1; j < path.length; j++) {
    const w = path[j]!, was = path[j - 1]!;
    if (at <= w.n || j === path.length - 1) {
      const t = w.n > 0 ? Math.min(1, Math.max(0, at / w.n)) : 1;
      return { c: { x: was.c.x + (w.c.x - was.c.x) * t, y: was.c.y + (w.c.y - was.c.y) * t }, rot: was.rot + (w.rot - was.rot) * t };
    }
    at -= w.n;
  }
  return { c: path[0]!.c, rot: path[0]!.rot };
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
  const ends: [Point, number, Point, number] = [e.c, e.rot, c, rot], size0 = e.size0 || size;
  const swung = (s: number) => {
    const a = (a0 + swing * s) * DEG, r = r0 + (r1 - r0) * s, turn = rot + (e.rot - rot) * (1 - s);
    return { m: clear(k, { x: p.x + r * Math.cos(a), y: p.y + r * Math.sin(a) }, turn, s, ends, size, e.size0), turn };
  };
  const along = (s: number) => {
    const { m, turn } = swung(s);
    /* On the screen beats clear of the corner, so within() comes last. Over a window's corner her
       turned box needs more room above its top than standing there does (about 170 px against 120
       for a 120 px buddy), and windows often sit closer to a screen's edge than that. Where that
       would draw her over the corner, she steps past it and tips over instead (tipPath). */
    return { c: screen ? within(screen, m, turn, s, ends, size, size0) : m, rot: turn };
  };
  /* Stepping past, the way is worked out afresh each frame, as the swing is, so it goes with a
     window that moves and with her animation as it goes on. She goes on from as far along it as
     she's got, by the share of the time left that's gone by: the far end moving on as she climbs
     or crawls speeds her a little over what's left, rather than moving her along what she's done. */
  const tip = e.tip ? tipPath(k, ends, size, size0, screen!, e.tip.rate).path : null, all = tip ? tip.reduce((a, w) => a + w.n, 0) : 0;
  const path = (s: number) => {
    if (!tip) return along(s);
    const t = e.tip!;
    if (s !== t.s) { t.at += Math.max(0, all - t.at) * (t.s < 1 ? (s - t.s) / (1 - t.s) : 1); t.s = s; }
    return alongTip(tip, t.at);
  };
  /* The first time round: the way she goes, then how long it takes. Where the swing, drawn in from
     the screen's edge, would take her further into the window than she is at either end, she steps
     past and tips over instead. The move takes at least the path her middle is drawn on at 20 px a
     frame of her own size. A path that takes her box further off her monitors than she is at either
     end isn't drawn at all: she's drawn where she is. */
  if (!e.timed) {
    e.timed = true;
    /* Only where she's on the screen at both ends, give or take her animation: a wall with no room
       for her beside it at all is another matter, and there she swings as before. */
    if (screen && turnsOver(k, e.rot, rot) && off(e.c, e.rot, size0, [screen]) <= size0.h / 10 && off(c, rot, size, [screen]) <= size.h / 10) {
      const d0 = Math.max(0, into(k, e.c, e.rot, size0)), d1 = Math.max(0, into(k, c, rot, size));
      let tight = false;
      for (let i = 0; i <= PATH && !tight; i++) {
        const s = i / PATH, at = along(s), m = swung(s).m;
        /* only where the screen's edge drew her in: elsewhere the swing is today's, untouched */
        tight = Math.hypot(at.c.x - m.x, at.c.y - m.y) > 1e-6 && into(k, at.c, at.rot, size) > d0 * (1 - s) + d1 * s + .5;
      }
      /* She turns no faster than she'd swing round with room, over the time that swing would take,
         and steps past only where her monitor has room for it at every turn. */
      let swing = 0;
      for (let i = 1; tight && i <= PATH; i++) { const a = swung((i - 1) / PATH).m, b = swung(i / PATH).m; swing += Math.hypot(b.x - a.x, b.y - a.y); }
      const rate = Math.max(1, Math.min(7.5, Math.abs(norm(rot - e.rot)) / Math.max(e.n, swing / (20 * size.k)))), way = tight ? tipPath(k, ends, size, size0, screen!, rate) : null;
      if (way && way.fits) { e.tip = { rate, at: 0, s: 0 }; e.n = Math.max(e.n, way.path.reduce((a, w) => a + w.n, 0)); return eased(e, now, c, rot, size); }
    }
    const room = e.room || [], out = (s: number) => { const at = path(s); return off(at.c, at.rot, size, room); };
    const far = Math.max(off(e.c, e.rot, size0, room), off(c, rot, size, room)) + 1;
    let len = 0, was = path(0).c;
    for (let i = 1; i <= PATH; i++) {
      if (out(i / PATH) > far) { e.n = 0; return null; }
      const at = path(i / PATH).c; len += Math.hypot(at.x - was.x, at.y - was.y); was = at;
    }
    if (len / (20 * size.k) > e.n) { e.n = len / (20 * size.k); return eased(e, now, c, rot, size); }
  }
  return path(smooth(Math.max(0, u)));
}
