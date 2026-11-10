/* The view's pure parts: what a slot shows and how big, how a pose plays, what the words say, and what
   the window remembers. */
import assert from 'node:assert';
import { POSES, type Frame, type PoseKey } from '@buddies/buddy-file';
import { LINES } from '@buddies/engine';
import type { MakerBuddy } from '@buddies/maker-core';
import { test } from 'vitest';
import { boxOf, captionOf, cellsOf, mainSlot, printed, slotOf, type Showing } from '../src/art';
import { artOf, label, noArtNote, ownNote, partsOf, plain, shortLabel, silent, sitOf, usedFor } from '../src/captions';
import { filesOfDrop, sortFiles } from '../src/drops';
import { SPLIT, clampSplit, fit, startSplit } from '../src/layout';
import { SWING_MS, createPlayer, motionOf } from '../src/playback';
import { readBacking, readSpots, saveBacking, saveSpots } from '../src/remember';
import { next } from '../src/save-status';
import { ON_STICKER, bubbleFor, lineAfterTidy } from '../src/words';
import { MOMENTS } from '../src/moments';

const BB = { x0: .25, y0: .1, x1: .75, y1: 1 };
const frame = (n: string, bb = BB): Frame => ({ src: `data:image/png;base64,${n}`, bb });
const buddy = (poses: Partial<Record<PoseKey, { frames: Frame[]; fps?: number; scale?: number }>> = {}, more: Partial<MakerBuddy> = {}): MakerBuddy => ({ id: 'x', character: 'c', name: 'Ann', size: 120, faces: 'right', base: frame('base'), poses, ...more });
const pose = (...n: string[]) => ({ frames: n.map(x => frame(x)), fps: 8, scale: 1.2 });
const keys = POSES.map(p => p.key);

test('short labels drop what follows, as the design has them', () => {
  assert.deepStrictEqual(['Stand / idle', 'Jump (going up)', 'Held, swung left', 'Held (still)', 'Eat snack'].map(shortLabel), ['Stand', 'Jump', 'Swung left', 'Held', 'Eat snack']);
  assert.strictEqual(label('dragR'), 'Swung right');
});

test('a caption comes apart into words and art', () => {
  assert.deepStrictEqual(partsOf('With {wave} on the floor'), ['With ', { pose: 'wave' }, ' on the floor']);
  assert.strictEqual(plain('{run} and {sit}'), 'Run and Sit');
});

test('a slot with its own art is that art', () => {
  const s = slotOf(buddy({ walk: pose('a', 'b') }), 'walk') as Showing;
  assert.strictEqual(s.kind, 'own');
  assert.strictEqual(s.from, 'walk');
  assert.strictEqual(s.fps, 8);
  assert.strictEqual(s.scale, 1.2);
  assert.strictEqual(s.frames.length, 2);
  assert.strictEqual(captionOf(s), '2 frames');
  assert.strictEqual(captionOf(slotOf(buddy({ walk: pose('a') }), 'walk') as Showing), '1 frame');
  assert.strictEqual(printed(s), false);
});

test('a core slot with no art borrows, printed faint', () => {
  const s = slotOf(buddy({ sit: pose('s') }), 'cry') as Showing;
  assert.strictEqual(s.kind, 'borrow');
  assert.strictEqual(s.from, 'sit');
  assert.strictEqual(captionOf(s), 'Using Sit');
  assert.strictEqual(printed(s), true);
});

test('with nothing to borrow it stands on the main image, full strength', () => {
  const s = slotOf(buddy(), 'walk') as Showing;
  assert.strictEqual(s.kind, 'main');
  assert.strictEqual(captionOf(s), 'Main image');
  assert.strictEqual(printed(s), false);
  assert.strictEqual(s.fps, 1);
});

test('walls and the ceiling turn the main image', () => {
  assert.strictEqual((slotOf(buddy(), 'climb') as Showing).turn, 90);
  assert.strictEqual((slotOf(buddy(), 'wall') as Showing).turn, 90);
  assert.strictEqual((slotOf(buddy(), 'hang') as Showing).turn, 180);
  assert.strictEqual((slotOf(buddy(), 'walk') as Showing).turn, 0);
  assert.strictEqual(printed(slotOf(buddy(), 'climb') as Showing), false);
});

