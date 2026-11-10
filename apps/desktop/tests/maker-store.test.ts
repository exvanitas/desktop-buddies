/* The hub's store: the same contract as the web's two, then what's its own. */
import assert from 'node:assert';
import { read, write } from '@buddies/buddy-file';
import { test } from 'vitest';
import { storeContract } from '../../../packages/maker-core/tests/store-contract';
import { kitOf } from '@buddies/maker-core';
import { canon, createHubStore } from '../src/maker-store';
import { createDisk, frame, hubOn, small, type HubRun } from './maker-harness';

/* Timers that fire at once, except the wait for an answer, which never comes due here. */
const after = (ms: number, f: () => void) => { if (ms >= 30000) return () => {}; const t = setTimeout(f); return () => clearTimeout(t); };
const storeOn = (r: HubRun, open?: string) => createHubStore({ wire: r.bus.wire(), session: `s${Math.random()}`, open, after });

storeContract('hub', async () => {
  const exe = createDisk();
  const r = await hubOn(exe);
  return {
    store: storeOn(r),
    async again() { return storeOn(await hubOn(exe), 'cabc'); }
  };
}, { nothing: { started: true, pets: [] }, alwaysStarted: true, undefinedIsAbsent: true, onlyBuddies: true });

test('a window that opened nobody holds nobody, whatever the library holds', async () => {
  const r = await hubOn(createDisk());
  assert.deepStrictEqual((await storeOn(r).load()).pets, []);
});

test('a buddy dropped from the window stays in the library', async () => {
  const exe = createDisk(), r = await hubOn(exe), store = storeOn(r);
  const state = { pets: [{ ...small('c1'), id: 'c1' }], bubbles: true, chatter: 'normal' as const, names: true };
  await store.save(state);
  assert.ok(exe.files.has('library/c1/buddy.json'));
  await store.save({ ...state, pets: [] });
  assert.ok(exe.files.has('library/c1/buddy.json'), 'still there');
});

test('a save rejects when it can\'t land, for whoever awaits it', async () => {
  const exe = createDisk(), r = await hubOn(exe), store = storeOn(r);
  exe.failUntil('data_write', 'disk full', () => true);
  await assert.rejects(store.save({ pets: [{ ...small('c1'), id: 'c1' }], bubbles: true, chatter: 'normal', names: true }), /not saved/);
});

test('canon ignores key order, the window\'s id and a kit filled in by reading it', () => {
  const b = { ...read(write(small('c1'))), id: 'one' };
  const shuffled = { id: 'two', poses: b.poses, base: b.base, name: b.name, character: b.character };
  assert.strictEqual(canon(b), canon(shuffled));
  assert.strictEqual(canon(b), canon({ ...b, kit: kitOf(b) }));
});

test('canon sees a real edit in any field', () => {
  const b = { ...small('c1'), id: 'c1', size: 100, faces: 'left' as const }, base = canon(b);
  for (const edit of [{ name: 'x' }, { size: 101 }, { faces: 'right' as const }, { base: frame('other') }, { poses: {} }, { lines: { chat: ['hi'] } }, { kit: { personality: 'kind' } }, { ref: { ow: 1, oh: 1, w: 1, h: 1, cx: 0, by: 0, side: 1 } }, { signature: { weight: 1 } }]) {
    assert.notStrictEqual(canon({ ...b, ...edit }), base, JSON.stringify(Object.keys(edit)));
  }
});
