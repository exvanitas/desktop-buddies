/* Failures: a dashed misprint at the top of the sheet saying what happened, why, and what to do.
   A drop of twenty bad files mustn't push everyone out of sight, so only the first few show. */
import { ANOTHER_FILE, ANOTHER_FOLDER, type Failure } from '../failures';
import { button, h } from '@buddies/peel/dom';
import { misprintOf } from '@buddies/peel/misprint';

export const SHOWN = 2;

export interface MisprintIO {
  pickFile(then: () => void): void;
  pickFolder(then: () => void): void;
  clear(id: string): void;
  clearAll(): void;
}

/* What the `again` button does, or null if there's nothing this window can truly do. */
export function againFor(f: Failure, io: Pick<MisprintIO, 'pickFile' | 'pickFolder' | 'clear'>, retry?: () => void): (() => void) | null {
  if (!f.again) return null;
  if (f.again === ANOTHER_FILE) return () => io.pickFile(() => io.clear(f.id));
  if (f.again === ANOTHER_FOLDER) return () => io.pickFolder(() => io.clear(f.id));
  return retry ? () => { io.clear(f.id); retry(); } : null;
}

function misprint(f: Failure, again: (() => void) | null, clear: () => void) {
  return misprintOf(f, { 'data-failure': f.id },
    again && button(f.again, again, { class: 'btn sm go' }),
    button('Clear', clear, { class: 'btn sm' }));
}

export function createMisprints(io: MisprintIO, retries: Map<string, () => void>) {
  const el = h('div', { class: 'misprints' });
  let all = false, last: Failure[] = [];
  function draw() {
    const shown = all ? last : last.slice(0, SHOWN), hidden = last.length - shown.length;
    el.hidden = !last.length;
    el.replaceChildren(...shown.map(f => misprint(f, againFor(f, io, retries.get(f.id)), () => io.clear(f.id))));
    if (last.length > SHOWN) {
      el.append(h('div', { class: 'more' },
        hidden ? h('span', {}, `${hidden} more`) : null,
        hidden ? button('Show all', () => { all = true; draw(); }, { class: 'btn sm' }) : null,
        button('Clear all', io.clearAll, { class: 'btn sm' })));
    }
  }
  return {
    el,
    /* A failure's state comes before its answer, so a retry can arrive after it's drawn. */
    retryKnown: draw,
    update(failures: Failure[]) {
      if (failures.length === last.length && failures.every((f, i) => f.id === last[i]!.id)) return;
      last = failures;
      if (last.length <= SHOWN) all = false;
      draw();
    }
  };
}
