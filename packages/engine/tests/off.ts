/* How far off a set of monitors a turned box reaches: the furthest any point of it is past the
   edges of the nearest monitor, measured along whichever axis it's furthest past. With one monitor,
   or with the box's corners all on one, its corners say it exactly: each is convex. Where monitors
   meet, a point between two corners can be off both while the corners aren't (a box turned over a
   step), so each edge is measured every pixel, and a grid inside for any hole between monitors.
   Every point counts 1 px a px moved, so the most it can miss is half a pixel. No engine code here,
   so a mocked ease can use it too. */
type Pt = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
const past = (p: Pt, r: Rect) => Math.max(0, r.x - p.x, p.x - r.x - r.w, r.y - p.y, p.y - r.y - r.h);
const away = (p: Pt, rs: Rect[]) => Math.min(...rs.map(r => past(p, r)));

/* `pts`: the box's corners in order round it */
export function offAll(pts: Pt[], rs: Rect[]) {
  if (!rs.length) return 0;
  let worst = Math.max(...pts.map(p => away(p, rs)));
  if (rs.length === 1 || rs.some(r => pts.every(p => past(p, r) === 0))) return worst;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!, n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let k = 1; k < n; k++) worst = Math.max(worst, away({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n }, rs));
  }
  const [o, u, , v] = [pts[0]!, pts[1]!, pts[2]!, pts[3]!];
  for (let i = 1; i < 8; i++) for (let j = 1; j < 8; j++) worst = Math.max(worst, away({ x: o.x + (u.x - o.x) * i / 8 + (v.x - o.x) * j / 8, y: o.y + (u.y - o.y) * i / 8 + (v.y - o.y) * j / 8 }, rs));
  return worst;
}
/* the corners of a box this size, turned this far, with its middle at m */
export function boxAt(m: Pt, rot: number, z: { w: number; h: number }): Pt[] {
  const r = rot * Math.PI / 180, u = { x: Math.sin(r) * z.h / 2, y: -Math.cos(r) * z.h / 2 }, v = { x: Math.cos(r) * z.w / 2, y: Math.sin(r) * z.w / 2 };
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([i, j]) => ({ x: m.x + i! * u.x + j! * v.x, y: m.y + i! * u.y + j! * v.y }));
}
