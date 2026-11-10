/* The spot a sticker leaves, drawn from a baked outline: its pad, then its dots. One line per buddy. */
import { DOT, dotsOn, pathOf, type Outline } from '@buddies/art/outline';
import { s } from '@buddies/peel/dom';

export function cutline(o: Outline, width: number) {
  const k = width / o.w, height = Math.round(o.h * k);
  const svg = s('svg', { class: 'cutline', viewBox: `0 0 ${o.w} ${o.h}`, width, height, 'aria-hidden': 'true', 'data-line': o.shape });
  for (const l of o.loops) {
    const d = pathOf(l);
    svg.append(s('path', { class: 'cut-pad', d }), s('path', { class: 'cut-dots', d, 'stroke-width': +(DOT / k).toFixed(2), pathLength: dotsOn(l, k) }));
  }
  return svg;
}
