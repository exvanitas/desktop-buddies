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

/* What Import Shimeji images asks for, said where it's offered. */
export const SHIMEJI_TIP = "For a Shimeji, pick every image in its img folder, or drag the whole folder in.";

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
    /* A Shimeji's images, picked as files: a folder picker makes the browser ask "Upload N files to
       this site?", and a dragged folder never does. */
    shimeji: input('shimeji', { accept: IMAGES, multiple: true }, io.shimeji),
    buddyFile: input('buddyFile', { accept: '.buddy,.json,application/json' }, f => io.buddyFile(f[0]!))
  };
  return {
    els: Object.values(inputs),
    open: (kind: keyof typeof inputs) => inputs[kind].click()
  };
}
export type Pickers = ReturnType<typeof createPickers>;
