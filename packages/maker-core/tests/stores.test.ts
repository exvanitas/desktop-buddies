/* The store contract on the web's two stores, and what's IndexedDB's own. fake-indexeddb stands in
   for the browser here; the browser check in apps/maker reads the real one. */
import assert from 'node:assert';
import { IDBFactory as FakeIdb } from 'fake-indexeddb';
import { test } from 'vitest';
import { indexedDbStore, memoryStore, type IndexedDb, type MakerState } from '../src';
import { buddy } from './harness';
import { storeContract } from './store-contract';

const state = (more: Partial<MakerState> = {}): MakerState => ({ pets: [buddy()], bubbles: true, chatter: 'normal', names: true, started: true, ...more });

const fresh = () => new FakeIdb() as unknown as IDBFactory & IndexedDb;

storeContract('memory', () => { const store = memoryStore(); return { store, again: () => store }; });
storeContract('indexeddb', () => { const idb = fresh(); return { store: indexedDbStore(() => idb), again: () => indexedDbStore(() => idb) }; });

const raw = (idb: IDBFactory, write?: (db: IDBDatabase) => void) => new Promise<IDBDatabase>((res, rej) => {
  const r = idb.open('desktop-buddies', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => { write?.(r.result); res(r.result); };
  r.onerror = () => rej(r.error);
});

test('state saved under the old names loads', async () => {
  const idb = fresh();
  const db = await raw(idb);
  await new Promise<void>(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put({ bubbles: false, pets: [] }, 'state'); t.oncomplete = () => res(); });
  db.close();
  assert.deepStrictEqual(await indexedDbStore(() => idb).load(), { bubbles: false, pets: [] });
});

test('a save goes under the old names', async () => {
  const idb = fresh();
  await indexedDbStore(() => idb).save(state({ chatter: 'low' }));
  const db = await raw(idb);
  const got = await new Promise<MakerState>(res => { const q = db.transaction('kv').objectStore('kv').get('state'); q.onsuccess = () => res(q.result as MakerState); });
  assert.strictEqual(got.chatter, 'low');
});

test('with no IndexedDB, loading and saving reject for the Maker to handle', async () => {
  const store = indexedDbStore(() => { throw new Error('no IndexedDB here'); });
  await assert.rejects(store.load(), /no IndexedDB here/);
  await assert.rejects(store.save(state()), /no IndexedDB here/);
});

test('a database that will not open rejects', async () => {
  const opening = { error: new Error('blocked'), onerror: null as (() => void) | null };
  setTimeout(() => opening.onerror?.());
  const store = indexedDbStore(() => ({ open: () => opening }) as unknown as IndexedDb);
  await assert.rejects(store.load(), /blocked/);
});
