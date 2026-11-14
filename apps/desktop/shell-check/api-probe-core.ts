/* What the local API's end-to-end run reads and clicks, kept apart from the page so a test can run it
   on the real Manager view and the real bubble. api-probe.ts wires it to the app; api-e2e.ps1 drives. */
import type { HubState } from '../src/manager-api';
import { SETTING, askWords } from '../src/manager/asking';
import { FILES_SWITCH } from '../src/manager/settings';

/* UTF-8 bytes as hex: what the driver compares, byte for byte. */
export const hex = (s: string) => [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, '0')).join('');
/* JSON with everything past printable ASCII escaped, so a log line is plain ASCII. */
export const ascii = (v: unknown) => (JSON.stringify(v) ?? 'null').replace(/[^\x20-\x7e]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

const shown = (e: Element | null) => { for (let n = e as HTMLElement | null; n; n = n.parentElement) if (n.hidden) return false; return !!e; };
/* A shown, enabled button in `scope` called `name`, by its words or its label. */
export function buttonIn(scope: ParentNode | null | undefined, name: string): HTMLButtonElement | null {
  if (!scope) return null;
  return [...scope.querySelectorAll('button')].find(b => shown(b) && !b.disabled && (b.textContent?.trim() === name || b.getAttribute('aria-label') === name)) ?? null;
}
/* What the shown buttons in `scope` are called, for a failure. */
export const buttonsIn = (scope: ParentNode | null | undefined) => scope ? [...scope.querySelectorAll('button')].filter(shown).map(b => b.textContent?.trim() || b.getAttribute('aria-label') || '?') : [];
const askFor = (root: ParentNode, app: string) => [...root.querySelectorAll('.ask')].find(e => e.getAttribute('data-app') === app) ?? null;

/* One thing the driver asks the Manager to do, as the person would: by its own buttons. */
export type Task =
  | { n: number; do: 'on'; on: boolean }
  | { n: number; do: 'pause'; on: boolean }
  | { n: number; do: 'hide'; on: boolean }
  | { n: number; do: 'files'; on: boolean }
  | { n: number; do: 'look'; app: string }
  | { n: number; do: 'forget'; app: string }
  | { n: number; do: 'answer'; app: string; allow: boolean }
  | { n: number; do: 'state' };
export interface Done { ok: boolean; detail: unknown }
export interface ManagerIO {
  root: ParentNode;
  state(): HubState | null;
  /* True once the hub's state says so, false if it never did. */
  until(f: (s: HubState) => boolean): Promise<boolean>;
}

/* What the hub says about what a task touches. Apps' names are the driver's own, all plain ASCII;
   buddies' names come from files, and ascii() escapes them in the log. */
const facts = (s: HubState | null) => s ? { on: s.api.on, paused: s.paused, hidden: s.hidden, asking: s.api.asking, apps: s.api.apps, files: s.files, names: s.buddies.map(b => b.name) } : null;

export async function perform(t: Task, io: ManagerIO): Promise<Done> {
  const { root } = io;
  const now = io.state();
  if (!now) return { ok: false, detail: 'no state from the hub yet' };
  const done = async (f: (s: HubState) => boolean, more: object = {}) => {
    const ok = await io.until(f);
    return { ok, detail: { ...more, hub: facts(io.state()) } };
  };
  /* The Settings panel, open for `f`, then closed again by the same button. */
  const inSettings = async (f: (panel: ParentNode) => HTMLButtonElement | null, what: string) => {
    const open = buttonIn(root, 'Settings');
    if (!open) return { clicked: false, why: `no Settings button: ${buttonsIn(root).join(', ')}` };
    open.click();
    const panel = root.querySelector('.panel');
    const b = f(panel ?? root);
    if (b) b.click();
    const why = b ? '' : `no ${what} in Settings: ${buttonsIn(panel).join(', ')}`;
    if (root.querySelector('.panel')) buttonIn(root, 'Settings')?.click();
    return { clicked: !!b, why };
  };

  if (t.do === 'state') return { ok: true, detail: { hub: facts(now) } };
  if (t.do === 'pause' || t.do === 'hide') {
    const key = t.do === 'pause' ? 'paused' : 'hidden';
    if (now[key] === t.on) return { ok: true, detail: { already: true, hub: facts(now) } };
    const b = buttonIn(root, t.do === 'pause' ? 'Pause' : 'Hide all');
    if (!b) return { ok: false, detail: `no ${t.do} switch: ${buttonsIn(root).join(', ')}` };
    b.click();
    return done(s => s[key] === t.on);
  }
  if (t.do === 'on') {
    if (now.api.on === t.on) return { ok: true, detail: { already: true, hub: facts(now) } };
    const c = await inSettings(p => buttonIn(p, SETTING), 'switch');
    if (!c.clicked) return { ok: false, detail: c.why };
    return done(s => s.api.on === t.on);
  }
  if (t.do === 'files') {
    if (now.files === t.on) return { ok: true, detail: { already: true, hub: facts(now) } };
    const c = await inSettings(p => buttonIn(p, FILES_SWITCH), 'files switch');
    if (!c.clicked) return { ok: false, detail: c.why };
    return done(s => s.files === t.on);
  }
  if (t.do === 'look') {
    const ask = askFor(root, t.app);
    const words = ask?.querySelector('b')?.textContent ?? null;
    return { ok: shown(ask) && words === askWords(t.app) && now.api.asking.includes(t.app), detail: { shown: shown(ask), words, buttons: buttonsIn(ask), hub: facts(now) } };
  }
  if (t.do === 'answer') {
    const ask = askFor(root, t.app), b = buttonIn(ask, t.allow ? 'Allow' : 'Not now');
    if (!b) return { ok: false, detail: { why: 'no question for that app, or no button', buttons: buttonsIn(ask), hub: facts(now) } };
    b.click();
    return done(s => s.api.apps.some(a => a.name === t.app && a.allow === t.allow) && !s.api.asking.includes(t.app));
  }
  const c = await inSettings(p => buttonIn(p, `Remove ${t.app}`), `Remove for ${t.app}`);
  if (!c.clicked) return { ok: false, detail: c.why };
  return done(s => !s.api.apps.some(a => a.name === t.app));
}

/* An app's line in a bubble as the view set it: the badge's name and the words after it. Null for
   her own lines, which have no badge. */
export function appLine(bubble: Element): { from: string; text: string } | null {
  const badge = bubble.firstChild;
  if (!badge || badge.nodeType !== 1 || !(badge as Element).classList.contains('db-from')) return null;
  const from = (badge.textContent ?? '').replace(/^From /, '');
  return { from, text: [...bubble.childNodes].slice(1).map(n => n.textContent ?? '').join('') };
}
/* The file an image is shown from, without its folder or query. */
export const imageName = (src: string) => decodeURIComponent(src.split('?')[0]!.split('#')[0]!.split('/').pop() ?? '');


export interface OverlayIO {
  said(from: string, text: string): void;
  /* She started a wave: the nth since the page came up. */
  waved(n: number): void;
  isWave(name: string): boolean;
  /* Nothing can be judged on this page, so nothing will be told. Said once. */
  cannot(why: string): void;
}

/* Whether a person could see an element now. 'unknown' when the page can't say, which tells nothing. */
export type Seen = 'yes' | 'no' | 'unknown';
/* Settling waits; judging never does. A judgment of several elements is taken in one go after they
   have all settled, so it sees them as they are together, not one now and another later. */
export interface Look {
  settle(els: Element[]): Promise<void>;
  seen(el: Element): Seen;
}
/* How long to wait for animations to end before judging. */
export const SETTLE_MS = 1500;

/* The browser's own judgment, not a walk of its styles. Settling waits, capped, for every finite
   animation on, inside or around any of the elements, so a bubble popping in from opacity 0 is
   judged as it lands. Seen is, at that moment: in the page, passing checkVisibility with opacity and
   visibility counted, with a size, and at least partly inside the window. A page with no
   checkVisibility, an old WebView2, says 'unknown'. */
export function platformLook(settleMs = SETTLE_MS): Look {
  return {
    async settle(els) {
      const doc = els[0]?.ownerDocument;
      const near = (t: Element) => els.some(el => t === el || el.contains(t) || t.contains(el));
      const ending = (doc?.getAnimations?.() ?? []).filter(a => {
        const t = (a.effect as KeyframeEffect | null)?.target;
        return !!t && near(t) && Number.isFinite(a.effect!.getComputedTiming().endTime);
      });
      if (ending.length) await Promise.race([Promise.all(ending.map(a => a.finished.catch(() => {}))), new Promise(r => setTimeout(r, settleMs))]);
    },
    seen(el) {
      if (typeof el.checkVisibility !== 'function') return 'unknown';
      const view = el.ownerDocument.defaultView;
      if (!view) return 'unknown';
      if (!el.isConnected) return 'no';
      /* The newer names and the first ones, so a WebView2 that knows either counts both. */
      const options = { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true, checkOpacity: true, checkVisibilityCSS: true };
      if (!el.checkVisibility(options)) return 'no';
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return 'no';
      return r.right > 0 && r.bottom > 0 && r.left < view.innerWidth && r.top < view.innerHeight ? 'yes' : 'no';
    }
  };
}

/* An image whose current picture is its source, decoded: not one still loading, or one that failed. */
export function decoded(img: HTMLImageElement) {
  const want = imageName(img.getAttribute('src') ?? '');
  return img.complete && img.naturalWidth > 0 && (!img.currentSrc || imageName(img.currentSrc) === want);
}
/* The view puts each buddy's pet element first, her bubble right after it, and her image at
   .db-pet > .db-body > img. */
const isPet = (e: Element | null | undefined): e is Element => !!e && e.classList.contains('db-pet');
const petBefore = (bubble: Element) => isPet(bubble.previousElementSibling) ? bubble.previousElementSibling : null;
const bubbleAfter = (pet: Element) => { const n = pet.nextElementSibling; return n?.classList.contains('db-bubble') ? n : null; };
const herImage = (pet: Element | null) => pet?.querySelector<HTMLImageElement>(':scope > .db-body > img') ?? null;

/* Watches an overlay's buddies, and tells only what a person could see: an app's line once her
   bubble and her decoded image are both seen, and a wave once a decoded wave image of hers is seen,
   after one that wasn't a wave. Each is judged by `look` whenever anything about her changes or an
   image loads, one judgment at a time for each element, so a late show or load is still told. */
export function watchOverlay(root: Element, io: OverlayIO, look: Look = platformLook()) {
  const told = new WeakMap<Element, string>(), waving = new WeakMap<Element, boolean>();
  const busy = new WeakSet<Element>(), again = new WeakSet<Element>();
  let waves = 0, warned = false;
  const unknown = () => { if (!warned) { warned = true; io.cannot('this page has no checkVisibility, so what she shows cannot be judged'); } };
  const once = (el: Element, f: () => Promise<void>) => {
    if (busy.has(el)) { again.add(el); return; }
    busy.add(el);
    void f().catch(() => {}).finally(() => { busy.delete(el); if (again.has(el)) { again.delete(el); once(el, f); } });
  };
  const keyOf = (b: Element) => { const l = appLine(b); return l ? l.from + '\n' + l.text : null; };
  /* Every element seen, judged now, with no wait in between. */
  const seenAll = (els: Element[]): Seen => {
    for (const e of els) { const s = look.seen(e); if (s !== 'yes') return s; }
    return 'yes';
  };

  /* Settle her bubble, pet and image together, then judge all of it in one go: her bubble still
     after that pet, her image still in it and decoded, the line the same, and every one seen. */
  const bubble = (b: Element) => {
    const key = keyOf(b);
    if (key === null) { told.delete(b); return; }
    if (told.get(b) === key) return;
    once(b, async () => {
      const p = petBefore(b), img = herImage(p);
      if (!p || !img) return;
      await look.settle([b, p, img]);
      const k = keyOf(b);
      if (k === null || told.get(b) === k || petBefore(b) !== p || herImage(p) !== img || !decoded(img)) return;
      const s = seenAll([b, p, img]);
      if (s === 'unknown') return unknown();
      if (s !== 'yes') return;
      told.set(b, k);
      const line = appLine(b)!;
      io.said(line.from, line.text);
    });
  };
  const isWaveNow = (img: HTMLImageElement) => io.isWave(imageName(img.getAttribute('src') ?? ''));
  const image = (img: HTMLImageElement) => {
    if (!isWaveNow(img)) { waving.set(img, false); return; }
    if (waving.get(img)) return;
    once(img, async () => {
      if (waving.get(img)) return;
      await look.settle([img]);
      if (!isWaveNow(img) || waving.get(img) || !decoded(img)) return;
      const s = look.seen(img);
      if (s === 'unknown') return unknown();
      if (s !== 'yes') return;
      waving.set(img, true);
      io.waved(++waves);
    });
  };
  const pet = (p: Element) => {
    const b = bubbleAfter(p), img = herImage(p);
    if (b) bubble(b);
    if (img) image(img);
  };
  /* Everything about the buddy an element belongs to; anything else, everyone. */
  const judge = (t: Element) => {
    const b = t.closest('.db-bubble'), p = t.closest('.db-pet');
    if (b && root.contains(b)) { bubble(b); const before = petBefore(b); if (before) pet(before); return; }
    if (p && root.contains(p)) return pet(p);
    for (const each of root.querySelectorAll('.db-pet')) pet(each);
    for (const each of root.querySelectorAll('.db-bubble')) bubble(each);
  };
  const seen = (records: MutationRecord[]) => {
    for (const r of records) {
      const t = (r.target.nodeType === 1 ? r.target : r.target.parentElement) as Element | null;
      if (t) judge(t);
    }
  };
  const loaded = (e: Event) => { const t = e.target as Element; if (t.nodeName === 'IMG') judge(t); };
  root.addEventListener('load', loaded, true);
  const watcher = new MutationObserver(seen);
  watcher.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['src', 'hidden', 'style', 'class'] });
  return {
    stop: () => { watcher.disconnect(); root.removeEventListener('load', loaded, true); },
    flush: () => seen(watcher.takeRecords()),
    /* Judge everyone now, as an animation ending changes nothing a watcher sees. */
    recheck: () => judge(root)
  };
}
