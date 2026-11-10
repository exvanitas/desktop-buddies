/* The load-time checks, on the real book and on broken ones. */
import assert from 'node:assert';
import { POSES } from '@buddies/buddy-file';
import { test } from 'vitest';
import { BOOK } from '../src/behaviours';
import { MOVES, checkBook, checkPoses, namesOf } from '../src/check';
import { lively } from '../src/pace';
import type { Book } from '../src/runner';

const names = namesOf(lively, MOVES);
const broken = (change: (b: Book) => void) => { const b = structuredClone(BOOK); change(b); return checkBook(b, names); };
const finds = (change: (b: Book) => void, what: RegExp) => assert.ok(broken(change).some(p => what.test(p)), `wanted ${what}, got: ${broken(change).join('; ')}`);

test('the real book is clean: every name resolves, every behaviour reached, none a dead end', () => {
  assert.deepStrictEqual(checkBook(BOOK, names), []);
});
test('every pose has a fallback that ends', () => assert.deepStrictEqual(checkPoses(), []));
test('every pose a behaviour uses is a real slot', () => {
  const slots = new Set<string>(POSES.map(p => p.key));
  for (const [n, b] of Object.entries(BOOK.behaviours)) assert.ok(slots.has(b.main.pose), n);
});

test('finds a pose that isn\'t one', () => finds(b => { b.behaviours.sit!.main.pose = 'nap'; }, /sit: no pose called nap/));
test('finds a motion that isn\'t registered', () => finds(b => { b.behaviours.walk!.main.motion = 'skip'; }, /walk: no motion called skip/));
test('finds a cue that isn\'t registered', () => finds(b => { b.behaviours.sleep!.main.each = 'dream'; }, /sleep: no cue called dream/));
test('finds an animation that isn\'t registered', () => finds(b => { b.behaviours.idle!.main.anim = 'hum'; }, /idle: no anim called hum/));
test('finds a duration the pace table doesn\'t have', () => finds(b => { b.behaviours.idle!.main.hold = 'forever'; }, /idle: no duration called forever/));
test('the reach table is not a duration', () => finds(b => { b.behaviours.idle!.main.hold = 'reach'; }, /idle: no duration called reach/));
test('finds a line that doesn\'t exist', () => finds(b => { b.behaviours.think!.main.say = 'muse'; }, /think: no line called muse/));
test('finds an exit clip that isn\'t a pose', () => finds(b => { b.behaviours.dizzy!.exit = { clip: 'rise', ifDown: true }; }, /dizzy: no pose called rise/));
test('finds a getting up from somewhere that isn\'t the floor', () => finds(b => { b.behaviours.hang!.exit = { clip: 'stand_up', ifDown: true }; }, /hang: gets up only on the floor/));
test('finds a stand-in exit clip that isn\'t a pose', () => finds(b => { b.behaviours.sleep!.exit = { clip: 'stand_up', or: 'rise' }; }, /sleep: no pose called rise/));
test('finds an entry clip that isn\'t a pose', () => finds(b => { b.behaviours.sit!.enter = { clip: 'plop' }; }, /sit: no pose called plop/));
test('finds an entry clip somewhere she can\'t be standing', () => finds(b => { b.behaviours.hang!.enter = { clip: 'sit_down' }; }, /hang: comes from standing only on the floor/));
test('finds a rule going nowhere', () => finds(b => { b.behaviours.spin!.then = [{ to: 'orbit' }]; }, /spin: nowhere called orbit/));
test('finds a condition nobody wrote', () => finds(b => { (b.events.clicked as { when?: string }[])[0]!.when = 'moody'; }, /no condition called moody/));
test('finds a pick with no weight in the pace table', () => finds(b => { b.picks.floor!.push({ to: 'sit', weight: 'lots' }); }, /no weight called lots/));
test('finds an alias to nothing', () => finds(b => { b.aliases.nap = 'snooze'; }, /alias nap: nothing called snooze/));
test('finds a dead end', () => finds(b => { b.behaviours.stuck = { on: ['floor'], main: { pose: 'stand' } }; }, /stuck: a dead end/));
test('finds a hold with nothing after it', () => finds(b => { b.behaviours.stuck = { on: ['floor'], main: { pose: 'stand', hold: 'idle' } }; }, /stuck: a hold with nothing after it/));
test('finds a trap: a behaviour that can never get back to idle', () => finds(b => {
  b.behaviours.trap = { on: ['floor'], main: { pose: 'stand', hold: 'idle' }, then: 'trap2' };
  b.behaviours.trap2 = { on: ['floor'], main: { pose: 'stand', hold: 'idle' }, then: 'trap' };
}, /trap: never gets back to idle/));
test('finds something only the wall can reach but nothing does', () => finds(b => {
  b.behaviours.perch = { on: ['wall'], main: { pose: 'wall', hold: 'wall' }, then: 'wall' };
  delete b.direct.perch;
}, /perch: nothing leads to it/));

test('the optional slots are the ones the tiers say', () => {
  assert.deepStrictEqual(POSES.filter(p => p.tier !== 'core').map(p => p.key as string).sort(), ['dance', 'dangle_legs', 'dragL', 'dragR', 'eat', 'excited', 'face_away', 'fall_asleep', 'knocked_out', 'laugh', 'roll', 'signature', 'sing', 'sit_down', 'stand_from_sit', 'stand_up', 'stand_up_from_dizzy', 'stand_up_from_knocked_out', 'stand_up_from_sleep', 'stand_up_from_sprawl', 'stare', 'struggle', 'surprised', 'tap_screen', 'think', 'tired', 'turn_back', 'watch_cursor']);
});
