/* What this viewer's window remembers. The file and the library never hear of it, and if storage fails
   the window just starts fresh. */
import type { Backing } from './context';
import type { MakerViewIO } from './host';

const BACK = 'maker-backing', spots = (character: string) => `maker-spots-${character}`;

export function readBacking(store: MakerViewIO['store']): Backing {
  try { return store().getItem(BACK) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}
export function saveBacking(store: MakerViewIO['store'], b: Backing) {
  try { store().setItem(BACK, b); } catch { /* it just won't be remembered */ }
}

export interface Spots { last: number; splits: Record<string, number> }
export function readSpots(store: MakerViewIO['store'], character: string, sheets: number): Spots {
  try {
    const o = JSON.parse(store().getItem(spots(character)) || '{}') as Partial<Spots>;
    const last = Number.isInteger(o.last) && o.last! >= 1 && o.last! <= sheets ? o.last! : 0;
    const splits = Object.fromEntries(Object.entries(o.splits || {}).filter(([, v]) => typeof v === 'number'));
    return { last, splits };
  } catch { return { last: 0, splits: {} }; }
}
export function saveSpots(store: MakerViewIO['store'], character: string, s: Spots) {
  try { store().setItem(spots(character), JSON.stringify(s)); } catch { /* it just won't be remembered */ }
}
