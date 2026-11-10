// @vitest-environment happy-dom
/* The panel on a page that isn't a browser, over the real Maker. These hold its two rules (images
   are escaped in markup, every import goes through BuddyFile.read) and that its controls reach the
   Maker. tests/browser/run.mjs does the rest in a real browser. */
import { read, write, type Buddy, type Frame } from '@buddies/buddy-file';
import { createMaker, memoryStore, type MakerBuddy, type MakerFile, type Saved } from '@buddies/maker-core';
import assert from '@buddies/test-support/dom-assert';
import { test } from 'vitest';
import { createPanel } from '../src/panel.js';

const BOX = { x0: 0, y0: 0, x1: 1, y1: 1 };
const IMAGE = 'data:image/png;base64,AAAA';
const HOSTILE = 'x" onerror="window.__pwned=1';
const NAME = '<img src=x onerror="window.__pwned=1">';
const art = (src: string): Frame => ({ src, bb: BOX });
const pet = (more: Partial<MakerBuddy> = {}): MakerBuddy => ({ id: 'a', character: 'ca', name: 'Ann', size: 120, faces: 'right', base: art(IMAGE), poses: {}, ...more });
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r)); };

async function mount(pets: MakerBuddy[], saved: Saved = { pets, started: true }) {
  const toasts: string[] = [], box = document.createElement('div');
  document.body.replaceChildren(box);
  const maker = createMaker({
    store: memoryStore(saved), world: { sync() {}, act() {} }, toast: m => { toasts.push(m); },
    art: {
      processBase: async src => ({ frame: art(src), ref: { ow: 1, oh: 1, w: 1, h: 1, cx: 0, by: 1, side: 1 }, photo: false }),
      processFrames: async srcs => ({ frames: srcs.map(art), scale: 1 }), matchScale: async () => 1, bottomOf: async () => 1, fromShimeji: async () => null, natSort: (a, b) => a.localeCompare(b)
    },
    samples: { build: async () => ({ base: art(IMAGE), poses: {} }), thumb: () => IMAGE },
    readImage: async () => IMAGE, exportPage() {},
    after: (ms, f) => window.setTimeout(f, ms), cancel: id => clearTimeout(id), random: () => .5
  });
  createPanel(box, maker, { toast: m => { toasts.push(m); } });
  await maker.start();
  const $ = <E extends HTMLElement>(s: string) => box.querySelector<E>(s)!;
  const click = (s: string) => { $(s).click(); };
  const pick = async (s: string, ...files: MakerFile[]) => {
    const input = $<HTMLInputElement>(s);
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    await tick();
  };
  const type = (s: string, value: string) => { const i = $<HTMLInputElement>(s); i.value = value; i.dispatchEvent(new Event('input')); };
  return { box, maker, toasts, $, click, pick, type, pets: () => box.querySelectorAll('.pn-pet').length, injected: () => box.querySelectorAll('[onerror]').length };
}
const textFile = (text: string): MakerFile => ({ name: 'pip.buddy', type: '', text: async () => text });

test('a first start holds no buddy, and offers the samples and Add', async () => {
  const v = await mount([], {});
  assert.strictEqual(v.maker.state.pets.length, 0);
  assert.strictEqual(v.pets(), 0);
  assert.ok(v.$('.pn-ed').hidden);
  assert.deepStrictEqual([...v.box.querySelectorAll('.pn-sample')].map(b => b.getAttribute('aria-label')!.split(' ')[1]), ['Pip', 'Pudding', 'Sprout']);
  assert.ok(v.$('.pn-add'));
});

test('the main image is escaped in a buddy\'s tab', async () => {
  const v = await mount([pet({ base: art(HOSTILE) })]);
  assert.strictEqual(v.injected(), 0);
  assert.ok(v.$('.pn-pet i').getAttribute('style')!.includes(HOSTILE));
});

test('a name is escaped in a buddy\'s tab', async () => {
  const v = await mount([pet({ name: NAME })]);
  assert.strictEqual(v.injected(), 0);
  assert.strictEqual(v.$('.pn-pet span').textContent, NAME);
});

test('an image is escaped in the pose grid', async () => {
  const v = await mount([pet({ poses: { walk: { frames: [art(HOSTILE)] } } })]);
  assert.strictEqual(v.injected(), 0);
  assert.ok([...v.box.querySelectorAll('.pn-pose img')].some(i => i.getAttribute('src') === HOSTILE));
});

test('the main image is escaped where an empty pose borrows it', async () => {
  const v = await mount([pet({ base: art(HOSTILE) })]);
  assert.strictEqual(v.injected(), 0);
  assert.strictEqual(v.$('.pn-pose img').getAttribute('src'), HOSTILE);
});

