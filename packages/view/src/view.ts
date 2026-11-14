/* Applies frames to the DOM for one viewport, and turns pointer events into input. */
import type { Frame, Input, ParticleFrame, ParticleKind, PetFrame, Viewport } from '@buddies/engine';

const HEART = '<svg viewBox="0 0 32 30"><path d="M16 29C6 21 0 15.5 0 9.5A8.5 8.5 0 0 1 16 5.4 8.5 8.5 0 0 1 32 9.5C32 15.5 26 21 16 29z"/></svg>';
const STAR = (() => { let p = ''; for (let i = 0; i < 10; i++) { const r = i % 2 ? 5 : 12, a = -Math.PI / 2 + i * Math.PI / 5; p += (i ? 'L' : 'M') + (12 + r * Math.cos(a)).toFixed(1) + ' ' + (12 + r * Math.sin(a)).toFixed(1); } return `<svg viewBox="0 0 24 24"><path d="${p}z"/></svg>`; })();
const TEAR = '<svg viewBox="0 0 24 32"><path d="M12 1C10 6 3 13 3 20a9 9 0 0 0 18 0C21 13 14 6 12 1z" fill="#8ccfff"/><ellipse cx="8.5" cy="20" rx="2.2" ry="3.4" fill="#fff" opacity=".75"/></svg>';
const ANGER = '<svg viewBox="0 0 24 24"><path d="M9 2v5.5Q9 9 7.5 9H2M15 2v5.5Q15 9 16.5 9H22M9 22v-5.5Q9 15 7.5 15H2M15 22v-5.5Q15 15 16.5 15H22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
const SHAPES: Partial<Record<ParticleKind, string>> = { heart: HEART, star: STAR, anger: ANGER, tear: TEAR };
/* how far a bubble's tail stays from its sides: its corner's radius and half the tail */
const TAIL_CLEAR = 20;
/* to the low end when the range is empty: a bubble bigger than the page keeps its top left on it */
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, hi));

export interface ViewOptions {
  root: HTMLElement; input: Input; viewport: Viewport;
  /* the exported page's right-click menu, when a page asks for one */
  onMenu?: (id: string, x: number, y: number) => void;
  /* the desktop host holds the mouse itself, and works out hover from its own hit test */
  pointerCapture?: boolean; hover?: boolean;
}
/* A new size that comes with a new picture waits for the picture. Set before it's loaded, the old picture
   stays on screen at the new size until it is: stretched or squeezed for a frame or more, so a buddy whose
   poses are cut at different sizes seemed to grow and shrink at random. The picture loads in an element of
   its own first; once decoded, setting it shows it at once, with the new size. Past `WAIT_MS`, or if it
   can't load, the change goes anyway, as before. */
export const WAIT_MS = 250;
/* pictures already decoded here, newest last, so a pose seen before changes at once */
const KNOWN = 256;
interface Loading { src: string; img: HTMLImageElement; ready: boolean; since: number }
/* `fitted`: the bubble is where the view moved it, not where the engine wrote it */
interface PetElements { el: HTMLElement; body: HTMLElement; img: HTMLImageElement; bub: HTMLElement; tag: HTMLElement; last: PetFrame | null; fitted: boolean; loading: Loading | null }
interface FxElement { e: HTMLElement; opacity: number | null; tf: string | null }
export type View = ReturnType<typeof createView>;

