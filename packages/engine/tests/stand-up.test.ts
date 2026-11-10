/* Stand up after Dizzy: only when her Dizzy art is clearly lower than her standing art. Sleep, a
   faceplant and a knockout always get up through it. */
import assert from 'node:assert';
import { test } from 'vitest';
import { BOOK, type BuddyData, type Pet } from '../src/index';
import { BUDDY, screen, world } from './support';

/* art `h` tall, standing on the bottom of its picture, a frame per entry */
const art = (name: string, hs: number[], scale = 1) => ({ fps: 6, scale, frames: hs.map((h, i) => ({ src: `data:image/png;base64,${name}${i}`, bb: { x0: .2, y0: 1 - h, x1: .8, y1: 1 } })) });
const UP = art('up', [.5, .9]);

function onFloor(poses: BuddyData['poses']) {
  const w = world([screen('s', 0, 0, 1600, 900)]), pet = w.add(BUDDY('a', { poses }));
  assert.ok(w.until(() => pet.P.surf === 'floor' && pet.P.state !== 'land', 2000));
  return { w, pet };
}
/* What she does as `from` ends: the clip she plays, or null for none. */
function getsUp(poses: BuddyData['poses'], from: Parameters<Pet['go']>[0] = 'dizzy') {
  const { w, pet } = onFloor(poses);
  pet.go(from); pet.P.dur = 1;
  /* a pose of several frames finishes its pass first */
  assert.ok(w.until(() => pet.P.clip || pet.P.state !== from, 60), 'it ended');
  return pet.P.clip ? pet.P.clip.pose : null;
}

test('the book: only Dizzy and Watch cursor ask whether she is down', () => {
  assert.deepStrictEqual(BOOK.behaviours.dizzy!.exit, { clip: 'stand_up_from_dizzy', or: 'stand_up', ifDown: true });
  assert.deepStrictEqual(BOOK.behaviours.watch_cursor!.exit, { clip: 'stand_from_sit', ifDown: true });
  for (const [name, b] of Object.entries(BOOK.behaviours)) if (name !== 'dizzy' && name !== 'watch_cursor') assert.ok(!b.exit || !('ifDown' in b.exit), name);
});

test('a Dizzy drawn sitting gets up through Stand up', () => {
  assert.strictEqual(getsUp({ stand: art('stand', [.9]), dizzy: art('dizzy', [.6]), stand_up: UP }), 'stand_up');
});

test('a Dizzy drawn standing doesn\'t lie down to get up again', () => {
  assert.strictEqual(getsUp({ stand: art('stand', [.9]), dizzy: art('dizzy', [.9]), stand_up: UP }), null);
});

test('the largest buddy\'s shape: a standing Dizzy at her own scale skips it', () => {
  assert.strictEqual(getsUp({ stand: art('stand', [.99], 1.0098), dizzy: art('dizzy', [.99], 1.0117), stand_up: UP }), null);
});

test('a chibi\'s shape: sitting at 83% of standing, she still gets up', () => {
  assert.strictEqual(getsUp({ stand: art('stand', [1], 1.027), dizzy: art('dizzy', [1], .85), stand_up: UP }), 'stand_up');
});

test('the line is 90% of standing, by height times scale', () => {
  const at = (scale: number) => getsUp({ stand: art('stand', [1]), dizzy: art('dizzy', [1], scale), stand_up: UP });
  assert.strictEqual(at(.89), 'stand_up');
  assert.strictEqual(at(.9), null);
  assert.strictEqual(at(.6), 'stand_up');
});

test('every frame counts: one tall frame makes the pose tall', () => {
  assert.strictEqual(getsUp({ stand: art('stand', [.9]), dizzy: art('dizzy', [.5, .9, .5]), stand_up: UP }), null);
  assert.strictEqual(getsUp({ stand: art('stand', [.5, .9]), dizzy: art('dizzy', [.6]), stand_up: UP }), 'stand_up', 'and in Stand too');
});

