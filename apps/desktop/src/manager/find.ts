/* Find, by name. It only shows when there are enough buddies to need it. */
import type { BuddyRow } from '../manager-api';
import { h, s } from '@buddies/peel/dom';

export const FIND_FROM = 10;

const plain = (t: string) => t.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
export const matches = (b: Pick<BuddyRow, 'name'>, query: string) => plain(b.name).includes(plain(query.trim()));

export function createFind(changed: (query: string) => void) {
  const input = h('input', { type: 'search', placeholder: 'Find', 'aria-label': 'Find a buddy', spellcheck: 'false' });
  const el = h('label', { class: 'search' }, s('svg', { viewBox: '0 0 14 14', 'aria-hidden': 'true' }, s('circle', { cx: 6, cy: 6, r: 4.5 }), s('path', { d: 'M9.5 9.5L13 13' })), input);
  const clear = () => { if (input.value) { input.value = ''; changed(''); } };
  input.addEventListener('input', () => changed(input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Escape') clear(); });
  return {
    el, clear,
    update(o: { show: boolean; ready: boolean }) {
      el.hidden = !o.show;
      input.disabled = !o.ready;
      if (!o.show) clear();
    }
  };
}
