/* The board: Everything, All words, a sheet, Prompt kit or Look. A pick only marks what's already
   drawn, so art never reloads and nothing moves under the pointer. */
import type { PoseKey } from '@buddies/buddy-file';
import { canShow } from '@buddies/buddy-file';
import { button, h, type Kid } from '@buddies/peel/dom';
import { captionOf, cellsOf, printed, slotOf, type Cell } from './art';
import { artOf, label, sitOf, stepsOf, silent, usedFor } from './captions';
import { isLine, isPose, keepFocus, keepScroll, sheetOf, type View } from './context';
import { drawArt, type DrawnArt } from './draw-art';
import { fit, startSplit } from './layout';
import { MOMENTS, type Moment } from './moments';
import { createDivider } from './divider';
import { kitPage } from './kit-page';
import { lookPage } from './look-page';
import { bubbleFor, groupOf, markLine, stepOf } from './words';
import { WHEN } from './moments';

const EVERYTHING_H = 60;
const present = <T>(...list: (T | null)[]) => list.filter((x): x is T & {} => x !== null);
interface Drawn { cell: Cell; art: DrawnArt; el: HTMLElement; bub: HTMLElement | null; small: boolean }

export function createBoard(v: View) {
  const el = h('section', { class: 'board' });
  let drawn: Drawn[] = [], sized: () => void = () => {}, sits: Moment['sits'] = [], kit: ReturnType<typeof kitPage> | null = null;

  /* A slider may have changed its scale since it was drawn. */
  const fresh = (d: Drawn) => { const s = slotOf(v.pet(), d.cell.keys[0]!); if (s.kind !== 'none') d.art.setSlot(s); };

  /* One sticker: one artwork, its frames, and the situations that use it. */
  function sticker(c: Cell, small: boolean): Drawn {
    const art = drawArt(c.slot), p = v.pet();
    const bub = small ? null : h('span', { class: 'bub', dir: 'auto', hidden: true });
    const first = c.keys[0]!, uses = small ? 0 : new Set(c.keys.flatMap(k => usedFor(p, k).map(s => s.k))).size;
    if (bub) art.el.append(bub);
    const spot = button(art.el, () => v.pick({ pose: first }), { class: 'spot', 'aria-label': label(first), 'data-art': first, 'data-k': `spot-${first}` });
    const names = c.keys.map(k => button(label(k), () => v.pick({ pose: k }), { class: 'nm', 'data-art': k, 'data-k': `nm-${k}` }));
    const cap = captionOf(c.slot);
    const box = h('div', { class: `c${printed(c.slot) ? ' print' : ''}${c.keys.length > 1 ? ' multi' : ''}`, 'data-keys': c.keys.join(' ') },
      spot, h('span', { class: 'names' }, ...names),
      h('small', {}, cap, uses ? h('br') : null, uses ? `Used for ${uses}` : null));
    return { cell: c, art, el: box, bub, small };
  }

  const head = (title: string, ...extra: Kid[]) => h('header', {},
    h('h2', {}, title), ...extra, h('span', { class: 'grow' }),
    h('span', { class: 'backing' }, 'Backing',
      ...(['light', 'dark'] as const).map(b => button(b === 'light' ? 'Light' : 'Dark', () => v.setBacking(b), { 'aria-pressed': String(v.now.back === b), 'data-b': b, 'data-k': `b-${b}` }))));

  function spare(words: string, keys: PoseKey[]) {
    return keys.length ? h('div', { class: 'spare' }, words, ...keys.map(k => button(label(k), () => v.pick({ pose: k }), { 'data-art': k, 'data-k': `spare-${k}` }))) : null;
  }

  function everything() {
    const p = v.pet(), last = v.now.last;
    const off = MOMENTS.flatMap(m => m.poses.filter(k => !canShow(p, k)));
    const blocks = MOMENTS.flatMap((m, i) => {
      const cs = cellsOf(p, m.poses);
      if (!cs.length) return [];
      const stickers = cs.map(c => sticker(c, true));
      drawn.push(...stickers);
      return [h('div', { class: 'blk' }, button(m.t, () => v.open(i + 1), { class: 'h', 'data-k': `blk-${i}` }), h('div', {}, ...stickers.map(s => s.el)))];
    });
    sits = [];
    sized = () => { for (const d of drawn) { fresh(d); d.art.size(EVERYTHING_H, d.el.classList.contains('multi') ? undefined : 92); } };
    el.replaceChildren(...present(
      head('Everything', last ? button(`Back to ${MOMENTS[last - 1]!.t}`, () => v.open(last), { class: 'btn sm resume', 'data-k': 'resume' }) : null),
      h('div', { class: 'stick all' }, ...blocks),
      spare('Could add:', off)));
  }

  function words() {
    sits = [];
    el.replaceChildren(
      head('All words', button('Write them all at once in Prompt kit', () => v.open('kit'), { class: 'btn sm resume', 'data-k': 'to-kit' })),
      h('div', { class: 'allw' }, ...MOMENTS.map((m, i) => h('section', {},
        button(m.t, () => v.open(i + 1), { class: 'h', 'data-k': `sec-${i}` }),
        h('div', { class: 'grid' }, ...m.sits.map(s => groupOf(v, s)))))));
    sized = () => {};
  }

  /* Art these words point at that lives on another sheet: one small reference each. */
  function refs(m: Moment) {
    const p = v.pet(), seen = new Map<string, { k: PoseKey; keys: PoseKey[]; art: DrawnArt; el?: HTMLElement }>();
    for (const s of m.sits) {
      const k = artOf(p, s);
      if (silent(p, s) || !k || m.poses.includes(k)) continue;
      const slot = slotOf(p, k);
      if (slot.kind === 'none') continue;
      const id = `${slot.from ?? 'main'}:${slot.turn}`, had = seen.get(id);
      if (had) { if (!had.keys.includes(k)) had.keys.push(k); } else seen.set(id, { k, keys: [k], art: drawArt(slot) });
    }
    const home = (k: PoseKey) => MOMENTS.find(x => x.poses.includes(k))!.t;
    return [...seen.values()].map(r => {
      r.art.size(44, 52);
      const main = slotOf(p, r.k).kind === 'main' || slotOf(p, r.k).kind === 'turn';
      return button([r.art.el, h('span', {}, h('b', {}, main ? 'Main image' : label(r.k)), h('small', {}, main ? r.keys.map(label).join(', ') : `On ${home(r.k)}`))],
        () => v.pick({ pose: r.k }), { class: 'ref', 'data-art': r.keys.join(' '), 'data-k': `ref-${r.k}` });
    });
  }

  function strip(m: Moment) {
    const p = v.pet(), sel = v.now.sel, on = isLine(sel) ? sel.sit : null;
    const quiet = m.sits.filter(s => silent(p, s) && on !== s.k), loud = m.sits.filter(s => !quiet.includes(s));
    return h('aside', { class: 'strip' },
      h('h3', { dir: 'auto' }, `What ${p.name || 'this buddy'} says`),
      h('div', { class: 'grid' }, ...loud.map(s => groupOf(v, s))),
      quiet.length ? h('div', { class: 'waiting' }, h('span', {}, 'Waiting for art'), ...quiet.map(s => button(WHEN[s.k], () => v.pick({ sit: s.k, i: 0 }), { 'data-wait': s.k, 'data-k': `wait-${s.k}` }))) : null);
  }

  function sheet(m: Moment, n: number) {
    const p = v.pet(), cs = cellsOf(p, m.poses), off = m.poses.filter(k => !canShow(p, k));
    const rs = refs(m), stickers = cs.map(c => sticker(c, false));
    drawn.push(...stickers);
    sits = m.sits;
    const stick = cs.length ? h('div', { class: 'stick' }, ...stickers.map(s => s.el)) : null;
    const left = h('div', { class: 'page' },
      stick,
      rs.length ? h('div', { class: 'refs' }, h('span', {}, cs.length ? 'Also shown here' : 'Art these words use'), ...rs) : null,
      h('div', { class: 'how' }, h('b', {}, 'How it goes'), h('ul', { class: 'flow' }, ...stepsOf(m.flow).map(t => stepOf(v, t)))),
      spare('Could also:', off));
    const spread = h('div', { class: 'spread' }, left);
    const share = startSplit(cs.length, rs.length, m.sits.filter(s => !silent(p, s)).length);
    const divider = createDivider(v, left, spread, String(n), share, 'Share the width between art and words');
    spread.append(divider, strip(m));
    el.replaceChildren(head(m.t), spread);
    sized = () => {
      if (!stick) return;
      const room = left.clientHeight * (cs.length === 1 ? .52 : .6) - (rs.length ? 90 : 0);
      const f = fit(stick.clientWidth - 14, room, cs.length, cs.length === 1 ? 150 : 170);
      stick.style.setProperty('--cw', `${f.cw}px`); stick.style.setProperty('--h', `${f.H}px`);
      for (const d of drawn) { fresh(d); d.art.size(f.H, f.cw - 8); }
    };
  }

  function mark() {
    const p = v.pet(), sel = v.now.sel, sit = isLine(sel) ? sitOf(sel.sit) : null;
    const pose = isPose(sel) ? sel.pose : null, art = sit ? artOf(p, sit) : null;
    const has = (e: Element, attr: string, k: string | null) => !!k && (e.getAttribute(attr) || '').split(' ').includes(k);
    for (const c of el.querySelectorAll('.c')) {
      c.classList.toggle('on', has(c, 'data-keys', pose));
      c.classList.toggle('linked', has(c, 'data-keys', art));
    }
    for (const n of el.querySelectorAll('.nm, .spare button')) { n.classList.toggle('sel', has(n, 'data-art', pose)); n.classList.toggle('on', has(n, 'data-art', pose)); }
    for (const r of el.querySelectorAll('.ref')) { r.classList.toggle('on', has(r, 'data-art', pose)); r.classList.toggle('linked', has(r, 'data-art', art)); }
    for (const g of el.querySelectorAll<HTMLElement>('.sit')) g.classList.toggle('on', isLine(sel) && g.dataset.g === sel.sit);
    markLine(el, p, sel);
    for (const w of el.querySelectorAll<HTMLElement>('.says .say:not(.add)')) w.classList.toggle('on', isLine(sel) && w.dataset.sit === sel.sit && +w.dataset.i! === sel.i);
    for (const d of drawn) {
      if (!d.bub) continue;
      const b = bubbleFor(p, d.cell.keys, sel, sits);
      d.bub.hidden = !b; d.bub.textContent = b ? b.t : ''; d.bub.classList.toggle('now', !!b?.now);
    }
    seat();
  }

  /* A sticker keeps room above her for one line. A bubble that wraps taller comes down over her
     instead of out of its sticker, where it would cover the row above or be cut off at the top. */
  function seat() {
    for (const d of drawn) if (d.bub) d.bub.style.removeProperty('--drop');
    for (const d of drawn) {
      if (!d.bub || d.bub.hidden) continue;
      const over = d.el.querySelector('.spot')!.getBoundingClientRect().top - d.bub.getBoundingClientRect().top;
      if (over > 0) d.bub.style.setProperty('--drop', `${Math.ceil(over)}px`);
    }
  }

  /* Show the picked group whole, under the sticky title, with nothing left over above it. */
  function reveal() {
    const box = el.querySelector<HTMLElement>('.strip, .allw'), g = box?.querySelector('.sit.on');
    if (!box || !g) return;
    const top = box.classList.contains('strip') ? 26 : 0, a = g.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (a.top < b.top + top || a.bottom > b.bottom) box.scrollTop += a.top - b.top - top - 2;
  }

  function draw() {
    keepFocus(el, () => keepScroll(el, ['.strip', '.stick', '.allw', '.page'], () => {
      drawn = []; kit = null;
      const page = v.now.page, m = sheetOf(page);
      if (page === 'all') everything();
      else if (page === 'words') words();
      else if (page === 'kit') { kit = kitPage(v, head('Prompt kit'), el); sized = () => {}; }
      else if (page === 'look') sized = lookPage(v, head('Look'), el).fit;
      else sheet(m!, page);
      sized();
      mark();
    }));
  }

  /* The strip only changes shape when a quiet situation is picked or stops being picked. */
  function picked() {
    const m = sheetOf(v.now.page);
    if (m && m.sits.some(s => silent(v.pet(), s))) {
      const old = el.querySelector('.strip');
      if (old) keepFocus(el, () => keepScroll(el, ['.strip'], () => old.replaceWith(strip(m))));
    }
    if (v.now.page === 'kit') kit?.mark();
    mark(); reveal();
  }

  return {
    el, draw, mark, picked, reveal,
    resized: () => { sized(); seat(); },
    refreshPrompts: () => kit?.refresh()
  };
}
export type Board = ReturnType<typeof createBoard>;
