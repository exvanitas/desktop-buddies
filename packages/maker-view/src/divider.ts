/* The perforated line is the divider: drag it, or use the arrow keys, to give one side more room. Each
   page keeps its own setting. */
import { h } from '@buddies/peel/dom';
import type { View } from './context';
import { SPLIT, clampSplit } from './layout';

export function createDivider(v: View, left: HTMLElement, spread: HTMLElement, page: string, start: number, label: string) {
  const el = h('div', { class: 'perf', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': label, 'aria-valuemin': Math.round(SPLIT.min * 100), 'aria-valuemax': Math.round(SPLIT.max * 100), tabindex: 0, 'data-k': 'divider' });
  const show = (share: number) => {
    left.style.flexBasis = `${share * 100}%`;
    el.setAttribute('aria-valuenow', String(Math.round(share * 100)));
  };
  const set = (share: number) => {
    const to = clampSplit(share);
    v.now.splits[page] = to;
    show(to); v.resized(); v.saveSpots();
  };
  const now = () => v.now.splits[page] ?? start;
  show(now());
  let dragging = false;
  el.addEventListener('pointerdown', e => {
    dragging = true; e.preventDefault();
    el.setPointerCapture?.(e.pointerId);
    el.focus();
  });
  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    const r = spread.getBoundingClientRect();
    set((e.clientX - r.left) / r.width);
  });
  const up = () => { dragging = false; };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(now() + SPLIT.step);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(now() - SPLIT.step);
    else if (e.key === 'Home') set(SPLIT.min);
    else if (e.key === 'End') set(SPLIT.max);
    else return;
    e.preventDefault();
  });
  return el;
}