test('an optional slot with no art shows nothing', () => {
  assert.strictEqual(slotOf(buddy(), 'dance').kind, 'none');
  assert.strictEqual(slotOf(buddy(), 'dangle_legs').kind, 'none');
  assert.strictEqual(slotOf(buddy({ dance: pose('d') }), 'dance').kind, 'own');
});

test('a pose\'s box covers all its frames, so it holds still as it plays', () => {
  const s = slotOf(buddy({ walk: { frames: [frame('a', { x0: .4, y0: .2, x1: .6, y1: .9 }), frame('b', { x0: .1, y0: .3, x1: .5, y1: 1 })] } }), 'walk') as Showing;
  assert.deepStrictEqual(s.bb, { x0: .1, y0: .2, x1: .6, y1: 1 });
  assert.strictEqual(s.fps, 6);
  assert.strictEqual(s.scale, 1);
});

test('slots on one picture share one sticker, and a one-image buddy gets one per sheet', () => {
  const p = buddy();
  const cells = cellsOf(p, ['stand', 'walk', 'think']);
  assert.strictEqual(cells.length, 1);
  assert.deepStrictEqual(cells[0]!.keys, ['stand', 'walk']);
  const walls = cellsOf(p, ['climb', 'wall', 'crawl', 'hang']);
  assert.deepStrictEqual(walls.map(c => c.keys), [['climb', 'wall'], ['crawl', 'hang']]);
});

test('slots borrowing the same pose share a sticker, and own art never does', () => {
  const p = buddy({ fall: pose('f') });
  const cells = cellsOf(p, ['fall', 'jump', 'drag']);
  assert.deepStrictEqual(cells.map(c => c.keys), [['fall'], ['jump', 'drag']]);
  assert.deepStrictEqual(cellsOf(buddy({ drag: pose('d') }), ['drag', 'dragL', 'dragR']).map(c => c.keys), [['drag']], 'the side poses are optional: no art, no sticker');
  assert.deepStrictEqual(cellsOf(buddy({ walk: pose('a'), run: pose('b') }), ['walk', 'run']).map(c => c.keys), [['walk'], ['run']]);
});

test('art is drawn at its own scale on one baseline', () => {
  const b = boxOf({ bb: BB, scale: 1, turn: 0 }, 115);
  assert.ok(Math.abs(b.side - 100) < 1e-9);
  assert.ok(Math.abs(b.w - 50) < 1e-9);
  assert.ok(Math.abs(b.h - 90) < 1e-9);
  assert.ok(Math.abs(b.left + 25) < 1e-9);
  assert.ok(Math.abs(b.top + 10) < 1e-9);
  assert.ok(Math.abs(boxOf({ bb: BB, scale: .5, turn: 0 }, 115).side - 50) < 1e-9);
  assert.ok(Math.abs(boxOf({ bb: BB, scale: 1.1, turn: 0 }, 115).side - 110) < 1e-9);
});

test('art too big for its place shrinks to fit, height or width', () => {
  const big = boxOf({ bb: { x0: 0, y0: 0, x1: 1, y1: 1 }, scale: 3, turn: 0 }, 100);
  assert.ok(Math.abs(big.h - 100) < 1e-9);
  assert.ok(Math.abs(big.w - 100) < 1e-9);
  const wide = boxOf({ bb: { x0: 0, y0: .5, x1: 1, y1: 1 }, scale: 1, turn: 0 }, 115, 40);
  assert.ok(Math.abs(wide.w - 40) < 1e-9);
  assert.ok(Math.abs(wide.h - 20) < 1e-9);
});

