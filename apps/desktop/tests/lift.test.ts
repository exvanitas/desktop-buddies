/* Lift, through everything a buddy goes through in the app: the Maker's save, a restart, the
   Manager's export and an import. Byte for byte, and nothing written when nothing changed. */
import assert from 'node:assert';
import { read, write, type Buddy } from '@buddies/buddy-file';
import { test } from 'vitest';
import { changes, createDisk, frame, holding, hubOn, importing, lands, makerOn, manifestOf, png, small, type HubRun } from './maker-harness';

/* Art that ends at the bottom of its picture, as freshly cut art does. */
const sat = (more: Partial<Buddy> = {}) => small('c1', 'Pip', { size: 120, poses: { sit: { frames: [{ src: png('sit'), bb: { x0: .1, y0: .2, x1: .9, y1: 1 } }, frame('sit-2')], fps: 6, scale: 1 } }, ...more });

async function exported(r: HubRun, id = 'c1') {
  const m = await r.manager();
  r.exe.dialog = true;
  r.exe.saved.length = 0;
  assert.deepStrictEqual(await m.client.exportBuddy(id), { ok: true, value: { saved: true } });
  return r.exe.saved[0]!.content;
}

test('a pose lifted in the Maker is saved, opens again as it was, and leaves and comes back byte for byte', async () => {
  const { exe, r, page } = await holding(sat());
  const p = page.maker.current()!;
  await page.maker.measureLift(p, 'sit');
  assert.strictEqual(page.maker.poseLift(p, 'sit'), 0);
  page.maker.setPoseLift(p, 'sit', -6);
  await page.pass(1300);
  assert.strictEqual(page.saveState.kind, 'saved');
  const saved = manifestOf(exe, 'c1');
  assert.deepStrictEqual((JSON.parse(saved) as { buddy: Buddy }).buddy.poses.sit!.frames.map(f => f.bb.y1), [.95, .95]);

  /* opened again: measuring and the same lift write nothing */
  page.crashed();
  const again = await hubOn(exe), next = await makerOn(again, 'c1');
  await again.done();
  const q = next.maker.current()!;
  exe.calls.length = 0;
  await next.maker.measureLift(q, 'sit');
  assert.strictEqual(next.maker.poseLift(q, 'sit'), -6);
  next.maker.setPoseLift(q, 'sit', -6);
  next.maker.saveNow();
  await next.pass(3000);
  assert.deepStrictEqual(changes(exe), [], 'no change, nothing written');
  assert.strictEqual(manifestOf(exe, 'c1'), saved);

  /* exported, imported over itself, exported again */
  const file = await exported(again);
  assert.deepStrictEqual(read(file).poses.sit!.frames.map(f => f.bb.y1), [.95, .95]);
  await importing(await again.manager(), read(file));
  await again.done();
  assert.strictEqual(manifestOf(exe, 'c1'), saved, 'the import wrote what was there');
  assert.strictEqual(await exported(again), file);

  /* and into a library that never had her */
  const other = await holding(small('c9', 'Bo'));
  await importing(other.m, read(file));
  await other.r.done();
  assert.strictEqual(await exported(other.r), file);
  void r;
});

const LIFTED = { floor: -.05, wall: .1, ceiling: -.2 };
const liftIn = (text: string) => (JSON.parse(text) as { buddy: Buddy }).buddy.lift;

test('her own lift for each surface is saved, kept by saves that never touch it, and leaves and comes back byte for byte', async () => {
  const { exe, page } = await holding(sat());
  page.maker.setLift('ceiling', -.2); page.maker.setLift('floor', -.05); page.maker.setLift('wall', .1);
  await page.pass(1300);
  assert.deepStrictEqual(liftIn(manifestOf(exe, 'c1')), LIFTED);

  /* opened again: the same lift, or none, writes nothing */
  page.crashed();
  const again = await hubOn(exe), next = await makerOn(again, 'c1');
  await again.done();
  assert.deepStrictEqual(next.maker.current()!.lift, LIFTED);
  exe.calls.length = 0;
  next.maker.setLift('wall', .1);
  next.maker.saveNow();
  await next.pass(3000);
  assert.deepStrictEqual(changes(exe), []);

  /* edits that don't touch it keep it */
  next.maker.setName('Bea'); next.maker.setSize(200); next.maker.setFaces('left');
  await next.pass(1300);
  assert.deepStrictEqual(liftIn(manifestOf(exe, 'c1')), LIFTED);
  next.maker.setName('Pip'); next.maker.setSize(120); next.maker.setFaces('right');
  await next.pass(1300);

  /* one surface at 0 goes alone; all at 0 and the field goes, and comes back */
  next.maker.setLift('wall', 0);
  await next.pass(1300);
  assert.deepStrictEqual(liftIn(manifestOf(exe, 'c1')), { floor: -.05, ceiling: -.2 });
  next.maker.setLift('floor', 0); next.maker.setLift('ceiling', 0);
  await next.pass(1300);
  assert.ok(!manifestOf(exe, 'c1').includes('"lift"'));
  for (const [k, x] of Object.entries(LIFTED)) next.maker.setLift(k as keyof typeof LIFTED, x);
  await next.pass(1300);

  /* exported, imported over itself and into a library that never had her */
  const file = await exported(again);
  assert.deepStrictEqual(read(file).lift, LIFTED);
  await importing(await again.manager(), read(file));
  await again.done();
  assert.strictEqual(await exported(again), file);
  const other = await holding(small('c9', 'Bo'));
  await importing(other.m, read(file));
  await other.r.done();
  assert.strictEqual(await exported(other.r), file);
});

