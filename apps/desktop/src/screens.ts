/* Monitors as the world sees them. The exe's `i` is a position in today's list, and unplugging one
   shifts the rest, so each monitor gets a number of its own that lasts the whole run. */
import type { Area } from './host';
import type { Monitor, Rect } from './shell';

export function createScreens() {
  const numbers = new Map<string, number>();
  let next = 0;
  const number = (m: Monitor) => {
    const key = m.name || 'monitor ' + m.i;
    if (!numbers.has(key)) numbers.set(key, next++);
    return numbers.get(key)!;
  };
  return { areas: (list: Monitor[]): Area[] => list.map(m => ({ i: number(m), x: m.x, y: m.y, w: m.w, h: m.h, scale: m.scale, full: { x: m.full.x, y: m.full.y, w: m.full.w, h: m.full.h } })) };
}

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
/* A taskbar that moves or hides can change only the work area or only the full bounds. Either is a new
   place: the overlay's window comes from both. */
const same = (a: Area, b: Area) => sameRect(a, b) && sameRect(a.full, b.full) && a.scale === b.scale;

/* What has to happen to the overlays to get from one list to the next. */
export function changes(before: Area[], after: Area[]) {
  const was = new Map(before.map(a => [a.i, a])), now = new Set(after.map(a => a.i));
  return {
    open: after.filter(a => !was.has(a.i)),
    close: before.filter(a => !now.has(a.i)),
    place: after.filter(a => was.has(a.i) && !same(was.get(a.i)!, a))
  };
}
