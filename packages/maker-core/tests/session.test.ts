/* Starting up, saving and loading: what a Maker keeps between runs. */
import assert from 'node:assert';
import { test } from 'vitest';
import { SAMPLES, memoryStore, type MakerStore, type Saved } from '../src';
import { REF, buddy, frame, harness, started } from './harness';

test('a first run holds no buddy: nobody selected, the samples only offered, and saved', async () => {
  const h = harness();
  await h.maker.start();
  const { state } = h.maker;
  assert.strictEqual(state.pets.length, 0);
  assert.deepStrictEqual(h.built, []);
  assert.strictEqual(state.started, true);
  assert.strictEqual(h.maker.selected, null);
  assert.deepStrictEqual(SAMPLES.map(d => d.kind), ['pip']);
  assert.ok(SAMPLES.every(d => h.maker.thumb(d.kind).startsWith('data:image/png')));
  assert.strictEqual(h.saves(), 1);
  assert.deepStrictEqual(h.changes.at(-1), { scope: 'all' });
  await h.maker.addSample('pip');
  assert.deepStrictEqual(h.built, ['pip']);
  assert.deepStrictEqual(h.maker.state.pets.map(p => p.name), ['pip']);
});

test('defaults are there for what a store never held', async () => {
  const h = harness();
  await h.maker.start();
  const { bubbles, chatter, names } = h.maker.state;
  assert.deepStrictEqual({ bubbles, chatter, names }, { bubbles: true, chatter: 'normal', names: true });
});

test('removing everyone stays that way', async () => {
  const h = await started();
  h.maker.remove();
  const again = harness({ store: h.store });
  await again.maker.start();
  assert.strictEqual(again.maker.state.pets.length, 0);
  assert.strictEqual(again.maker.selected, null);
});

test('a store with buddies and no started mark keeps just them', async () => {
  const h = harness({ saved: { pets: [buddy()] } });
  await h.maker.start();
  assert.strictEqual(h.maker.state.pets.length, 1);
  assert.strictEqual(h.maker.state.pets[0]!.name, 'Ann');
  assert.strictEqual(h.maker.state.started, true);
});

/* As the first web maker saved it: no character, no kit, no faces, and settings it had switched off. */
const OLD = {
  started: true, bubbles: false, names: false, chatter: 'low',
  pets: [{ id: 'b1', name: 'Old', size: 90, base: frame('old'), ref: REF, poses: { walk: { frames: [frame('w')], fps: 6, scale: 1.2 } }, lines: { chat: ['hm'] } }]
} as unknown as Saved;

test('old saved state loads as it was, and only gains a character', async () => {
  const h = harness({ saved: OLD });
  await h.maker.start();
  const { state } = h.maker, p = state.pets[0]!;
  const { character, ...rest } = p;
  assert.deepStrictEqual(rest, OLD.pets![0]);
  assert.match(character!, /^c[a-z0-9]+$/);
  assert.deepStrictEqual([state.bubbles, state.names, state.chatter], [false, false, 'low']);
  assert.strictEqual(h.maker.selected, 'b1');
});

test('a character already there is kept', async () => {
  const h = await started([buddy({ character: 'ckeep' })]);
  assert.strictEqual(h.maker.state.pets[0]!.character, 'ckeep');
});

test('what a store has but the Maker no longer knows stays in the state', async () => {
  const h = harness({ saved: { ...OLD, gone: 1 } as Saved });
  await h.maker.start();
  assert.strictEqual((h.maker.state as unknown as { gone: number }).gone, 1);
});

test('a save survives a round trip through the store', async () => {
  const h = await started();
  h.maker.setFaces('left'); h.maker.setChatter('high'); h.maker.toggleNames();
  const again = harness({ store: h.store });
  await again.maker.start();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(again.maker.state)), JSON.parse(JSON.stringify(h.maker.state)));
});

test('a store that will not load starts empty, as a first run', async () => {
  const h = harness({ store: { load: () => Promise.reject(new Error('blocked')), save: async () => {} } });
  await h.maker.start();
  assert.strictEqual(h.maker.state.pets.length, 0);
  assert.deepStrictEqual(h.toasts, []);
});

