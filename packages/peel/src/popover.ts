/* The one floating thing at a time: a menu, the delete confirm, Import's choice, Settings. It's placed
   by script to stay inside the window, and it closes on scroll, Escape and an outside click. */

export interface Size { w: number; h: number }
const MARGIN = 8, GAP = 4;

/* Under its button if it fits, otherwise above, pulled in from the sides. Pure. */
export function placed(anchor: Pick<DOMRect, 'left' | 'top' | 'bottom' | 'width'>, box: Size, view: Size) {
  const x = anchor.left + anchor.width / 2 - box.w / 2;
  let y = anchor.bottom + GAP;
  if (y + box.h > view.h - MARGIN) y = anchor.top - box.h - GAP;
  return {
    x: Math.max(MARGIN, Math.min(x, view.w - box.w - MARGIN)),
    y: Math.max(MARGIN, Math.min(y, view.h - box.h - MARGIN))
  };
}

interface Open { el: HTMLElement; anchor: HTMLElement; closed(): void }

export function createPopover(host: HTMLElement) {
  let open: Open | null = null;

  function put() {
    if (!open) return;
    const { el, anchor } = open, { x, y } = placed(anchor.getBoundingClientRect(), { w: el.offsetWidth, h: el.offsetHeight }, { w: innerWidth, h: innerHeight });
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }
  function close(refocus = true) {
    if (!open) return;
    const { anchor, closed } = open;
    open = null;
    host.replaceChildren();
    if (refocus) anchor.focus();
    closed();
  }
  /* `focus` is what takes the keyboard, the first button if not given. */
  function show(el: HTMLElement, anchor: HTMLElement, closed: () => void = () => {}, focus?: HTMLElement) {
    close(false);
    open = { el, anchor, closed };
    host.replaceChildren(el);
    put();
    (focus || el.querySelector('button'))?.focus();
  }
  /* New contents for what's open, in the same place. */
  function swap(el: HTMLElement, focus?: HTMLElement) {
    if (!open) return;
    open.el = el;
    host.replaceChildren(el);
    put();
    (focus || el.querySelector('button'))?.focus();
  }

  const gone = new AbortController(), { signal } = gone;
  const outside = (e: Event) => { const t = e.target as Node; if (open && !host.contains(t) && !open.anchor.contains(t)) close(false); };
  document.addEventListener('pointerdown', outside, { capture: true, signal });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) { e.preventDefault(); close(); } }, { signal });
  addEventListener('scroll', e => { if (!host.contains(e.target as Node)) close(false); }, { capture: true, signal });
  addEventListener('resize', () => close(false), { signal });

  /* `place` is for contents that changed size by themselves. */
  return { show, swap, close, place: put, dispose() { close(false); gone.abort(); }, get anchor() { return open?.anchor ?? null; } };
}
export type Popover = ReturnType<typeof createPopover>;
