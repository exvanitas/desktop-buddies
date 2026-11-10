/* What Close looks like: a modal dialog, which makes the rest of the page inert by itself, and holds
   nothing but buttons. Inert stops clicks and keys, not what reaches a page from outside, so while
   it's up every drag, drop, paste, input and change is refused, wherever it lands, the dialog
   included. It's up while it's in the page. It shows nothing for the first moment, so a quick close
   doesn't flash. */
import { button, h } from '@buddies/peel/dom';
import { misprintOf } from '@buddies/peel/misprint';
import type { ClosingUI } from './maker-close';

const FROM_OUTSIDE = ['dragenter', 'dragover', 'drop', 'paste', 'change', 'input'];

export function closingDialog(): ClosingUI {
  const box = h('dialog', { class: 'closing', 'aria-label': 'Closing the Maker' }) as HTMLDialogElement;
  const refuse = (e: Event) => { if (box.isConnected) { e.preventDefault(); e.stopImmediatePropagation(); } };
  for (const type of FROM_OUTSIDE) addEventListener(type, refuse, { capture: true });
  /* Escape would close it. A second Escape can't be refused, so it just comes straight back. */
  box.addEventListener('cancel', e => e.preventDefault());
  box.addEventListener('close', () => { if (box.isConnected) box.showModal(); });
  return {
    show() {
      box.replaceChildren(h('p', { class: 'closing-word', role: 'status' }, 'Saving before it closes'));
      document.body.append(box);
      box.showModal();
    },
    ask(what, actions) {
      box.replaceChildren(misprintOf(what, { 'data-closing': 'true' }, ...actions.map((a, i) => button(a.label, () => a.run(), { class: `btn sm${i ? '' : ' go'}` }))));
    },
    hide() {
      /* Out of the page first, so the close this fires doesn't bring it back. */
      box.remove();
      box.close();
    }
  };
}