test('a store that will not save warns once, and the world still follows', async () => {
  const failing: MakerStore = { load: async () => ({ pets: [buddy()], started: true }), save: () => Promise.reject(new Error('full')) };
  const h = harness({ store: failing });
  await h.maker.start();
  h.maker.toggleBubbles(); h.maker.toggleBubbles();
  await new Promise(r => setTimeout(r));
  assert.deepStrictEqual(h.toasts, ["Couldn't save in this browser — buddies will reset on reload"]);
  assert.strictEqual(h.order.filter(x => x === 'world').length, 3);
});

test('every save reaches the world before the store', async () => {
  const h = await started();
  h.maker.setFaces('left');
  assert.deepStrictEqual(h.order, ['world', 'store']);
});

test('fast changes save once, after the pause', async () => {
  const h = await started();
  for (const size of [100, 101, 102]) { h.maker.setSize(size); h.tick(100); }
  assert.strictEqual(h.saves(), 0);
  h.tick(150);
  assert.strictEqual(h.saves(), 1);
});

test('a save now takes the place of one waiting', async () => {
  const h = await started();
  h.maker.setSize(100);
  h.maker.setFaces('left');
  h.tick(1000);
  assert.strictEqual(h.saves(), 1);
});

test('exporting the page hands it the state, and saves what was still waiting', async () => {
  const h = await started();
  h.maker.setSize(100);
  h.maker.exportPage();
  assert.strictEqual(h.saves(), 1);
  h.tick(1000);
  assert.strictEqual(h.saves(), 1, 'once, not again when the wait ends');
  assert.strictEqual(h.pages[0], h.maker.state);
});

test('a listener can stop listening', async () => {
  const h = await started(); let heard = 0;
  const stop = h.maker.subscribe(() => { heard++; });
  h.maker.toggleNames(); stop(); h.maker.toggleNames();
  assert.strictEqual(heard, 1);
});

test('the memory store starts from what it is given', async () => {
  assert.deepStrictEqual(await memoryStore({ bubbles: false }).load(), { bubbles: false });
});

/* What a store hands back is checked as a .buddy file is: an older Maker, or a broken one, may have
   kept anything. A buddy that fails is never mended, only set aside as she was. */
const bad = (more: Record<string, unknown>) => ({ ...buddy(), ...more }) as unknown as ReturnType<typeof buddy>;
const BROKEN = { x0: 0, y0: 0, x1: 1, y1: 1 };
/* hands back the very objects it holds, so "as she was" can be the same object */
const holding = (saved: Saved): MakerStore => ({ load: async () => saved, save: async () => {} });

test('a damaged buddy is set aside as she was, the good one beside her loads, and the person is told once', async () => {
  const broken = bad({ id: 'b', name: 'Broken', base: { src: 'not an image', bb: BROKEN } });
  const h = harness({ saved: { started: true, pets: [buddy({ id: 'a' }), broken] } });
  await h.maker.start();
  assert.deepStrictEqual(h.maker.state.pets.map(p => p.id), ['a']);
  assert.deepStrictEqual(h.maker.state.setAside, [broken]);
  assert.deepStrictEqual(h.toasts, ['Couldn\'t open "Broken": what was saved is damaged. She\'s kept as she was, set aside.']);
});

test('set aside survives a save and the next load, once, and only a new one is told', async () => {
  const broken = bad({ id: 'b', name: 'Broken', size: 9999 });
  const h = harness({ saved: { started: true, pets: [buddy({ id: 'a' }), broken] } });
  await h.maker.start();
  h.maker.toggleBubbles();
  const again = harness({ store: h.store });
  await again.maker.start();
  assert.deepStrictEqual(again.maker.state.setAside, [broken]);
  assert.deepStrictEqual(again.maker.state.pets.map(p => p.id), ['a']);
  assert.deepStrictEqual(again.toasts, []);
  const saved = await h.store.load(), other = bad({ id: 'c', name: 'Other', faces: 'up' });
  const third = harness({ saved: { ...saved, pets: [...saved.pets!, other] } });
  await third.maker.start();
  assert.deepStrictEqual(third.maker.state.setAside, [broken, other]);
  assert.strictEqual(third.toasts.length, 1);
  assert.match(third.toasts[0]!, /"Other"/);
});

