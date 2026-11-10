/* Rectangles and their surfaces, and the queries over them. World units are physical pixels.

   A rectangle: { id, kind, rect: { x, y, w, h }, z, terrain, scale }. `kind` is 'screen' or 'window'.
   `terrain` false makes a blocker: it hides what is behind it and gives no surfaces.

   A surface: { id, owner, kind, normal, from, to, at, next, prev }. `kind` is floor, wall or ceil.
   `at` is the fixed coordinate; `from` and `to` run along the other axis, smallest first. `next` is
   the surface round the corner past `to`, `prev` the one past `from`, by id, or null.

   Screens face inward. Every monitor is a world of its own, with a floor, a ceiling and walls, and
   only side-by-side edges are open: a wall shared with a neighbour, or a small gap for a taskbar
   down the side. Monitors stacked on each other keep their floors and ceilings; across() says who
   is on the far side, for whatever means to go through. Windows face outward, all four edges, and
   overlap is settled at query time, never by clipping. */
export interface Point { x: number; y: number }
export interface Bounds { x: number; y: number; w: number; h: number }
/* `cut` names a window's edges that aren't really edges, such as where it was cut off at a monitor.
   They give no surface. */
export interface Rectangle { id: string; kind: 'screen' | 'window'; rect: Bounds; z: number; terrain: boolean; scale: number; cut?: ('top' | 'bottom' | 'left' | 'right')[] }
export type SurfaceKind = 'floor' | 'wall' | 'ceil';
export interface Surface { id: string; owner: string; kind: SurfaceKind; normal: Point; from: number; to: number; at: number; next: string | null; prev: string | null }
/* the body around a point at the feet. With `k`, the scale it is that size at, a check of where she
   is held sizes it for the monitor holding that spot, as she'll be there. */
export interface Body { side: number; up: number; k?: number }
export interface Crossing { surface: Surface; f: number; x: number; y: number }
export interface SweepOptions { box?: Body; kind?: SurfaceKind; owner?: string | null; only?: Rectangle['kind']; among?: Surface[] }
export interface TerrainOptions { seam?: number }

export interface Terrain {
  set(next: Rectangle[]): void;
  rects(): Rectangle[];
  screens(): Rectangle[];
  surfaces(): Surface[];
  rectById(id: string): Rectangle | null;
  surfaceById(id: string | null): Surface | null;
  pointOn(s: Surface, t: number): Point;
  covered(z: number, p: Point): boolean;
  hidden(s: Surface, p: Point): boolean;
  behind(s: Surface, p: Point, b: Body): boolean;
  open(s: Surface): [number, number][];
  crowded(z: number, b: Bounds): boolean;
  near(b: Bounds): Surface[];
  sweep(from: Point, to: Point, o?: SweepOptions): Crossing | null;
  past(kind: SurfaceKind, p: Point, b: Body, screen: Rectangle): Surface | null;
  contact(kind: SurfaceKind, from: Point, to: Point, b: Body, screen: Rectangle, passing?: boolean): Surface | null;
  home(p: Point): Rectangle;
  nearest(p: Point): Rectangle;
  primary(): Rectangle;
  ceilingAbove(p: Point): Surface | null;
  floorBelow(p: Point): Surface | null;
  across(s: Surface, x: number): Rectangle | null;
  holds(r: Bounds, p: Point): boolean;
  lost(p: Point): boolean;
}

interface Box { x0: number; y0: number; x1: number; y1: number }
/* a rectangle's area, or a seam's: the pieces the outline is made from */
interface Piece extends Box { owner: string; name: string }
type Edge = 'top' | 'bottom' | 'left' | 'right';
type End = 'from' | 'to';