test('a quarter-turned image takes up the shape it really has', () => {
  const b = boxOf({ bb: BB, scale: 1, turn: 90 }, 115);
  assert.ok(Math.abs(b.w - 90) < 1e-9);
  assert.ok(Math.abs(b.h - 50) < 1e-9);
  assert.strictEqual(b.turn, 90);
  const half = boxOf({ bb: BB, scale: 1, turn: 180 }, 115);
  assert.ok(Math.abs(half.w - 50) < 1e-9);
  assert.ok(Math.abs(half.h - 90) < 1e-9);
});

test('the main image stands in when something must be drawn', () => {
  const p = buddy();
  assert.strictEqual(mainSlot(p).frames[0], p.base);
});

test('slots borrowing different poses keep their own stickers', () => {
  const p = buddy({ sit: pose('s'), stand: pose('t') });
  assert.deepStrictEqual(cellsOf(p, ['cry', 'eat', 'angry']).map(c => c.keys), [['cry'], ['angry']]);
});

test('with equal room, the sticker keeps the wider cell', () => {
  assert.deepStrictEqual(fit(400, 1000, 2, 100), { H: 100, cw: 260 });
});

test('a sticker\'s size comes from the room, and never below a usable size', () => {
  assert.deepStrictEqual(fit(600, 400, 2, 170), { H: 170, cw: 300 > 260 ? 260 : 300 });
  assert.strictEqual(fit(100, 40, 8, 170).H, 58);
  const three = fit(900, 300, 3, 170);
  assert.strictEqual(three.H, 170);
  assert.strictEqual(three.cw, 260);
  const narrow = fit(200, 800, 2, 170);
  assert.strictEqual(narrow.cw, 200);
  assert.strictEqual(narrow.H, 170);
  assert.strictEqual(fit(120, 800, 1, 170).H, 126);
  assert.strictEqual(fit(1000, 196, 1, 170).H, 120);
  assert.strictEqual(fit(1000, 400, 4, 80).H, 80);
});

test('the divider starts where the sheet\'s art and words suggest, and stays in range', () => {
  assert.ok(startSplit(8, 0, 2) > startSplit(1, 0, 7));
  assert.strictEqual(startSplit(40, 0, 0), .72);
  assert.strictEqual(startSplit(0, 0, 40), .34);
  assert.ok(startSplit(1, 3, 3) > startSplit(1, 0, 3));
  assert.strictEqual(clampSplit(0), SPLIT.min);
  assert.strictEqual(clampSplit(1), SPLIT.max);
  assert.strictEqual(clampSplit(.5), .5);
});

test('how a pose plays is how the engine plays it', () => {
  assert.strictEqual(motionOf('walk', 1), 'still');
  assert.strictEqual(motionOf('walk', 4), 'loop');
  assert.strictEqual(motionOf('stand_up', 3), 'once');
  assert.strictEqual(motionOf('laugh', 2), 'once');
  assert.strictEqual(motionOf('signature', 2), 'once');
  assert.strictEqual(motionOf('dragL', 2), 'swing');
  assert.strictEqual(motionOf('dragR', 2), 'swing');
  assert.strictEqual(motionOf('dragL', 3), 'loop');
  assert.strictEqual(motionOf('dragL', 1), 'still');
});

function ticking() {
  let f: (() => void) | null = null, ms = 0, stops = 0;
  return {
    io: { every: (m: number, g: () => void) => { f = g; ms = m; return () => { f = null; stops++; }; } },
    tick: (n = 1) => { for (let i = 0; i < n && f; i++) f(); },
    get on() { return !!f; }, get ms() { return ms; }, get stops() { return stops; }
  };
}

test('a loop goes round until it\'s stopped, at its real speed', () => {
  const t = ticking(), shown: number[] = [], p = createPlayer(t.io, i => shown.push(i));
  p.play('loop', 3, 10);
  assert.strictEqual(t.ms, 100);
  assert.strictEqual(p.running, true);
  t.tick(4);
  assert.deepStrictEqual(shown, [0, 1, 2, 0, 1]);
  p.stop();
  assert.strictEqual(p.running, false);
  assert.strictEqual(t.on, false);
});

