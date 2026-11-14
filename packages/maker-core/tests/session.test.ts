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
