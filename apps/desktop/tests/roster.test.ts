/* Who's out, and how many copies. */
import assert from 'node:assert';
import { test } from 'vitest';
import { MAX_COPIES, copyId, createRoster } from '../src/roster';

test('copies go newest first, and the last one is the character itself', () => {
  const r = createRoster();
  r.add('a'); r.add('a'); r.add('a');
  assert.strictEqual(r.drop('a'), 'a~2');
  assert.strictEqual(r.drop('a'), 'a~1');
  assert.strictEqual(r.drop('a'), 'a');
  assert.strictEqual(r.count('a'), 0);
  assert.strictEqual(r.drop('a'), null);
});

test('clear names every copy', () => {
  const r = createRoster();
  r.add('a'); r.add('a'); r.add('b');
  assert.deepStrictEqual(r.clear('a'), ['a', 'a~1']);
  assert.deepStrictEqual(r.list(), ['b']);
  assert.deepStrictEqual(r.clear('a'), []);
});

test('the list repeats an id per copy, so an old settings file reads the same', () => {
  const r = createRoster();
  r.load(['a', 'b', 'a']);
  assert.strictEqual(r.count('a'), 2);
  assert.strictEqual(r.count('b'), 1);
  assert.deepStrictEqual(r.list().sort(), ['a', 'a', 'b']);
  r.load(['c']);
  assert.deepStrictEqual(r.list(), ['c']);
});

test('copies stop at the limit, on the way in and from a file', () => {
  const r = createRoster();
  for (let i = 0; i < MAX_COPIES; i++) assert.ok(r.add('a'));
  assert.strictEqual(r.add('a'), false);
  assert.strictEqual(r.count('a'), MAX_COPIES);
  r.load(Array.from({ length: 100 }, () => 'b'));
  assert.strictEqual(r.count('b'), MAX_COPIES);
});

test('keep forgets anyone not known', () => {
  const r = createRoster();
  r.load(['a', 'gone']);
  r.keep(new Set(['a']));
  assert.deepStrictEqual(r.list(), ['a']);
});

test('a copy\'s id can\'t be a character\'s', () => {
  assert.strictEqual(copyId('a', 0), 'a');
  assert.doesNotMatch(copyId('a', 1), /^[A-Za-z0-9_-]{1,64}$/);
});