test('a play-once pose runs through once and holds its last frame', () => {
  const t = ticking(), shown: number[] = [], p = createPlayer(t.io, i => shown.push(i));
  p.play('once', 3, 5);
  assert.strictEqual(t.ms, 200);
  t.tick(10);
  assert.deepStrictEqual(shown, [0, 1, 2]);
  assert.strictEqual(p.running, false);
  assert.strictEqual(t.on, false);
});

test('the swing shows gentle, then strong, then gentle again and stops', () => {
  const t = ticking(), shown: number[] = [], p = createPlayer(t.io, i => shown.push(i));
  p.play('swing', 2, 6);
  assert.strictEqual(t.ms, SWING_MS);
  t.tick(10);
  assert.deepStrictEqual(shown, [0, 1, 0]);
  assert.strictEqual(p.running, false);
});

test('one frame has nothing to play', () => {
  const t = ticking(), shown: number[] = [], p = createPlayer(t.io, i => shown.push(i));
  p.play('still', 1, 6);
  assert.deepStrictEqual(shown, [0]);
  assert.strictEqual(p.running, false);
  assert.strictEqual(t.on, false);
});

test('playing again starts over and leaves no second timer', () => {
  const t = ticking(), shown: number[] = [], p = createPlayer(t.io, i => shown.push(i));
  p.play('loop', 3, 10); t.tick(1);
  p.play('loop', 3, 10);
  assert.strictEqual(t.stops, 1);
  assert.deepStrictEqual(shown, [0, 1, 0]);
});

test('the player says when it starts and when it stops', () => {
  const t = ticking(), runs: boolean[] = [], p = createPlayer(t.io, () => {}, () => runs.push(p.running));
  p.play('once', 2, 5);
  t.tick(1);
  assert.deepStrictEqual(runs, [true, false]);
});

test('a pose with no art promises only what the engine does', () => {
  assert.match(noArtNote('Ann', 'dangle_legs'), /Not in the game yet/);
  /* picked now and then, once they have art */
  for (const k of ['stare', 'face_away', 'tap_screen', 'surprised', 'laugh', 'excited'] as const) assert.strictEqual(noArtNote('Ann', k), "Ann doesn't do this yet. Add art and it will.", k);
  assert.strictEqual(noArtNote('Ann', 'turn_back'), 'Without it Ann turns back from Face away at once. Add art and she plays it as she does.');
  assert.strictEqual(noArtNote('Ann', 'dance'), "Ann doesn't do this yet. Add art and it will.");
  for (const k of ['dragL', 'dragR'] as const) assert.strictEqual(noArtNote('Ann', k), 'Without it Ann swings on Held. Add art and she leans into the swing.', k);
  assert.strictEqual(noArtNote('Ann', 'roll'), 'Without it Ann rolls by spinning Stand like a wheel. Add art and she shows it as she rolls.');
  for (const k of ['stand_up_from_sleep', 'stand_up_from_sprawl', 'stand_up_from_dizzy', 'stand_up_from_knocked_out'] as const) assert.match(noArtNote('Ann', k), /^Without it Ann gets up through Stand up/, k);
  assert.strictEqual(noArtNote('', 'sit_down'), 'Without it this buddy sits at once. Add art and she sits down into Sit from standing.');
  assert.strictEqual(noArtNote('Ann', 'fall_asleep'), 'Without it Ann drops straight into Sleep. Add art and she dozes off first.');
  assert.strictEqual(noArtNote('', 'dance'), "This buddy doesn't do this yet. Add art and it will.");
  for (const k of keys) if (k === 'dangle_legs') assert.doesNotMatch(noArtNote('Ann', k), /Add art and it will/);
});

test('a pose with art says what it does', () => {
  assert.match(ownNote('stand_from_sit', 2), /Plays once\./);
  assert.strictEqual((ownNote('laugh', 2).match(/plays once/gi) || []).length, 1);
  assert.match(ownNote('dragL', 2), /Frame 1 is a gentle swing, frame 2 a strong one\./);
  assert.match(ownNote('dragL', 1), /One frame, or two/);
  assert.doesNotMatch(ownNote('dragL', 2), /1.2 frames/);
  assert.doesNotMatch(ownNote('stare', 1), /Nothing sets this off/);
  assert.match(ownNote('dangle_legs', 1), /Not in the game yet/);
  assert.strictEqual(ownNote('walk', 2), '');
  assert.strictEqual(ownNote('walk', 3), '');
  assert.strictEqual(ownNote('walk', 1), '');
});

