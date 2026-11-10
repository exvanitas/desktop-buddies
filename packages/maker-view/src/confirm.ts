/* Asks before something an evening's work could go with. Cancel is the big, focused button, and Escape,
   a click away or a scroll all mean Cancel too. Arguments for popover.show. */
import { button, h } from '@buddies/peel/dom';
import type { View } from './context';

export function confirmOf(title: string, says: string, yesWords: string, yes: () => void, v: Pick<View, 'popover'>, anchor: HTMLElement): [HTMLElement, HTMLElement, () => void, HTMLElement] {
  const stay = button('Cancel', () => v.popover.close(), { class: 'btn sm go' });
  const el = h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': title },
    h('h2', { dir: 'auto' }, title),
    h('p', {}, says),
    h('div', { class: 'row' }, stay, button(yesWords, () => { v.popover.close(); yes(); }, { class: 'btn sm bad' })));
  return [el, anchor, () => {}, stay];
}
