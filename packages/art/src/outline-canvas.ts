/* Reads an image's alpha with a canvas, for the pure bake in outline.ts. Never fails: an image that
   can't be read still gets a line. */
import { outlineOf, rectangle, type Alpha, type Outline } from './outline';

/* Worked at this much the size it's shown, whatever the image's size, so every buddy costs the same. */
export const DETAIL = 1.5;

/* How big art of this natural size is shown on the sheet. */
export type Fit = (w: number, h: number) => [number, number];

/* Throws on an image from another origin, because the canvas is tainted. */
export function alphaOf(im: CanvasImageSource, w: number, h: number): Alpha {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(im, 0, 0, w, h);
  const rgba = x.getImageData(0, 0, w, h).data, data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3]!;
  return { width: w, height: h, data };
}

const load = (src: string) => new Promise<HTMLImageElement>((done, fail) => {
  const im = new Image();
  im.onload = () => done(im);
  im.onerror = () => fail(new Error('image failed to load'));
  im.src = src;
});

/* `src` is any image URL. `read` and `open` are for tests. */
export async function outlineOfImage(src: string, fit: Fit, read = alphaOf, open: (src: string) => Promise<HTMLImageElement> = load): Promise<Outline> {
  let [w, h] = fit(1, 1).map(n => Math.round(n * DETAIL)) as [number, number];
  try {
    const im = await open(src);
    if (!im.naturalWidth || !im.naturalHeight) throw new Error('image has no size');
    const shown = fit(im.naturalWidth, im.naturalHeight);
    [w, h] = shown.map(n => Math.round(n * DETAIL)) as [number, number];
    return outlineOf(read(im, w, h), shown[0] / w);
  } catch {
    return rectangle(w, h, 1 / DETAIL);
  }
}
