/* Which edition of a buddy a window has. */
import assert from 'node:assert';
import { test, vi } from 'vitest';
import { createRevisions } from '../src/revisions';

test('a buddy keeps her revision until she changes', () => {
  const r = createRevisions(), a = r.of('c1');
  assert.strictEqual(r.of('c1'), a);
  r.changed('c1');
  assert.notStrictEqual(r.of('c1'), a);
});

test('two buddies never share a revision, nor does one deleted and brought back', () => {
  const r = createRevisions(), a = r.of('c1'), b = r.of('c2');
  assert.notStrictEqual(a, b);
  r.changed('c1');
  r.changed('c1');
  assert.ok(r.of('c1') > b);
});

test('a save based on the current revision goes ahead, and on an old one doesn\'t', () => {
  const r = createRevisions(), a = r.of('c1');
  assert.ok(r.accepts('c1', a, 'w', true));
  r.changed('c1');
  assert.ok(!r.accepts('c1', a, 'w', true));
  assert.ok(r.accepts('c1', r.of('c1'), 'w', true));
});

test('based on nothing means new: fine with nobody there, and refused with somebody', () => {
  const r = createRevisions();
  assert.ok(r.accepts('c1', null, 'w', false));
  r.of('c1');
  assert.ok(!r.accepts('c1', null, 'w', true));
});

test('nobody this run has seen comes back through based on nothing', () => {
  const r = createRevisions();
  assert.ok(r.accepts('c1', null, 'w', false), 'a stranger is new');
  r.saved('c1', 'w');
  r.changed('c1'); /* deleted */
  assert.ok(!r.accepts('c1', null, 'w', false), 'not even by the window that made her');
});

test('it counts on from where it starts', () => {
  const r = createRevisions(5000);
  assert.strictEqual(r.of('c1'), 5001);
  const a = createRevisions(5000).of('c1'), b = createRevisions(6000).of('c1');
  assert.notStrictEqual(a, b);
});

test('a restart at the same instant, as after the clock steps back, starts somewhere new', () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  try {
    const firsts = new Set(Array.from({ length: 50 }, () => createRevisions().of('c1')));
    assert.strictEqual(firsts.size, 50);
    for (const f of firsts) assert.ok(Number.isSafeInteger(f) && Number.isSafeInteger(f + 2 ** 40), 'a safe integer with room to count');
    assert.ok([...firsts].some(f => f > 2 ** 40), 'drawn from far more than 32 bits');
  } finally { now.mockRestore(); }
});

test('someone gone can\'t be saved over, whatever it was based on', () => {
  const r = createRevisions(), a = r.of('c1');
  assert.ok(!r.accepts('c1', a, 'w', false));
});

test('after her own save, a window is taken at its word whatever revision it has', () => {
  const r = createRevisions(), a = r.of('c1');
  const b = r.saved('c1', 'w');
  assert.ok(b !== a);
  assert.ok(r.accepts('c1', a, 'w', true), 'it may not have heard');
  assert.ok(r.accepts('c1', b, 'w', true));
  assert.ok(!r.accepts('c1', a, 'other', true), 'not another window\'s old one');
});

test('a new buddy\'s second save too, with nothing to go on', () => {
  const r = createRevisions();
  r.saved('c1', 'w');
  assert.ok(r.accepts('c1', null, 'w', true));
  assert.ok(!r.accepts('c1', null, 'other', true));
});

test('that stops as soon as anyone else changes her', () => {
  const r = createRevisions(), a = r.of('c1');
  r.saved('c1', 'w');
  r.changed('c1');
  assert.ok(!r.accepts('c1', a, 'w', true));
  const b = r.of('c1');
  r.saved('c1', 'other');
  assert.ok(!r.accepts('c1', a, 'w', true));
  assert.ok(!r.accepts('c1', b, 'w', true), 'another window\'s save moved her on');
});