test('a buddy with any one part damaged is set aside whole, not mended', async () => {
  const w = frame('w');
  for (const more of [{ size: 9999 }, { name: 42 }, { stray: 1 }, { lines: { chat: ['Keep me', 7] } }, { lift: { floor: .1, wall: 999 } },
    { signature: { line: 'Keep this', weight: 999 } }, { kit: { mode: 'loud' } }, { poses: { walk: { frames: [w], fps: 6, scale: 40 } } },
    { poses: { walk: { frames: [w, { src: 'nope', bb: BROKEN }], fps: 6 } } }, { poses: { walk: { frames: [{ ...w, extra: 1 }] } } }]) {
    const raw = bad({ name: 'Bo', ...more });
    const h = harness({ store: holding({ started: true, pets: [raw] }) });
    await h.maker.start();
    assert.deepStrictEqual(h.maker.state.pets, [], JSON.stringify(more));
    assert.strictEqual(h.maker.state.setAside![0], raw, JSON.stringify(more));
    assert.strictEqual(h.toasts.length, 1);
  }
});

test('a loop or a deep nest in what was saved is set aside as it was, and never stops the Maker', async () => {
  const loop: Record<string, unknown> = {}; loop.self = loop;
  let deep: Record<string, unknown> = {}; const top = deep;
  for (let i = 0; i < 10000; i++) { deep.a = {}; deep = deep.a as Record<string, unknown>; }
  const looped = bad({ id: 'l', name: loop }), nested = bad({ id: 'n', poses: { walk: { frames: [top] } } }), deepName = bad({ id: 'd', name: top });
  const h = harness({ store: holding({ started: true, pets: [looped, buddy({ id: 'a' }), nested, deepName] }) });
  await h.maker.start();
  assert.deepStrictEqual(h.maker.state.pets.map(p => p.id), ['a']);
  const aside = h.maker.state.setAside!;
  assert.strictEqual(aside.length, 3);
  assert.ok(aside[0] === looped && aside[1] === nested && aside[2] === deepName);
  assert.strictEqual((looped as unknown as { name: unknown }).name, loop);
  assert.strictEqual(h.toasts.length, 1);
});

test('what is not a buddy at all, and a list that is not a list, are set aside too', async () => {
  const h = harness({ saved: { started: true, pets: [null, 5, buddy({ id: 'a' })] } as unknown as Saved });
  await h.maker.start();
  assert.deepStrictEqual(h.maker.state.pets.map(p => p.id), ['a']);
  assert.deepStrictEqual(h.maker.state.setAside, [null, 5]);
  assert.strictEqual(h.toasts.length, 1);
  const g = harness({ saved: { started: true, pets: 'lots' } as unknown as Saved });
  await g.maker.start();
  assert.deepStrictEqual(g.maker.state.pets, []);
  assert.deepStrictEqual(g.maker.state.setAside, ['lots']);
  assert.strictEqual(g.toasts.length, 1);
});

test('a name saved as undefined is no name, and loads quietly', async () => {
  const h = harness({ saved: { started: true, pets: [bad({ id: 'u', name: undefined })] } });
  await h.maker.start();
  const [u] = h.maker.state.pets;
  assert.ok(u && !('name' in u));
  assert.deepStrictEqual(h.toasts, []);
});

test('two saved buddies with one id, or none, each get their own', async () => {
  const h = harness({ saved: { started: true, pets: [buddy({ id: 'a', name: 'One' }), buddy({ id: 'a', name: 'Two' }), bad({ id: 7, name: 'Three' })] } });
  await h.maker.start();
  const ids = h.maker.state.pets.map(p => p.id);
  assert.deepStrictEqual(h.maker.state.pets.map(p => p.name), ['One', 'Two', 'Three']);
  assert.strictEqual(new Set(ids).size, 3);
  assert.ok(ids.every(id => typeof id === 'string'));
  assert.deepStrictEqual(h.toasts, []);
});

test('settings saved as something they cannot be come back as their defaults', async () => {
  const h = harness({ saved: { started: true, pets: [], bubbles: 'yes', names: 0, chatter: 'loud' } as unknown as Saved });
  await h.maker.start();
  const { bubbles, chatter, names } = h.maker.state;
  assert.deepStrictEqual({ bubbles, chatter, names }, { bubbles: true, chatter: 'normal', names: true });
  assert.deepStrictEqual(h.toasts, []);
});

test('good buddies load with no word said, and nothing set aside', async () => {
  const h = harness({ saved: OLD });
  await h.maker.start();
  assert.deepStrictEqual(h.toasts, []);
  assert.ok(!('setAside' in h.maker.state));
});
