/* The contract for a wire. The real one and the test one run the same suite, so tests on the memory
   bus mean something for the BroadcastChannel. */
import assert from 'node:assert';
import { afterEach, describe, test } from 'vitest';
import { broadcastWire, createBus, type Wire } from '../src/wire';

const settle = () => new Promise(r => setTimeout(r, 30));
let n = 0;
const makers: [string, () => () => Wire<unknown>][] = [
  ['BroadcastChannel', () => { const name = `test-${++n}`; return () => broadcastWire(name); }],
  ['memory bus', () => { const bus = createBus<unknown>(); return () => bus.wire(); }]
];

describe.each(makers)('%s', (_, make) => {
  const open: Wire<unknown>[] = [];
  const pages = () => { const w = make(); return () => { const e = w(); open.push(e); return e; }; };
  const hears = (w: Wire<unknown>) => { const got: unknown[] = []; w.listen(m => got.push(m)); return got; };
  afterEach(() => { for (const w of open.splice(0)) w.close(); });

  test('the others hear it, in order, and the sender doesn\'t', async () => {
    const page = pages(), a = page(), b = page(), c = page();
    const [heardA, heardB, heardC] = [hears(a), hears(b), hears(c)];
    a.post(1); a.post(2); a.post(3);
    await settle();
    assert.deepStrictEqual(heardA, []);
    assert.deepStrictEqual(heardB, [1, 2, 3]);
    assert.deepStrictEqual(heardC, [1, 2, 3]);
  });

  test('what arrives is a copy', async () => {
    const page = pages(), a = page(), b = page(), got = hears(b), m = { list: [1] };
    a.post(m); m.list.push(2);
    await settle();
    assert.deepStrictEqual(got, [{ list: [1] }]);
  });

  test('something that can\'t be copied is refused at once', () => {
    const page = pages(), a = page();
    assert.throws(() => a.post({ f() {} }));
  });

  test('a post with nobody listening is nothing', async () => {
    const page = pages(), a = page();
    a.post('anyone');
    await settle();
  });

  test('a closed page hears nothing more, and what it left behind doesn\'t matter', async () => {
    const page = pages(), a = page(), b = page(), got = hears(b);
    a.post(1); await settle();
    b.close();
    a.post(2); await settle();
    assert.deepStrictEqual(got, [1]);
  });

  test('a page that opens later hears only what comes after', async () => {
    const page = pages(), a = page();
    a.post('before'); await settle();
    const b = page(), got = hears(b);
    a.post('after'); await settle();
    assert.deepStrictEqual(got, ['after']);
  });
});

test('one bus doesn\'t reach another', async () => {
  const a = createBus<number>().wire(), b = createBus<number>().wire(), got: number[] = [];
  b.listen(m => got.push(m));
  a.post(1); await settle();
  assert.deepStrictEqual(got, []);
});
