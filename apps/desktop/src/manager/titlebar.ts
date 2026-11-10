/* The window's own bar. The exe draws no frame here, so this drags the window. */
import { button, h } from '@buddies/peel/dom';
import { DRAG, windowControls } from '@buddies/peel/window';

export interface BarIO { find: HTMLElement; importIt(anchor: HTMLElement): void; newBuddy(): void; minimize(): void; close(): void }

export function createTitlebar(io: BarIO) {
  const title = h('h1', { ...DRAG, class: 'title' }, 'Desktop Buddies');
  const importIt: HTMLButtonElement = button('Import', () => io.importIt(importIt), { class: 'btn' });
  const make = button('New buddy', io.newBuddy, { class: 'btn go' });
  const el = h('header', { ...DRAG, class: 'bar' }, title, io.find, h('span', { ...DRAG, class: 'grow' }), importIt, make,
    windowControls(io));
  return {
    el, importIt,
    update(o: { ready: boolean; maker: boolean; finding: boolean; importing: boolean }) {
      title.hidden = o.finding;
      importIt.disabled = !o.ready || o.importing;
      importIt.textContent = o.importing ? 'Importing' : 'Import';
      make.hidden = !o.maker;
      make.disabled = !o.ready;
    }
  };
}
