/* What saving costs, measured and printed. The bounds are only there to catch something far off:
   these are the fake exe, with no disk under it. */
import assert from 'node:assert';
import { LIMIT, read, write, type Buddy, type Frame } from '@buddies/buddy-file';
import { test } from 'vitest';
import { canon } from '../src/maker-store';
import { BOX, holding, saved, small, lands } from './maker-harness';

const header = 'iVBORw0KGgo';
/* An image that passes for a PNG, of about this many characters, made so no two are alike. */
const image = (chars: number, seed: number): Frame => {
  const body = (seed.toString(36).padStart(4, 'x') + 'AbCd0123').repeat(Math.ceil(chars / 12)).slice(0, chars - chars % 4 + 1);
  return { src: `data:image/png;base64,${header}${body}`, bb: BOX };
};
const buddyOf = (images: number, each: number): Buddy => {
  const frames = Array.from({ length: images }, (_, i) => image(each, i));
  return small('big', 'Big', { base: frames[0]!, poses: { walk: { frames: frames.slice(1, 121) }, ...(images > 121 ? { run: { frames: frames.slice(121, 241) } } : {}), ...(images > 241 ? { sit: { frames: frames.slice(241, 361) } } : {}) } });
};

async function measure(label: string, b: Buddy) {
  const text = write(b);
  assert.ok(text.length <= LIMIT.file, `${label} fits: ${text.length}`);
  read(text);
  const s = await holding(b);
  const t0 = performance.now();
  const c = canon(s.page.maker.current()!), t1 = performance.now();
  const out = write(s.page.maker.current()!), t2 = performance.now();
  read(out);
  const t3 = performance.now();
  s.exe.calls.length = 0;
  s.page.maker.setName('Bigger');
  const t4 = performance.now();
  await s.page.pass(1300);
  const t5 = performance.now();
  assert.strictEqual(saved(s.exe, 'big')!.name, 'Bigger');
  assert.strictEqual(s.page.saveState.kind, 'saved');
  assert.strictEqual(lands(s.exe, 'big'), 1);
  const writes = s.exe.calls.filter(x => x.cmd === 'data_write').length;
  console.log(`maker-measure ${label}: ${(text.length / 1e6).toFixed(1)} MB, ${writes} files written per save; compare ${(t1 - t0).toFixed(0)} ms, file text ${(t2 - t1).toFixed(0)} ms, hub's read ${(t3 - t2).toFixed(0)} ms, whole save round trip ${(t5 - t4).toFixed(0)} ms on the fake (${c.length} characters)`);
  return t5 - t4;
}

test('the largest allowed buddy in a few big images', async () => {
  assert.ok(await measure('8 images', buddyOf(8, 7_900_000)) < 60000);
}, 300000);

test('the largest allowed buddy in as many small ones as a buddy can usefully have', async () => {
  assert.ok(await measure('360 images', buddyOf(360, 175_000)) < 60000);
}, 300000);

test('a buddy the size of Olive', async () => {
  assert.ok(await measure('Olive-sized', buddyOf(60, 18_000)) < 10000);
}, 120000);
