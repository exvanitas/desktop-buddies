/* Outer window corners near a screen's edge, driven one at a time, and what her drawing does going
   round each: how far into the window and off the screen it's drawn, and its biggest steps. Her
   drawn box is worked out from the frame a view gets, turned, as the DOM places it. */
import type { Rectangle, Surface } from '@buddies/terrain';
import type { BuddyData, Pet, PetFrame } from '../src/index';
import { BUDDY, screen, windowRect, world, type TestWorld } from './support';

type M = [number, number, number, number, number, number];
type Pt = { x: number; y: number };
interface Rect { x: number; y: number; w: number; h: number }
interface ContentBox { x0: number; y0: number; x1: number; y1: number }
const mul = (p: M, q: M): M => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
function parse(tf: string): M {
  let m: M = [1, 0, 0, 1, 0, 0];
  for (const [, fn, args] of tf.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = args!.split(',').map(s => parseFloat(s)), a = v[0]! * Math.PI / 180;
    const q: M = fn === 'rotate' ? [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0] : fn === 'translate' ? [1, 0, 0, 1, v[0]!, v[1] ?? 0]
      : fn === 'translateY' ? [1, 0, 0, 1, 0, v[0]!] : fn === 'scale' ? [v[0]!, 0, 0, v[1] ?? v[0]!, 0, 0] : [1, 0, 0, 1, 0, 0];
    m = mul(m, q);
  }
  return m;
}
/* her art's content box as drawn: its four corners in order, and how far it's turned */
export function outline(f: PetFrame, bb: ContentBox) {
  const S = f.box.size, [ox, oy] = f.origin!.split(' ').map(s => parseFloat(s)) as [number, number];
  const m = mul([1, 0, 0, 1, f.box.l + ox, f.box.t + oy], mul(parse(f.body!), [1, 0, 0, 1, -ox, -oy]));
  const pts = [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x1, bb.y1], [bb.x0, bb.y1]].map(([u, v]) => ({ x: m[0] * u! * S + m[2] * v! * S + m[4], y: m[1] * u! * S + m[3] * v! * S + m[5] }));
  const flip = m[0] * m[3] - m[1] * m[2] < 0;
  return { pts, rot: (flip ? Math.atan2(-m[1], -m[0]) : Math.atan2(m[1], m[0])) * 180 / Math.PI };
}
/* How deep a turned box goes into a rectangle: the least they overlap along any axis that could
   part them, 0 when they're clear. */
export function depthInto(pts: Pt[], r: Rect) {
  const rc = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
  const ax = [{ x: 1, y: 0 }, { x: 0, y: 1 }, ...[0, 1].map(i => { const a = pts[i]!, b = pts[i + 1]!, l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l }; })];
  let depth = Infinity;
  for (const a of ax) {
    const p = pts.map(q => q.x * a.x + q.y * a.y), q = rc.map(c => c.x * a.x + c.y * a.y);
    depth = Math.min(depth, Math.min(Math.max(...p), Math.max(...q)) - Math.max(Math.min(...p), Math.min(...q)));
    if (depth <= 0) return 0;
  }
  return depth;
}
/* how far past a rectangle's edges a turned box reaches, 0 when it's all inside */
export const outOf = (pts: Pt[], r: Rect) => Math.max(0, ...pts.map(p => Math.max(r.x - p.x, p.x - r.x - r.w, r.y - p.y, p.y - r.y - r.h)));

/* The ways round a window's outer corner, by where she starts and which way she goes. */
export type Way = 'top-side' | 'side-top' | 'side-under' | 'under-side';
export interface Corner {
  way: Way; side: 'left' | 'right'; size: number; shape: 'tall' | 'square'; art: 'main' | 'own';
  /* the room between the window and the screen's edge beside it, above it and below it */
  gap: number; above: number; below: number;
}
const BOXES: Record<Corner['shape'], ContentBox> = { tall: { x0: .2, y0: 0, x1: .8, y1: 1 }, square: { x0: 0, y0: 0, x1: 1, y1: 1 } };
function buddy(c: Corner): { data: BuddyData; bbs: Map<string, ContentBox> } {
  const bb = BOXES[c.shape], bbs = new Map<string, ContentBox>(), art = (key: string) => { const src = `data:image/png;base64,${key}${c.shape}`; bbs.set(src, bb); return { fps: 6, frames: [{ src, bb }] }; };
  const base = art('QmFzZQ').frames[0]!;
  const poses = c.art === 'own' ? { climb: art('Yw'), wall: art('Ww'), crawl: art('Cw'), hang: art('SA') } : {};
  return { data: BUDDY('a', { size: c.size, base, poses }), bbs };
}

/* The screen and the window for a corner: the window four of her wide and tall, the screen wide
   and tall enough that only the room asked for is tight. */
