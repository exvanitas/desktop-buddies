/* Generated buddies through random sequences of real maker-core edits, saved, the hub restarted and
   read back. What comes back has to equal the last state saved, every field of it. Seeded: a failure
   names its seed, and a seed always runs the same. */
import assert from 'node:assert';
import { LIFTS, POSES, SITUATIONS, read, write, type Buddy, type PoseKey } from '@buddies/buddy-file';
import { test } from 'vitest';
import { canon } from '../src/maker-store';
import { changes, createDisk, frame, hubOn, makerOn, type Page, pageOn, pickedFile, png, saved, small } from './maker-harness';

const RUNS = 40, EDITS = 40;
function rng(seed: number) {
  let x = seed * 2654435761 >>> 0 || 1;
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 2 ** 32; };
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(a: readonly T[]) => a[Math.floor(next() * a.length)]! };
}
type Rng = ReturnType<typeof rng>;
const KEYS = POSES.map(p => p.key) as PoseKey[], SITS = Object.keys(SITUATIONS);
const TEXT = ['', 'plain', 'with "quotes"', 'back\\slash', 'new\nline', 'emoji 🌱', '</script>', 'ünïcödé', ' spaces '];

function generate(r: Rng, id: string): Buddy {
  const b: Buddy = { character: id, base: frame(`${id}-base-${r.int(9)}`), poses: {} };
  if (r.next() < .8) b.name = r.pick(TEXT).slice(0, 60);
  if (r.next() < .7) b.size = 16 + r.int(497);
  if (r.next() < .3) b.lift = Object.fromEntries(LIFTS.filter(() => r.next() < .6).map(k => [k, +(r.next() - .5).toFixed(3)]));
  if (r.next() < .7) b.faces = r.pick(['left', 'right'] as const);
  if (r.next() < .7) b.ref = { ow: r.int(900) - 1, oh: r.int(900) - 1, w: r.int(900), h: r.int(900), cx: r.next() * 900, by: r.next() * 900, side: r.int(900) };
  for (let i = r.int(5); i > 0; i--) {
    b.poses[r.pick(KEYS)] = { frames: Array.from({ length: 1 + r.int(4) }, (_, n) => r.next() < .2 ? b.base : frame(`${id}-${i}-${n}`)), ...(r.next() < .7 ? { fps: .1 + r.next() * 59 } : {}), ...(r.next() < .7 ? { scale: .05 + r.next() * 9 } : {}) };
  }
  if (r.next() < .5) b.lines = { [r.pick(SITS)]: [r.pick(TEXT), r.pick(TEXT)] };
  if (r.next() < .5) b.kit = { mode: r.pick(['tags', 'text'] as const), personality: r.pick(TEXT) };
  if (r.next() < .3) b.signature = { weight: r.next() * 5, line: r.pick(TEXT) };
  return b;
}

/* One real edit, through what a view calls. */
function edit(page: Page, r: Rng, n: number) {
  const { maker } = page, p = maker.current()!, keys = Object.keys(p.poses) as PoseKey[], key = keys.length ? r.pick(keys) : null;
  const ops: (() => unknown)[] = [
    () => maker.setName(r.pick(TEXT)),
    () => maker.setSize(16 + r.int(497)),
    () => maker.setLift(r.pick(LIFTS), r.pick([0, (r.next() - .5) * .99])),
    () => maker.setFaces(r.pick(['left', 'right'])),
    () => maker.setKitField(r.pick(['personality', 'appearance', 'quality', 'style'] as const), r.pick(TEXT)),
    () => maker.setKitMode(r.pick(['tags', 'text'])),
    () => maker.applyReply(JSON.stringify({ [r.pick(SITS)]: [r.pick(TEXT.filter(Boolean)), `line ${n}`] })),
    () => maker.resetLines(),
    () => maker.setMainImage(pickedFile(`main-${n}.png`)),
    async () => { const k = r.pick(KEYS); maker.togglePose(p, k); if (maker.openPose !== k) maker.togglePose(p, k); await maker.addFrames(p, [pickedFile(`f-${n}-a.png`), pickedFile(`f-${n}-b.png`)]); },
    () => key && maker.moveFrame(p, key, r.int(p.poses[key]!.frames.length), r.pick([-1, 1] as const)),
    () => key && maker.removeFrame(p, key, r.int(p.poses[key]!.frames.length)),
    () => key && maker.clearPose(p, key),
    () => key && maker.setSpeed(p, key, .1 + r.next() * 59),
    () => key && maker.setScale(p, key, .05 + r.next() * 9),
    async () => { if (!key) return; await maker.measureLift(p, key); maker.setPoseLift(p, key, r.int(121) - 60); },
    () => maker.matchSizes(),
    () => maker.importGenerated([{ ...pickedFile(`${r.pick(KEYS)}_${n}.png`) }])
  ];
  return r.pick(ops)();
}
/* Everything the file holds, however it was reached. */
const fields = (b: Buddy & { id?: string }) => { const { id: _, ...rest } = b; return JSON.parse(write(rest as Buddy)).buddy as Buddy; };

