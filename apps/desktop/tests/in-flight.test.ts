/* A few calls out at once, in order, and a failure that waits for the rest. */
import assert from 'node:assert';
import { test } from 'vitest';
import { inFlight } from '../src/in-flight';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const later = () => wait(Math.random() * 3);

test('never more than the most out at once, started in order, and each once', async () => {
  let out = 0, most = 0;
  const started: number[] = [];
  await inFlight(Array.from({ length: 50 }, (_, i) => i), 4, async i => {
    started.push(i); out++; most = Math.max(most, out);
    await later();
    out--;
  });
  assert.strictEqual(most, 4);
  assert.deepStrictEqual(started, Array.from({ length: 50 }, (_, i) => i));
});

test('fewer items than lanes, none, and a most below one', async () => {
  const seen: number[] = [];
  await inFlight([1, 2], 8, async i => { seen.push(i); });
  await inFlight([], 4, async () => { throw new Error('never called'); });
  let out = 0, most = 0;
  await inFlight([1, 2, 3], 0, async () => { out++; most = Math.max(most, out); await later(); out--; });
  assert.deepStrictEqual(seen, [1, 2]);
  assert.strictEqual(most, 1, 'one at a time');
});

test('after a failure nothing new starts, the ones out finish first, and the first failure is thrown', async () => {
  const started: number[] = [], finished: number[] = [];
  let release = () => {};
  const held = new Promise<void>(r => { release = r; });
  const run = inFlight(Array.from({ length: 20 }, (_, i) => i), 3, async i => {
    started.push(i);
    if (i === 1) { await wait(1); throw new Error('one'); }
    if (i === 2) { await wait(8); throw new Error('two'); }
    if (i === 0) await held;
    finished.push(i);
  });
  let settled = false;
  void run.then(() => { settled = true; }, () => { settled = true; });
  await wait(20);
  assert.strictEqual(settled, false, 'still waiting on the one out');
  release();
  await assert.rejects(run, /one/);
  assert.deepStrictEqual(started, [0, 1, 2], 'none started after the failure');
  assert.deepStrictEqual(finished, [0]);
});

test('a call that throws before it awaits is a failure like any other', async () => {
  await assert.rejects(inFlight([1, 2, 3], 2, (() => { throw new Error('at once'); }) as () => Promise<void>), /at once/);
});