test('what a situation points at can depend on the art', () => {
  assert.strictEqual(artOf(buddy(), sitOf('hello')), 'wave');
  assert.strictEqual(artOf(buddy(), sitOf('chat')), null);
  assert.strictEqual(artOf(buddy(), sitOf('think')), null);
  assert.strictEqual(artOf(buddy({ think: pose('t') }), sitOf('think')), 'think');
});

test('words that need art wait for it', () => {
  assert.strictEqual(silent(buddy(), sitOf('eat')), true);
  assert.strictEqual(silent(buddy({ eat: pose('e') }), sitOf('full')), false);
  assert.strictEqual(silent(buddy(), sitOf('hello')), false);
});

test('art knows what words use it', () => {
  assert.deepStrictEqual(usedFor(buddy(), 'wave').map(s => s.k), ['hello', 'greet', 'bye']);
  assert.deepStrictEqual(usedFor(buddy(), 'dizzy').map(s => s.k), ['hurt']);
  assert.deepStrictEqual(usedFor(buddy(), 'turn_back'), []);
});

const FEELINGS = MOMENTS.find(m => m.t === 'Feelings')!.sits;

test('a picked line rides on its art when it\'s short enough', () => {
  const p = buddy({}, { lines: { hello: ['x'.repeat(ON_STICKER), 'y'.repeat(ON_STICKER + 1)] } });
  assert.deepStrictEqual(bubbleFor(p, ['wave'], { sit: 'hello', i: 0 }, FEELINGS), { t: 'x'.repeat(ON_STICKER), now: true });
  assert.strictEqual(bubbleFor(p, ['wave'], { sit: 'hello', i: 1 }, FEELINGS), null);
});

test('a resting word is the art\'s shortest short line, or none', () => {
  const p = buddy({}, { lines: { hello: ['A long enough line here', 'Hi'], love: ['A line far too long to ride on this'] } });
  assert.deepStrictEqual(bubbleFor(p, ['wave'], { pose: 'stand' }, FEELINGS), { t: 'Hi', now: false });
  assert.strictEqual(bubbleFor(p, ['stand'], { pose: 'stand' }, FEELINGS), null);
  assert.strictEqual(bubbleFor(p, ['happy'], { pose: 'stand' }, FEELINGS.filter(s => s.k === 'love')), null);
});

test('a picked line only rides on its own art, and the rest stay at rest', () => {
  const p = buddy({}, { lines: { hello: ['Yo'], love: ['Yay'] } });
  assert.deepStrictEqual(bubbleFor(p, ['happy'], { sit: 'hello', i: 0 }, FEELINGS), { t: 'Yay', now: false });
});

test('of two short lines the same length, the first rests on the sticker, and 18 letters is short enough', () => {
  const p = buddy({}, { lines: { hello: ['Hi', 'Yo'] } });
  assert.strictEqual(bubbleFor(p, ['wave'], { pose: 'stand' }, FEELINGS)!.t, 'Hi');
  const q = buddy({}, { lines: { hello: ['x'.repeat(18)] } });
  assert.strictEqual(bubbleFor(q, ['wave'], { pose: 'stand' }, FEELINGS)!.t, 'x'.repeat(18));
  const r = buddy({}, { lines: { hello: ['x'.repeat(19)] } });
  assert.strictEqual(bubbleFor(r, ['wave'], { pose: 'stand' }, FEELINGS), null);
});

test('a word waiting for art doesn\'t ride on anything', () => {
  const fun = MOMENTS.find(m => m.t === 'Just for fun')!.sits;
  assert.strictEqual(bubbleFor(buddy(), ['eat'], { pose: 'stand' }, fun), null);
  assert.ok(LINES.eat.length);
});

