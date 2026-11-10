/* A save writes only what changed. Each image is named by its bytes, so one already in her folder
   is never written again. */
import assert from 'node:assert';
import { imageNames, read, readManifest, write, type Buddy } from '@buddies/buddy-file';
import { test } from 'vitest';
import { createLibrary } from '../src/library';
import { createFakeExe, type FakeExe } from '../src/shell-fake';
import { frame, holding, bigBuddy, manifestOf } from './maker-harness';

function setup() {
  const exe = createFakeExe(), notes: string[] = [];
  return { exe, notes, lib: createLibrary(exe.shell, l => notes.push(l)) };
}
const writes = (exe: FakeExe) => exe.calls.filter(c => c.cmd === 'data_write').map(c => c.path!);
const count = (exe: FakeExe, cmd: string) => exe.calls.filter(c => c.cmd === cmd).length;
async function holdingBig() {
  const s = setup();
  await s.lib.add(write(bigBuddy()));
  s.exe.calls.length = 0;
  return s;
}

test('renaming her writes her manifest and nothing else', async () => {
  const s = await holdingBig();
  await s.lib.add(write({ ...bigBuddy(), name: 'Renamed' }));
  const w = writes(s.exe);
  assert.ok(w.length === 1 && w[0] === 'library/cbig/buddy.json', `${w.length} files written`);
  assert.strictEqual(count(s.exe, 'data_delete') + count(s.exe, 'data_move'), 0, 'nothing moved or deleted');
  assert.strictEqual((await s.lib.get('cbig')).name, 'Renamed');
});

test('changing one image writes that image and her manifest, and clears the old one', async () => {
  const s = await holdingBig(), b = bigBuddy();
  b.poses.walk!.frames[3] = frame('changed');
  await s.lib.add(write(b));
  const w = writes(s.exe);
  assert.ok(w.length === 2 && w[1] === 'library/cbig/buddy.json', `${w.length} files written`);
  assert.strictEqual(count(s.exe, 'data_delete'), 1, 'the old image goes');
  assert.strictEqual(count(s.exe, 'data_move'), 0);
});

test('saving her unchanged writes only her manifest', async () => {
  const s = await holdingBig();
  await s.lib.add(write(bigBuddy()));
  assert.strictEqual(writes(s.exe).length, 1, `${writes(s.exe).length} files written`);
});

/* A stop at every step of her save, on the library alone: the next run finds one whole big buddy, old
   or new, and her next save leaves nothing she doesn't use. Compared by text, never diffed. */
const packedOf = (b: Buddy) => JSON.stringify(read(write(b)));
async function sweep(next: Buddy, expected: number, outcomes: string[]) {
  const s = await holdingBig();
  await s.lib.add(write(next));
  const steps = changes(s.exe).length, seen = new Set<string>(), old = packedOf(bigBuddy()), now = packedOf(next);
  assert.strictEqual(steps, expected, `${steps} steps`);
  for (const torn of [false, true]) {
    for (let n = 1; n <= steps; n++) {
      const t = await holdingBig();
      t.exe.faultAt(n, true, torn);
      await t.lib.add(write(next)).catch(() => null);
      t.exe.revive();
      const lib = createLibrary(t.exe.shell, () => {});
      await lib.recover();
      const list = await lib.list();
      assert.ok(list.length === 1 && list[0]!.id === 'cbig', `step ${n}: ${list.length} on the shelf`);
      const back = JSON.stringify(read(await lib.packed('cbig')));
      assert.ok(back === old || back === now, `step ${n}: neither copy`);
      seen.add(back === now ? 'new' : 'old');
      await lib.add(write(next));
      assert.ok(JSON.stringify(read(await lib.packed('cbig'))) === now, `step ${n}: the retry`);
      const named = imageNames(readManifest(manifestOf(t.exe, 'cbig'))), inside = [...t.exe.files.keys()].filter(k => k.startsWith('library/'));
      assert.strictEqual(inside.length, named.length + 1, `step ${n}: nothing left over`);
    }
  }
  assert.deepStrictEqual([...seen].sort(), outcomes);
}
const changes = (exe: FakeExe) => exe.calls.filter(c => /^data_(write|move|delete)$/.test(c.cmd));

test('a stop at every step of renaming her: her manifest is the one step, and a stop there leaves her as she was', async () => {
  await sweep({ ...bigBuddy(), name: 'Renamed' }, 1, ['old']);
}, 60000);

test('a stop at every step of changing one image: three steps, and she\'s whole at each', async () => {
  const b = bigBuddy();
  b.poses.walk!.frames[3] = frame('changed');
  await sweep(b, 3, ['new', 'old']);
}, 60000);

test('opening her in the Maker and saving with no edit writes nothing', async () => {
  const { exe, page } = await holding(bigBuddy());
  exe.calls.length = 0;
  page.maker.saveNow();
  await page.pass(3000);
  assert.strictEqual(changes(exe).length, 0);
}, 60000);
