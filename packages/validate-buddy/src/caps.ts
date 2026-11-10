/* What a .buddy may weigh, on top of the reader's own LIMIT. */
import { LIMIT } from '@buddies/buddy-file';

export const CAPS = {
  /* bytes on disk, checked before anything is parsed */
  file: LIMIT.file,
  /* JSON nesting; a real file goes 6 deep */
  depth: 16,
  /* decoded width or height of any image */
  side: 2048,
  /* frames in one animated GIF, WebP or APNG */
  animFrames: 120,
  /* width x height x frames of one image */
  imagePixels: 2048 * 2048 * 4,
  /* the same, summed over every distinct image in the file */
  totalPixels: 2048 * 2048 * 128,
  /* chunks, markers or blocks walked in one image */
  segments: 65536
};
export type Caps = typeof CAPS;
