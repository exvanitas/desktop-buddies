/* One buddy on the sheet: art, name, status and its button, together. At home it's a die-cut
   sticker. Out, it's the spot the sticker left. */
import type { Outline } from '@buddies/art/outline';
import type { BuddyRow } from '../manager-api';
import { cutline } from './cutline';
import { button, h } from '@buddies/peel/dom';
import type { Peel } from './peel';

/* The art's height on the sheet, and with one buddy. Wide art stops at this much wider than tall. */
export const ART = 92, ONLY = 180, WIDEST = 1.6;
/* Two clicks this close are one double-click, not Call then Dismiss. */
const DOUBLE_MS = 400;
/* How long a line that couldn't be read is remembered, as for the overlay's masks. A sticker asks
   again a little after, so the failure is surely forgotten by then. */
export const FAILED_MS = 5000;
const RETRY_SLACK_MS = 100;

export const fit = (w: number, h: number, tall = ART): [number, number] => {
  const k = Math.min(tall / h, tall * WIDEST / w);
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
};
export const statusOf = (b: Pick<BuddyRow, 'copies'>) => b.copies === 0 ? 'At home' : b.copies === 1 ? 'On desktop' : `${b.copies} on desktop`;

export interface StickerIO {
  call(b: BuddyRow): void;
  dismiss(b: BuddyRow): void;
  more(b: BuddyRow, anchor: HTMLElement): void;
  outline(url: string): Promise<Outline>;
  peel: Peel;
  now(): number;
  after(ms: number, f: () => void): void;
}
export interface Look { only: boolean; ready: boolean }

export function createSticker(first: BuddyRow, io: StickerIO) {
  let row = first, out = false, tall = ART, width = ART, line: SVGSVGElement | null = null, baked: Outline | null = null, toggled = -Infinity, wanted: string | null = null;

  const toggle = () => {
    const t = io.now();
    if (t - toggled < DOUBLE_MS) return;
    toggled = t;
    if (row.copies) io.dismiss(row); else io.call(row);
  };
  const img = h('img', { alt: '', draggable: 'false', width: ART, height: ART, decoding: 'async' });
  const art = button(img, toggle, { class: 'art' });
  const name = h('b', { dir: 'auto' }), status = h('span', { class: 's' });
  const main = button('', toggle, { class: 'btn sm' });
  const dots = button('•••', () => io.more(row, dots), { class: 'dots' });
  const el = h('div', { class: 'st' }, art, name, status, h('span', { class: 'acts' }, main, dots));

  const sized = () => {
    const [w, h] = img.naturalWidth ? fit(img.naturalWidth, img.naturalHeight, tall) : [tall, tall];
    width = w; img.setAttribute('width', String(w)); img.setAttribute('height', String(h));
  };
  function drawLine(animate: boolean) {
    if (!baked) return;
    const next = cutline(baked, width);
    if (line) line.replaceWith(next); else art.prepend(next);
    line = next;
    if (animate) io.peel.drawIn(next);
  }
  img.addEventListener('load', () => { el.classList.remove('broken'); sized(); if (out) drawLine(false); });
  img.addEventListener('error', () => { el.classList.add('broken'); });

  /* Baked when wanted. It may be for an image, or a state, that's gone by the time it's ready. */
  function bake(animate: boolean) {
    const url = row.image;
    if (wanted === url) return;
    wanted = url; baked = null;
    line?.remove(); line = null;
    void io.outline(url).then(o => {
      if (wanted !== url || !out) return;
      baked = o;
      drawLine(animate);
      retry(url, o);
    });
  }
  /* A line that couldn't be read is asked for once more after its failure is forgotten, since
     nothing else may ever ask: she may not change. The drawn one stays until a better one comes. */
  function retry(url: string, o: Outline) {
    if (o.shape !== 'unread') return;
    /* Gone from the page, by a delete or the view going, is gone: nothing more is asked. */
    const still = () => el.isConnected && wanted === url && baked === o && out;
    io.after(FAILED_MS + RETRY_SLACK_MS, () => {
      if (!still()) return;
      void io.outline(url).then(n => {
        if (!still()) return;
        baked = n;
        if (n.shape !== 'unread') drawLine(false);
        retry(url, n);
      });
    });
  }
  function leave() {
    out = true;
    el.classList.add('out');
    img.className = 'ghost';
  }
  function comeHome(animate: boolean) {
    out = false; wanted = null; baked = null;
    el.classList.remove('out');
    img.className = 'cut';
    const gone = line; line = null;
    if (!gone) return;
    if (animate) { io.peel.land(img); io.peel.rubOut(gone, () => gone.remove()); } else gone.remove();
  }

  function update(b: BuddyRow, look: Look) {
    const seen = img.hasAttribute('src'), was = out, nowOut = b.copies > 0;
    row = b;
    if (img.getAttribute('src') !== b.image) img.src = b.image;
    name.textContent = b.name; name.title = b.name;
    status.textContent = statusOf(b);
    const several = b.copies > 1, verb = several ? 'Dismiss all' : nowOut ? 'Dismiss' : 'Call';
    art.title = several ? `Dismiss all copies of ${b.name}` : `${verb} ${b.name}`; art.setAttribute('aria-label', art.title);
    main.textContent = verb; main.className = nowOut ? 'btn sm' : 'btn sm go';
    dots.setAttribute('aria-label', `More for ${b.name}`);
    for (const c of [art, main, dots]) c.disabled = !look.ready;

    const height = look.only ? ONLY : ART;
    if (height !== tall) { tall = height; sized(); if (out) drawLine(false); }

    if (nowOut && !was) { leave(); if (seen) io.peel.lift(img); bake(seen); }
    else if (nowOut) bake(false);
    else if (was) comeHome(seen);
    else img.className = 'cut';
  }
  update(first, { only: false, ready: true });
  return { el, update, dots };
}
export type Sticker = ReturnType<typeof createSticker>;
