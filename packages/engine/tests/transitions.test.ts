/* Transitions from an artist's notes: a Roll pose, a stand up for each way down, clips into Sit and
   Sleep, and timed states that finish the cycle they're in. Each needs its art: without it she does
   what she did before. */
import assert from 'node:assert';
import { test } from 'vitest';
import { ANIMS } from '../src/anims';
import { BOOK, type BuddyData, type Pet } from '../src/index';
import type { PetState } from '../src/state';
import { BUDDY, screen, world } from './support';

/* art `h` tall, standing on the bottom of its picture, a frame per entry */
const art = (name: string, hs: number[], fps = 6) => ({ fps, frames: hs.map((h, i) => ({ src: `data:image/png;base64,${name}${i}`, bb: { x0: .2, y0: 1 - h, x1: .8, y1: 1 } })) });
type Poses = Record<string, ReturnType<typeof art>>;
const STAND = art('stand', [.9]);

function onFloor(poses: Poses) {
  const w = world([screen('s', 0, 0, 1600, 900)]), pet = w.add(BUDDY('a', { poses: poses as BuddyData['poses'] }));
  assert.ok(w.until(() => pet.P.surf === 'floor' && pet.P.state !== 'land', 2000));
  /* nothing chatters or picks while a test looks */
  pet.P.chatT = 1e9;
  return { w, pet };
}
const VP = { x: 0, y: 0, scale: 1 };
/* the angle the art is turned by its animation, from the transform the view is given */
const turned = (pet: Pet) => Number(/translateY\([^)]*\) rotate\((-?[\d.]+)deg\)/.exec(pet.frame(VP).body!)![1]);
const src = (pet: Pet) => pet.frame(VP).src;

/* ---------- 1. Roll ---------- */

test('with Roll art she shows it, unturned, and still rolls along', () => {
  const { w, pet } = onFloor({ stand: STAND, roll: art('roll', [.8, .8, .8]) });
  pet.go('roll'); pet.P.dur = 1e9; const x = pet.P.x;
  w.run(20);
  assert.strictEqual(pet.P.state, 'roll');
  assert.ok(src(pet)!.includes('roll'), 'her Roll art');
  assert.strictEqual(turned(pet), 0, 'the art already rolls');
  assert.ok(Math.abs(pet.P.x - x) > 20, 'the roll still moves her');
});

test('without Roll art she spins her Stand art like a wheel, as before', () => {
  const { w, pet } = onFloor({ stand: STAND });
  pet.go('roll'); pet.P.dur = 1e9; const x = pet.P.x;
  w.run(20);
  assert.ok(src(pet)!.includes('stand'));
  assert.notStrictEqual(turned(pet), 0);
  assert.ok(Math.abs(pet.P.x - x) > 20);
});

/* ---------- 2. Stand up per state ---------- */

/* What she does as `from` ends: the clip she plays, or null for none. */
function getsUp(poses: Poses, from: Parameters<Pet['go']>[0]) {
  const { w, pet } = onFloor(poses);
  pet.go(from); pet.P.dur = 1;
  assert.ok(w.until(() => pet.P.clip || pet.P.state !== from, 60), 'it ended');
  return pet.P.clip ? pet.P.clip.pose : null;
}
const UP = art('up', [.5, .9]);
const WAYS = [['sleep', 'sleep', 'stand_up_from_sleep'], ['trip', 'sprawl', 'stand_up_from_sprawl'], ['dizzy', 'dizzy', 'stand_up_from_dizzy'], ['knocked_out', 'knocked_out', 'stand_up_from_knocked_out']] as const;

test('each way down gets up through its own Stand up when it is drawn', () => {
  for (const [from, pose, own] of WAYS) {
    assert.strictEqual(getsUp({ stand: STAND, [pose]: art(pose, [.5]), stand_up: UP, [own]: art(own, [.5, .9]) }, from), own, from);
  }
});

test('without its own, the shared Stand up, and without that, nothing', () => {
  for (const [from, pose, own] of WAYS) {
    assert.strictEqual(getsUp({ stand: STAND, [pose]: art(pose, [.5]), stand_up: UP }, from), 'stand_up', from);
    assert.strictEqual(getsUp({ stand: STAND, [pose]: art(pose, [.5]) }, from), null, from);
    assert.strictEqual(getsUp({ stand: STAND, [pose]: art(pose, [.5]), [own]: art(own, [.5, .9]) }, from), own, `${from}, its own alone`);
  }
});

test('one way down\'s Stand up is never another\'s', () => {
  assert.strictEqual(getsUp({ stand: STAND, sprawl: art('sprawl', [.5]), stand_up_from_sleep: UP }, 'trip'), null);
});

