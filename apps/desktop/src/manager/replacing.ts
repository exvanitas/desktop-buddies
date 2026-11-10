/* A file that would replace someone: the question at the top of the sheet, one at a time, oldest
   first. Replace has the keyboard. Keep both adds the file as a new buddy. Closing it, or Escape,
   imports nothing. Every name here comes from a file, so it's only ever text. */
import type { ReplaceHow, Replacing } from '../manager-api';
import { button, h } from '@buddies/peel/dom';

/* Settles once the hub has answered, so a question it asks again can show again. */
export interface ReplacingIO { answer(q: Replacing, how: ReplaceHow): Promise<unknown> }

export const replaceWords = (name: string) => `Replace ${name} with this file?`;
/* The name she has now heads it, since she's who goes. What the file calls her only shows when
   it's different, since that's what she'll be called after. */
export function fromWords(q: Pick<Replacing, 'name' | 'called' | 'file'>) {
  const named = q.called === q.name ? '' : ` It calls her ${q.called}.`;
  return `From ${q.file}.${named} Keep both adds it as a new buddy.`;
}
const typing = (e: Element | null) => !!e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || (e as HTMLElement).isContentEditable);

/* A question that has just shown can't be answered yet: a second press meant for the one before
   mustn't replace the next. */
export const SETTLE_MS = 400;
const KEYS = new Set(['Enter', ' ']);

export function createReplacing(io: ReplacingIO, now: () => number) {
  const el = h('div', { class: 'replacing' }), more = h('small', {});
  let shown = '', ask = '', last: Replacing[] = [], at = 0;
  /* While an answer is on its way, nothing shows: the next one waits for it, and one the hub asks
     again comes back. */
  let busy = 0;
  function answer(q: Replacing, how: ReplaceHow) {
    if (busy) return;
    busy++; update(last);
    void io.answer(q, how).finally(() => { busy--; update(last); });
  }
  /* The Enter or Space press under way: when it began, and whether it has repeated. A held key, or
     one pressed before the question showed, answers nothing; only a fresh press does. It's cleared
     after its keyup has done what it does, since Space clicks on keyup, and when the window loses
     the keyboard, since its keyup may then go elsewhere. It only ever stops the keyboard: a click
     from a pointer waits for the moment alone. */
  let press: { began: number; repeat: boolean } | null = null;
  document.addEventListener('keydown', e => {
    if (!KEYS.has(e.key)) return;
    if (e.repeat && press) press.repeat = true;
    else press = { began: now(), repeat: e.repeat };
  }, true);
  document.addEventListener('keyup', e => {
    if (!KEYS.has(e.key)) return;
    const p = press;
    setTimeout(() => { if (press === p) press = null; });
  }, true);
  const forget = () => { press = null; };
  addEventListener('blur', forget);
  document.addEventListener('visibilitychange', forget);
  /* `detail` counts a pointer's clicks, and is 0 for a click from a key. */
  const settled = (f: () => void) => (e: MouseEvent) => {
    if (now() - at < SETTLE_MS || (e.detail === 0 && press && (press.repeat || press.began < at))) return;
    f();
  };
  function update(list: Replacing[]) {
    last = list;
    const q = busy ? undefined : list[0];
    el.hidden = !q;
    more.textContent = list.length > 1 ? ` ${list.length - 1} more after this.` : '';
    more.hidden = list.length < 2;
    /* What it says: a new count behind it is no reason to draw it again. */
    const key = q ? [q.ask, q.name, q.called, q.file].join('\n') : '';
    if (key === shown) return;
    shown = key;
    if (!q) { el.replaceChildren(); return; }
    const card = h('div', { class: 'ask replace', role: 'alertdialog', 'aria-labelledby': 'replace-q', 'data-ask': q.ask },
      h('p', {}, h('b', { id: 'replace-q', dir: 'auto' }, replaceWords(q.name)), h('span', { dir: 'auto' }, fromWords(q)), more),
      button('Replace', settled(() => answer(q, 'replace')), { class: 'btn sm go', 'data-how': 'replace' }),
      button('Keep both', settled(() => answer(q, 'both')), { class: 'btn sm', 'data-how': 'both' }),
      button('×', () => answer(q, 'none'), { class: 'btn sm x', 'aria-label': 'Close, and import nothing', 'data-how': 'none' }));
    card.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); answer(q, 'none'); } });
    const fresh = q.ask !== ask, had = el.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.how : undefined;
    el.replaceChildren(card);
    /* Its words changed, so it waits again before it can be answered. */
    at = now();
    ask = q.ask;
    /* A new question takes the keyboard on Replace, unless someone is typing: a key meant for Find
       mustn't answer it. One drawn again keeps it on the button it was on. */
    const focus = had ?? (fresh && !typing(document.activeElement) ? 'replace' : undefined);
    if (focus) card.querySelector<HTMLElement>(`[data-how="${focus}"]`)?.focus();
  }
  return { el, update };
}
