/* The hit test's masks. Each changed image gets a new URL, so they can't all stay, and an image that
   goes and comes back has the same one. */
import assert from 'node:assert';
import { afterEach, beforeEach, test, vi } from 'vitest';
import fs from 'node:fs';
import { FAILED_MS, aim, explain, huntLine, make, noteWith, under } from '../src/hit';

const made: string[] = [];
beforeEach(() => {
  made.length = 0;
  vi.stubGlobal('Image', class { set src(url: string) { made.push(url); } });
});
afterEach(() => vi.unstubAllGlobals());

test('an image asked for again isn\'t loaded again', () => {
  assert.strictEqual(make('a?v=1'), make('a?v=1'));
  assert.deepStrictEqual(made, ['a?v=1']);
});

test('the oldest masks go, so an evening of saves doesn\'t pile up, and one still wanted comes back', () => {
  const first = make('old?v=0');
  for (let i = 0; i < 1024; i++) make(`b?v=${i}`);
  assert.notStrictEqual(make('old?v=0'), first, 'it went, and is made again');
  assert.strictEqual(made.filter(u => u === 'old?v=0').length, 2);
  const kept = make("b?v=1023");
  assert.strictEqual(make("b?v=1023"), kept);
});

test('a failed load that comes after its mask has gone leaves the newer mask alone', () => {
  const images: { src: string; onerror: (() => void) | null }[] = [];
  vi.stubGlobal('Image', class { onerror: (() => void) | null = null; onload: (() => void) | null = null; set src(url: string) { images.push({ src: url, onerror: null }); images.at(-1)!.onerror = () => this.onerror?.(); } });
  make('late');
  const first = images.at(-1)!;
  for (let i = 0; i < 1024; i++) make(`fill${i}`);
  const newer = make('late');
  first.onerror!();
  assert.strictEqual(make('late'), newer);
});

/* Failures are remembered for a while, counted from when they arrive, and then the next ask tries
   again. The clock is performance.now, moved by hand. */
function clocked() {
  let t = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => t);
  const images: { src: string; fail(): void; load(): void }[] = [];
  vi.stubGlobal('Image', class {
    onerror: (() => void) | null = null; onload: (() => void) | null = null;
    set src(u: string) { made.push(u); images.push({ src: u, fail: () => this.onerror?.(), load: () => this.onload?.() }); }
  });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4).fill(255) }) }) }) });
  return { images, later: (ms: number) => { t += ms; } };
}
const loadsOf = (u: string) => made.filter(x => x === u).length;

test('an image that stays broken is loaded once a period, however often the cursor asks', () => {
  const c = clocked();
  make('broken'); c.images.at(-1)!.fail();
  for (let i = 0; i < 120; i++) { c.later(FAILED_MS / 200); assert.strictEqual(make('broken').ready, false); }
  assert.strictEqual(loadsOf('broken'), 1, '120 checks inside the period, one load');
  c.later(FAILED_MS);
  make('broken');
  assert.strictEqual(loadsOf('broken'), 2, 'then one more');
  vi.restoreAllMocks();
});

test('a failure that clears by itself, with nothing changed about her, is tried again and hits', () => {
  const c = clocked();
  make('flaky'); c.images.at(-1)!.fail();
  c.later(FAILED_MS);
  const again = make('flaky');
  assert.strictEqual(loadsOf('flaky'), 2, 'loaded again');
  c.images.at(-1)!.load();
  assert.strictEqual(again.ready, true);
  assert.strictEqual(make('flaky'), again, 'and a good one is kept');
  c.later(FAILED_MS * 10);
  assert.strictEqual(make('flaky'), again);
  vi.restoreAllMocks();
});

test('a failure that arrives late, after her image is back, is tried again once its time is up', async () => {
  const c = clocked();
  const { createFakeExe } = await import('../src/shell-fake');
  const { createLibrary } = await import('../src/library');
  const { write } = await import('@buddies/buddy-file');
  const exe = createFakeExe(), lib = createLibrary(exe.shell, () => {});
  const png = (seed: string) => `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.from(seed)]).toString('base64')}`, bb = { x0: 0, y0: 0, x1: 1, y1: 1 };
  const pip = (walk: string) => write({ character: 'pip', name: 'Pip', base: { src: png('base'), bb }, poses: { walk: { frames: [{ src: png(walk), bb }] } } });
  await lib.add(pip('late A'));
  const a = (await lib.get('pip')).buddy.poses.walk!.frames[0]!.src;
  await lib.add(pip('late B'));
  make(a);
  const pending = c.images.at(-1)!;
  await lib.add(pip('late A'));
  assert.ok(exe.files.has(a), 'A is back');
  pending.fail();
  for (let i = 0; i < 120; i++) make(a);
  assert.strictEqual(loadsOf(a), 1);
  c.later(FAILED_MS);
  const back = make(a);
  assert.strictEqual(loadsOf(a), 2);
  c.images.at(-1)!.load();
  assert.strictEqual(back.ready, true);
  vi.restoreAllMocks();
});