test('a file with her own lift opens in the Maker and saves back unchanged', async () => {
  for (const lift of [LIFTED, { wall: .3 }]) {
    const b = sat({ lift }), { exe, page } = await holding(b);
    assert.deepStrictEqual(page.maker.current()!.lift, lift);
    const before = manifestOf(exe, 'c1');
    exe.calls.length = 0;
    page.maker.saveNow();
    await page.pass(3000);
    assert.deepStrictEqual(changes(exe), [], JSON.stringify(lift));
    assert.strictEqual(manifestOf(exe, 'c1'), before);
  }
});

/* A lift that does nothing, as a file can spell it, and what's left of it. JSON can say -0. */
const IDLE: [string, string | undefined][] = [
  ['{}', undefined], ['{"floor":0,"wall":0,"ceiling":0}', undefined], ['{"floor":-0}', undefined], ['{"floor":0,"wall":0.1}', '{"wall":0.1}']
];
const MANIFEST = 'library/c1/buddy.json';
const withLift = (text: string, lift: string) => text.replace(/"poses":/, `"lift":${lift},"poses":`);

test('a lift that does nothing comes in as none: imported, exported, and into a library that never had her', async () => {
  for (const [lift, left] of IDLE) {
    const clean = await holding(sat(left ? { lift: JSON.parse(left) as Buddy['lift'] } : {})), want = await exported(clean.r);
    const fresh = await holding(small('c9', 'Bo')), text = withLift(write(sat()), lift);
    assert.ok(text.includes(`"lift":${lift}`));
    await importing(fresh.m, read(text));
    await fresh.r.done();
    assert.strictEqual(JSON.stringify(liftIn(manifestOf(fresh.exe, 'c1'))), left, lift);
    assert.strictEqual(await exported(fresh.r), want, 'exported as if it never had one: ' + lift);
    /* the file itself, not read first: the Manager's import reads it */
    const m = await fresh.r.manager();
    await m.client.importFiles([{ name: 'x.buddy', path: 'x.buddy', size: 1, text: async () => text, url: async () => '' }]);
    await fresh.r.done();
    assert.strictEqual(JSON.stringify(liftIn(manifestOf(fresh.exe, 'c1'))), left, 'as text: ' + lift);
    assert.strictEqual(await exported(fresh.r), want);
  }
});

/* A library saved before this, whose file still holds it. Like a kit's defaults, it's what reading
   her gives that's compared: she opens and closes with nothing written, and the file keeps it until
   her next real save, which drops it once. */
test('a stored lift that does nothing opens as none, closes with no write, and her first save drops it for good', async () => {
  for (const [lift, left] of IDLE) {
    const exe = createDisk();
    await hubOn(exe, write(sat()));
    const planted = withLift(manifestOf(exe, 'c1'), lift);
    exe.files.set(MANIFEST, new TextEncoder().encode(planted));
    const r = await hubOn(exe), page = await makerOn(r, 'c1');
    await r.done();
    assert.strictEqual(JSON.stringify(page.maker.current()!.lift), left, lift);
    exe.calls.length = 0;
    page.maker.saveNow();
    await page.pass(3000);
    page.host.window!.close();
    await page.pass(1300);
    assert.ok(!exe.windows.has(page.label), 'closed');
    assert.deepStrictEqual(changes(exe), [], 'opened and closed: nothing written: ' + lift);
    assert.strictEqual(manifestOf(exe, 'c1'), planted);

    /* exported as it reads */
    assert.strictEqual(JSON.stringify(read(await exported(r)).lift), left, 'exported: ' + lift);

    /* her first save drops it, once */
    const next = await makerOn(r, 'c1');
    await r.done();
    exe.calls.length = 0;
    next.maker.setName('Bea');
    await next.pass(1300);
    assert.strictEqual(lands(exe, 'c1'), 1, lift);
    assert.strictEqual(JSON.stringify(liftIn(manifestOf(exe, 'c1'))), left);
    const after = manifestOf(exe, 'c1');
    exe.calls.length = 0;
    next.maker.saveNow();
    await next.pass(3000);
    assert.deepStrictEqual(changes(exe), [], 'nothing more: ' + lift);
    next.crashed();
    const again = await hubOn(exe), last = await makerOn(again, 'c1');
    await again.done();
    exe.calls.length = 0;
    last.maker.saveNow();
    await last.pass(3000);
    assert.deepStrictEqual(changes(exe), [], 'and never again: ' + lift);
    assert.strictEqual(manifestOf(exe, 'c1'), after);
  }
});
