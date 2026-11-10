/* The sheet: everyone in the hub's order, and what it shows when there's nobody to show. Each
   sticker stays in the page across updates, so art never reloads and a call can animate. */
import type { BuddyRow } from '../manager-api';
import { button, h } from '@buddies/peel/dom';
import { matches } from './find';
import { createSticker, type Sticker, type StickerIO } from './sticker';

const DROP = 'Drop a .buddy file or a Shimeji folder';

export interface SheetView { buddies: BuddyRow[]; query: string; ready: boolean; maker: boolean }
export interface SheetIO extends StickerIO { importIt(anchor: HTMLElement): void; newBuddy(): void; clearFind(): void }

export function createSheet(io: SheetIO, ...top: HTMLElement[]) {
  const stickers = new Map<string, Sticker>(), list = h('div', { class: 'list' });
  const drop = h('div', { class: 'dropit' }, DROP);
  const none = h('p', { class: 'none' }, h('span', {}), button('Clear', io.clearFind, { class: 'btn sm' }));
  const importIt: HTMLButtonElement = button('Import', () => io.importIt(importIt), { class: 'btn go' });
  const make = button('New buddy', io.newBuddy, { class: 'btn' });
  const welcome = h('div', { class: 'welcome' }, h('h2', {}, 'No buddies yet'), h('p', {}, `${DROP} here.`), h('div', { class: 'row' }, importIt, make));
  const waiting = h('p', { class: 'waiting', role: 'status' }, 'Getting ready');
  const wrap = h('div', { class: 'wrap' }, ...top, waiting, welcome, list, none);
  const el = h('main', { class: 'sheet' }, wrap);

  function order(rows: BuddyRow[]) {
    for (const [id, st] of stickers) if (!rows.some(b => b.id === id)) { st.el.remove(); stickers.delete(id); }
    let at = list.firstChild;
    for (const b of rows) {
      const node = stickers.get(b.id)!.el;
      if (node === at) at = at.nextSibling; else list.insertBefore(node, at);
    }
    if (at !== drop) list.append(drop);
  }

  return {
    el,
    /* Her sticker into view, with the keyboard on it. */
    reveal(id: string) {
      const st = stickers.get(id);
      if (!st || st.el.hidden) return;
      st.el.scrollIntoView?.({ block: 'nearest' });
      st.el.querySelector<HTMLElement>('.acts .btn')?.focus();
    },
    update(v: SheetView) {
      const only = v.buddies.length === 1;
      for (const b of v.buddies) if (!stickers.has(b.id)) stickers.set(b.id, createSticker(b, io));
      order(v.buddies);
      let found = 0;
      for (const b of v.buddies) {
        const st = stickers.get(b.id)!, show = !v.query || matches(b, v.query);
        st.el.hidden = !show;
        if (show) found++;
        st.update(b, { only, ready: v.ready });
      }
      const empty = !v.buddies.length;
      waiting.hidden = v.ready;
      welcome.hidden = !v.ready || !empty;
      list.hidden = empty;
      drop.hidden = !!v.query || !v.ready;
      none.hidden = !v.query || found > 0;
      none.firstElementChild!.textContent = `No one called "${v.query.trim()}"`;
      make.hidden = !v.maker;
      wrap.classList.toggle('only', only);
    }
  };
}
