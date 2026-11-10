/* Words: a situation's lines as bubbles, and the links from a caption to its art. Words never own a
   picture. A click on a word opens its words, and a link in a caption picks the art. */
import { LIMIT, canShow, type PoseKey, type Situation } from '@buddies/buddy-file';
import { linesOf, type MakerBuddy } from '@buddies/maker-core';
import { button, h, type Kid } from '@buddies/peel/dom';
import { capOf, label, partsOf, saidOnce, silent, artOf } from './captions';
import { isLine, type Sel, type View } from './context';
import { slotOf } from './art';
import { drawArt } from './draw-art';
import type { SitDef } from './moments';
import { WHEN } from './moments';

/* Only short lines ride on a sticker. A resting one is shorter still. */
export const ON_STICKER = 26, RESTING = 18;
const shortest = (p: MakerBuddy, k: Situation) => linesOf(p, k).filter(l => l.trim()).reduce((a, l) => !a || l.length < a.length ? l : a, '');

/* The words riding on a sticker, if any: the picked line if its art is here, else a short resting one. */
export function bubbleFor(p: MakerBuddy, keys: PoseKey[], sel: Sel, sits: SitDef[]): { t: string; now: boolean } | null {
  if (isLine(sel)) {
    const s = sits.find(x => x.k === sel.sit), art = s && artOf(p, s);
    if (art && keys.includes(art)) { const t = linesOf(p, sel.sit)[sel.i] || ''; return t && t.length <= ON_STICKER ? { t, now: true } : null; }
  }
  for (const x of sits) {
    const art = artOf(p, x);
    if (silent(p, x) || !art || !keys.includes(art)) continue;
    const t = shortest(p, x.k);
    if (t && t.length <= RESTING) return { t, now: false };
  }
  return null;
}

/* A caption with its art as links. */
export function rich(v: View, text: string): Kid[] {
  const p = v.pet();
  return partsOf(text).map(x => typeof x === 'string' ? x
    : button(label(x.pose), () => v.pick({ pose: x.pose }), { class: `lk${canShow(p, x.pose) ? '' : ' no'}`, 'data-art': x.pose }));
}
/* One step of a sequence: the same links, each with its art. */
export function stepOf(v: View, text: string) {
  const p = v.pet();
  return h('li', {}, ...partsOf(text).map(x => {
    if (typeof x === 'string') return x;
    const s = slotOf(p, x.pose);
    let small: Kid = null;
    if (s.kind !== 'none') { const a = drawArt(s); a.size(22, 30); small = a.el; }
    return button([small, label(x.pose)], () => v.pick({ pose: x.pose }), { class: `lk stp${s.kind === 'none' ? ' no' : ''}`, 'data-art': x.pose });
  }));
}

const wordOf = (v: View, k: Situation, l: string, i: number) => {
  const words = l ? h('span', { dir: 'auto' }, l) : h('span', {}, h('em', {}, 'New line'));
  return button(words, () => v.pick({ sit: k, i }), { class: 'say', 'data-sit': k, 'data-i': i, 'data-k': `say-${k}-${i}` });
};

/* The writer opens on a new line, which doesn't exist until something is typed. */
export function addLine(v: View, k: Situation) {
  v.pick({ sit: k, i: linesOf(v.pet(), k).length });
  document.querySelector<HTMLElement>('.tray .field')?.focus();
}
/* A new line just got its first letter, so it's in the list now. */
export function addWord(v: View, box: Element, k: Situation, i: number) {
  for (const says of box.querySelectorAll(`.sit[data-g="${k}"] .says`)) {
    const add = says.querySelector('.add'), word = wordOf(v, k, '', i);
    if (add) add.before(word); else says.append(word);
  }
}

export function groupOf(v: View, s: SitDef) {
  const p = v.pet(), lines = linesOf(p, s.k), hush = silent(p, s), cap = capOf(p, s);
  return h('div', { class: 'sit', 'data-g': s.k },
    button(WHEN[s.k], () => v.pick({ sit: s.k, i: 0 }), { class: 'top', 'data-sit-top': s.k, 'data-k': `top-${s.k}` }),
    h('p', { class: 'cap' }, ...rich(v, cap), hush ? `. ${saidOnce(s)}` : ''),
    h('div', { class: 'says' },
      ...lines.map((l, i) => wordOf(v, s.k, l, i)),
      lines.length < LIMIT.lines ? button('Add a line', () => addLine(v, s.k), { class: 'say add', 'data-add': s.k, 'data-k': `add-${s.k}` }) : null));
}

/* Where line i of a list lands once the blanks have gone. A blank target opens what took its place,
   or the last line left. A new line past the end stays past the end. Pure. */
export function lineAfterTidy(list: readonly string[], i: number) {
  const kept = list.filter(l => l.trim()).length, before = list.slice(0, i).filter(l => l.trim()).length;
  return i >= list.length ? before : Math.max(0, Math.min(before, kept - 1));
}

/* While the writer has a new line open, it shows in the list too. */
export function markLine(box: HTMLElement, p: MakerBuddy, sel: Sel) {
  for (const old of box.querySelectorAll('.say.draft')) old.remove();
  if (!isLine(sel)) return;
  const list = linesOf(p, sel.sit);
  if (sel.i < list.length) return;
  for (const says of box.querySelectorAll(`.sit[data-g="${sel.sit}"] .says`)) {
    says.querySelector('.add')?.before(h('span', { class: 'say draft on', 'data-sit': sel.sit, 'data-i': sel.i }, h('span', {}, h('em', {}, 'New line'))));
  }
}