test('a frame is escaped in the pose editor', async () => {
  const v = await mount([pet({ poses: { walk: { frames: [art(IMAGE), art(HOSTILE)] } } })]);
  v.maker.togglePose(v.maker.current()!, 'walk');
  assert.strictEqual(v.injected(), 0);
  assert.strictEqual(v.box.querySelectorAll('.pn-frame img')[1]!.getAttribute('src'), HOSTILE);
});

test('a buddy file comes in through BuddyFile.read', async () => {
  const v = await mount([pet()]);
  const b: Buddy = { character: 'cfile', name: 'Filed', base: art(IMAGE), poses: {} };
  await v.pick('.pn-import', textFile(write(b)));
  assert.strictEqual(v.pets(), 2);
  assert.strictEqual(v.maker.current()!.character, 'cfile');
  assert.deepStrictEqual(v.toasts, []);
});

test('a file read refuses is refused at the panel, with an image that markup would have let through', async () => {
  const v = await mount([pet()]);
  await v.pick('.pn-import', textFile(write({ character: 'cfile', base: art(HOSTILE), poses: {} })));
  assert.strictEqual(v.pets(), 1);
  assert.strictEqual(v.injected(), 0);
  assert.deepStrictEqual(v.toasts, ["That isn't a Desktop Buddies file"]);
});

test('a version 1 file comes in upgraded, which only read does', async () => {
  const v = await mount([pet()]);
  await v.pick('.pn-import', textFile(JSON.stringify({ app: 'desktop-buddies', version: 1, buddy: { name: 'Old', base: art(IMAGE), poses: {} } })));
  assert.match(v.maker.current()!.character!, /^c[a-z0-9]+$/);
});

test('tabs select, and the editor follows', async () => {
  const v = await mount([pet(), pet({ id: 'b', name: 'Bo' })]);
  assert.strictEqual(v.$<HTMLInputElement>('.pn-name').value, 'Ann');
  (v.box.querySelectorAll('.pn-pet')[1] as HTMLElement).click();
  assert.strictEqual(v.maker.selected, 'b');
  assert.strictEqual(v.$<HTMLInputElement>('.pn-name').value, 'Bo');
  assert.strictEqual(v.$('.pn-pet[aria-selected="true"] span').textContent, 'Bo');
});

test('typing a name renames the tab as you type', async () => {
  const v = await mount([pet()]);
  v.type('.pn-name', 'Mochi');
  assert.strictEqual(v.maker.current()!.name, 'Mochi');
  assert.strictEqual(v.$('.pn-pet span').textContent, 'Mochi');
  v.type('.pn-name', '');
  assert.strictEqual(v.$('.pn-pet span').textContent, 'No name');
});

test('the size slider moves its number', async () => {
  const v = await mount([pet()]);
  v.type('.pn-size', '200');
  assert.strictEqual(v.maker.current()!.size, 200);
  assert.strictEqual(v.$('.pn-rng output').textContent, '200');
});

test('Remove asks once, then removes', async () => {
  const v = await mount([pet(), pet({ id: 'b', name: 'Bo' })]);
  v.click('.pn-rm');
  assert.strictEqual(v.$('.pn-rm').textContent, 'Click again to remove Ann');
  assert.strictEqual(v.pets(), 2);
  v.click('.pn-rm');
  assert.strictEqual(v.pets(), 1);
  assert.strictEqual(v.$('.pn-rm').textContent, 'Remove buddy');
});

test('choosing something else takes back the question', async () => {
  const v = await mount([pet(), pet({ id: 'b', name: 'Bo' })]);
  v.click('.pn-rm');
  (v.box.querySelectorAll('.pn-pet')[1] as HTMLElement).click();
  assert.strictEqual(v.$('.pn-rm').textContent, 'Remove buddy');
  v.click('.pn-rm');
  assert.strictEqual(v.pets(), 2);
});

test('a pose opens from the grid, shows its frames, and they move and go', async () => {
  const v = await mount([pet({ poses: { walk: { frames: [art('data:image/png;base64,AAAA'), art('data:image/png;base64,BBBB')], fps: 6 } } })]);
  (v.box.querySelector('.pn-pose.own') as HTMLElement).click();
  assert.strictEqual(v.maker.openPose, 'walk');
  assert.strictEqual(v.$('.pn-pose-ed').hidden, false);
  v.click('.pn-frame [data-a=r]');
  assert.strictEqual(v.maker.current()!.poses.walk!.frames[0]!.src, 'data:image/png;base64,BBBB');
  v.click('.pn-frame [data-a=x]');
  assert.strictEqual(v.box.querySelectorAll('.pn-frame').length, 1);
  v.click('.pn-frame [data-a=x]');
  assert.strictEqual(v.maker.current()!.poses.walk, undefined);
  assert.ok(v.$('.pn-frames .pn-drop').textContent!.startsWith('Drop images here'));
});

