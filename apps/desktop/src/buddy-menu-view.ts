/* The right-click menu's page: her actions, from the same list as the Manager's ••• menu, drawn when
   the hub says whose. It never shows or hides its own window: it says how big the menu is, the one
   choice made in it, and when it should close (Esc, the window losing the focus, which is a click
   anywhere else, or Alt+F4), and the hub does each in its turn. */
import { h } from '@buddies/peel/dom';
import { menuOf } from '@buddies/peel/menu';
import { readTheme, showTheme, type Store } from '@buddies/peel/theme';
import type { BuddyRow, Command, Said } from './manager-api';
import { buddyItems, confirmOf } from './manager/menu';
import type { Wire } from './wire';

/* CSS pixels of clear window around the menu, for its shadow, and the space between her and it */
export const MARGIN = 10;

export interface MenuViewIO {
  /* the menu's own channel, which carries nothing else */
  wire: Wire<Said>;
  /* this window's own: the hub speaks to it by name, and it signs what it says */
  label: string;
  store: Store;
  /* performance.timeOrigin plus now, which every page of the app shares */
  stamp(): number;
  /* whether this window has the keyboard: document.hasFocus() */
  focused(): boolean;
}

export function mountMenu(root: HTMLElement, io: MenuViewIO) {
  const { wire, label } = io;
  /* the showing on screen, whether it can still be chosen from or closed, what takes the focus in
     it, and the room there is for it */
  let n = 0, open = false, first: () => HTMLElement | null = () => null, max = { w: 0, h: 0 };
  const win = h('div', { class: 'menu-win' });
  root.replaceChildren(win);

  function close(why: string) {
    if (!open) return;
    open = false;
    wire.post({ k: 'menu-closed', n, why });
  }
  /* One choice per showing: after it, or after a close, nothing more is asked. */
  const then = (cmd: Command) => () => {
    if (!open) return;
    open = false;
    wire.post({ k: 'menu-choose', n, label, cmd });
  };
  /* In the room there is, scrolling inside it if it must, with the focus on its first item whenever
     the window's own focus comes. Then how big it is with its margin, for the hub to place. */
  function put(el: HTMLElement, focus: () => HTMLElement | null) {
    el.style.maxWidth = `${max.w - 2 * MARGIN}px`;
    el.style.maxHeight = `${max.h - 2 * MARGIN}px`;
    win.replaceChildren(el);
    first = focus;
    first()?.focus();
    const r = el.getBoundingClientRect();
    wire.post({ k: 'menu-ready', n, label, w: Math.ceil(r.width) + 2 * MARGIN, h: Math.ceil(r.height) + 2 * MARGIN });
  }
  function show(b: BuddyRow, maker: boolean) {
    showTheme(readTheme(io.store));
    const id = b.id;
    const menu = menuOf(buddyItems(b, maker, {
      bringHere: then({ k: 'bring', id }),
      treat: then({ k: 'act', id, action: 'eat' }),
      chase: then({ k: 'act', id, action: 'chase' }),
      another: then({ k: 'another', id }),
      dismissOne: then({ k: 'dismiss-one', id }),
      dismiss: then({ k: 'dismiss', id }),
      edit: then({ k: 'maker', id }),
      exportIt: then({ k: 'export', id }),
      /* Asks first, in this window, about only the her it named, as the Manager does. */
      remove: () => {
        if (!open) return;
        const { el, stay } = confirmOf(b, () => close('cancel'), then({ k: 'delete', id, rev: b.rev }));
        put(el, () => stay);
      }
    }, 'desktop'), b.name);
    put(menu, () => menu.querySelector('button'));
  }

  wire.listen(m => {
    if (m.k === 'menu-ping' && m.label === label) wire.post({ k: 'menu-up', label });
    else if (m.k === 'menu-show' && m.label === label) { n = m.n; open = true; max = m.max; show(m.row, m.maker); }
    else if (m.k === 'menu-hide' && m.n === n) open = false;
    /* The hub counts it shown only once this page says it has the keyboard: now, or when it comes. */
    else if (m.k === 'menu-check' && m.label === label && m.n === n && open && io.focused()) focused();
  });
  function focused() {
    first()?.focus();
    wire.post({ k: 'menu-focused', n, label, t: io.stamp() });
  }
  addEventListener('focus', () => { if (open) focused(); });
  addEventListener('blur', () => close('blur'));
  addEventListener('keydown', e => { if (e.key === 'Escape' && open) { e.preventDefault(); close('esc'); } });
  wire.post({ k: 'menu-up', label });
  return { close };
}
