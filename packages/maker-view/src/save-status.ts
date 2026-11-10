/* Whether the work is safe. Quiet when fine. A failure stays in full view until a save really succeeds:
   a retry in progress still isn't saved, so it doesn't clear it. Pure in `next`. */
import { button, h } from '@buddies/peel/dom';
import { misprintOf } from '@buddies/peel/misprint';
import type { SaveState } from './host';

type Failed = Extract<SaveState, { kind: 'failed' }>;
export interface SaveView { word: string; bad: boolean; failure: Failed | null }

export function next(was: Failed | null, s: SaveState): SaveView {
  if (s.kind === 'failed') return { word: 'Not saved', bad: true, failure: s };
  if (s.kind === 'saving') return { word: was ? 'Not saved yet, trying again' : 'Saving', bad: !!was, failure: was };
  return { word: 'Saved', bad: false, failure: null };
}

/* `keep` offers a way to get the work out when the library can't take it. */
export function createSaveStatus(keep: () => { label: string; run(): void } | null) {
  const chip = h('span', { class: 'saved', role: 'status', 'data-save': 'none' });
  const banner = h('div', { class: 'save-fail', hidden: true });
  let failure: Failed | null = null, shownFailure: Failed | null = null;
  return {
    chip, banner,
    update(s: SaveState) {
      const v = next(failure, s);
      failure = v.failure;
      chip.textContent = v.word;
      chip.dataset.save = s.kind;
      chip.classList.toggle('bad', v.bad);
      banner.hidden = !failure;
      if (failure && failure !== shownFailure) {
        const out = keep();
        banner.replaceChildren(misprintOf(failure, { 'data-save-failure': 'true' },
          ...(failure.actions || []).map((a, i) => button(a.label, () => a.run(), { class: `btn sm${i ? '' : ' go'}` })),
          out ? button(out.label, out.run, { class: 'btn sm', 'data-keep': 'true' }) : null));
      }
      shownFailure = failure;
    }
  };
}
