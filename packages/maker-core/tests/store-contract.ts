/* What any place that keeps the Maker's state has to do. Run against every store: memory and
   IndexedDB here, and the hub's in apps/desktop/tests. */
import assert from 'node:assert';
import { describe, test } from 'vitest';
import type { MakerState, MakerStore, Saved } from '../src';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/* A store that keeps files can tell a real image from a pretend one. */
const image = (`data:image/png;base64,${btoa(String.fromCharCode(...SIGNATURE, 1, 2, 3))}`);
const BOX = { x0: .1, y0: .1, x1: .9, y1: 1 };
const REF = { ow: 300, oh: 300, w: 300, h: 300, cx: 150, by: 280, side: 280 };
const buddy = (more: Partial<MakerState['pets'][number]> = {}): MakerState['pets'][number] => ({ id: 'x', character: 'cabc', name: 'Ann', size: 120, faces: 'right', base: { src: image, bb: BOX }, ref: REF, poses: {}, ...more });
const state = (more: Partial<MakerState> = {}): MakerState => ({ pets: [buddy()], bubbles: true, chatter: 'normal', names: true, started: true, ...more });

export interface ContractStore {
  store: MakerStore;
  /* the same store after a restart, opened on what it was saving */
  again(): MakerStore | Promise<MakerStore>;
}
export interface Quirks {
  /* What loads when nothing was saved. */
  nothing?: Saved;
  /* A store with no first run says so itself, so `started` isn't what was saved. */
  alwaysStarted?: boolean;
  /* A store of files can't hold undefined: the field comes back absent, which reads the same. */
  undefinedIsAbsent?: boolean;
  /* A store that holds buddies, and not the switches about all of them. */
  onlyBuddies?: boolean;
}

export function storeContract(name: string, make: () => ContractStore | Promise<ContractStore>, quirks: Quirks = {}) {
  const held = (s: Partial<MakerState>): Partial<MakerState> => {
    if (!quirks.onlyBuddies) return s;
    const { pets, started } = s;
    return { pets, started };
  };
  describe(`the ${name} store`, () => {
    test('nothing saved loads as nothing', async () => {
      const { store } = await make();
      assert.deepStrictEqual(await store.load(), quirks.nothing ?? {});
    });
    test('what is saved loads back', async () => {
      const { store } = await make();
      await store.save(state());
      assert.deepStrictEqual(held(await store.load()), held(state()));
    });
    test('it survives a restart', async () => {
      const { store, again } = await make();
      await store.save(state({ chatter: 'high', pets: [buddy({ name: 'Bea' })] }));
      const back = await (await again()).load();
      if (!quirks.onlyBuddies) assert.strictEqual(back.chatter, 'high');
      assert.strictEqual(back.pets![0]!.name, 'Bea');
    });
    test('a later save replaces the earlier one whole', async () => {
      const { store } = await make();
      await store.save(state({ started: true }));
      const { started, ...rest } = state({ pets: [] });
      await store.save(rest);
      assert.deepStrictEqual(held(await store.load()), held(quirks.alwaysStarted ? { ...rest, started: true } : rest));
      assert.ok(started);
    });
    test('it holds a copy: changes after the save stay out', async () => {
      const { store } = await make(), s = state();
      await store.save(s);
      s.pets[0]!.name = 'changed'; s.bubbles = false;
      const back = await store.load();
      assert.strictEqual(back.pets![0]!.name, 'Ann');
      if (!quirks.onlyBuddies) assert.strictEqual(back.bubbles, true);
    });
    test('what it hands back is a copy too', async () => {
      const { store } = await make();
      await store.save(state());
      (await store.load()).pets![0]!.name = 'changed';
      assert.strictEqual((await store.load()).pets![0]!.name, 'Ann');
    });
    test('a field that is undefined survives', async () => {
      const { store } = await make();
      await store.save(state({ pets: [buddy({ name: undefined })] }));
      const p = (await store.load()).pets![0]!;
      assert.strictEqual('name' in p, !quirks.undefinedIsAbsent);
      assert.strictEqual(p.name, undefined);
    });
  });
}
