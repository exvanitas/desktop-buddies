/* The one movement in the Manager. Call lifts the sticker and the dotted line draws in behind it.
   Dismiss runs it back. With reduced motion, nothing moves and everything lands at once. */
import { s } from '@buddies/peel/dom';

const MS = 260, EASE = 'cubic-bezier(.3, .7, .3, 1)';
const AWAY = 'translateY(-30px) rotate(-5deg) scale(1.05)';
let masks = 0;

export interface Peel {
  /* The sticker that's just left: this image is now its ghost. */
  lift(ghost: HTMLImageElement): void;
  /* Draws a line in, or takes it away and calls `done`. */
  drawIn(line: SVGSVGElement): void;
  rubOut(line: SVGSVGElement, done: () => void): void;
  /* The sticker coming back to its spot. */
  land(img: HTMLImageElement): void;
}

/* The dots show through a mask that a single stroke opens along the line. */
function reveal(line: SVGSVGElement, from: number, to: number) {
  const box = line.viewBox.baseVal, cleanups: (() => void)[] = [], runs: Animation[] = [];
  for (const dots of line.querySelectorAll<SVGPathElement>('.cut-dots')) {
    const id = `peel-${++masks}`, wide = Number(dots.getAttribute('stroke-width')) * 4;
    const stroke = s('path', { d: dots.getAttribute('d'), fill: 'none', stroke: '#fff', 'stroke-width': wide, pathLength: 1, 'stroke-dasharray': '1 1' });
    const mask = s('mask', { id, maskUnits: 'userSpaceOnUse', x: -box.width, y: -box.height, width: box.width * 3, height: box.height * 3 }, stroke);
    line.append(mask);
    dots.setAttribute('mask', `url(#${id})`);
    runs.push(stroke.animate([{ strokeDashoffset: from }, { strokeDashoffset: to }], { duration: MS, easing: EASE, fill: 'both' }));
    cleanups.push(() => { dots.removeAttribute('mask'); mask.remove(); });
  }
  for (const pad of line.querySelectorAll('.cut-pad')) runs.push(pad.animate([{ opacity: from ? 0 : 1 }, { opacity: from ? 1 : 0 }], { duration: MS, easing: EASE, fill: 'both' }));
  return Promise.all(runs.map(r => r.finished)).then(() => { for (const c of cleanups) c(); return runs; }, () => runs);
}

export function createPeel(moves: () => boolean): Peel {
  return {
    lift(ghost) {
      if (!moves()) return;
      const sticker = ghost.cloneNode() as HTMLImageElement;
      sticker.className = 'cut fly';
      ghost.after(sticker);
      const gone = () => sticker.remove();
      void sticker.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(-16px) rotate(-3deg) scale(1.03)', opacity: 1, offset: .5 }, { transform: AWAY, opacity: 0 }], { duration: MS, easing: EASE }).finished.then(gone, gone);
    },
    drawIn(line) { if (moves()) void reveal(line, 1, 0).then(r => { for (const a of r) a.cancel(); }); },
    rubOut(line, done) { if (moves()) void reveal(line, 0, 1).then(() => done()); else done(); },
    land(img) { if (moves()) img.animate([{ transform: AWAY, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: MS, easing: EASE }); }
  };
}
