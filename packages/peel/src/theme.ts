/* Theme belongs to the window's viewer, not to the library, so it stays in the page's own storage. If
   that fails, the window is simply dark. */
export type Theme = 'dark' | 'light';
export const THEME_KEY = 'theme';
/* What the page's storage does, or throws. */
export type Store = () => Pick<Storage, 'getItem' | 'setItem'>;

export function readTheme(store: Store): Theme {
  try { return store().getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}
export function saveTheme(store: Store, theme: Theme) {
  try { store().setItem(THEME_KEY, theme); }
  catch { /* it just won't be remembered */ }
}
export const showTheme = (theme: Theme) => { document.documentElement.dataset.theme = theme; };
