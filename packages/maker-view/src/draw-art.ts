/* Art as it will really appear: the picture's content, at its own scale, with no sticker edge. Sizes go
   through CSSOM, because the page's CSP refuses style attributes. */
import { h } from '@buddies/peel/dom';
import { boxOf, type ArtBox, type Showing } from './art';

export interface DrawnArt { el: HTMLElement; img: HTMLImageElement; size(height: number, maxWidth?: number): ArtBox; show(i: number): void; setSlot(s: Showing): void }

export function drawArt(first: Showing, frame = 0): DrawnArt {
  let slot = first;
  const img = h('img', { alt: '', draggable: 'false', decoding: 'async' });
  img.src = slot.frames[Math.min(frame, slot.frames.length - 1)]!.src;
  const el = h('span', { class: 'art' }, img);
  return {
    el, img,
    setSlot(s) { slot = s; },
    size(height, maxWidth) {
      const b = boxOf(slot, height, maxWidth), px = (n: number) => `${Math.round(n * 10) / 10}px`;
      el.style.width = px(b.w); el.style.height = px(b.h);
      img.style.width = img.style.height = px(b.side);
      img.style.left = px(b.left); img.style.top = px(b.top);
      img.style.transformOrigin = `${px(b.originX)} ${px(b.originY)}`;
      img.style.rotate = b.turn ? `${b.turn}deg` : '';
      return b;
    },
    show(i) { const f = slot.frames[i]; if (f && img.getAttribute('src') !== f.src) img.src = f.src; }
  };
}
