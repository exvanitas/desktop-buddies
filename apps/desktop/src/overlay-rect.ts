/* An overlay's window: its monitor less one line of pixels. A visible, borderless, always-on-top
   window exactly covering a monitor is a full-screen app to Windows, and the taskbar on that monitor
   then drops out of the always-on-top layer. The line comes off the edge across from the taskbar, so
   the window still covers the taskbar's whole strip. The taskbar is on the side where the work area
   falls short of the screen, the most short if more than one. With none to tell (hidden, or no
   taskbar), the line comes off the top. Physical pixels, for the monitor list's work area and `full`.
   Opening, placing, drawing and hit testing all start from this rect. */
import type { Rect } from './shell';

export function overlayRect(a: Rect & { full: Rect }): Rect {
  const f = a.full, { x, y, w, h } = f;
  const short = { bottom: y + h - (a.y + a.h), top: a.y - y, left: a.x - x, right: x + w - (a.x + a.w) };
  /* ties go to the first: bottom, top, left, right */
  const side = (Object.keys(short) as (keyof typeof short)[]).reduce<keyof typeof short | null>((s, k) => short[k] > (s ? short[s] : 0) ? k : s, null);
  return side === 'top' ? { x, y, w, h: h - 1 }
    : side === 'left' ? { x, y, w: w - 1, h }
    : side === 'right' ? { x: x + 1, y, w: w - 1, h }
    : { x, y: y + 1, w, h: h - 1 }; /* a taskbar at the bottom, or none to tell */
}