test('files sort by what they\'re for', () => {
  const f = (name: string, type = 'image/png') => ({ name, type }) as File;
  const s = sortFiles([f('olive.buddy', ''), f('old.buddy.json', 'application/json'), f('walk_1.png'), f('cat.png'), f('notes.txt', 'text/plain')]);
  assert.deepStrictEqual(s.buddyFiles.map(x => x.name), ['olive.buddy', 'old.buddy.json']);
  assert.deepStrictEqual(s.named.map(x => x.name), ['walk_1.png']);
  assert.deepStrictEqual(s.unnamed.map(x => x.name), ['cat.png']);
  assert.deepStrictEqual(s.other.map(x => x.name), ['notes.txt']);
});

test('four Shimeji frames are a set, and three are just images', () => {
  const f = (name: string) => ({ name, type: 'image/png' }) as File;
  assert.strictEqual(sortFiles(['shime1.png', 'shime2.png', 'shime3.png', 'shime4.png'].map(f)).shimeji.length, 4);
  const few = sortFiles(['shime1.png', 'shime2.png', 'shime3.png'].map(f));
  assert.strictEqual(few.shimeji.length, 0);
  assert.strictEqual(few.unnamed.length, 3);
});

/* A dropped folder arrives as entries to walk, a batch at a time, until one comes back empty. */
test('a dropped folder is walked, with its paths kept', async () => {
  const fileEntry = (name: string, full: string) => ({ isFile: true, fullPath: full, file: (ok: (f: File) => void) => ok(new File(['x'], name, { type: 'image/png' })) });
  const batches = [[fileEntry('shime1.png', '/Mochi/img/shime1.png')], [fileEntry('shime2.png', '/Mochi/img/shime2.png')], []];
  const folder = { isFile: false, fullPath: '/Mochi', createReader: () => ({ readEntries: (ok: (e: unknown[]) => void) => ok(batches.shift()!) }) };
  const got = await filesOfDrop({ items: [{ webkitGetAsEntry: () => folder }, { webkitGetAsEntry: () => null }] as never, files: [] as never });
  assert.deepStrictEqual(got.map(f => [f.name, f.webkitRelativePath]), [['shime1.png', 'Mochi/img/shime1.png'], ['shime2.png', 'Mochi/img/shime2.png']]);
});

test('files with no entries come as they are', async () => {
  const f = new File(['x'], 'a.png');
  assert.deepStrictEqual((await filesOfDrop({ items: [] as never, files: [f] as never })).map(x => x.name), ['a.png']);
  assert.deepStrictEqual((await filesOfDrop({ files: [f] } as never)).map(x => x.name), ['a.png']);
});

test('a save\'s word follows its state', () => {
  assert.deepStrictEqual(next(null, { kind: 'saved' }), { word: 'Saved', bad: false, failure: null });
  assert.deepStrictEqual(next(null, { kind: 'saving' }), { word: 'Saving', bad: false, failure: null });
  const f = { kind: 'failed', title: 't', why: 'w', fix: 'f' } as const;
  assert.deepStrictEqual(next(null, f), { word: 'Not saved', bad: true, failure: f });
});

test('trying again after a failure still isn\'t saved', () => {
  const f = { kind: 'failed', title: 't', why: 'w', fix: 'f' } as const;
  assert.deepStrictEqual(next(f, { kind: 'saving' }), { word: 'Not saved yet, trying again', bad: true, failure: f });
  assert.deepStrictEqual(next(f, { kind: 'saved' }), { word: 'Saved', bad: false, failure: null });
});

function memory() {
  const held = new Map<string, string>();
  return { held, store: () => ({ getItem: (k: string) => held.get(k) ?? null, setItem: (k: string, v: string) => { held.set(k, v); } }) };
}
const broken = () => { throw new Error('no storage'); };

test('the backing and a buddy\'s places are remembered', () => {
  const m = memory();
  assert.strictEqual(readBacking(m.store), 'light');
  saveBacking(m.store, 'dark');
  assert.strictEqual(readBacking(m.store), 'dark');
  saveSpots(m.store, 'ann', { last: 4, splits: { 4: .5 } });
  assert.deepStrictEqual(readSpots(m.store, 'ann', 9), { last: 4, splits: { 4: .5 } });
  assert.deepStrictEqual(readSpots(m.store, 'bob', 9), { last: 0, splits: {} });
});