test('a Dizzy drawn standing still skips getting up, its own or the shared one', () => {
  assert.strictEqual(getsUp({ stand: STAND, dizzy: art('dizzy', [.9]), stand_up: UP, stand_up_from_dizzy: UP }, 'dizzy'), null);
  assert.strictEqual(getsUp({ stand: STAND, dizzy: art('dizzy', [.9]), stand_up_from_dizzy: UP }, 'dizzy'), null);
});

/* ---------- 3. Entry clips ---------- */

const SIT = art('sit', [.6]), DOWN = art('sitdown', [.9, .7, .6]);

test('from standing, Sit starts with Sit down, then sits for her usual time', () => {
  const { w, pet } = onFloor({ stand: STAND, sit: SIT, sit_down: DOWN });
  pet.go('idle'); pet.go('sit');
  assert.deepStrictEqual([pet.P.state, pet.P.clip?.pose], ['sit', 'sit_down']);
  assert.ok(w.until(() => !pet.P.clip, 60), 'the clip ends');
  assert.strictEqual(pet.P.state, 'sit');
  assert.ok(pet.P.dur >= 150 && pet.P.dur <= 420, 'her sit, timed from here');
  assert.ok(pet.P.t < 2);
  w.frame();
  assert.ok(src(pet)!.includes('sit0'));
});

test('without Sit down art she sits at once, as before', () => {
  const { pet } = onFloor({ stand: STAND, sit: SIT });
  pet.go('idle'); pet.go('sit');
  assert.strictEqual(pet.P.clip, null);
});

test('she never sits down twice: Cry drawn sitting, or shown as Sit, goes straight to Sit', () => {
  for (const poses of <Poses[]>[{ stand: STAND, sit: SIT, sit_down: DOWN }, { stand: STAND, sit: SIT, cry: art('cry', [.6]), sit_down: DOWN }]) {
    const { w, pet } = onFloor(poses);
    pet.go('cry'); pet.P.dur = 1;
    assert.ok(w.until(() => pet.P.state === 'sit', 20));
    assert.strictEqual(pet.P.clip, null);
  }
});

test('a Cry drawn standing sits down after it', () => {
  const { w, pet } = onFloor({ stand: STAND, sit: SIT, cry: art('cry', [.9]), sit_down: DOWN });
  pet.go('cry'); pet.P.dur = 1;
  assert.ok(w.until(() => pet.P.state === 'sit', 20));
  assert.strictEqual(pet.P.clip?.pose, 'sit_down');
});

test('after Stand from sit she is standing, so sitting again sits down again', () => {
  const { w, pet } = onFloor({ stand: STAND, sit: SIT, sit_down: DOWN, stand_from_sit: art('situp', [.6, .9]) });
  pet.go('sit'); assert.ok(w.until(() => !pet.P.clip, 60));
  pet.P.dur = 1; assert.ok(w.until(() => pet.P.clip?.pose === 'stand_from_sit', 20));
  /* as the clip hands on, she sits again */
  pet.P.t = 1e9; pet.P.clip!.then = () => pet.go('sit');
  w.frame();
  assert.strictEqual(pet.P.clip?.pose, 'sit_down');
});

test('Sleep starts with Fall asleep, then sleeps for her usual time', () => {
  const { w, pet } = onFloor({ stand: STAND, sleep: art('sleep', [.5]), fall_asleep: art('doze', [.9, .7, .5]) });
  pet.go('idle'); pet.go('sleep');
  assert.strictEqual(pet.P.clip?.pose, 'fall_asleep');
  assert.ok(w.until(() => !pet.P.clip, 60));
  assert.strictEqual(pet.P.state, 'sleep');
  assert.ok(pet.P.dur >= 500, 'her nap, timed from here');
});

test('a Watch cursor drawn sitting sits down into it, one drawn standing doesn\'t', () => {
  const low = onFloor({ stand: STAND, watch_cursor: art('watch', [.6]), sit_down: DOWN });
  low.pet.go('idle'); low.pet.go('watch_cursor');
  assert.strictEqual(low.pet.P.clip?.pose, 'sit_down');
  const tall = onFloor({ stand: STAND, watch_cursor: art('watch', [.9]), sit_down: DOWN });
  tall.pet.go('idle'); tall.pet.go('watch_cursor');
  assert.strictEqual(tall.pet.P.clip, null);
});

test('a grab during an entry clip picks her up, as during any clip', () => {
  const { w, pet } = onFloor({ stand: STAND, sit: SIT, sit_down: DOWN });
  pet.go('sit'); w.frame();
  const c = pet.center();
  pet.pressed(c.x, c.y); pet.moved(c.x + 30, c.y - 30); w.frame();
  assert.deepStrictEqual([pet.P.state, pet.P.clip], ['held', null]);
});

test('asking for something during an entry clip cuts it', () => {
  const { pet } = onFloor({ stand: STAND, sit: SIT, sleep: art('sleep', [.5]), fall_asleep: DOWN });
  pet.go('sleep'); assert.ok(pet.P.clip);
  pet.act('wave');
  assert.deepStrictEqual([pet.P.state, pet.P.clip], ['wave', null]);
});

