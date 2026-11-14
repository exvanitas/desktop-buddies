/* How the Maker probe tells a first-save stall from a slow machine. */
import assert from 'node:assert';
import { test } from 'vitest';
import { STALL_MS, STALL_X, median, stalls } from '../shell-check/firsts';

test('the runner\'s two stalls are stalls, against the first saves around them', () => {
  assert.deepStrictEqual(stalls([46500, 17300, 16700, 17000, 16900]), { median: 17000, stalled: [0] });
  assert.deepStrictEqual(stalls([12000, 11000, 75700, 12500, 11800]).stalled, [2]);
});

test('a slow machine is slow at all of them, and that isn\'t a stall', () => {
  assert.deepStrictEqual(stalls([30000, 34000, 36000, 31000, 33000]).stalled, []);
  assert.deepStrictEqual(stalls([8000, 9000, 24000, 8500, 9100]).stalled, [], 'under STALL_MS');
  assert.deepStrictEqual(stalls([20000, 21000, 40000, 22000, 20500]).stalled, [], 'under STALL_X times the median');
});

test('both bounds, at their edges, and the median', () => {
  assert.strictEqual(STALL_MS, 25000);
  assert.strictEqual(STALL_X, 2.5);
  assert.deepStrictEqual(stalls([10000, 10000, 25000, 10000, 10000]).stalled, [], 'not past 25 s');
  assert.deepStrictEqual(stalls([10000, 10000, 25001, 10000, 10000]).stalled, [2]);
  assert.strictEqual(median([3, 1, 2]), 2);
  assert.strictEqual(median([4, 1, 2, 3]), 2.5);
  assert.strictEqual(median([]), 0);
});

test('makerprobe.shaped: her first save and upgrade beside the same files written one by one', () => {
  /* a0e1bd8 and 5f6f944: the stalled first saves */
  assert.deepStrictEqual(stalls([46500, 17300, 16700]).stalled, [0]);
  assert.deepStrictEqual(stalls([75700, 16900, 18100]).stalled, [0]);
  /* 3436aee's 30 s upgrade, on a machine where the same files took 16 s one by one: slow, not a stall */
  assert.deepStrictEqual(stalls([9945, 30047, 16040]).stalled, []);
});
