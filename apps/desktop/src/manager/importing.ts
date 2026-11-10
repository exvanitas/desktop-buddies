/* The ways in: the two file pickers behind Import, and drops anywhere on the window. */
import { fromInput, takeDrops, type Handed } from '../handed';
import { h } from '@buddies/peel/dom';

const FILES = '.buddy,.json';

/* Hidden inputs, opened by a click. `then` runs only if something was picked. */
export function createPickers(took: (files: Handed[]) => void) {
  let after: () => void = () => {};
  const input = (kind: string, attrs: Record<string, string | boolean>) => {
    const i = h('input', { type: 'file', multiple: true, hidden: true, 'data-pick': kind, ...attrs });
    i.addEventListener('change', () => {
      const files = fromInput(i.files || []);
      i.value = '';
      if (!files.length) return;
      after(); after = () => {};
      took(files);
    });
    return i;
  };
  const file = input('file', { accept: FILES }), folder = input('folder', { webkitdirectory: true });
  const open = (i: HTMLInputElement, then: () => void) => { after = then; i.click(); };
  return {
    els: [file, folder],
    pickFile: (then: () => void = () => {}) => open(file, then),
    pickFolder: (then: () => void = () => {}) => open(folder, then)
  };
}

/* Drops, and whether one is on its way. A drag crosses every element inside the window, so only its
   way in and out of the window count. Text and links being dragged aren't drops. While `open` says
   no, the cursor says so too, and nothing comes in. */
export function watchDrops(target: Document, took: (files: Handed[]) => void, dragging: (on: boolean) => void, open: () => boolean = () => true) {
  let depth = 0;
  const files = (e: Event) => [...(e as DragEvent).dataTransfer?.types || []].includes('Files');
  const set = (n: number) => { const was = depth > 0; depth = n; if (was !== depth > 0) dragging(depth > 0 && open()); };
  target.addEventListener('dragenter', e => { if (files(e)) set(depth + 1); });
  target.addEventListener('dragleave', e => { if (files(e)) set(Math.max(0, depth - 1)); });
  target.addEventListener('dragover', e => { const d = (e as DragEvent).dataTransfer; if (d && !open()) d.dropEffect = 'none'; });
  target.addEventListener('drop', () => set(0));
  takeDrops(target, files => { if (open()) took(files); });
}
