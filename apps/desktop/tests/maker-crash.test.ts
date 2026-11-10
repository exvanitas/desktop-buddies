/* A stop at every step. For each change a save makes to the disk, the exe dies right there, a new
   hub starts on the same disk, and the buddy has to be whole: everything of the old copy or
   everything of the new one, never missing, never mixed. It loops over every step it counts, so a
   save that gains a step gains a stop. A stop after her manifest can leave images she no longer
   uses, and her next save has to clear them. */
import assert from 'node:assert';
import { imageNames, pack, read, readManifest, unpack, write, type Buddy } from '@buddies/buddy-file';
import { test } from 'vitest';
import type { FakeExe } from '../src/shell-fake';
import { changes, createDisk, frame, holding, hubOn, makerOn, manifestOf, type Page, saved, small, importing, type HubRun } from './maker-harness';

let stops = 0;
const THREE = (c: string, name: string, more: Partial<Buddy> = {}): Buddy => small(c, name, { poses: { walk: { frames: [frame(`${name}-1`), frame(`${name}-2`)] }, sit: { frames: [frame(`${name}-3`)] } }, ...more });

/* The disk's version of her, with every image her manifest names. With `tidy`, nothing else. */
function onDisk(exe: FakeExe, id: string, tidy = false): Buddy {
  const inside = [...exe.files.keys()].filter(k => k.startsWith(`library/${id}/`)).map(k => k.slice(`library/${id}/`.length));
  assert.ok(inside.length, `${id} is missing`);
  const b = pack(manifestOf(exe, id), n => exe.files.get(`library/${id}/${n}`));
  const named = imageNames(readManifest(manifestOf(exe, id)));
  assert.ok(named.every(n => inside.includes(n)), 'nothing short');
  if (tidy) assert.strictEqual(inside.length, named.length + 1, `nothing extra: ${inside.filter(n => n !== 'buddy.json' && !named.includes(n)).join()}`);
  return b;
}
/* Her next save, on the hub that found her, leaves nothing she doesn't use. */
async function tidiedByNextSave(r: HubRun, id: string, at: string) {
  const page = await makerOn(r, id);
  page.maker.setName('Tidied');
  await page.pass(1300);
  assert.strictEqual(onDisk(r.exe, id, true).name, 'Tidied', at);
}
/* A folder from before images were named by their bytes, under the names they had then. */
async function holdingLegacy(b: Buddy) {
  const exe = createDisk(), { manifest, images } = unpack(b);
  for (const f of images) exe.files.set(`library/${b.character}/${f.name}`, f.bytes);
  exe.files.set(`library/${b.character}/buddy.json`, new TextEncoder().encode(manifest));
  const r = await hubOn(exe), m = await r.manager(), page = await makerOn(r, b.character);
  return { exe, r, m, page };
}
/* Exactly one of these, and the next hub finds her the same way. */
async function wholeAfterRestart(exe: FakeExe, id: string, allowed: Buddy[], at: string) {
  const r = await hubOn(exe);
  await r.done();
  const b = onDisk(exe, id), got = JSON.stringify(read(write(b)));
  const hit = allowed.findIndex(a => JSON.stringify(read(write(a))) === got);
  assert.ok(hit >= 0, `${at}: she's neither old nor new: ${b.name}`);
  assert.ok(![...exe.files.keys()].some(k => k.startsWith('library/.outgoing') || k.startsWith('library/.incoming')), `${at}: left over`);
  const m = await r.manager();
  assert.strictEqual(m.s().buddies.filter(x => x.id === id).length, 1, `${at}: on the shelf`);
  return { hit, r, m };
}
const edited = (b: Buddy, name: string): Buddy => {
  const copy = read(write(b));
  copy.name = name;
  copy.poses = { walk: { frames: [frame(`${name}-new`)] } };
  return copy;
};
/* Puts the edit on the page, the way a person's edits arrive. */
const apply = (page: Page, name: string) => {
  const p = page.maker.current()!;
  p.name = name; p.poses = { walk: { frames: [frame(`${name}-new`)] } };
  page.maker.saveNow();
};