test('an image tried again after a failure counts as the newest, so the oldest go first', () => {
  const c = clocked();
  for (let i = 0; i < 1024; i++) make(`full${i}`); /* full, whatever ran before */
  make('retried'); c.images.at(-1)!.fail();
  for (let i = 0; i < 1022; i++) make(`older${i}`);
  c.later(FAILED_MS);
  make('retried');
  make('one more'); make('two more');
  make('retried');
  assert.strictEqual(loadsOf('retried'), 2, 'still there');
  vi.restoreAllMocks();
});

/* One frame, drawn at 100,100 and 60 wide, with no turn. */
const frameAt = (src: string) => ({ id: 'c1-0', src, size: '60px', off: false, body: 'none', box: { l: 100, t: 100, size: 60, ox: 30, oy: 30 } }) as unknown as import('@buddies/engine').PetFrame;
class Flat { inverse() { return this; } transformPoint(p: { x: number; y: number }) { return p; } }

test('explain says what the hit test makes of a point, and never starts a load', () => {
  const c = clocked();
  vi.stubGlobal('DOMMatrix', Flat);
  const f = [frameAt('ex.png')];
  assert.strictEqual(explain(f, 900, 900), null, 'nowhere near her');
  assert.strictEqual(explain(f, 130, 130)!.answer, 'no mask yet');
  assert.strictEqual(loadsOf('ex.png'), 0, 'explaining loads nothing');
  make('ex.png');
  assert.strictEqual(explain(f, 130, 130)!.answer, 'loading');
  c.images.at(-1)!.load();
  assert.strictEqual(explain(f, 130, 130)!.answer, 'hit');
  assert.strictEqual(explain(f, 175, 130)!.answer, 'miss, outside her image');
  assert.deepStrictEqual([explain(f, 130, 130)!.id, explain(f, 130, 130)!.src], ['c1-0', 'ex.png']);
  const g = [frameAt('ex-bad.png')];
  make('ex-bad.png'); c.images.at(-1)!.fail();
  c.later(1000);
  assert.strictEqual(explain(g, 130, 130)!.answer, `couldn't load, next try in ${FAILED_MS - 1000} ms`);
  vi.restoreAllMocks();
});

test('explain tells a clear pixel from a hit', () => {
  const c = clocked();
  vi.stubGlobal('DOMMatrix', Flat);
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4) }) }) }) });
  make('clear.png'); c.images.at(-1)!.load();
  assert.strictEqual(explain([frameAt('clear.png')], 130, 130)!.answer, 'miss, a clear pixel');
  vi.restoreAllMocks();
});

test('a mask that couldn\'t load is said once a period, in words the smoke run doesn\'t read as trouble', () => {
  const c = clocked(), said: string[] = [];
  noteWith(l => said.push(l));
  make('said.png'); c.images.at(-1)!.fail();
  for (let i = 0; i < 120; i++) { c.later(FAILED_MS / 200); make('said.png'); }
  assert.deepStrictEqual(said, [`mask couldn't load said.png, next try in ${FAILED_MS} ms`]);
  c.later(FAILED_MS); make('said.png'); c.images.at(-1)!.fail();
  assert.strictEqual(said.length, 2);
  assert.ok(said.every(l => !/\b(error|rejected|failed)\b/.test(l)));
  noteWith(() => {});
  vi.restoreAllMocks();
});

/* A mask solid only in a block on the image's left: columns 4 to 23 of 64, rows 10 to 49. */
function leftBlock() {
  const c = clocked(), d = new Uint8ClampedArray(64 * 64 * 4);
  for (let j = 10; j < 50; j++) for (let i = 4; i < 24; i++) d[(j * 64 + i) * 4 + 3] = 255;
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: d }) }) }) });
  return c;
}
/* an overlay that shows all of a frame at 100,100 */
const VIEW = { w: 1000, h: 1000 };
/* turned about her origin, as a buddy facing the other way is */
class Mirror { inverse() { return this; } transformPoint(p: { x: number; y: number }) { return { x: -p.x, y: p.y }; } }

test('the aim is on one of her solid pixels, through her turn, and the hit test agrees', () => {
  const c = leftBlock();
  for (const M of [Flat, Mirror]) {
    vi.stubGlobal('DOMMatrix', M);
    const f = [frameAt(`aim-${M.name}.png`)];
    assert.strictEqual(aim(f[0]!, VIEW), null, 'no mask yet');
    assert.strictEqual(loadsOf(`aim-${M.name}.png`), 0, 'aiming loads nothing');
    make(`aim-${M.name}.png`); c.images.at(-1)!.load();
    const p = aim(f[0]!, VIEW)!;
    assert.strictEqual(under(f, p.x, p.y), 'c1-0', `${M.name}: ${p.x},${p.y}`);
    /* the block's middle: column 13.5 of 64 across a 60 px image at 100, or its mirror about the origin at 130 */
    const x = 100 + 14.5 / 64 * 60;
    assert.ok(Math.abs(p.x - (M === Flat ? x : 260 - x)) < 1, `${M.name}: ${p.x}`);
  }
  vi.restoreAllMocks();
});

