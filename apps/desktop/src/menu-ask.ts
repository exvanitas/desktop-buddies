/* An overlay's side of the right-click menu: where she and the click are on screen. The overlay draws
   in CSS pixels from its own window's corner, overlayRect(me), as pointed() in hit.ts reads the
   cursor. This is the one place that turns that into physical pixels on the virtual desktop. */
import type { PetFrame } from '@buddies/engine';
import type { Area } from './host';
import { overlayRect } from './overlay-rect';
import type { Rect } from './shell';

export const pointOnScreen = (me: Area, x: number, y: number) => { const o = overlayRect(me); return { x: Math.round(o.x + x * me.scale), y: Math.round(o.y + y * me.scale) }; };

/* Her image's box, as her body transform turns and moves it about her origin, the way hit.ts reads
   it. Where there's no DOMMatrix to read it with, the box that holds her however she turns. */
export function herOnScreen(f: PetFrame, me: Area): Rect {
  const b = f.box, cx = b.l + b.ox, cy = b.t + b.oy;
  const corners = [[b.l, b.t], [b.l + b.size, b.t], [b.l, b.t + b.size], [b.l + b.size, b.t + b.size]] as const;
  let l = b.l, t = b.t, r = b.l + b.size, d = b.t + b.size;
  if (f.body && typeof DOMMatrix === 'function') {
    const m = new DOMMatrix(f.body), at = corners.map(([x, y]) => m.transformPoint({ x: x - cx, y: y - cy }));
    l = cx + Math.min(...at.map(p => p.x)); r = cx + Math.max(...at.map(p => p.x));
    t = cy + Math.min(...at.map(p => p.y)); d = cy + Math.max(...at.map(p => p.y));
  } else if (f.body) {
    const reach = Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy)));
    l = cx - reach; t = cy - reach; r = cx + reach; d = cy + reach;
  }
  const o = overlayRect(me), x = Math.floor(o.x + l * me.scale), y = Math.floor(o.y + t * me.scale);
  return { x, y, w: Math.ceil(o.x + r * me.scale) - x, h: Math.ceil(o.y + d * me.scale) - y };
}