test('with storage gone or garbled, the window just starts fresh', () => {
  assert.strictEqual(readBacking(broken as never), 'light');
  saveBacking(broken as never, 'dark');
  saveSpots(broken as never, 'ann', { last: 1, splits: {} });
  assert.deepStrictEqual(readSpots(broken as never, 'ann', 9), { last: 0, splits: {} });
  const m = memory();
  m.held.set('maker-spots-ann', 'not json');
  assert.deepStrictEqual(readSpots(m.store, 'ann', 9), { last: 0, splits: {} });
  m.held.set('maker-spots-ann', JSON.stringify({ last: 99, splits: { a: 'x', b: .4 } }));
  assert.deepStrictEqual(readSpots(m.store, 'ann', 9), { last: 0, splits: { b: .4 } });
  m.held.set('maker-spots-ann', JSON.stringify({ last: 0 }));
  assert.strictEqual(readSpots(m.store, 'ann', 9).last, 0);
  m.held.set('maker-spots-ann', JSON.stringify({ last: 1 }));
  assert.strictEqual(readSpots(m.store, 'ann', 9).last, 1);
  m.held.set('maker-spots-ann', JSON.stringify({ last: 9 }));
  assert.strictEqual(readSpots(m.store, 'ann', 9).last, 9);
  m.held.set('maker-spots-ann', JSON.stringify({ last: 1.5 }));
  assert.strictEqual(readSpots(m.store, 'ann', 9).last, 0);
});

test('where a line lands once the blanks have gone', () => {
  const five = ['first', '', 'third', '', 'fifth'];
  const table: [string[], number, number][] = [
    [five, 0, 0], [five, 1, 1], [five, 2, 1], [five, 3, 2], [five, 4, 2], [five, 5, 3],
    /* a blank target: what took its place, or the last one left */
    [['a', ''], 1, 0], [['a', '', ''], 1, 0], [['', 'b'], 0, 0], [['a', ' ', 'c'], 1, 1],
    /* a new line past the end stays past the end */
    [['a', ''], 2, 1], [['a', 'b'], 2, 2],
    /* nothing to tidy */
    [['a', 'b'], 1, 1], [['a'], 0, 0],
    /* all blank: the defaults come back, so the first */
    [['', ' '], 1, 0], [['', ' '], 0, 0]
  ];
  for (const [list, i, want] of table) assert.strictEqual(lineAfterTidy(list, i), want, `${JSON.stringify(list)} at ${i}`);
});

test('poses with a Lift are the ones the book stands on the floor, and no others', async () => {
  const { ON_FLOOR, floorIn } = await import('../src/facts');
  for (const k of ['stand', 'sit', 'sleep', 'walk', 'run', 'dizzy', 'sprawl', 'land', 'stand_up', 'stand_from_sit', 'turn_back', 'signature']) assert.ok(ON_FLOOR.has(k), k);
  for (const k of ['roll', 'sit_down', 'fall_asleep', 'stand_up_from_sleep', 'stand_up_from_sprawl', 'stand_up_from_dizzy', 'stand_up_from_knocked_out']) assert.ok(ON_FLOOR.has(k), k);
  for (const k of ['climb', 'wall', 'crawl', 'hang', 'fall', 'drag', 'dragL', 'dragR', 'struggle', 'jump', 'thrown', 'dangle_legs']) assert.ok(!ON_FLOOR.has(k), k);
  const book = { behaviours: { a: { on: ['floor'], main: { pose: 'sit' }, exit: { clip: 'x' } }, b: { on: ['floor', 'wall'], main: { pose: 'sit' } }, c: { on: ['ceil'], main: { pose: 'y' }, exit: { clip: 'x' } } } };
  assert.deepStrictEqual([...floorIn(book as never)], [], 'shown anywhere else, it is not a floor pose');
});
