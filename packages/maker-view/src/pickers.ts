/* The file pickers behind every button that asks for files. Hidden inputs, opened by a click. */
import { h } from '@buddies/peel/dom';

export interface PickerIO {
  main(file: File): void;
  buddies(files: File[]): void;
  frames(files: File[]): void;
  generated(files: File[]): void;
  shimeji(files: File[]): void;
  buddyFile(file: File): void;
}

export function createPickers(io: PickerIO) {
  const input = (kind: string, attrs: Record<string, string | boolean>, took: (files: File[]) => void) => {
    const i = h('input', { type: 'file', hidden: true, 'data-pick': kind, ...attrs });
    i.addEventListener('change', () => {
      const files = [...i.files || []];
      i.value = '';
      if (files.length) took(files);
    });
    return i;
  };
  const IMAGES = 'image/*';
  const inputs = {
    main: input('main', { accept: IMAGES }, f => io.main(f[0]!)),
    buddies: input('buddies', { accept: IMAGES, multiple: true }, io.buddies),
    frames: input('frames', { accept: IMAGES, multiple: true }, io.frames),
    generated: input('generated', { accept: IMAGES, multiple: true }, io.generated),
    shimeji: input('shimeji', { webkitdirectory: true, multiple: true }, io.shimeji),
    buddyFile: input('buddyFile', { accept: '.buddy,.json,application/json' }, f => io.buddyFile(f[0]!))
  };
  return {
    els: Object.values(inputs),
    open: (kind: keyof typeof inputs) => inputs[kind].click()
  };
}
export type Pickers = ReturnType<typeof createPickers>;
