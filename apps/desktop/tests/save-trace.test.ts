/* A slow Maker save says where its time went, and one that hangs says where it is, as the two runner
   stalls needed: the first save of a new buddy held past the Maker's reply timeout, and a save
   queued behind it. Counts, times and ids only. */
import assert from 'node:assert';
import { test } from 'vitest';
import { frame, holding } from './maker-harness';

const WATCH_MS = 10000;
const later = (ms: number) => new Promise(r => setTimeout(r, ms));

test('a held first save and one queued behind it: each says where it is while it waits, and where its time went', async () => {
  const { exe, r, page } = await holding();
  const before = exe.logs.length;
  /* the new buddy's first image write never comes back until it's let go */
  const release = exe.hold('data_write', () => true);
  const frames = Array.from({ length: 6 }, (_, i) => frame(`slow-${i}`));
  const made = page.maker.addPet({ name: 'Slow', base: frame('slow-base'), poses: { walk: { frames, fps: 6, scale: 1 } } }, true)!;
  await page.pass(1300);
  const id = made.character!;
  /* and the buddy she was opened on is saved too, which waits its turn in the hub's queue */
  page.maker.select(page.maker.state.pets.find(p => p.id !== made.id)!.id);
  page.maker.setName('Behind');
  await page.pass(1300);
  await later(1100);
  r.fire(WATCH_MS);
  await r.done();
  const lines = () => exe.logs.slice(before);
  const going = lines().find(l => l.startsWith(`maker save of ${id} still going`));
  assert.ok(going, lines().join('\n'));
  assert.match(going, /still going after \d+ ms: storing for \d+; library: writing for \d+ ms, \d+ of \d+ written, [1-4] out, the oldest for \d+ ms$/);
  const queued = lines().find(l => /^maker save of \w+ still going/.test(l) && !l.includes(id));
  assert.ok(queued, lines().join('\n'));
  assert.match(queued, /still going after \d+ ms: queued for \d+, the queue on maker-save; library: writing/);
  release();
  await r.done();
  await page.pass(1300);
  const took = lines().find(l => l.startsWith(`maker save of ${id} took`));
  assert.ok(took, lines().join('\n'));
  assert.match(took, /took \d+ ms: queued \d+, looking \d+, reading \d+, storing (\d+), reading back \d+, telling \d+$/);
  assert.ok(Number(/storing (\d+)/.exec(took)![1]) >= 1000, 'the held write is in storing');
  const lib = lines().find(l => l.startsWith('library: a save took'));
  assert.match(lib ?? '', /: hashing \d+, settling \d+, clearing staging \d+, writing (\d+), the manifest \d+, the move \d+; \d+ images, 4 at a time, each \d+ median, \d+ p90, \d+ most$/);
  const behind = lines().find(l => /^maker save of \w+ took/.test(l) && !l.includes(id));
  assert.match(behind ?? lines().join('\n'), /took \d+ ms: queued (\d{4,}), looking/);
  /* and nothing in them names a file */
  for (const l of [going, queued, took, lib!, behind!]) assert.ok(!/\.png|\.webp|buddy\.json|library\/|Slow|Behind/.test(l), l);
  /* one that's over says nothing more */
  const n = exe.logs.length;
  r.fire(WATCH_MS);
  await r.done();
  assert.ok(!exe.logs.slice(n).some(l => l.includes('still going')), exe.logs.slice(n).join('\n'));
}, 30000);

test('a quick save says nothing', async () => {
  const { exe, page } = await holding();
  const before = exe.logs.length;
  page.maker.setName('Quick');
  await page.pass(1300);
  assert.ok(!exe.logs.slice(before).some(l => /maker save of|a save took/.test(l)), exe.logs.slice(before).join('\n'));
});
