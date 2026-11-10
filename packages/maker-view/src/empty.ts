/* New buddy, with no buddy yet. One picture is all it takes, and nothing exists until there is one. The
   dotted line is the one a sticker leaves, here saying where this one will go. */
import { SAMPLES, type Maker } from '@buddies/maker-core';
import { button, h, s } from '@buddies/peel/dom';
import type { Pickers } from './pickers';

export function createEmpty(maker: Maker, pickers: Pickers, busy: <T>(work: () => Promise<T>) => Promise<T | undefined>) {
  const samples = h('div', { class: 'first-samples' });
  const el = h('main', { class: 'first' },
    h('div', { class: 'first-spot' },
      s('svg', { class: 'first-line', viewBox: '0 0 200 200', 'aria-hidden': 'true' }, s('path', { d: 'M100 12c52 0 88 34 88 86 0 58-38 90-88 90s-88-32-88-90c0-52 36-86 88-86z' })),
      h('div', { class: 'first-in' },
        h('h2', {}, "Who's your buddy?"),
        h('p', {}, 'Drop a picture here. One is all it takes.'),
        button('Pick an image', () => pickers.open('buddies'), { class: 'btn go', 'data-first': 'pick' }))),
    h('div', { class: 'first-more' },
      h('h3', {}, 'Or start from a sample'),
      samples,
      h('h3', {}, 'Already have one?'),
      h('div', { class: 'row' },
        button('Import buddy file', () => pickers.open('buddyFile'), { class: 'btn sm', 'data-first': 'buddy' }),
        button('Import Shimeji folder', () => pickers.open('shimeji'), { class: 'btn sm', 'data-first': 'shimeji' })),
      h('p', { class: 'first-tip' }, 'You can paste a picture too.')));
  let filled = false;
  return {
    el,
    /* Samples are drawn in code, so only when someone is here to see them. */
    show() {
      if (filled) return;
      filled = true;
      samples.replaceChildren(...SAMPLES.map(d => {
        const img = h('img', { alt: '', draggable: 'false', class: 'cut' });
        img.src = maker.thumb(d.kind);
        return button([img, h('b', {}, d.name)], () => void busy(() => maker.addSample(d.kind)), { class: 'sample', 'data-sample': d.kind });
      }));
    }
  };
}