export function scene(c: Corner) {
  const S = c.size, ww = 4 * S, wh = 4 * S, sw = ww + 12 * S, sh = c.above + wh + c.below;
  const x = c.side === 'right' ? sw - c.gap - ww : c.gap;
  return { screen: { x: 0, y: 0, w: sw, h: sh }, win: { x, y: c.above, w: ww, h: wh } };
}
const where = (s: Surface) => s.kind === 'wall' ? (s.normal.x > 0 ? 'left' : 'right') : s.kind;

export interface Seen { frame: number; pts: Pt[]; rot: number; win: number; off: number; surf: string }
export interface Run {
  corner: Corner; went: boolean; frames: Seen[]; at: number; n: number;
  /* the first tick after the turn that no corner was drawn going round, and whether she stepped
     past, when `easing` says so */
  done: number; tip: boolean;
  /* once she's round, the most her middle moves in a tick climbing or crawling on, and turns */
  own: { mid: number; turn: number };
  /* over the turn: window overlap frames past 0.5 px, its deepest px, off-screen frames past 0.5 px, the furthest, and the
     biggest step of any edge (px), of her middle (px) and of her turn (degrees) */
  overlap: number; deepest: number; offFrames: number; furthest: number; move: number; mid: number; turn: number;
  /* the same, as drawn the tick before the turn starts and once it's well over: what her animation does anyway */
  ends: { win: number; off: number };
  /* over the turn, frame by frame: how deep into the window and how far off the screen */
  wins: number[]; offs: number[];
}

/* Stands her by the corner, sends her round it, and watches until the turn is well over. */
/* `easing.corner`: set when a tick draws her going round a corner, so the turn is watched until it's
   verifiably over, and `easing.tip` when it steps past. Without it, a turn is taken to be over a set
   time after it starts. */
export function run(c: Corner, o: { w?: (rects: Rectangle[]) => TestWorld; easing?: { corner: boolean; tip: boolean } } = {}): Run {
  const S = c.size;
  const { screen: sr, win: wr } = scene(c), { data, bbs } = buddy(c);
  const rects = [screen('s', sr.x, sr.y, sr.w, sr.h), windowRect('w', wr.x, wr.y, wr.w, wr.h, 1)];
  const w = o.w ? o.w(rects) : world(rects), pet = w.add(data);
  w.run(5);
  const find = (kind: string, n?: number) => w.terrain.surfaces().find(s => s.owner === 'w' && s.kind === kind && (n === undefined || s.normal.x === n))!;
  const len = (s: Surface) => s.to - s.from;
  /* the window's side she goes onto or comes off: its right side faces right */
  const sideN = c.side === 'right' ? 1 : -1, side = find('wall', sideN), top = find('floor'), under = find('ceil');
  let from: Surface, t: number, go: string, dir: number, to: string;
  if (c.way === 'top-side') { from = top; t = c.side === 'right' ? len(top) - .7 * S : .7 * S; go = 'climbGo'; dir = sideN; to = where(side); }
  else if (c.way === 'side-top') { from = side; t = 1.6 * S; go = 'climb'; dir = -1; to = 'floor'; }
  else if (c.way === 'side-under') { from = side; t = len(side) - 1.6 * S; go = 'climb'; dir = 1; to = 'ceil'; }
  else { from = under; t = c.side === 'right' ? len(under) - 1.6 * S : 1.6 * S; go = 'crawl'; dir = sideN; to = where(side); }
  pet.P.on = { surface: from, t }; const p = w.terrain.pointOn(from, t); pet.P.x = p.x; pet.P.y = p.y; pet.P.vx = pet.P.vy = 0;
  pet.go(go, { dir }); w.frame();
  const look = () => { const f = pet.frame({ x: 0, y: 0, scale: 1 }), d = outline(f, bbs.get(f.src!)!); return { ...d, win: depthInto(d.pts, wr), off: outOf(d.pts, sr), surf: pet.P.surf as string }; };
  const frames: Seen[] = [];
  let at = -1;
  let done = -1, tip = false;
  for (let i = 0; i < 2000 && (at < 0 || (o.easing ? done < 0 || i < done + 45 : i < at + Math.max(30, Math.ceil(.15 * S) + 20) + 15)); i++) {
    if (pet.P.state === 'climb' || pet.P.state === 'crawl' || pet.P.state === 'climbGo') pet.P.dur = 1e9;
    /* toward the corner till she's round it, so a turn back at the end doesn't keep her off it */
    if (at < 0 && (pet.P.state === 'climb' || pet.P.state === 'crawl')) pet.P.dir = dir;
    if (o.easing) o.easing.corner = o.easing.tip = false;
    w.frame();
    const now = look(); frames.push({ frame: i, ...now });
    if (at < 0 && now.surf === to) at = frames.length - 1;
    if (o.easing && at >= 0 && done < 0 && frames.length - 1 > at && !o.easing.corner) done = frames.length - 1;
    if (o.easing?.tip) tip = true;
  }
  const out: Run = { corner: c, went: at >= 0, frames, at, n: 0, overlap: 0, deepest: 0, offFrames: 0, furthest: 0, move: 0, mid: 0, turn: 0, ends: { win: 0, off: 0 }, wins: [], offs: [], done, tip, own: { mid: 0, turn: 0 } };
  if (at < 0) return out;
  /* the turn: from the tick before it starts to well after it's drawn, which takes longer for a bigger buddy */
  const long = o.easing ? done - at + 2 : Math.max(30, Math.ceil(.15 * S) + 20), span = frames.slice(Math.max(0, at - 1), at + long), before = frames[Math.max(0, at - 1)]!, after = frames[Math.min(frames.length - 1, at + long + 10)]!;
  /* Once she's verifiably round, after is the most of the 40 ticks that follow: her climbing tips
     her in and out of the wall as it goes. */
  const later = o.easing ? frames.slice(done + 1, done + 41) : [after];
  out.ends = { win: Math.max(before.win, ...later.map(f => f.win)), off: Math.max(before.off, ...later.map(f => f.off)) };
  const centre = (f: Seen) => ({ x: f.pts.reduce((a, p) => a + p.x, 0) / 4, y: f.pts.reduce((a, p) => a + p.y, 0) / 4 });
  for (let i = 1; i < later.length; i++) {
    const a = centre(later[i - 1]!), b = centre(later[i]!);
    out.own.mid = Math.max(out.own.mid, Math.hypot(b.x - a.x, b.y - a.y)); out.own.turn = Math.max(out.own.turn, Math.abs(((later[i]!.rot - later[i - 1]!.rot + 540) % 360) - 180));
  }
  out.wins = span.map(f => f.win); out.offs = span.map(f => f.off);
  const mid = (f: Seen) => ({ x: f.pts.reduce((a, p) => a + p.x, 0) / 4, y: f.pts.reduce((a, p) => a + p.y, 0) / 4 });
  const aabb = (f: Seen) => ({ x0: Math.min(...f.pts.map(p => p.x)), x1: Math.max(...f.pts.map(p => p.x)), y0: Math.min(...f.pts.map(p => p.y)), y1: Math.max(...f.pts.map(p => p.y)) });
  for (let i = 0; i < span.length; i++) {
    const f = span[i]!;
    if (f.win > .5) out.overlap++;
    if (f.off > .5) out.offFrames++;
    out.deepest = Math.max(out.deepest, f.win); out.furthest = Math.max(out.furthest, f.off);
    if (!i) continue;
    const a = aabb(span[i - 1]!), b = aabb(f), m0 = mid(span[i - 1]!), m1 = mid(f);
    out.move = Math.max(out.move, Math.abs(b.x0 - a.x0), Math.abs(b.x1 - a.x1), Math.abs(b.y0 - a.y0), Math.abs(b.y1 - a.y1));
    out.mid = Math.max(out.mid, Math.hypot(m1.x - m0.x, m1.y - m0.y));
    out.turn = Math.max(out.turn, Math.abs(((f.rot - span[i - 1]!.rot + 540) % 360) - 180));
  }
  return out;
}

