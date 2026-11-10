/* Where the right-click menu goes, worked out here and nowhere else: beside her, on whichever side
   has room, inside the work area of the monitor she was clicked on. Physical pixels on the virtual
   desktop throughout. How overlays are placed doesn't come into it: the exe's monitor list does. */
import type { Monitor, Rect } from './shell';

export interface Work extends Rect { scale: number }
export interface Point { x: number; y: number }

const gap = (p: Point, r: Rect) => Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h)));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/* The work area, taskbar left out, of the monitor the point is on, or of the nearest one. */
export function workAt(list: Monitor[], p: Point): Work | null {
  if (!list.length) return null;
  const m = list.reduce((a, b) => gap(p, b.full) < gap(p, a.full) ? b : a);
  return { x: m.x, y: m.y, w: m.w, h: m.h, scale: m.scale };
}

/* No bigger than the work area: the page scrolls a list too long for it. Then to her right, then her
   left, with its top at the click, then below her and then above her, with its left at the click.
   Each must fit in the work area. With no side free, wherever the work area holds it nearest the
   click, which can only happen to a buddy bigger than most of the screen. */
export function beside(her: Rect, at: Point, work: Rect, size: { w: number; h: number }): Rect {
  const w = Math.min(size.w, work.w), h = Math.min(size.h, work.h), right = work.x + work.w, bottom = work.y + work.h;
  const y = clamp(at.y, work.y, bottom - h), x = clamp(at.x, work.x, right - w);
  const sides: Rect[] = [
    { x: her.x + her.w, y, w, h },
    { x: her.x - w, y, w, h },
    { x, y: her.y + her.h, w, h },
    { x, y: her.y - h, w, h }
  ];
  const fits = (r: Rect) => r.x >= work.x && r.y >= work.y && r.x + r.w <= right && r.y + r.h <= bottom;
  return sides.find(fits) ?? { x: Math.max(work.x, x), y: Math.max(work.y, y), w, h };
}