test('with no Stand art, standing is the main image', () => {
  assert.strictEqual(getsUp({ dizzy: art('dizzy', [1]), stand_up: UP }), null);
  assert.strictEqual(getsUp({ dizzy: art('dizzy', [.6]), stand_up: UP }), 'stand_up');
});

test('a Dizzy with no art of its own gets up through it only when what she shows is low', () => {
  assert.strictEqual(getsUp({ stand: art('stand', [.9]), sprawl: art('sprawl', [.5]), stand_up: UP }), 'stand_up', 'Sprawl, lying down');
  assert.strictEqual(getsUp({ stand: art('stand', [.5]), sprawl: art('sprawl', [.9]), stand_up: UP }), null, 'a Sprawl drawn taller than Stand');
  assert.strictEqual(getsUp({ stand_up: UP }), null, 'the main image wobbling: she is standing');
});

test('sleep, a faceplant and a knockout always get up through it, however tall the art', () => {
  for (const [from, pose] of [['sleep', 'sleep'], ['trip', 'sprawl'], ['knocked_out', 'knocked_out']] as const) {
    assert.strictEqual(getsUp({ stand: art('stand', [.9]), [pose]: art(pose, [.9]), stand_up: UP }, from), 'stand_up', from);
  }
});

test('with no Stand up art, nothing changes', () => {
  assert.strictEqual(getsUp({ stand: art('stand', [.9]), dizzy: art('dizzy', [.6]) }), null);
});

test('skipping it still ends Dizzy the usual way', () => {
  const { w, pet } = onFloor({ stand: art('stand', [.9]), dizzy: art('dizzy', [.9]), stand_up: UP });
  pet.go('dizzy'); pet.P.dur = 1; w.run(3);
  assert.deepStrictEqual([pet.P.state, pet.P.clip], ['idle', null]);
});

/* Watch cursor gets up the way Sit does, when it's drawn sitting. */
const SIT_UP = art('situp', [.6, .9]);
test('a Watch cursor drawn sitting gets up through Stand from sit', () => {
  assert.strictEqual(getsUp({ stand: art('stand', [.9]), watch_cursor: art('watch', [.6]), stand_from_sit: SIT_UP }, 'watch_cursor'), 'stand_from_sit');
});

test('a Watch cursor drawn standing goes straight on', () => {
  assert.strictEqual(getsUp({ stand: art('stand', [.9]), watch_cursor: art('watch', [.9]), stand_from_sit: SIT_UP }, 'watch_cursor'), null);
});

test('a Watch cursor with no art of its own shows Sit, so it counts as low', () => {
  assert.strictEqual(getsUp({ stand: art('stand', [.9]), sit: art('sit', [.6]), stand_from_sit: SIT_UP }, 'watch_cursor'), 'stand_from_sit');
});

test('Watch cursor art taken away while she watches, with no Sit art: she shows Stand, so she goes straight on', () => {
  const poses = { stand: art('stand', [.9]), watch_cursor: art('watch', [.6]), stand_from_sit: SIT_UP };
  const { w, pet } = onFloor(poses);
  pet.go('watch_cursor'); pet.P.dur = 1e9; w.frame();
  const { watch_cursor: _, ...rest } = poses;
  w.sim.sync({ pets: [BUDDY('a', { poses: rest })] }); w.frame();
  pet.P.dur = 1;
  assert.ok(w.until(() => pet.P.clip || pet.P.state !== 'watch_cursor', 20), 'it ended');
  assert.strictEqual(pet.P.clip, null);
});

test('with no Stand from sit art, Watch cursor ends as before', () => {
  assert.strictEqual(getsUp({ stand: art('stand', [.9]), watch_cursor: art('watch', [.6]) }, 'watch_cursor'), null);
});

test('after it, she picks what is next, as before', () => {
  const { w, pet } = onFloor({ stand: art('stand', [.9]), watch_cursor: art('watch', [.6]), stand_from_sit: SIT_UP });
  pet.go('watch_cursor'); pet.P.dur = 1;
  assert.ok(w.until(() => pet.P.clip, 20));
  assert.ok(w.until(() => !pet.P.clip, 200));
  assert.notStrictEqual(pet.P.state, 'watch_cursor');
});