/* Tight and roomy corners: each way round, each side, sizes from 64 to 512 px, tall and square art,
   her main image turned and her own climbing art, and the room beside, above or below the window
   from her height to a size and a half, or plenty. */
export function corners(o: { sizes?: number[]; rooms?: number[]; both?: boolean } = {}): Corner[] {
  const out: Corner[] = [], sizes = o.sizes || [64, 120, 240, 512], rooms = o.rooms || [1.05, 1.15, 1.3, 1.45, 1.6];
  for (const size of sizes) for (const shape of ['tall', 'square'] as const) for (const art of ['main', 'own'] as const) for (const side of ['right', 'left'] as const) for (const way of ['top-side', 'side-top', 'side-under', 'under-side'] as const) {
    const roomy = 5 * size, tightOf = way === 'side-under' || way === 'under-side' ? 'below' : 'above';
    for (const room of rooms) {
      /* tight beside, roomy above and below */
      out.push({ way, side, size, shape, art, gap: Math.round(room * size), above: roomy, below: roomy });
      /* tight above (or below), roomy beside */
      out.push({ way, side, size, shape, art, gap: roomy, above: tightOf === 'above' ? Math.round(room * size) : roomy, below: tightOf === 'below' ? Math.round(room * size) : roomy });
      /* tight both ways: the window in a corner of the screen */
      if (o.both) out.push({ way, side, size, shape, art, gap: Math.round(room * size), above: tightOf === 'above' ? Math.round(room * size) : roomy, below: tightOf === 'below' ? Math.round(room * size) : roomy });
    }
    /* roomy all round */
    out.push({ way, side, size, shape, art, gap: roomy, above: roomy, below: roomy });
  }
  return out;
}
export const label = (c: Corner) => `${c.way} ${c.side} ${c.size} ${c.shape} ${c.art} gap ${(c.gap / c.size).toFixed(2)} above ${(c.above / c.size).toFixed(2)} below ${(c.below / c.size).toFixed(2)}`;