test('no aim at a buddy drawn elsewhere, or all clear', () => {
  const c = clocked();
  vi.stubGlobal('DOMMatrix', Flat);
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4) }) }) }) });
  make('none.png'); c.images.at(-1)!.load();
  assert.strictEqual(aim(frameAt('none.png'), VIEW), null);
  make('off.png'); c.images.at(-1)!.load();
  assert.strictEqual(aim({ ...frameAt('off.png'), off: true }, VIEW), null);
  vi.restoreAllMocks();
});

test("the trace's line gives the aim in screen pixels, in the words the smoke run's hunt reads", () => {
  const c = leftBlock();
  vi.stubGlobal('DOMMatrix', Flat);
  const f = frameAt('line.png');
  make('line.png'); c.images.at(-1)!.load();
  /* a taskbar along the bottom, so the window starts a line down, at 720,1441 */
  const me = { x: 720, y: 1440, w: 1920, h: 1008, full: { x: 720, y: 1440, w: 1920, h: 1080 }, scale: 1.5 }, p = aim(f, { w: 1280, h: 1079 / 1.5 })!, line = huntLine(f, me)!;
  const hunt = fs.readFileSync(new URL('../shell-check/hunt.ps1', import.meta.url), 'utf8');
  /* the overlay's log puts its index in front */
  const m = `[1] ${line}`.match(new RegExp(hunt.match(/^\$AIM = '([^']+)'$/m)![1]!))!;
  assert.ok(m, line);
  assert.deepStrictEqual([m[1], m[2], Number(m[3]), Number(m[4])], ['1', 'c1-0', Math.round(720 + p.x * 1.5), Math.round(1441 + p.y * 1.5)]);
  assert.ok(!/\b(error|rejected|failed)\b/.test(line));
  assert.strictEqual(huntLine(frameAt('not-yet.png'), me), 'hunt c1-0 drawn 100,100 size 60, no aim yet');
  vi.restoreAllMocks();
});

/* A frame at l, t and 60 wide, the left block solid. */
const frameBox = (src: string, l: number, t: number) => ({ ...frameAt(src), box: { l, t, size: 60, ox: 30, oy: 30 } }) as unknown as import('@buddies/engine').PetFrame;

test("an overlay that doesn't show her gives no line and no aim: the first local smoke's second monitor", () => {
  const c = leftBlock();
  vi.stubGlobal('DOMMatrix', Flat);
  make('past.png'); c.images.at(-1)!.load();
  /* drawn at -129,-128 on the 1.5x monitor below, not off by the view's margin, and none of her shown */
  const below = { x: 720, y: 1440, w: 1920, h: 1008, full: { x: 720, y: 1440, w: 1920, h: 1008 }, scale: 1.5 }, f = { ...frameBox('past.png', -129, -128), box: { l: -129, t: -128, size: 96, ox: 48, oy: 48 } };
  assert.strictEqual(huntLine(f, below), null);
  assert.strictEqual(aim(f, { w: 1280, h: 672 }), null);
  /* past each edge in turn */
  for (const [l, t] of [[-60, 100], [100, -60], [1280, 100], [100, 672]] as const) assert.strictEqual(huntLine(frameBox('past.png', l, t), below), null, `${l},${t}`);
  vi.restoreAllMocks();
});

test('a buddy across an overlay\'s edge is aimed at on the part it shows', () => {
  const c = leftBlock();
  vi.stubGlobal('DOMMatrix', Flat);
  make('edge.png'); c.images.at(-1)!.load();
  /* her solid block runs from x -6 to 12.5 here: only the part from 0 shows */
  const f = frameBox('edge.png', -10, 100), p = aim(f, VIEW)!;
  assert.ok(p.x >= 0 && p.x < 12.5, String(p.x));
  assert.strictEqual(under([f], p.x, p.y), 'c1-0');
  /* and none of it shows when it all lies left of the edge */
  assert.strictEqual(aim(frameBox('edge.png', -30, 100), VIEW), null);
  assert.match(huntLine(frameBox('edge.png', -30, 100), { x: 0, y: 0, w: 1000, h: 1000, full: { x: 0, y: 0, w: 1000, h: 1000 }, scale: 1 })!, /, no aim yet$/, 'her box shows, her pixels don\'t');
  vi.restoreAllMocks();
});