for (let run = 1; run <= RUNS; run++) {
  test(`round trip, seed ${run}`, async () => {
    const r = rng(run), exe = createDisk(), id = `c${run}`, born = generate(r, id);
    let hub = await hubOn(exe, write(born));
    let page = await makerOn(hub, id);
    await hub.done();
    /* It opens as what the file says, exactly. */
    assert.deepStrictEqual(fields(page.maker.current()!), fields(read(write(born))), 'opened');
    exe.calls.length = 0;
    await page.pass(3000);
    assert.deepStrictEqual(changes(exe), [], 'a load with no edit writes nothing');

    for (let n = 0; n < EDITS; n++) {
      await edit(page, r, n);
      await page.pass(r.pick([0, 16, 300, 1300]));
      if (r.next() < .1) {
        /* A restart partway: settled, then read back as if for the first time. */
        await page.pass(1300);
        assert.strictEqual(page.saveState.kind, 'saved', JSON.stringify(page.saveState).slice(0, 200));
        const last = fields(page.maker.current()!);
        page.crashed();
        hub = await hubOn(exe, write(born));
        page = await makerOn(hub, id);
        await hub.done();
        assert.strictEqual(canon({ ...fields(page.maker.current()!), id }), canon({ ...last, id }), `restart at edit ${n}`);
        exe.calls.length = 0;
        await page.pass(3000);
        assert.deepStrictEqual(changes(exe), [], `nothing written on opening at edit ${n}`);
      }
    }
    await page.pass(1300);
    assert.strictEqual(page.saveState.kind, 'saved', JSON.stringify(page.saveState).slice(0, 200));
    const last = page.maker.current()!;
    page.crashed();
    hub = await hubOn(exe, write(born));
    const next = await makerOn(hub, id);
    await hub.done();
    const back = next.maker.current()!;
    assert.strictEqual(canon({ ...back, id }), canon({ ...last, id }), 'the last saved state');
    assert.strictEqual(back.character, last.character);
    assert.deepStrictEqual(back.poses, JSON.parse(JSON.stringify(last.poses)), 'frames in order');
    assert.strictEqual(back.base.src, last.base.src);
    assert.deepStrictEqual(back.lines, last.lines);
    assert.deepStrictEqual(back.ref, last.ref);
    assert.strictEqual(back.size, last.size);
    assert.deepStrictEqual(back.lift, last.lift);
    assert.strictEqual(back.faces, last.faces);
    /* And nothing was lost that the file holds, but the Maker doesn't touch. */
    assert.deepStrictEqual(back.signature, born.signature ? read(write(born)).signature : undefined);
  });
}

test('a load then save of each kind of buddy writes nothing, however odd her file', async () => {
  for (const b of [small('c1'), small('c2', ''), { ...small('c3'), name: undefined }, small('c4', 'x', { faces: 'left', size: 16, kit: { mode: 'text' }, lines: { chat: [] }, signature: { weight: 0 } })]) {
    const exe = createDisk(), hub = await hubOn(exe, write(b)), page = await makerOn(hub, b.character!);
    await hub.done();
    exe.calls.length = 0;
    page.maker.saveNow();
    await page.pass(3000);
    assert.deepStrictEqual(changes(exe), [], b.character);
  }
});

test('a file naming a png that\'s really webp opens, and saves as what it really is', async () => {
  const webp = `data:image/png;base64,${Buffer.from('RIFF0000WEBPxxxx').toString('base64')}`;
  const exe = createDisk(), hub = await hubOn(exe, write(small('c1', 'Pip', { base: { src: webp, bb: frame('x').bb } }))), page = await makerOn(hub, 'c1');
  await hub.done();
  assert.match(page.maker.current()!.base.src, /^data:image\/webp/);
  exe.calls.length = 0;
  await page.pass(3000);
  assert.deepStrictEqual(changes(exe), []);
});

/* Fields the reader doesn't know. */

test('a manifest with a field this version doesn\'t know won\'t open, and is left exactly as it is', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1')));
  const m = await r.manager();
  const text = new TextDecoder().decode(exe.files.get('library/c1/buddy.json'));
  const odd = JSON.stringify({ ...JSON.parse(text) as object, buddy: { ...(JSON.parse(text) as { buddy: object }).buddy, wings: 2 } });
  await exe.shell.dataWrite('library/c1/buddy.json', odd);
  const next = await hubOn(exe, write(small('c2')));
  await next.done();
  assert.ok(!(await next.manager()).s().buddies.some(b => b.id === 'c1'), 'a newer buddy isn\'t on this version\'s shelf');
  const page = pageOn(next, { n: 0, id: 'c1', label: 'maker-test' }); /* a window on her from before */
  await next.done();
  assert.deepStrictEqual(page.maker.state.pets, []);
  assert.strictEqual(new TextDecoder().decode(exe.files.get('library/c1/buddy.json')), odd, 'untouched');
  void m;
});

test('a state with a field the file doesn\'t know is refused in plain words, and the old copy stays', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1'))), page = await makerOn(r, 'c1');
  await r.done();
  (page.maker.current() as unknown as { wings: number }).wings = 2;
  page.maker.saveNow();
  await page.pass(1300);
  assert.strictEqual(saved(exe, 'c1')!.name, 'Pip');
  assert.ok(page.saveState.kind === 'failed' && page.saveState.title === "Pip wasn't saved", JSON.stringify(page.saveState));
  delete (page.maker.current() as unknown as { wings?: number }).wings;
  page.maker.setName('Bea');
  await page.pass(1300);
  assert.strictEqual(saved(exe, 'c1')!.name, 'Bea');
});

test('an unusual frame that shares a file with another keeps both, in place', async () => {
  const exe = createDisk(), shared = png('shared');
  const b = small('c1', 'Pip', { base: { src: shared, bb: frame('x').bb }, poses: { walk: { frames: [{ src: shared, bb: frame('x').bb }, frame('w')] } } });
  const hub = await hubOn(exe, write(b)), page = await makerOn(hub, 'c1');
  await hub.done();
  page.maker.setName('Bea');
  await page.pass(1300);
  page.crashed();
  const again = await hubOn(exe), next = await makerOn(again, 'c1');
  await again.done();
  const p = next.maker.current()!;
  assert.strictEqual(p.base.src, shared);
  assert.strictEqual(p.poses.walk!.frames[0]!.src, shared);
  assert.strictEqual(p.poses.walk!.frames[1]!.src, frame('w').src);
});
