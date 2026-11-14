/* The window's own bar: who this is, whether it's safe, and the ways out. On the web the browser has its
   own bar, so there's nothing to drag and no window buttons. */
import { SAMPLES } from '@buddies/maker-core';
import { button, h } from '@buddies/peel/dom';
import { DRAG, windowControls } from '@buddies/peel/window';
import { mainSlot } from './art';
import type { View } from './context';
import { drawArt } from './draw-art';
import { SHIMEJI_TIP } from './pickers';

export function createBar(v: Pick<View, 'maker' | 'host' | 'popover' | 'pickers' | 'busy'>, chip: HTMLElement, working: HTMLElement) {
  const { maker, host } = v, drag = host.window ? DRAG : {};
  const face = h('span', { class: 'face' }), name = h('h1', { ...drag, dir: 'auto' });

  function buddies() {
    const pets = maker.state.pets;
    const panel = h('div', { class: 'buddies', role: 'dialog', 'aria-label': 'Buddies' },
      pets.length > 1 ? h('div', { class: 'in-window' }, h('h3', {}, 'In this window'),
        ...pets.map(p => button(p.name || 'No name', () => { v.popover.close(); maker.select(p.id); }, { class: 'pick', dir: 'auto', title: p.name || null, 'aria-current': String(p.id === maker.selected), 'data-buddy': p.id }))) : null,
      h('h3', {}, 'Add a buddy'),
      button('From an image', () => { v.popover.close(); v.pickers.open('buddies'); }, { class: 'pick', 'data-add-from': 'image' }),
      button('Import buddy file', () => { v.popover.close(); v.pickers.open('buddyFile'); }, { class: 'pick', 'data-add-from': 'buddy' }),
      button('Import Shimeji images', () => { v.popover.close(); v.pickers.open('shimeji'); }, { class: 'pick', 'data-add-from': 'shimeji' }),
      h('p', { class: 'pick-tip' }, SHIMEJI_TIP),
      h('h3', {}, 'Samples'),
      h('div', { class: 'first-samples tiny' }, ...SAMPLES.map(d => {
        const img = h('img', { alt: '', draggable: 'false' });
        img.src = maker.thumb(d.kind);
        return button([img, h('b', {}, d.name)], () => { v.popover.close(); void v.busy(() => maker.addSample(d.kind)); }, { class: 'sample', title: d.note ? `${d.name}, ${d.note}` : d.name, 'data-sample': d.kind });
      })));
    v.popover.show(panel, who);
  }
  const who: HTMLButtonElement = button([face, name, h('span', { class: 'caret', 'aria-hidden': 'true' }, '▾')], () => {
    if (v.popover.anchor === who) v.popover.close(); else buddies();
  }, { class: 'who', 'aria-label': 'Buddies', 'data-who': true });

  const save = button('Save buddy file', () => { const id = maker.selected; if (id) host.saveBuddyFile(id); }, { class: 'btn go', 'data-save-file': true });
  const page = host.exportPage ? button('Export desktop page', () => host.exportPage!(), { class: 'btn', 'data-export': true }) : null;
  const newBuddy = h('h1', { ...drag, class: 'fresh' }, 'New buddy');

  const el = h('header', { ...drag, class: 'bar' },
    who, newBuddy, h('span', { ...drag, class: 'grow' }), working, chip, page, save,
    host.window ? windowControls(host.window) : null);

  return {
    el,
    update() {
      const p = maker.current();
      who.hidden = !p; save.hidden = !p; chip.hidden = !p; newBuddy.hidden = !!p;
      if (page) page.hidden = !p;
      if (!p) return;
      name.textContent = p.name || 'No name'; name.title = p.name || '';
      const a = drawArt(mainSlot(p));
      a.size(30, 44);
      face.replaceChildren(a.el);
    }
  };
}
