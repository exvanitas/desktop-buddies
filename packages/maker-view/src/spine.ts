/* The list of sheets down the side. It never shows a total: nothing counts toward 42. */
import { button, h } from '@buddies/peel/dom';
import type { Page, View } from './context';
import { MOMENTS } from './moments';

export function createSpine(v: View) {
  const item = (id: Page, words: string) => button(words, () => v.open(id), { 'data-s': String(id) });
  const el = h('nav', { class: 'spine', 'aria-label': 'Sheets' },
    h('div', { class: 'sheets' },
      item('all', 'Everything'), item('words', 'All words'), h('hr'),
      ...MOMENTS.map((m, i) => item(i + 1, m.t)), h('hr'),
      item('kit', 'Prompt kit'), item('look', 'Look')),
    h('div', { class: 'foot' },
      h('small', {}, 'Drop images anywhere. walk_1.png finds Walk.'),
      button('Upload images', () => v.pickers.open('generated'), { class: 'btn sm', 'data-upload': true }),
      button('Match sizes', () => void v.busy(() => v.maker.matchSizes()), { class: 'btn sm', 'data-match': true })));
  return {
    el,
    update() {
      for (const b of el.querySelectorAll<HTMLElement>('[data-s]')) {
        const on = b.dataset.s === String(v.now.page);
        b.classList.toggle('on', on);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      }
    }
  };
}
