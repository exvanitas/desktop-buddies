/* A pose's frames in the tray: "Frame 3 of 8", Earlier, Later, Remove on the picked frame. Over 12
   frames, a slider jumps along the strip. */
import { LIMIT, type PoseKey } from '@buddies/buddy-file';
import type { MakerBuddy } from '@buddies/maker-core';
import { button, h } from '@buddies/peel/dom';
import type { View } from './context';
import type { Showing } from './art';

const JUMP_FROM = 12;
export const frameIn = (v: View, key: PoseKey, n: number) => Math.max(0, Math.min(v.now.frames[key] ?? 0, n - 1));

export function frameStrip(v: View, p: MakerBuddy, key: PoseKey, own: Showing | null) {
  const adder = (words: string) => button(words, () => { v.maker.pickPose(key); v.pickers.open('frames'); }, { class: 'fs-t add', 'aria-label': 'Add frames', 'data-k': 'add-frames' });
  if (!own) return h('div', { class: 'fs empty' }, adder('+'), h('span', { class: 'fs-hint' }, 'Add frames, or drop images here'));
  const n = own.frames.length, c = frameIn(v, key, n);
  /* Working on a frame stops the preview on it, until Play. */
  const go = (i: number) => { v.now.frames[key] = i; v.now.held = key; v.drawTray(); };
  const moved = (by: -1 | 1) => { v.now.frames[key] = c + by; v.now.held = key; v.maker.moveFrame(p, key, c, by); };
  return h('div', { class: 'fs' },
    h('div', { class: 'fs-bar' }, h('b', {}, `Frame ${c + 1} of ${n}`),
      n > JUMP_FROM ? jump(n, c, go) : null,
      h('span', { class: 'fs-acts' },
        button('‹ Earlier', () => moved(-1), { disabled: c === 0, 'aria-label': 'Move earlier', 'data-k': 'earlier' }),
        button('Later ›', () => moved(1), { disabled: c === n - 1, 'aria-label': 'Move later', 'data-k': 'later' }),
        button('Remove', () => { v.now.held = key; v.maker.removeFrame(p, key, c); }, { 'aria-label': 'Remove frame', 'data-k': 'remove-frame' }))),
    h('div', { class: 'fs-roll' },
      ...own.frames.map((f, i) => {
        const img = h('img', { alt: '', decoding: 'async', loading: 'lazy', draggable: 'false' });
        img.src = f.src;
        return button([img, h('small', {}, i + 1)], () => go(i), { class: `fs-t${i === c ? ' on' : ''}`, 'aria-label': `Frame ${i + 1}`, 'aria-pressed': String(i === c), 'data-fi': i, 'data-k': `frame-${i}` });
      }),
      n < LIMIT.frames ? adder('+') : null));
}

function jump(n: number, c: number, go: (i: number) => void) {
  const r = h('input', { class: 'fs-go', type: 'range', min: 1, max: n, 'aria-label': 'Go to frame', 'data-k': 'frame-jump' });
  r.value = String(c + 1);
  r.addEventListener('input', () => go(+r.value - 1));
  return r;
}

/* The picked frame in view, without moving anything else. */
export function showPicked(tray: HTMLElement) {
  const r = tray.querySelector('.fs-roll'), t = r?.querySelector('.fs-t.on');
  if (!r || !t) return;
  const a = t.getBoundingClientRect(), b = r.getBoundingClientRect();
  if (a.left < b.left) r.scrollLeft -= b.left - a.left + 6;
  else if (a.right > b.right) r.scrollLeft += a.right - b.right + 6;
}