const SEAM = 160;
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const FACES: Record<Rectangle['kind'], Record<Edge, [SurfaceKind, number, number]>> = {
  screen: { top: ['ceil', 0, 1], bottom: ['floor', 0, -1], left: ['wall', 1, 0], right: ['wall', -1, 0] },
  window: { top: ['floor', 0, -1], bottom: ['ceil', 0, 1], left: ['wall', -1, 0], right: ['wall', 1, 0] }
};
const box = (r: Bounds): Box => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
const holds = (r: Bounds, p: Point) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/* The bands that join screens side by side across a small gap, as extra pieces of floor and ceiling. */
function seams(screens: Rectangle[], limit: number) {
  const out: Piece[] = [];
  for (const a of screens) for (const b of screens) {
    if (a === b) continue;
    const A = box(a.rect), B = box(b.rect), gx = B.x0 - A.x1;
    const y0 = Math.max(A.y0, B.y0), y1 = Math.min(A.y1, B.y1);
    if (gx > 0 && gx <= limit && y1 > y0) out.push({ owner: b.id, name: 'seam' + a.id + '-', x0: A.x1, y0, x1: B.x0, y1 });
  }
  return out;
}

/* What is left of [lo, hi] once the given spans are taken out. */
function subtract(lo: number, hi: number, spans: [number, number][]) {
  let parts: [number, number][] = [[lo, hi]];
  for (const [a, b] of spans) parts = parts.flatMap(([p, q]): [number, number][] => (b <= p || a >= q ? [[p, q] as [number, number]] : [[p, a] as [number, number], [b, q] as [number, number]]).filter(([u, v]) => v - u >= 1));
  return parts;
}

/* One piece's four edges. A wall loses whatever another piece covers from the far side. */
function edgesOf(piece: Piece, faces: Record<Edge, [SurfaceKind, number, number]>, others: Piece[], out: Surface[]) {
  const { x0, y0, x1, y1 } = piece;
  const edges: [Edge, number, number, number, number, boolean][] = [
    ['left', x0, y0, y1, -1, true], ['right', x1, y0, y1, 1, true],
    ['top', y0, x0, x1, -1, false], ['bottom', y1, x0, x1, 1, false]
  ];
  for (const [name, at, lo, hi, out_, upright] of edges) {
    const probe = at + out_ * .5;
    const spans = upright ? others.filter(q => q.x0 < probe && probe < q.x1).map((q): [number, number] => [q.y0, q.y1]) : [];
    subtract(lo, hi, spans).forEach(([from, to], i) => {
      const [kind, nx, ny] = faces[name];
      out.push({ id: `${piece.owner}:${piece.name}${name}:${i}`, owner: piece.owner, kind, normal: { x: nx, y: ny }, from, to, at, next: null, prev: null });
    });
  }
}

/* Close up what a seam split: a floor that runs on across the gap is one floor. */
function merge(surfaces: Surface[]) {
  const out = surfaces.slice().sort((a, b) => Number(a.id.includes(':seam')) - Number(b.id.includes(':seam')));
  for (let i = 0; i < out.length; i++) for (let j = out.length - 1; j > i; j--) {
    const a = out[i]!, b = out[j]!;
    if (a.owner !== b.owner || a.kind !== b.kind || a.at !== b.at || a.normal.x !== b.normal.x || a.normal.y !== b.normal.y) continue;
    if (b.to === a.from) a.from = b.from; else if (b.from === a.to) a.to = b.to; else continue;
    out.splice(j, 1);
  }
  return surfaces.filter(s => out.includes(s));
}

const endOf = (s: Surface, end: End): Point => { const v = end === 'to' ? s.to : s.from; return s.kind === 'wall' ? { x: s.at, y: v } : { x: v, y: s.at }; };
/* Can you get from this end of a to that end of b? */
function joins(a: Surface, endA: End, b: Surface, endB: End) {
  if (a.kind !== b.kind) return a.kind === 'wall' || b.kind === 'wall';
  return endA !== endB && a.normal.x === b.normal.x && a.normal.y === b.normal.y;
}
function link(surfaces: Surface[], kindOf: (id: string) => Rectangle['kind'] | undefined) {
  const ENDS: End[] = ['from', 'to'];
  const key = (p: Point) => p.x + ',' + p.y, at = new Map<string, { s: Surface; end: End }[]>();
  for (const s of surfaces) for (const end of ENDS) {
    const k = key(endOf(s, end)); if (!at.has(k)) at.set(k, []); at.get(k)!.push({ s, end });
  }
  for (const s of surfaces) for (const end of ENDS) {
    const near = at.get(key(endOf(s, end)))!.filter(c => c.s !== s && joins(s, end, c.s, c.end) && (c.s.owner === s.owner || (kindOf(c.s.owner) === 'screen' && kindOf(s.owner) === 'screen')));
    const best = near.find(c => c.s.owner === s.owner) || near[0];
    if (best) s[end === 'to' ? 'next' : 'prev'] = best.s.id;
  }
}