async function stepsOf(edit: (page: Page) => Promise<void>) {
  const s = await holding(THREE('c1', 'Old'));
  s.exe.calls.length = 0;
  await edit(s.page);
  await s.r.done();
  return changes(s.exe).length;
}

for (const torn of [false, true]) {
  test(`a stop at every step of a save${torn ? ', with deletes partway' : ''}`, async () => {
    const old = THREE('c1', 'Old'), steps = await stepsOf(async page => { apply(page, 'New'); await page.pass(1300); });
    assert.strictEqual(steps, 5, 'one new image, her manifest, three old images');
    const seen = new Set<number>();
    for (let n = 1; n <= steps; n++) {
      const s = await holding(old);
      s.exe.faultAt(n, true, torn);
      apply(s.page, 'New');
      await s.page.pass(1300);
      s.page.crashed();
      const { hit, r } = await wholeAfterRestart(s.exe, 'c1', [old, edited(old, 'New')], `step ${n}`);
      await tidiedByNextSave(r, 'c1', `step ${n}`);
      seen.add(hit);
      stops++;
    }
    assert.deepStrictEqual([...seen].sort(), [0, 1], 'the stops went past the swap');
  });

  test(`a stop at every step of two saves in a row${torn ? ', with deletes partway' : ''}`, async () => {
    const old = THREE('c1', 'Old');
    const steps = await stepsOf(async page => { apply(page, 'A'); await page.pass(1300); apply(page, 'B'); await page.pass(1300); });
    const a = edited(old, 'A'), b = edited(old, 'B'), seen = new Set<number>();
    for (let n = 1; n <= steps; n++) {
      const s = await holding(old);
      s.exe.faultAt(n, true, torn);
      apply(s.page, 'A'); await s.page.pass(1300);
      apply(s.page, 'B'); await s.page.pass(1300);
      s.page.crashed();
      const { hit } = await wholeAfterRestart(s.exe, 'c1', [old, a, b], `step ${n}`);
      seen.add(hit);
      stops++;
    }
    assert.deepStrictEqual([...seen].sort(), [0, 1, 2]);
  });

  test(`a stop at every step of a replace with copies out${torn ? ', with deletes partway' : ''}: nobody out is lost`, async () => {
    const old = THREE('c1', 'Old');
    const run = async (n?: number) => {
      const s = await holding(old);
      await s.m.client.call('c1'); await s.m.client.callAnother('c1'); await s.r.done();
      s.exe.calls.length = 0;
      if (n) s.exe.faultAt(n, true, torn);
      apply(s.page, 'New');
      await s.page.pass(1300);
      return s;
    };
    const steps = changes((await run()).exe).length;
    assert.ok(steps >= 5);
    const seen = new Set<number>();
    for (let n = 1; n <= steps; n++) {
      const s = await run(n);
      s.page.crashed();
      const { hit, m } = await wholeAfterRestart(s.exe, 'c1', [old, edited(old, 'New')], `step ${n}`);
      assert.strictEqual(m.s().buddies.find(b => b.id === 'c1')!.copies, 2, `step ${n}: still two out`);
      seen.add(hit);
      stops++;
    }
    assert.deepStrictEqual([...seen].sort(), [0, 1]);
  });

  test(`a stop at every step of a new buddy's first save${torn ? ', with deletes partway' : ''}: all of her or none`, async () => {
    const start = async () => {
      const exe = createDisk(), r = await hubOn(exe), page = await makerOn(r);
      await r.done();
      await page.maker.addFromSrc(frame('new').src, 'New');
      return { exe, r, page, c: page.maker.current()!.character! };
    };
    const first = await start();
    first.exe.calls.length = 0;
    await first.page.pass(1300);
    assert.strictEqual(onDisk(first.exe, first.c).name, 'New', 'with no stop, she lands');
    const steps = changes(first.exe).length, seen = new Set<string>();
    assert.ok(steps >= 3);
    for (let n = 1; n <= steps; n++) {
      const { exe, page, c } = await start();
      exe.faultAt(n, true, torn);
      await page.pass(1300);
      page.crashed();
      const r = await hubOn(exe);
      await r.done();
      const m = await r.manager(), there = m.s().buddies.some(b => b.id === c);
      seen.add(String(there));
      if (there) assert.strictEqual(onDisk(exe, c).name, 'New');
      else assert.ok(![...exe.files.keys()].some(k => k.startsWith(`library/${c}/`)), `step ${n}: half of her`);
      assert.ok(![...exe.files.keys()].some(k => k.startsWith('library/.incoming')), `step ${n}`);
      stops++;
    }
    /* The last step is the move home, so a stop at any step is before she's there. */
    assert.deepStrictEqual([...seen], ['false']);
  });

  test(`a stop at every step of a folder's first save since images were named by their bytes${torn ? ', with deletes partway' : ''}`, async () => {
    const old = THREE('c1', 'Old'), first = await holdingLegacy(old);
    first.exe.calls.length = 0;
    apply(first.page, 'New');
    await first.page.pass(1300);
    assert.strictEqual(onDisk(first.exe, 'c1', true).name, 'New', 'with no stop, the old names are gone');
    const steps = changes(first.exe).length, seen = new Set<number>();
    assert.strictEqual(steps, 7, 'two images, her manifest, four old names');
    for (let n = 1; n <= steps; n++) {
      const s = await holdingLegacy(old);
      s.exe.faultAt(n, true, torn);
      apply(s.page, 'New');
      await s.page.pass(1300);
      s.page.crashed();
      const { hit, r } = await wholeAfterRestart(s.exe, 'c1', [old, edited(old, 'New')], `step ${n}`);
      await tidiedByNextSave(r, 'c1', `step ${n}`);
      seen.add(hit);
      stops++;
    }
    assert.deepStrictEqual([...seen].sort(), [0, 1]);
  });

  test(`a stop at every step of a Manager import that replaces her${torn ? ', with deletes partway' : ''}`, async () => {
    const old = THREE('c1', 'Old'), next = edited(old, 'New');
    const run = async (n?: number) => {
      const s = await holding(old);
      s.exe.calls.length = 0;
      if (n) s.exe.faultAt(n, true, torn);
      await importing(s.m, next).catch(() => null);
      await s.r.done();
      return s;
    };
    const steps = changes((await run()).exe).length, seen = new Set<number>();
    assert.ok(steps >= 5, `${steps}`);
    for (let n = 1; n <= steps; n++) {
      const s = await run(n);
      s.page.crashed();
      const { hit, r } = await wholeAfterRestart(s.exe, 'c1', [old, next], `step ${n}`);
      await tidiedByNextSave(r, 'c1', `step ${n}`);
      seen.add(hit);
      stops++;
    }
    assert.deepStrictEqual([...seen].sort(), [0, 1]);
  });
}

