// @vitest-environment happy-dom
/* A friend saw Pip grow and shrink at random on the desktop. Her poses are cut at different sizes (her
   arms-up poses in a bigger square), and the view set a new size at once while the new picture was still
   loading, so for a frame or more the old picture was drawn at the new size. In a browser, an <img> keeps
   showing its old picture until the new one is decoded: that's what `painted` models here. */
import type { Frame, Input, PetFrame } from '@buddies/engine';
import { createView, WAIT_MS } from '@buddies/view';
import assert from 'node:assert';
import { afterEach, beforeEach, test, vi } from 'vitest';

const pet = (size: number, src: string, x = 0): Frame => ({
  pets: [{
    id: 'a', size: `${size}px`, src, origin: `${size / 2}px ${size}px`, body: 'none', grab: false, off: false, stage: '1 walk walk 1', parts: null,
    box: { l: x, t: 0, size, ox: size / 2, oy: size }, tf: `translate(${x}px,0px)`,
    bubble: { text: '', hidden: true, pop: 0, below: false, tf: null, at: null },
    tag: { text: '', hidden: true, tf: null }
  } as PetFrame],
  fx: []
});

/* decode() under the test's control: each picture decodes, or fails, when the test says */
const waiting = new Map<string, { ok: () => void; fail: () => void }>();
let decodedSrcs: Set<string>;
let clock = 0;
beforeEach(() => {
  waiting.clear(); decodedSrcs = new Set(); clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value(this: HTMLImageElement) {
      const src = this.getAttribute('src')!;
      if (decodedSrcs.has(src)) return Promise.resolve();
      return new Promise<void>((ok, fail) => waiting.set(src, { ok: () => { decodedSrcs.add(src); ok(); }, fail }));
    }
  });
});
afterEach(() => { vi.restoreAllMocks(); delete (HTMLImageElement.prototype as { decode?: unknown }).decode; });
const settle = () => new Promise(r => setTimeout(r, 0));

function page() {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const input = { down() {}, move() {}, up() {}, enter() {}, leave() {}, pointer() {} } as unknown as Input;
  const view = createView({ root, input, viewport: { x: 0, y: 0, scale: 1, w: 1280, h: 720 } });
  const el = () => root.querySelector<HTMLElement>('.db-pet')!, img = () => root.querySelector('img')!;
  /* What the screen shows: the picture an <img> last finished decoding, at the size its box has now. */
  let painted = '';
  const shown = () => { const s = img().getAttribute('src')!; if (decodedSrcs.has(s)) painted = s; return { picture: painted, size: el().style.width }; };
  return { view, el, img, shown, first(f: Frame) { view.apply(f); decodedSrcs.add(f.pets[0]!.src!); painted = f.pets[0]!.src!; } };
}

/* the sizes each picture was cut for: the square around her, which differs from pose to pose */
const SIZE: Record<string, string> = { 'stand.png': '120px', 'wave.png': '140px', 'sit.png': '123px', 'stand2.png': '120px' };

test('a new size waits for its new picture: the old picture is never drawn at the new size', async () => {
  const p = page();
  p.first(pet(120, 'stand.png'));
  p.view.apply(pet(140, 'wave.png', 4));
  const mid = p.shown();
  assert.strictEqual(mid.size, SIZE[mid.picture], `drawn ${mid.picture} at ${mid.size}`);
  assert.strictEqual(p.el().style.transform, 'translate(0px,0px)', 'and where she was, until it can change');
  waiting.get('wave.png')!.ok(); await settle();
  p.view.apply(pet(140, 'wave.png', 8));
  assert.deepStrictEqual(p.shown(), { picture: 'wave.png', size: '140px' });
  assert.strictEqual(p.el().style.transform, 'translate(8px,0px)');
});

test('a picture decoded before changes at once', async () => {
  const p = page();
  p.first(pet(120, 'stand.png'));
  p.view.apply(pet(140, 'wave.png')); waiting.get('wave.png')!.ok(); await settle(); p.view.apply(pet(140, 'wave.png'));
  p.view.apply(pet(123, 'sit.png')); waiting.get('sit.png')!.ok(); await settle(); p.view.apply(pet(123, 'sit.png'));
  p.view.apply(pet(140, 'wave.png'));
  assert.deepStrictEqual(p.shown(), { picture: 'wave.png', size: '140px' });
});

test('a new picture at the same size goes at once, as before', () => {
  const p = page();
  p.first(pet(120, 'stand.png'));
  p.view.apply(pet(120, 'stand2.png'));
  assert.strictEqual(p.img().getAttribute('src'), 'stand2.png');
});

test("a picture that can't load doesn't hold her: the change goes anyway", async () => {
  const p = page();
  p.first(pet(120, 'stand.png'));
  p.view.apply(pet(140, 'wave.png'));
  waiting.get('wave.png')!.fail(); await settle();
  p.view.apply(pet(140, 'wave.png'));
  assert.strictEqual(p.el().style.width, '140px');
  assert.strictEqual(p.img().getAttribute('src'), 'wave.png');
});

test(`one that never loads goes after ${WAIT_MS} ms`, () => {
  const p = page();
  p.first(pet(120, 'stand.png'));
  p.view.apply(pet(140, 'wave.png'));
  clock = WAIT_MS - 1; p.view.apply(pet(140, 'wave.png'));
  assert.strictEqual(p.el().style.width, '120px');
  clock = WAIT_MS + 1; p.view.apply(pet(140, 'wave.png'));
  assert.strictEqual(p.el().style.width, '140px');
});
