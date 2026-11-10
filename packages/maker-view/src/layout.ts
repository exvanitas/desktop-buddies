/* How a sheet shares its space. Sizes come from the sheet, the window and the divider, never from
   what's picked. Pure. */
export const SPLIT = { min: .28, max: .74, step: .04 };
export const clampSplit = (v: number) => Math.max(SPLIT.min, Math.min(SPLIT.max, v));

/* The biggest sticker that fits. Room under each is its name and caption. */
const LABELS = 76, MIN_HEIGHT = 58, WIDEST_CELL = 260;
export function fit(width: number, height: number, count: number, cap: number) {
  let best = { h: 0, cw: 120 };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols), cw = Math.floor(width / cols), h = Math.min(cw * 1.05, height / rows - LABELS, cap);
    if (h > best.h) best = { h, cw };
  }
  return { H: Math.max(MIN_HEIGHT, Math.floor(best.h)), cw: Math.min(best.cw, WIDEST_CELL) };
}

/* Where the divider starts: more art takes more room, more words take it back. */
export function startSplit(stickers: number, refs: number, words: number) {
  const art = stickers * 1.3 + refs * .7 + .8, said = words * .8 + .6;
  return Math.max(.34, Math.min(.72, art / (art + said)));
}