test('one failure at every step of a save: whole straight away, the status says so, and the retry lands', async () => {
  const old = THREE('c1', 'Old'), steps = await stepsOf(async page => { apply(page, 'New'); await page.pass(1300); });
  const results = new Set<string>();
  for (let n = 1; n <= steps; n++) {
    const s = await holding(old);
    s.exe.faultAt(n);
    apply(s.page, 'New');
    await s.page.pass(1300);
    const b = onDisk(s.exe, 'c1'), kind = s.page.saveState.kind;
    /* A failed clear, after her manifest, is still a saved buddy. */
    assert.strictEqual(b.name, kind === 'failed' ? 'Old' : 'New', `step ${n}`);
    results.add(kind);
    await s.page.store.flush();
    await s.r.done();
    assert.strictEqual(saved(s.exe, 'c1')!.name, 'New', `step ${n}`);
    assert.strictEqual(s.page.saveState.kind, 'saved', `step ${n}`);
    onDisk(s.exe, 'c1');
    await tidiedByNextSave(s.r, 'c1', `step ${n}`);
    stops++;
  }
  assert.deepStrictEqual([...results].sort(), ['failed', 'saved']);
});

test('how many stops ran', () => {
  console.log(`maker-crash: ${stops} stops`);
  assert.ok(stops > 50, `${stops}`);
});
