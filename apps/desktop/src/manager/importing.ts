/* The ways in: the two file pickers behind Import, and drops anywhere on the window. */
import { fromImages, fromInput, takeDrops, type Handed } from '../handed';
import { h } from '@buddies/peel/dom';

const FILES = '.buddy,.json';
/* What the Shimeji choice asks for, said where it's offered. A folder picker would make the
   browser ask "Upload N files to this site?", and a dragged folder never does. */
export const SHIMEJI_TIP = 'Pick every image in its img folder, or drag the whole folder in.';

/* Hidden inputs, opened by a click. `then` runs only if something was picked. */
export function createPickers(took: (files: Handed[]) => void) {
  let after: () => void = () => {};
  const input = (kind: string, attrs: Record<string, string | boolean>, read: (list: Iterable<File>) => Handed[] = fromInput) => {
    const i = h('input', { type: 'file', multiple: true, hidden: true, 'data-pick': kind, ...attrs });
    i.addEventListener('change', () => {
      const files = read(i.files || []);
      i.value = '';
      if (!files.length) return;
      after(); after = () => {};
      took(files);
    });
    return i;
  };
  const file = input('file', { accept: FILES }), shimeji = input('shimeji', { accept: 'image/*' }, fromImages);
  const open = (i: HTMLInputElement, then: () => void) => { after = then; i.click(); };
  return {
    els: [file, shimeji],
    pickFile: (then: () => void = () => {}) => open(file, then),
    pickShimeji: (then: () => void = () => {}) => open(shimeji, then)
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
