/* A situation's lines, one at a time. A buddy's list replaces the default list whole, as in voice.ts,
   and nothing here can write what a buddy file wouldn't take back. */
import assert from 'node:assert';
import { LIMIT, read, write } from '@buddies/buddy-file';
import { LINES } from '@buddies/engine';
import { test } from 'vitest';
import { hasOwnLines, linesOf } from '../src';
import { buddy, started } from './harness';

test('a buddy with no list of its own says the defaults', () => {
  const p = buddy();
  assert.deepStrictEqual(linesOf(p, 'hello'), LINES.hello);
  assert.strictEqual(hasOwnLines(p, 'hello'), false);
});

test('an empty own list is no list, as in voice.ts', () => {
  const p = buddy({ lines: { hello: [] } });
  assert.deepStrictEqual(linesOf(p, 'hello'), LINES.hello);
  assert.strictEqual(hasOwnLines(p, 'hello'), false);
});

test('the first change copies the defaults and leaves them alone', async () => {
  const h = await started(), p = h.maker.current()!, before = [...LINES.hello];
  assert.strictEqual(h.maker.setLine('hello', 1, 'Hiya'), true);
  assert.deepStrictEqual(p.lines!.hello, [before[0], 'Hiya', ...before.slice(2)]);
  assert.deepStrictEqual(LINES.hello, before);
});

test('one past the end adds a line, and further is refused', async () => {
  const h = await started([buddy({ lines: { hello: ['a'] } })]), p = h.maker.current()!;
  assert.strictEqual(h.maker.setLine('hello', 1, 'b'), true);
  assert.deepStrictEqual(p.lines!.hello, ['a', 'b']);
  assert.strictEqual(h.maker.setLine('hello', 3, 'c'), false);
  assert.strictEqual(h.maker.setLine('hello', -1, 'c'), false);
  assert.deepStrictEqual(p.lines!.hello, ['a', 'b']);
});

test('a line the file would refuse is refused here', async () => {
  const h = await started([buddy({ lines: { hello: ['a'] } })]), p = h.maker.current()!;
  assert.strictEqual(h.maker.setLine('hello', 0, 'x'.repeat(LIMIT.line + 1)), false);
  assert.strictEqual(h.maker.setLine('hello', 0, 'x'.repeat(LIMIT.line)), true);
  p.lines!.hello = Array<string>(LIMIT.lines).fill('z');
  assert.strictEqual(h.maker.setLine('hello', LIMIT.lines, 'one too many'), false);
  assert.strictEqual(h.maker.setLine('hello', LIMIT.lines - 1, 'last'), true);
  assert.strictEqual(read(write(p)).lines!.hello!.length, LIMIT.lines);
});

test('typing saves on the slow save, and removing saves now', async () => {
  const h = await started([buddy({ lines: { hello: ['a', 'b'] } })]);
  h.maker.setLine('hello', 0, 'c');
  assert.strictEqual(h.saves(), 0);
  h.tick(250);
  assert.strictEqual(h.saves(), 1);
  h.maker.removeLine('hello', 0);
  assert.strictEqual(h.saves(), 2);
  assert.deepStrictEqual(h.changes.at(-1), { scope: 'field' });
});

test('removing the last line goes back to the defaults', async () => {
  const h = await started([buddy({ lines: { hello: ['only'] } })]), p = h.maker.current()!;
  h.maker.removeLine('hello', 0);
  assert.strictEqual(hasOwnLines(p, 'hello'), false);
  assert.strictEqual(p.lines, undefined);
  assert.deepStrictEqual(linesOf(p, 'hello'), LINES.hello);
});

test('removing a default line makes the rest the buddy\'s own', async () => {
  const h = await started(), p = h.maker.current()!;
  h.maker.removeLine('hello', 0);
  assert.deepStrictEqual(p.lines!.hello, LINES.hello.slice(1));
});

test('removing out of range does nothing', async () => {
  const h = await started([buddy({ lines: { hello: ['a'] } })]), p = h.maker.current()!;
  h.maker.removeLine('hello', 1); h.maker.removeLine('hello', -1);
  assert.deepStrictEqual(p.lines!.hello, ['a']);
  assert.strictEqual(h.saves(), 0);
});

test('use the defaults takes back one situation and keeps the others', async () => {
  const h = await started([buddy({ lines: { hello: ['a'], love: ['b'] } })]), p = h.maker.current()!;
  h.maker.useDefaultLines('hello');
  assert.deepStrictEqual(p.lines, { love: ['b'] });
  assert.strictEqual(h.saves(), 1);
});

test('tidying drops blanks, and a list of only blanks goes back to the defaults', async () => {
  const h = await started([buddy({ lines: { hello: ['a', ' ', ''], love: [''] } })]), p = h.maker.current()!;
  h.maker.tidyLines('hello'); h.maker.tidyLines('love');
  assert.deepStrictEqual(p.lines, { hello: ['a'] });
  assert.strictEqual(h.saves(), 2);
});

test('tidying with nothing to tidy saves nothing', async () => {
  const h = await started([buddy({ lines: { hello: ['a'] } })]);
  h.maker.tidyLines('hello'); h.maker.tidyLines('love');
  assert.strictEqual(h.saves(), 0);
});

test('with no buddy, line changes do nothing', async () => {
  const h = await started([]);
  assert.strictEqual(h.maker.setLine('hello', 0, 'a'), false);
  h.maker.removeLine('hello', 0); h.maker.useDefaultLines('hello'); h.maker.tidyLines('hello');
  assert.strictEqual(h.saves(), 0);
});