export function createTerrain(rects: Rectangle[], opt?: TerrainOptions): Terrain {
  const limit = opt && opt.seam != null ? opt.seam : SEAM;
  let list: Rectangle[] = [], surfaces: Surface[] = [], byId = new Map<string, Surface>(), rectIds = new Map<string, Rectangle>(), pieces: Piece[] = [], bbox: Box | null = null;

  function set(next: Rectangle[]) {
    list = next.slice(); rectIds = new Map(list.map(r => [r.id, r]));
    surfaces = [];
    const screens = list.filter(r => r.kind === 'screen' && r.terrain !== false);
    pieces = screens.map(r => Object.assign({ owner: r.id, name: '' }, box(r.rect))).concat(seams(screens, limit));
    for (const p of pieces) edgesOf(p, FACES.screen, pieces.filter(q => q !== p), surfaces);
    surfaces = merge(surfaces);
    for (const r of list) if (r.kind === 'window' && r.terrain !== false) {
      const edges: Surface[] = [], cut = new Set((r.cut || []).map(e => `${r.id}:${e}:0`));
      edgesOf(Object.assign({ owner: r.id, name: '' }, box(r.rect)), FACES.window, [], edges);
      surfaces.push(...edges.filter(s => !cut.has(s.id)));
    }
    link(surfaces, id => (rectIds.get(id) || {}).kind);
    byId = new Map(surfaces.map(s => [s.id, s]));
    bbox = pieces.length ? { x0: Math.min(...pieces.map(p => p.x0)), y0: Math.min(...pieces.map(p => p.y0)), x1: Math.max(...pieces.map(p => p.x1)), y1: Math.max(...pieces.map(p => p.y1)) } : null;
  }

  const screens = () => list.filter(r => r.kind === 'screen');
  const rectById = (id: string) => rectIds.get(id) || null;
  const surfaceById = (id: string | null) => (id !== null && byId.get(id)) || null;
  /* Is this point behind something higher? Touching an edge isn't being behind it. */
  const covered = (z: number, p: Point) => list.some(r => r.z > z && p.x > r.rect.x && p.x < r.rect.x + r.rect.w && p.y > r.rect.y && p.y < r.rect.y + r.rect.h);
  /* Only windows can be covered: the screen's edges stay the edges of the world. */
  const hidden = (s: Surface, p: Point) => { const r = rectIds.get(s.owner); return !!r && r.kind === 'window' && covered(r.z, p); };
  /* The stretches of a surface nothing hides, along its own axis. */
  function open(s: Surface) {
    const r = rectIds.get(s.owner);
    if (!r || r.kind !== 'window') return [[s.from, s.to] as [number, number]];
    const upright = s.kind === 'wall';
    const over = list.filter(q => q.z > r.z && (upright ? q.rect.x < s.at && s.at < q.rect.x + q.rect.w : q.rect.y < s.at && s.at < q.rect.y + q.rect.h));
    return subtract(s.from, s.to, over.map((q): [number, number] => upright ? [q.rect.y, q.rect.y + q.rect.h] : [q.rect.x, q.rect.x + q.rect.w]));
  }
  /* Does anything in front of z reach into this box? Touching isn't reaching in. */
  const crowded = (z: number, b: Bounds) => list.some(r => r.z > z && r.rect.x < b.x + b.w && r.rect.x + r.rect.w > b.x && r.rect.y < b.y + b.h && r.rect.y + r.rect.h > b.y);
  /* Is a body holding on to a surface at p behind something in front of its window? The body sits
     over a floor, under a ceiling and out from a wall, with p the middle of it along a wall. A body
     with no size is the point. Only windows can be: a screen's edges stay the edges of the world. */
  function behind(s: Surface, p: Point, b: Body) {
    const r = rectIds.get(s.owner);
    if (!r || r.kind !== 'window') return false;
    const f = b.k ? home(p).scale / b.k : 1, side = b.side * f, up = b.up * f;
    if (s.kind === 'wall') return crowded(r.z, { x: s.normal.x > 0 ? s.at : s.at - 2 * side, y: p.y - up / 2, w: 2 * side, h: up });
    return crowded(r.z, { x: p.x - side, y: s.kind === 'floor' ? s.at - up : s.at, w: 2 * side, h: up });
  }
  /* The surfaces that touch a box, for whoever will sweep around in it many times. */
  function near(b: Bounds) {
    const x1 = b.x + b.w, y1 = b.y + b.h, out: Surface[] = [];
    for (const s of surfaces) if (s.kind === 'wall' ? s.at >= b.x && s.at <= x1 && s.to >= b.y && s.from <= y1 : s.at >= b.y && s.at <= y1 && s.to >= b.x && s.from <= x1) out.push(s);
    return out;
  }
  const pointOn = (s: Surface, t: number): Point => s.kind === 'wall' ? { x: s.at, y: s.from + t } : { x: s.from + t, y: s.at };

  function nearest(p: Point) {
    let best: Rectangle | null = null, d = Infinity;
    for (const r of screens()) {
      const b = box(r.rect), dx = p.x - clamp(p.x, b.x0, b.x1), dy = p.y - clamp(p.y, b.y0, b.y1), e = dx * dx + dy * dy;
      if (e < d) { d = e; best = r; }
    }
    return best!; /* a world always has a screen */
  }
  /* The screen a point belongs to: the one it is on, or the closest. */
  const home = (p: Point) => screens().find(r => holds(r.rect, p)) || nearest(p);
  /* Where new buddies arrive: the screen holding the desktop's origin. */
  const primary = () => (screens().find(r => holds(r.rect, { x: 0, y: 0 })) || screens()[0])!;

  /* How far along the path a crossing happens, or null. One-way: a floor only catches something
     moving down, a ceiling something moving up, a wall something moving toward its normal. */
  function crossing(s: Surface, from: Point, to: Point, b: Body): Crossing | null {
    let a: number, c: number;
    if (s.kind === 'floor') { a = from.y; c = to.y; if (c <= a || a > s.at || c < s.at) return null; }
    else if (s.kind === 'ceil') { a = from.y - b.up; c = to.y - b.up; if (c >= a || a < s.at || c > s.at) return null; }
    else {
      const n = s.normal.x; a = from.x - n * b.side; c = to.x - n * b.side;
      if ((c - a) * n >= 0 || (a - s.at) * n < 0 || (c - s.at) * n > 0) return null;
    }
    const f = (s.at - a) / (c - a), x = from.x + (to.x - from.x) * f, y = from.y + (to.y - from.y) * f;
    const inside = s.kind === 'wall' ? y >= s.from && y - b.up <= s.to : x >= s.from && x <= s.to;
    /* A floor holds her where she meets it, so all of her there has to be clear of anything in
       front. A wall or ceiling only has to be there where she touches it: where she'd be held on
       one, after the grip, is for the grab to judge. */
    const clear = s.kind === 'floor' ? !behind(s, { x, y: s.at }, b) : !hidden(s, s.kind === 'wall' ? { x: s.at, y: clamp(y, s.from, s.to) } : { x, y: s.at });
    return inside && clear ? { surface: s, f, x, y } : null;
  }
  /* The first surface crossed going from `from` to `to`. `box` is the body around the point, which
     sits at the feet: { side, up }. `kind`, `owner`, `only` (a rectangle kind) and `among` (a list) limit the search. */
  function sweep(from: Point, to: Point, o?: SweepOptions) {
    const b = o && o.box || { side: 0, up: 0 }, kind = o && o.kind, owner = o && o.owner, only = o && o.only;
    let best: Crossing | null = null;
    for (const s of o && o.among || surfaces) {
      if ((kind && s.kind !== kind) || (owner && s.owner !== owner) || (only && rectIds.get(s.owner)!.kind !== only)) continue;
      const hit = crossing(s, from, to, b);
      if (hit && (!best || hit.f < best.f)) best = hit;
    }
    return best;
  }
  /* A screen edge has nothing behind it, so a body past one is as good as caught, however it got
     there. Asked of one screen: its own edges, along their whole length, and on past their ends
     unless the body has gone over to another monitor. */
  function past(kind: SurfaceKind, p: Point, b: Body, screen: Rectangle) {
    const r = box(screen.rect), x = clamp(p.x, r.x0, r.x1), y = clamp(p.y, r.y0, r.y1);
    if (kind !== 'wall' && (p.x < r.x0 || p.x > r.x1) && pieces.some(q => q.owner !== screen.id && p.x >= q.x0 && p.x <= q.x1 && p.y >= q.y0 && p.y <= q.y1)) return null;
    for (const s of surfaces) {
      if (s.owner !== screen.id || s.kind !== kind) continue;
      if (kind === 'wall') { if ((s.normal.x > 0 ? p.x - b.side < s.at : p.x + b.side > s.at) && y >= s.from && y <= s.to) return s; }
      else if ((kind === 'floor' ? p.y >= s.at : p.y - b.up < s.at) && x >= s.from && x <= s.to) return s;
    }
    return null;
  }
  /* What screen edge a body moving from `from` to `to` has run into, of one kind, with `screen` as
     its home. One `passing` through to that screen meets only that screen, and may be past its floor or
     ceiling for now: it hasn't arrived. */
  function contact(kind: SurfaceKind, from: Point, to: Point, b: Body, screen: Rectangle, passing?: boolean) {
    const hit = sweep(from, to, { kind, box: b, owner: passing ? screen.id : null, only: 'screen' });
    return hit ? hit.surface : !passing || kind === 'wall' ? past(kind, to, b, screen) : null;
  }

  function ceilingAbove(p: Point) {
    let best: Surface | null = null;
    for (const s of surfaces) if (s.kind === 'ceil' && s.at <= p.y && p.x >= s.from && p.x <= s.to && !hidden(s, { x: p.x, y: s.at }) && (!best || s.at > best.at)) best = s;
    return best;
  }
  function floorBelow(p: Point) {
    let best: Surface | null = null;
    for (const s of surfaces) if (s.kind === 'floor' && s.at >= p.y && p.x >= s.from && p.x <= s.to && !hidden(s, { x: p.x, y: s.at }) && (!best || s.at < best.at)) best = s;
    return best;
  }
  /* The monitor stacked on the far side of a floor or ceiling, at this x. A taskbar's gap between
     them doesn't count. */
  function across(s: Surface, x: number) {
    if (s.kind === 'wall' || (rectIds.get(s.owner) || {}).kind !== 'screen') return null;
    return screens().find(r => {
      const b = box(r.rect), gap = s.kind === 'floor' ? b.y0 - s.at : s.at - b.y1;
      return r.id !== s.owner && gap >= 0 && gap <= limit && x >= b.x0 && x <= b.x1;
    }) || null;
  }
  /* A dead zone: within the desktop's bounds, off every monitor, and nothing to land on. */
  function lost(p: Point) {
    if (!bbox || p.x <= bbox.x0 || p.x >= bbox.x1 || p.y <= bbox.y0 || p.y >= bbox.y1) return false;
    if (pieces.some(q => p.x >= q.x0 && p.x <= q.x1 && p.y >= q.y0 && p.y <= q.y1)) return false;
    return !floorBelow(p);
  }

  set(rects);
  return { set, rects: () => list, screens, surfaces: () => surfaces, rectById, surfaceById, pointOn, covered, hidden, behind, open, crowded, near, sweep, past, contact, home, nearest, primary, ceilingAbove, floorBelow, across, holds, lost };
}
