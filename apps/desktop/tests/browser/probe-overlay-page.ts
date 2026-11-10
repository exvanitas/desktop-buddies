/* The end-to-end run's overlay probe in a real browser: the real view, the real overlay CSS with its
   pop animation, the browser's own look. Each case stages one buddy, watches for `ms`, and returns
   what the probe told. probe-overlay.mjs runs them. Never ships. */
import type { Frame, Input } from '@buddies/engine';
import { createView } from '@buddies/view';
import { hex, platformLook, watchOverlay } from '../../shell-check/api-probe-core';

const input = { down() {}, move() {}, up() {}, enter() {}, leave() {}, pointer() {} } as unknown as Input;
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
type Bubble = Frame['pets'][number]['bubble'];
const frame = (bubble: Partial<Bubble>, src: string, off = false): Frame => ({ fx: [], pets: [{ id: 'b0', size: '120px', src, origin: null, body: null, grab: false, off, box: { l: 0, t: 0, size: 120, ox: 0, oy: 0 }, tf: 'translate(200px,200px)', bubble: { text: '', hidden: true, pop: 0, below: false, tf: 'translate(180px,150px)', at: null, ...bubble }, tag: { text: '', hidden: true, tf: null } }] });
export const LINE = 'He said "hi" \\ café \u{1F44B} a | b end\\';
const GOOD = '/img/s.webp', WAVE = '/img/w-good.webp', BROKEN = '/img/w-broken.webp', LATE = '/img/w-late.webp';
const said = { bubble: { text: LINE, from: 'E2E Check', hidden: false, pop: 1 } };

interface Told { said: string[]; waves: number[]; cannot: string[]; early?: Told }
/* One buddy on a fresh page: `before` shapes the page before her line or wave, `after` right after. */
async function stage(o: { bubble?: Partial<Bubble>; src?: string; off?: boolean; before?: (e: Els) => void; after?: (e: Els) => void | Promise<void>; peekAt?: number; ms?: number }): Promise<Told> {
  document.body.replaceChildren();
  const host = document.createElement('div'), root = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0';
  root.id = 'root'; root.style.cssText = 'position:fixed;inset:0;pointer-events:none';
  host.append(root); document.body.append(host);
  const view = createView({ root, input, viewport: { x: 0, y: 0, scale: 1, w: innerWidth, h: innerHeight } });
  const told: Told = { said: [], waves: [], cannot: [] };
  const w = watchOverlay(root, { said: (f, t) => told.said.push(`${hex(f)} ${hex(t)}`), waved: n => told.waves.push(n), isWave: n => n.startsWith('w-'), cannot: why => told.cannot.push(why) }, platformLook());
  const timer = setInterval(w.recheck, 200);
  view.apply(frame({}, GOOD));
  await new Promise<void>(done => { const i = root.querySelector('img')!; if (i.complete && i.naturalWidth) done(); else i.addEventListener('load', () => done(), { once: true }); });
  await pause(100);
  const els: Els = { host, root, view, pet: root.querySelector('.db-pet')!, body: root.querySelector('.db-body')!, img: root.querySelector('img')!, bubble: root.querySelector('.db-bubble')! };
  o.before?.(els);
  view.apply(frame(o.bubble ?? {}, o.src ?? GOOD, o.off));
  await o.after?.(els);
  if (o.peekAt !== undefined) { await pause(o.peekAt); told.early = { said: [...told.said], waves: [...told.waves], cannot: [...told.cannot] }; }
  await pause(o.ms ?? 2500);
  clearInterval(timer); w.stop();
  return told;
}
interface Els { host: HTMLElement; root: HTMLElement; view: ReturnType<typeof createView>; pet: Element; body: HTMLElement; img: HTMLImageElement; bubble: HTMLElement }

export const CASES: Record<string, () => Promise<Told>> = {
  /* told */
  shown: () => stage(said),
  mid_pop: () => stage({ ...said, peekAt: 60 }),
  /* her image fading in over a second: judged once it has landed, with her bubble, not before */
  image_fading_in: () => stage({ ...said, peekAt: 600, after: e => { e.img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1000 }); } }),
  late_show:() => stage({ ...said, before: e => { e.host.style.opacity = '0'; }, after: async e => { await pause(1000); e.host.style.opacity = ''; } }),
  /* never told */
  opacity_ancestor: () => stage({ ...said, before: e => { e.host.style.opacity = '0'; } }),
  detached: () => stage({ ...said, after: async e => { await pause(100); e.bubble.remove(); } }),
  zero_size: () => stage({ ...said, before: e => { e.bubble.style.cssText += ';width:0;height:0;padding:0;border:0;overflow:hidden;box-shadow:none'; } }),
  offscreen: () => stage({ ...said, before: e => { e.host.style.transform = 'translate(-5000px,-5000px)'; } }),
  hidden_body: () => stage({ ...said, before: e => { e.body.hidden = true; } }),
  hidden_img: () => stage({ ...said, before: e => { e.img.style.opacity = '0'; } }),
  /* her image held at opacity 0 for a second by a finite animation, and her bubble, seen once its pop
     ended, gone at half a second: the two were never seen together */
  never_together: () => stage({ ...said, after: async e => { e.img.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 1000 }); await pause(500); e.bubble.hidden = true; } }),
  missing_pet:() => stage({ ...said, after: async e => { await pause(100); e.pet.remove(); } }),
  /* waves */
  wave: () => stage({ src: WAVE }),
  wave_broken: () => stage({ src: BROKEN }),
  wave_late: () => stage({ src: LATE, peekAt: 300 }),
  wave_hidden_pet: () => stage({ src: WAVE, off: true }),
  /* a page that can't judge */
  cannot: async () => {
    const real = Element.prototype.checkVisibility;
    (Element.prototype as { checkVisibility?: unknown }).checkVisibility = undefined;
    try { return await stage({ ...said, src: WAVE }); } finally { Element.prototype.checkVisibility = real; }
  }
};
