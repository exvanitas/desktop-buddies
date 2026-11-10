import type { Rectangle } from '../src/terrain';

export const screen = (id: string, x: number, y: number, w: number, h: number, scale = 1, more?: Partial<Rectangle>): Rectangle => Object.assign({ id, kind: 'screen' as const, rect: { x, y, w, h }, z: 0, terrain: true, scale }, more);
export const windowRect = (id: string, x: number, y: number, w: number, h: number, z = 1, more?: Partial<Rectangle>): Rectangle => Object.assign({ id, kind: 'window' as const, rect: { x, y, w, h }, z, terrain: true, scale: 1 }, more);
/* the owner's desk: 3440x1440 at 100% over 1920x1080 at 150%, taskbars taken off */
export const DESK = () => [screen('top', 0, 0, 3440, 1392, 1), screen('low', 720, 1440, 1920, 1008, 1.5)];