test('the speed and scale sliders move their numbers, and stay where they are', async () => {
  const v = await mount([pet({ poses: { walk: { frames: [art(IMAGE)], fps: 6, scale: 1 } } })]);
  v.maker.togglePose(v.maker.current()!, 'walk');
  const fps = v.$('.pn-pe-fps');
  v.type('.pn-pe-fps', '12'); v.type('.pn-pe-scale', '150');
  const p = v.maker.current()!.poses.walk!;
  assert.deepStrictEqual([p.fps, p.scale], [12, 1.5]);
  assert.strictEqual(v.$('.pn-pe-fps + output').textContent, '12 fps');
  assert.strictEqual(v.$('.pn-pe-scale + output').textContent, '150%');
  assert.ok(fps === v.$('.pn-pe-fps'), 'the slider being dragged was redrawn');
});

test('the menus offer what the art allows', async () => {
  const v = await mount([pet()]);
  const dance = () => v.$('.pn-acts .pn-act[data-a=dance]').hidden;
  assert.strictEqual(dance(), true);
  v.maker.current()!.poses.dance = { frames: [art(IMAGE)] };
  v.maker.clearPose(v.maker.current()!, 'sit');
  assert.strictEqual(dance(), false);
});

test('the kit fields fill in, and appearance brings the prompts', async () => {
  const v = await mount([pet()]);
  assert.strictEqual(v.$<HTMLInputElement>('.pn-k-quality').value, 'masterpiece, best quality');
  assert.ok(v.$('.pn-k-imgs .pn-drop'));
  v.type('.pn-k-look', 'round, green');
  assert.strictEqual(v.box.querySelectorAll('.pn-kp').length, 11);
  v.click('.pn-k-more');
  assert.strictEqual(v.box.querySelectorAll('.pn-kp').length, 31);
});

test('a reply that applies clears the box, and one that does not stays', async () => {
  const v = await mount([pet()]);
  const reply = v.$<HTMLTextAreaElement>('.pn-k-reply');
  reply.value = 'nope'; v.click('.pn-k-apply');
  assert.strictEqual(reply.value, 'nope');
  reply.value = '{"chat":["hi"]}'; v.click('.pn-k-apply');
  assert.strictEqual(reply.value, '');
  assert.strictEqual(v.$('.pn-k-stat').textContent, "Using Ann's own lines for 1 of 33 situations (the rest use defaults).");
});

test('the settings for everyone show their state', async () => {
  const v = await mount([pet()]);
  v.click('.pn-bub');
  assert.strictEqual(v.$('.pn-bub').getAttribute('aria-pressed'), 'false');
  v.click('.pn-chat [data-v=off]');
  assert.strictEqual(v.$('.pn-chat [data-v=off]').getAttribute('aria-pressed'), 'true');
  assert.strictEqual(v.maker.state.chatter, 'off');
});

test('with nobody left the editor hides', async () => {
  const v = await mount([pet()]);
  v.click('.pn-rm'); v.click('.pn-rm');
  assert.strictEqual(v.$('.pn-ed').hidden, true);
  assert.strictEqual(v.$('.pn-count').textContent, '0 / 8');
});

test('an upload finishing after a switch leaves the new buddy\'s poses on screen', async () => {
  const other = 'data:image/png;base64,BBBB', v = await mount([pet(), pet({ id: 'b', name: 'Bo', base: art(other) })]);
  const ann = v.maker.current()!;
  v.maker.togglePose(ann, 'walk');
  const going = v.maker.addFrames(ann, [{ name: 'a.png', type: 'image/png', text: async () => '' }]);
  v.maker.select('b');
  await going;
  assert.ok(ann.poses.walk, 'Ann got her frames');
  assert.strictEqual(v.box.querySelector<HTMLImageElement>('.pn-pose img')!.getAttribute('src'), other);
});

test('a buddy file with her own lift comes in, keeps it through edits that never touch it, and goes out with it', async () => {
  const v = await mount([pet()]);
  await v.pick('.pn-import', textFile(write({ character: 'clift', name: 'Lifted', size: 120, lift: { floor: -.05, ceiling: .2 }, base: art(IMAGE), poses: {} })));
  assert.deepStrictEqual(v.maker.current()!.lift, { floor: -.05, ceiling: .2 });
  /* a new buddy here takes the Maker's defaults, so what goes out is compared with what went out first */
  const out = v.maker.buddyFile()!.text;
  assert.deepStrictEqual(read(out).lift, { floor: -.05, ceiling: .2 });
  v.type('.pn-size', '200');
  v.type('.pn-name', 'Still lifted');
  assert.deepStrictEqual(v.maker.current()!.lift, { floor: -.05, ceiling: .2 });
  v.type('.pn-name', 'Lifted'); v.type('.pn-size', '120');
  assert.strictEqual(v.maker.buddyFile()!.text, out);
});