/* ---------- 4. Finishing the cycle ---------- */

/* Wave, two frames at 6 fps: a pass is 20 frames. */
const WAVE = art('wave', [.9, .9]);

/* When does a Wave of `dur` frames end? */
function waveEnds(poses: Poses, dur: number) {
  const { w, pet } = onFloor(poses);
  pet.go('wave'); pet.P.dur = dur;
  let t = 0;
  assert.ok(w.until(() => { if (pet.P.state === 'wave') { t = pet.P.t; return false; } return true; }, 200));
  return t;
}

test('time up mid-wave, she finishes the wave first', () => {
  const t = waveEnds({ stand: STAND, wave: WAVE }, 25);
  assert.ok(t > 38 && t < 40, `last seen waving at ${t}`);
});

test('she waits no more than one pass, and not at all on its last frame', () => {
  assert.ok(waveEnds({ stand: STAND, wave: WAVE }, 39) < 40);
  const t = waveEnds({ stand: STAND, wave: WAVE }, 40);
  assert.ok(t <= 40, `last seen waving at ${t}`);
});

test('she plays on to the last frame, and never starts the pass again', () => {
  const { w, pet } = onFloor({ stand: STAND, wave: WAVE });
  pet.go('wave'); pet.P.dur = 25;
  const seen: string[] = [];
  while (pet.P.state === 'wave') { w.frame(); if (pet.P.state === 'wave' && pet.P.t > 25) seen.push(src(pet)!.slice(-1)); }
  const shown = seen.join('');
  assert.match(shown, /^0+1+$/, 'the rest of the first frame, then the last');
});

test('one frame, or no art of her own, ends on time as before', () => {
  assert.ok(waveEnds({ stand: STAND, wave: art('wave', [.9]) }, 25) < 26);
  assert.ok(waveEnds({ stand: STAND, happy: art('happy', [.9, .9]) }, 25) < 26, 'Happy, shown for Wave, is not her Wave');
});

test('a pass she could only finish minutes later is cut on time', () => {
  /* 120 frames at a tenth of a frame a second: a pass of twenty minutes */
  const slow = art('wave', Array(120).fill(.9), .1);
  assert.ok(waveEnds({ stand: STAND, wave: slow }, 25) < 26);
});

test('a 120-frame Sleep at 6.5 fps finishes its pass only when it ends within three seconds', () => {
  /* a pass is 120 / 6.5 * 60, about 1107.7 frames */
  const sleeps = (dur: number) => {
    const { w, pet } = onFloor({ stand: STAND, sleep: art('sleep', Array(120).fill(.5), 6.5) });
    pet.go('sleep'); pet.P.dur = dur;
    let t = 0;
    assert.ok(w.until(() => { if (pet.P.state === 'sleep' && !pet.P.clip) { t = pet.P.t; return false; } return true; }, 1400));
    return t;
  };
  assert.ok(sleeps(600) < 601, 'woken 500 frames before the pass ends: on time');
  const t = sleeps(1000);
  assert.ok(t > 1106 && t < 1108, `100 frames before the end: she sleeps it out, last seen at ${t}`);
});

test('a grab or a request while she finishes cuts it at once', () => {
  const { w, pet } = onFloor({ stand: STAND, wave: WAVE });
  pet.go('wave'); pet.P.dur = 25; w.run(30);
  assert.strictEqual(pet.P.state, 'wave');
  pet.act('love');
  assert.strictEqual(pet.P.state, 'love');
  pet.go('wave'); pet.P.dur = 25; w.run(30);
  const c = pet.center();
  pet.pressed(c.x, c.y); pet.moved(c.x + 30, c.y - 30); w.frame();
  assert.strictEqual(pet.P.state, 'held');
});

test('her exit clip comes after the cycle', () => {
  const { w, pet } = onFloor({ stand: STAND, sit: art('sit', [.6, .6]), stand_from_sit: art('situp', [.6, .9]) });
  pet.go('sit'); pet.P.dur = 25;
  let t = 0;
  assert.ok(w.until(() => { if (pet.P.clip) return true; t = pet.P.t; return false; }, 100));
  assert.strictEqual(pet.P.clip!.pose, 'stand_from_sit');
  assert.ok(t > 38 && t < 40, `last seen sitting at ${t}`);
});

test('a spin that finishes its cycle stops turning at a full turn', () => {
  const A = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, pivot: 0 };
  ANIMS.whirl!(A, { t: 30, dur: 20, dir: 1 } as PetState, true, 100, 50);
  assert.strictEqual(A.rot, 360);
});

test('the book still asks for it: Wave and Tired are timed', () => {
  assert.ok(BOOK.behaviours.wave!.main.hold && BOOK.behaviours.tired!.main.hold);
});
