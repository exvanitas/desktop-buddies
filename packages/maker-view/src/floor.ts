/* Her own lift in a preview, placed the way the engine places her: away from what she's on, by that
   surface's lift as a share of her size. Which value each surface takes is the engine's list. */
import type { Lift } from '@buddies/buddy-file';
import { LIFT_FROM } from '@buddies/engine';
import type { MakerBuddy } from '@buddies/maker-core';
import type { ArtBox, Showing } from './art';
import type { Surface } from './facts';

const KIND: Partial<Record<Surface, keyof typeof LIFT_FROM>> = { floor: 'floor', along: 'floor', ledge: 'floor', wall: 'wall', ceiling: 'ceil' };

/* A surface's lift in px, on this drawing of art at this scale. */
export const liftAt = (p: Pick<MakerBuddy, 'lift'>, from: keyof Lift, box: ArtBox, scale: number) => (p.lift?.[from] || 0) * box.side / scale;

/* Moves drawn art off its surface. A wall preview has its wall on the left. */
export function standOff(el: HTMLElement, p: Pick<MakerBuddy, 'lift'>, surface: Surface, box: ArtBox, scale: number) {
  const kind = KIND[surface], px = kind ? Math.round(liftAt(p, LIFT_FROM[kind], box, scale) * 10) / 10 : 0;
  el.style.translate = !px ? '' : kind === 'wall' ? `${px}px 0px` : kind === 'ceil' ? `0px ${px}px` : `0px ${-px}px`;
}

/* A wall preview has its wall on her left, and the engine draws pose art there facing it, so art
   facing right is mirrored. The main image turned onto the wall isn't. */
export function faceWall(el: HTMLElement, p: Pick<MakerBuddy, 'faces'>, surface: Surface, s: Pick<Showing, 'kind'>) {
  el.style.scale = surface === 'wall' && s.kind !== 'turn' && (p.faces || 'right') === 'right' ? '-1 1' : '';
}

/* Signed px, as the sliders say it. */
export const signed = (px: number) => `${px > 0 ? '+' : ''}${px} px`;