export function createView(opt: ViewOptions) {
  const { root, input, viewport: vp, onMenu } = opt;
  const doc = root.ownerDocument;
  const pets = new Map<string, PetElements>(), fx = new Map<number, FxElement>();
  const known = new Set<string>();
  const now = () => (doc.defaultView?.performance ?? performance).now();
  /* A page that can't decode pictures ahead, like the golden traces' stand-in document, draws every
     change at once, as before. */
  const canWait = typeof doc.defaultView?.HTMLImageElement?.prototype?.decode === 'function';
  function decoded(src: string) { known.delete(src); known.add(src); if (known.size > KNOWN) known.delete(known.values().next().value!); }
  /* Is this picture ready to show the moment it's set? Starts loading it if not. */
  function ready(v: PetElements, src: string) {
    if (!canWait || known.has(src)) return true;
    let l = v.loading;
    if (!l || l.src !== src) {
      const img = doc.createElement('img'); img.src = src;
      const mine: Loading = l = v.loading = { src, img, ready: false, since: now() };
      const done = () => { mine.ready = true; decoded(src); };
      img.decode().then(done, done);
    }
    return l.ready || now() - l.since > WAIT_MS;
  }
  const world = (e: PointerEvent | MouseEvent) => { const r = root.getBoundingClientRect(); return { x: (e.clientX - r.left) * vp.scale + vp.x, y: (e.clientY - r.top) * vp.scale + vp.y }; };

  function createPet(id: string): PetElements {
    const el = doc.createElement('div'); el.className = 'db-pet';
    const body = doc.createElement('div'); body.className = 'db-body';
    const img = doc.createElement('img'); img.alt = ''; img.draggable = false;
    body.append(img); el.append(body);
    /* a picture it has shown is one it can show again at once */
    img.addEventListener('load', () => { const s = img.getAttribute('src'); if (s) decoded(s); });
    const bub = doc.createElement('div'); bub.className = 'db-bubble'; bub.hidden = true;
    const tag = doc.createElement('div'); tag.className = 'db-tag';
    root.append(el, bub, tag);
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); if (opt.pointerCapture !== false) { try { el.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ } }
      const p = world(e); input.down(id, p.x, p.y);
    });
    el.addEventListener('pointermove', e => { const p = world(e); input.move(id, p.x, p.y); });
    if (opt.hover !== false) {
      el.addEventListener('pointerenter', () => input.enter(id));
      el.addEventListener('pointerleave', () => input.leave(id));
    }
    el.addEventListener('pointerup', () => input.up(id));
    el.addEventListener('pointercancel', () => input.up(id));
    /* right-click menu, only when the host page asks for one (the exported desktop page does) */
    el.addEventListener('contextmenu', e => { if (!onMenu) return; e.preventDefault(); onMenu(id, e.clientX, e.clientY); });
    return { el, body, img, bub, tag, last: null, fitted: false, loading: null };
  }

  function applyPet(v: PetElements, f: PetFrame) {
    const was: Partial<PetFrame> = v.last || {};
    /* Until the new picture can show, she's drawn as she was: size, picture, place and body together. */
    if (f.size !== null && was.size && f.size !== was.size && f.src && f.src !== was.src && !ready(v, f.src))
      f = { ...f, size: was.size, src: was.src, tf: was.tf ?? f.tf, origin: was.origin ?? f.origin, body: was.body ?? f.body, parts: was.parts ?? f.parts, box: was.box ?? f.box, grab: was.grab ?? f.grab };
    if (f.size !== null) {
      if (f.size !== was.size) v.el.style.width = v.el.style.height = f.size;
      if (f.tf !== was.tf) v.el.style.transform = f.tf!;
      if (f.origin !== was.origin) v.body.style.transformOrigin = f.origin!;
      if (f.body !== was.body) v.body.style.transform = f.body!;
      if (f.src !== undefined && f.src !== was.src) v.img.src = f.src!;
      if (f.grab !== was.grab) v.el.classList.toggle('grab', f.grab);
    }
    if (f.off !== (was.off || false)) v.el.hidden = f.off;
    const b = f.bubble, wb: Partial<PetFrame['bubble']> = was.bubble || {};
    /* An app's line carries its name as a badge. Both are text, never markup. */
    if (b.text !== wb.text || b.from !== wb.from) {
      if (b.from) {
        const badge = doc.createElement('span'); badge.className = 'db-from'; badge.textContent = `From ${b.from}`;
        v.bub.replaceChildren(badge, doc.createTextNode(b.text));
      } else v.bub.textContent = b.text;
      v.bub.classList.toggle('app', !!b.from);
    }
    if (b.hidden !== wb.hidden) v.bub.hidden = b.hidden;
    if (b.pop !== (wb.pop || 0)) { v.bub.classList.remove('pop'); void v.bub.offsetWidth; v.bub.classList.add('pop'); }
    if (b.below !== wb.below) v.bub.classList.toggle('below', b.below);
    if (b.tf !== null && b.tf !== wb.tf) v.bub.style.transform = b.tf;
    fit(v, b);
    const t = f.tag, wt: Partial<PetFrame['tag']> = was.tag || {};
    if (t.text !== wt.text) v.tag.textContent = t.text;
    if (t.hidden !== wt.hidden) v.tag.hidden = t.hidden;
    if (t.tf !== null && t.tf !== wt.tf) v.tag.style.transform = t.tf;
    if (f.src === undefined) f.src = was.src; /* hosts may leave out an image that hasn't changed */
    v.last = f;
  }

  /* The engine placed her bubble by a guess at its size. Here the real size is known, so it's kept on
     the page: on the engine's side of her if it fits there, else the side it fits, else the side with
     more room, and then moved in from any edge. Its tail still points at her, short of its corners.
     Same frame, before anything is painted. A page with no layout measures nothing and leaves the
     engine's place, so a test's fake page reads as it always has. The edges are the viewport's, or
     the root's when the viewport has no size. Only the viewport her middle is in shows her bubble. */
  function fit(v: PetElements, b: PetFrame['bubble']) {
    const w = b.hidden || !b.at ? 0 : v.bub.clientWidth, h = w ? v.bub.clientHeight : 0;
    if (!w || !h) return;
    const W = vp.w ?? root.clientWidth, H = vp.h ?? root.clientHeight, { x, up, down, her, mid } = b.at!;
    if (!W || !H) return; /* a page with no size of its own has no edges to keep it from */
    /* Her bubble is the viewport's her middle is in. Another that shows part of her, across a seam
       between monitors, shows none of it, or the bubble moved into hers would have a twin here. */
    const here = her >= 0 && her < W && mid >= 0 && mid < H;
    v.bub.classList.toggle('away', !here);
    if (!here) return;
    const fitsUp = up - h >= 0, fitsDown = down + h <= H;
    const mine = b.below ? fitsDown : fitsUp, other = b.below ? fitsUp : fitsDown;
    const below = mine ? b.below : other ? !b.below : H - down > up;
    const left = clamp(x - w / 2, 0, W - w), top = clamp(below ? down : up - h, 0, H - h), reach = Math.max(0, w / 2 - TAIL_CLEAR);
    const tail = clamp(her - left - w / 2, -reach, reach);
    /* Where the engine put it is right more often than not, and then it stays as the engine wrote it. */
    if (below === b.below && Math.abs(left - (x - w / 2)) < .5 && Math.abs(top - (below ? down : up - h)) < .5 && Math.abs(tail) < .5) {
      if (v.fitted) { v.bub.style.transform = b.tf!; v.bub.style.removeProperty('--tail'); v.bub.classList.toggle('below', b.below); v.fitted = false; }
      return;
    }
    v.bub.classList.toggle('below', below);
    v.bub.style.transform = `translate(${left.toFixed(1)}px,${top.toFixed(1)}px)`;
    v.bub.style.setProperty('--tail', `${tail.toFixed(1)}px`);
    v.fitted = true;
  }

  function createFx(p: ParticleFrame): FxElement {
    const e = doc.createElement('div'); e.className = 'db-fx db-fx-' + p.kind;
    const shape = SHAPES[p.kind]; if (shape) e.innerHTML = shape;
    if (p.tint) e.style.color = p.tint;
    if (p.color && p.kind !== 'heart' && p.kind !== 'star') e.style.background = p.color;
    else if (p.kind === 'text') { e.textContent = p.text!; e.style.fontSize = p.size + 'px'; }
    e.style.width = e.style.height = p.kind === 'text' ? '' : p.size + 'px';
    if (p.h) e.style.height = p.h + 'px';
    root.append(e);
    return { e, opacity: null, tf: null };
  }

  return {
    /* what is on show, topmost last, as the frames last applied */
    shown: () => [...pets.values()].flatMap(v => v.last ? [v.last] : []),
    apply(frame: Frame) {
      const ids = new Set(frame.pets.map(f => f.id));
      pets.forEach((v, id) => { if (!ids.has(id)) { v.el.remove(); v.bub.remove(); v.tag.remove(); pets.delete(id); } });
      for (const f of frame.pets) {
        if (!pets.has(f.id)) pets.set(f.id, createPet(f.id));
        applyPet(pets.get(f.id)!, f);
      }
      const live = new Set(frame.fx.map(p => p.id));
      fx.forEach((v, id) => { if (!live.has(id)) { v.e.remove(); fx.delete(id); } });
      for (const p of frame.fx) {
        if (!fx.has(p.id)) fx.set(p.id, createFx(p));
        const v = fx.get(p.id)!;
        if (p.opacity !== null && p.opacity !== v.opacity) { v.opacity = p.opacity; v.e.style.opacity = String(p.opacity); }
        if (p.tf !== null && p.tf !== v.tf) v.e.style.transform = v.tf = p.tf;
      }
    }
  };
}
