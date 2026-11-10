/* A monitor with no taskbar, or one set to hide: its work area is the whole screen. */
import type { Area } from '../src/host';

export const whole = (a: Omit<Area, 'full'>): Area => ({ ...a, full: { x: a.x, y: a.y, w: a.w, h: a.h } });
