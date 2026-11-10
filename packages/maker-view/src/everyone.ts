/* Settings about every buddy, for a host with no other home for them: the plain web page has no Manager.
   Pass it as worldSettings. In the app these belong to the Manager, so the app leaves it out, and with it
   the only way to remove a buddy from here. */
import { ALL, type Maker } from '@buddies/maker-core';
import { button, h } from '@buddies/peel/dom';

const LEVELS = ['off', 'low', 'normal', 'high'] as const;

export function everyoneSettings(maker: Maker) {
  return (box: HTMLElement) => {
    const s = maker.state;
    const flip = (words: string, on: boolean, f: () => void) => button([h('i'), words], f, { class: 'tg', role: 'switch', 'aria-checked': String(on), 'data-k': `everyone-${words}` });
    box.replaceChildren(
      h('h3', {}, 'Every buddy on this page'),
      h('div', { class: 'row left' }, flip('Speech bubbles', s.bubbles !== false, () => maker.toggleBubbles()), flip('Name tags', s.names !== false, () => maker.toggleNames())),
      h('div', { class: 'fld' }, h('span', {}, 'Chattiness'),
        h('div', { class: 'choice', role: 'radiogroup', 'aria-label': 'Chattiness' },
          ...LEVELS.map(l => button(l[0]!.toUpperCase() + l.slice(1), () => maker.setChatter(l), { role: 'radio', 'aria-checked': String((s.chatter || 'normal') === l), 'data-k': `chatter-${l}` })))),
      h('div', { class: 'row left wrap' }, ...ALL.filter(([a]) => maker.canAnyAct(a)).map(([a, words]) => button(words, () => maker.actAll(a), { class: 'btn sm', 'data-k': `all-${a}` }))),
      h('div', { class: 'row left' }, button('Remove this buddy from the page', () => maker.remove(), { class: 'btn sm', 'data-remove': 'true', 'data-k': 'remove' })));
  };
}
