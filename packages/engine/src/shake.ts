/* A hard shake, told from the way a hand moves. Pure: points in, and true once it's a shake.

   A stroke starts at a point and runs to the farthest point the hand reaches from it. It ends there
   once the hand has come back toward its start by `back` of that distance and by `near` px or more,
   so jitter on the way never ends one, however sharp. The next stroke starts where it ended.
   A turn joins two strokes that are both quick and straight, and that point more than `turn` degrees
   apart. Any other stroke starts the count again. `turns` turns within `ms` is a shake.
   Quick: at least `leg` px from start to farthest point, at `speed` px a frame or more, both times her
   scale. A throw counts from 4 px a frame, so every stroke beats a throw, and 40 px is a third of her
   at the usual size.
   Straight: the hand's path to the farthest point is at most `straight` times that distance. A shake
   with rounded ends is about 1.0, a half circle about 1.57, and a corner of a square 1.41. 1.2 leaves
   out a circle however it's sampled: from six points a lap up a half lap is 1.5 or more, and five
   points a lap make strokes two sides long at 1.24.
   135 degrees lets a shake drift or bob as it goes, about 150 between strokes, and keeps out a
   zigzag's 120 and a square's 90.
   `ms`: four turns at three a second take a second, so 1200 is "about a second" for them, and
   turns over 400 ms apart, long sweeps, never get there. */
export const SHAKE = { turns: 4, ms: 1200, leg: 40, speed: 6, back: .25, near: 10, straight: 1.2, turn: 135 };
const TURN = Math.cos(SHAKE.turn * Math.PI / 180), FRAME = 16.667;

interface Point { x: number; y: number; t: number }
/* where this stroke began, the farthest point from there so far, how far that is, the hand's path to
   it, and the hand's path in all */
interface Stroke { from: Point; far: Point; reach: number; toFar: number; path: number }
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const stroke = (from: Point, at: Point, path: number): Stroke => ({ from, far: at, reach: dist(at, from), toFar: path, path });

export function shakeTracker() {
  let last: Point | null = null, now: Stroke | null = null, turns: number[] = [];
  let before: { x: number; y: number; counts: boolean } | null = null;

  /* A stroke has ended at its farthest point. True when that makes it a shake. */
  function ended(s: Stroke, k: number) {
    const way = { x: s.far.x - s.from.x, y: s.far.y - s.from.y };
    const counts = s.reach >= SHAKE.leg * k && s.reach / Math.max(1, (s.far.t - s.from.t) / FRAME) >= SHAKE.speed * k && s.toFar <= SHAKE.straight * s.reach;
    const b = before; before = { ...way, counts };
    const back = b ? (b.x * way.x + b.y * way.y) / (Math.hypot(b.x, b.y) * s.reach) : 1;
    if (!counts || !b || !b.counts || back >= TURN) { turns = []; return false; }
    const at = s.from.t;
    turns = turns.filter(u => at - u < SHAKE.ms).concat(at);
    if (turns.length < SHAKE.turns) return false;
    turns = [];
    return true;
  }

  return {
    /* the hand is at x, y at time t, in ms, with her scale k there */
    move(x: number, y: number, t: number, k: number) {
      const p = { x, y, t };
      if (!last || !now) { last = p; now = stroke(p, p, 0); return false; }
      const s = now;
      s.path += dist(p, last); last = p;
      const d = dist(p, s.from);
      if (d > s.reach) { s.far = p; s.reach = d; s.toFar = s.path; return false; }
      if (s.reach - d < Math.max(SHAKE.back * s.reach, SHAKE.near * k)) return false;
      const hit = ended(s, k), since = s.path - s.toFar;
      now = stroke(s.far, p, since);
      return hit;
    }
  };
}
export type ShakeTracker = ReturnType<typeof shakeTracker>;
