/* Cut lines on demand. Nothing is stored: a line is baked from the loaded image the first time it's
   wanted, and kept in memory by image URL, which changes when her main image does. One at a
   time, with a pause between, so a sheet of 200 never holds the page up. A line that couldn't be
   read is remembered for FAILED_MS from when it came, the same rule as the overlay's masks, and the
   next ask after that bakes again: the same image can come back under the same name. */
import { rectangle, type Outline } from '@buddies/art/outline';
import { ART, FAILED_MS } from './sticker';

export type Outlines = (url: string) => Promise<Outline>;

/* More than a sheet holds, so what's forgotten is art that's been replaced or deleted. */
export const KEEP = 400;
export { FAILED_MS };

export function createOutlines(trace: (url: string) => Promise<Outline>, pause: () => Promise<void> = () => new Promise(r => setTimeout(r)), now = () => performance.now()): Outlines {
  /* `failed`: when it came back unread. */
  const memo = new Map<string, { line: Promise<Outline>; failed: number | null }>();
  let last: Promise<unknown> = Promise.resolve();
  return url => {
    const kept = memo.get(url);
    if (kept && (kept.failed === null || now() - kept.failed < FAILED_MS)) return kept.line;
    memo.delete(url);
    const k: { line: Promise<Outline>; failed: number | null } = { line: null as unknown as Promise<Outline>, failed: null };
    /* The wrapper never fails, and if it ever did there'd still be a line. */
    k.line = last.then(pause).then(() => trace(url)).catch(() => rectangle(ART, ART, 1)).then(o => { if (o.shape === 'unread') k.failed = now(); return o; });
    memo.set(url, k);
    if (memo.size > KEEP) memo.delete(memo.keys().next().value!);
    last = k.line;
    return k.line;
  };
}
