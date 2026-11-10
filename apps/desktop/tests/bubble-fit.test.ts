// @vitest-environment happy-dom
/* The view's hold on her bubble: the engine places it by a guess at its size, and the view, which knows
   the real size, keeps it on the page and its tail at her. Sizes are set by hand here, since this page
   has no layout. With none, the view leaves the engine's place alone. */
import type { Frame, Input, PetFrame } from '@buddies/engine';
import assert from '@buddies/test-support/dom-assert';
import { createView } from '@buddies/view';
import { test } from 'vitest';

const W = 1280, H = 720;
/* a bubble the engine placed above her at x, its bottom at `up`, or below at `down`; she's at `her` */
const frame = (at: { x: number; up: number; down: number; her: number; mid?: number }, below = false, hidden = false): Frame => ({
  pets: [{
    id: 'a', size: '120px', src: 'data:image/png;base64,AAAA', origin: '60px 120px', body: 'none', grab: false, off: false,
    box: { l: 0, t: 0, size: 120, ox: 60, oy: 120 }, tf: 'translate(0px,0px)',
    bubble: { text: 'Hello', hidden, pop: 1, below, tf: `translate(${at.x}px,${below ? at.down : at.up}px) ${below ? 'translate(-50%,0)' : 'translate(-50%,-100%)'}`, at: { mid: 500, ...at } },
    tag: { text: '', hidden: true, tf: null }
  } as PetFrame],
  fx: []
});
function page(size: { w: number; h: number } | null) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const input = { down() {}, move() {}, up() {}, enter() {}, leave() {}, pointer() {} } as unknown as Input;
  const view = createView({ root, input, viewport: { x: 0, y: 0, scale: 1, w: W, h: H } });
  const start = { x: 640, up: 400, down: 600, her: 640 };
  view.apply(frame(start));
  const bub = root.querySelector<HTMLElement>('.db-bubble')!;
  if (size) for (const [k, v] of [['clientWidth', size.w], ['clientHeight', size.h]] as const) Object.defineProperty(bub, k, { configurable: true, get: () => v });
  let pop = 1;
  const show = (at: typeof start & { mid?: number }, below = false) => { const f = frame(at, below); f.pets[0]!.bubble.pop = ++pop; view.apply(f); return { tf: bub.style.transform, tail: bub.style.getPropertyValue('--tail'), below: bub.classList.contains('below'), ...(bub.classList.contains('away') ? { away: true } : {}) }; };
  return { bub, show };
}

test('where the engine put it fits, it stays just as the engine wrote it', () => {
  const p = page({ w: 200, h: 60 });
  assert.deepStrictEqual(p.show({ x: 640, up: 400, down: 600, her: 640 }), { tf: 'translate(640px,400px) translate(-50%,-100%)', tail: '', below: false });
});

test('past a side, it comes in, and its tail still points at her, short of its corners', () => {
  const p = page({ w: 200, h: 60 });
  /* the engine kept 70 from the left for a bubble 200 wide: 30 would be off the page */
  assert.deepStrictEqual(p.show({ x: 70, up: 400, down: 600, her: 36 }), { tf: 'translate(0.0px,340.0px)', tail: '-64.0px', below: false });
  /* she's further out than the tail can reach: it stops at the corner */
  assert.strictEqual(p.show({ x: 70, up: 400, down: 600, her: 0 }).tail, '-80.0px');
  assert.deepStrictEqual(p.show({ x: 1210, up: 400, down: 600, her: 1244 }), { tf: 'translate(1080.0px,340.0px)', tail: '64.0px', below: false });
  /* and back where it fits, the engine's place again */
  assert.deepStrictEqual(p.show({ x: 640, up: 400, down: 600, her: 640 }), { tf: 'translate(640px,400px) translate(-50%,-100%)', tail: '', below: false });
});

test('no room above her: below, if it fits there', () => {
  const p = page({ w: 200, h: 120 });
  assert.deepStrictEqual(p.show({ x: 640, up: 100, down: 300, her: 640 }), { tf: 'translate(540.0px,300.0px)', tail: '0.0px', below: true });
  /* and the other way: the engine said below, there's no room, above has it */
  assert.deepStrictEqual(p.show({ x: 640, up: 500, down: 650, her: 640 }, true), { tf: 'translate(540.0px,380.0px)', tail: '0.0px', below: false });
});

test('room on neither side: the side with more, kept on the page', () => {
  const p = page({ w: 240, h: 400 });
  /* 168 above, 10 below: above, from the top of the page */
  assert.deepStrictEqual(p.show({ x: 640, up: 168, down: 710, her: 640 }, true), { tf: 'translate(520.0px,0.0px)', tail: '0.0px', below: false });
  /* 100 above, 380 below: below, moved up until all of it is on the page */
  assert.deepStrictEqual(p.show({ x: 640, up: 100, down: 340, her: 640 }), { tf: 'translate(520.0px,320.0px)', tail: '0.0px', below: true });
  /* taller than the page: its top on the page */
  const q = page({ w: 240, h: 900 });
  assert.strictEqual(q.show({ x: 640, up: 300, down: 500, her: 640 }).tf, 'translate(520.0px,0.0px)');
});

test('a page with no layout measures nothing, and the engine\'s place stands', () => {
  const p = page(null);
  assert.deepStrictEqual(p.show({ x: 10, up: 5, down: 900, her: 0 }), { tf: 'translate(10px,5px) translate(-50%,-100%)', tail: '', below: false });
});

test('only the viewport her middle is in shows her bubble: a neighbour showing part of her shows none of it', () => {
  const p = page({ w: 240, h: 48 });
  /* her middle 110 px past this viewport's left edge: the next monitor's */
  const away = p.show({ x: -124, up: 506, down: 700, her: -110 });
  assert.strictEqual(away.away, true);
  assert.strictEqual(away.tf, 'translate(-124px,506px) translate(-50%,-100%)', 'and it is left where the engine put it');
  /* nor one below her monitor, with her middle above its top */
  assert.strictEqual(p.show({ x: 1156, up: -214, down: -10, her: 1244, mid: -60 }).away, true);
  /* she comes over: it's hers, and fitted */
  assert.deepStrictEqual(p.show({ x: 70, up: 506, down: 700, her: 20 }), { tf: 'translate(0.0px,458.0px)', tail: '-100.0px', below: false });
});
