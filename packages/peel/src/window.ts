/* A window with no frame from Windows draws its own bar. Tauri only drags from an element that has
   the mark itself, and Windows does the rest: snapping, the shadow, and double-click to maximize. */
import { button, h, s, type Kid } from './dom';

export const DRAG = { 'data-tauri-drag-region': true };
const icon = (...parts: Kid[]) => s('svg', { viewBox: '0 0 10 10', 'aria-hidden': 'true' }, ...parts);

export function windowControls(io: { minimize(): void; close(): void }) {
  return h('div', { class: 'wc' },
    button(icon(s('path', { d: 'M1 5.5h8' })), () => io.minimize(), { 'aria-label': 'Minimize', title: 'Minimize' }),
    button(icon(s('path', { d: 'M1.5 1.5l7 7M8.5 1.5l-7 7' })), () => io.close(), { 'aria-label': 'Close', title: 'Close' }));
}
