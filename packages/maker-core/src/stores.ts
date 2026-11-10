/* Where the Maker's state is kept. Two stores, one contract: tests/stores.test.ts runs against both. */
import type { MakerState, MakerStore, Saved } from './deps';

declare function structuredClone<T>(value: T): T;

/* Holds a copy, as a real store would: later changes to the state don't reach what was saved. */
export function memoryStore(initial: Saved = {}): MakerStore {
  let held = structuredClone(initial);
  return {
    load: async () => structuredClone(held),
    save: async (state: MakerState) => { held = structuredClone(state); }
  };
}

/* The parts of IndexedDB used here. `indexedDB` fits this as it is. */
type Handler = ((e: never) => unknown) | null;
interface Request<T> { result: T; error: unknown; onsuccess: Handler; onerror: Handler }
interface Opening<T> extends Request<T> { onupgradeneeded: Handler }
interface Transaction {
  error: unknown; oncomplete: Handler; onerror: Handler;
  objectStore(name: string): { get(key: string): Request<unknown>; put(value: unknown, key: string): unknown };
}
interface Database { transaction(name: string, mode?: 'readonly' | 'readwrite'): Transaction; createObjectStore(name: string): unknown }
export interface IndexedDb { open(name: string, version: number): Opening<Database> }

/* State saved by any earlier version lives under these names, so they never change. */
const DB = 'desktop-buddies', STORE = 'kv', KEY = 'state';

export function indexedDbStore(idb: () => IndexedDb): MakerStore {
  function open() {
    return new Promise<Database>((res, rej) => {
      const r = idb().open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  let dbp: Promise<Database> | null = null; const db = () => (dbp = dbp || open());
  return {
    async load() {
      const d = await db();
      return new Promise<Saved>((res, rej) => { const q = d.transaction(STORE).objectStore(STORE).get(KEY) as Request<Saved | undefined>; q.onsuccess = () => res(q.result || {}); q.onerror = () => rej(q.error); });
    },
    async save(s) {
      const d = await db();
      await new Promise<void>((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(s, KEY); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
    }
  };
}
