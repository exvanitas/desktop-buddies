/* The sheets against the engine. Every pose and situation is on exactly one sheet, and each caption's
   claim is checked against the behaviour book and the engine's source, so changing what a buddy does
   fails here until the caption has been looked at again. */
import assert from 'node:assert';
import fs from 'node:fs';
import { POSES, SITUATIONS, type Buddy, type PoseKey, type Situation } from '@buddies/buddy-file';
import { BOOK } from '@buddies/engine';
import { ACTS } from '@buddies/maker-core';
import { test } from 'vitest';
import { artsIn, capOf, plain, sitOf, stepsOf } from '../src/captions';
import { ONCE, UNBUILT, UNTRIGGERED, onceIn, reachedIn, surfaceOf, tryOf } from '../src/facts';
import { COMMON_TRIES, MOMENTS, SITS, WHEN } from '../src/moments';

const ALL_POSES = POSES.map(p => p.key as PoseKey), ALL_SITS = Object.keys(SITUATIONS) as Situation[];
const withArt = (...keys: PoseKey[]): Pick<Buddy, 'poses'> => ({ poses: Object.fromEntries(keys.map(k => [k, { frames: [{ src: 'x', bb: { x0: 0, y0: 0, x1: 1, y1: 1 } }] }])) });
const FULL = withArt(...ALL_POSES), NONE = withArt();

test('every pose is on exactly one sheet, and no pose is invented', () => {
  const seen = MOMENTS.flatMap(m => m.poses);
  assert.strictEqual(ALL_POSES.length, 49);
  assert.deepStrictEqual([...seen].sort(), [...ALL_POSES].sort());
});

test('every situation is on exactly one sheet, and none is invented', () => {
  const seen = SITS.map(s => s.k);
  assert.strictEqual(ALL_SITS.length, 33);
  assert.deepStrictEqual([...seen].sort(), [...ALL_SITS].sort());
});

test('every situation has its plain words, and no others', () => {
  assert.deepStrictEqual(Object.keys(WHEN).sort(), [...ALL_SITS].sort());
});

test('a caption or a sequence only names real poses, with or without art', () => {
  for (const art of [FULL, NONE]) {
    for (const s of SITS) for (const k of artsIn(capOf(art, s))) assert.ok(ALL_POSES.includes(k), `${s.k}: ${k}`);
  }
  for (const m of MOMENTS) for (const k of artsIn(m.flow)) assert.ok(ALL_POSES.includes(k), `${m.t}: ${k}`);
});

test('a sequence reads as whole steps', () => {
  assert.deepStrictEqual(stepsOf('{run} can trip into {sprawl}, then {stand_up}. {jump} comes down to {land}.'), ['{run} can trip into {sprawl}, then {stand_up}', '{jump} comes down to {land}']);
});

test('every sheet\'s tries are real actions', () => {
  const acts = ACTS.map(([a]) => a);
  for (const m of MOMENTS) for (const t of m.tries) assert.ok(acts.includes(t), `${m.t}: ${t}`);
  for (const t of COMMON_TRIES) assert.ok(acts.includes(t), t);
});

test('all 21 actions are still on offer', () => {
  assert.strictEqual(ACTS.length, 21);
  for (const [a] of ACTS) {
    const t = tryOf(a, () => false);
    assert.ok(ALL_POSES.includes(t.pose), a);
    if (t.say) assert.ok(ALL_SITS.includes(t.say), a);
  }
});

test('a Try shows what its behaviour shows, and says what it says', () => {
  for (const [a] of ACTS) {
    const b = BOOK.behaviours[a];
    if (!b || a === 'climbGo' || b.main.motion === 'roll') continue;
    for (const has of [() => true, () => false]) assert.deepStrictEqual(tryOf(a, has), { pose: b.main.pose, ...b.main.say ? { say: b.main.say } : {} }, a);
  }
});

/* A motion that picks its own pose decides what a Try shows, as it does in the engine. */
test('a Try of a behaviour whose motion picks the pose shows what the motion picks', () => {
  assert.deepStrictEqual(tryOf('roll', k => k === 'roll'), { pose: 'roll', say: 'roll' });
  assert.deepStrictEqual(tryOf('roll', () => false), { pose: 'stand', say: 'roll' });
  const picking = [...source('motions').matchAll(/^  (\w+): \{[^]*?^  \}/gm)].filter(m => /\n    pose: /.test(m[0])).map(m => m[1]).sort();
  assert.deepStrictEqual(picking, ['air', 'held', 'roll'], 'a new motion that picks its pose: teach tryOf about it');
  for (const [a] of ACTS) assert.ok(!['air', 'held'].includes(BOOK.behaviours[a]?.main.motion ?? ''), `${a}: a Try of air or held, which pick by speed and swing`);
});

test('the Tries that are moves or travel are still what the book says', () => {
  assert.strictEqual(BOOK.behaviours.climbGo!.main.pose, 'run');
  assert.strictEqual(BOOK.events.wall, 'climb');
  assert.strictEqual(BOOK.behaviours.climb!.main.pose, tryOf('climbGo', () => false).pose);
  assert.ok(BOOK.actions.jump!.move && BOOK.actions.ceilGo!.move && BOOK.actions.drop!.move);
  assert.strictEqual(BOOK.events.ceiling, 'crawl');
  assert.strictEqual(BOOK.behaviours.crawl!.main.pose, tryOf('ceilGo', () => false).pose);
});

test('a surface comes from where the book says a behaviour happens', () => {
  const on = { wall: 'wall', ceil: 'ceiling' } as const;
  for (const b of Object.values(BOOK.behaviours)) {
    const place = b.on[0] as keyof typeof on;
    if (on[place]) assert.strictEqual(surfaceOf(b.main.pose as PoseKey), on[place], b.main.pose);
  }
  assert.strictEqual(surfaceOf('fall'), 'air');
  assert.strictEqual(surfaceOf('drag'), 'held');
  assert.strictEqual(surfaceOf('stand'), 'floor');
});

test('what plays once is read from the book', () => {
  assert.deepStrictEqual([...ONCE].sort(), ['fall_asleep', 'laugh', 'signature', 'sit_down', 'stand_from_sit', 'stand_up', 'stand_up_from_dizzy', 'stand_up_from_knocked_out', 'stand_up_from_sleep', 'stand_up_from_sprawl', 'struggle', 'surprised', 'tap_screen', 'turn_back']);
});

test('what nothing sets off is read from the book, and is DESIGN.md\'s list', () => {
  assert.deepStrictEqual([...UNTRIGGERED].sort(), ['excited', 'face_away', 'laugh', 'stare', 'surprised', 'tap_screen']);
  assert.deepStrictEqual([...UNBUILT], ['dangle_legs']);
});

test('the readers notice a change to the book', () => {
  const b = { behaviours: { a: { on: ['floor'], main: { pose: 'p', once: true }, enter: { clip: 't' }, exit: { clip: 'q', or: 'u' }, then: [{ to: 'b' }] }, c: { on: ['floor'], main: { pose: 'r', chance: { odds: 1, to: 'd' } }, events: { e: 'f' } } }, picks: { floor: [{ to: 'g' }] }, aliases: {}, direct: {}, actions: { h: { clip: 's' } }, events: { i: 'j' } } as never;
  assert.deepStrictEqual([...reachedIn(b)].sort(), ['b', 'd', 'f', 'g', 'j']);
  assert.deepStrictEqual([...onceIn(b)].sort(), ['p', 'q', 's', 't', 'u']);
});

const rendered = (art: Pick<Buddy, 'poses'>) => Object.fromEntries(SITS.map(s => [s.k, plain(capOf(art, s))]));

test('with all the art, every caption says this', () => {
  assert.deepStrictEqual(rendered(FULL), {
    chat: 'Over any calm pose', think: 'With Think, or over any calm pose', dragme: 'Nothing says this on its own yet',
    held: 'Over Held, Swung left or Swung right', drop: 'With Falling or Thrown', hurt: 'On a hard hit, then Dizzy or Knocked out',
    climb: 'With Climb wall', grab: 'With Hold on wall or Hang from ceiling, caught after a throw',
    hello: 'With Wave', love: 'With Happy', comfort: 'With Happy, if it was upset', shy: 'With Shy', angry: 'With Angry', grumpy: 'Over Angry', cry: 'With Cry',
    trip: 'With Sprawled', getup: 'After Up from a trip, going to Stand',
    chase: 'With Run', caught: 'As it goes to Happy', tired: 'Going to Tired',
    yawn: 'As Fall asleep starts, when she was standing, or else with Sleep', wake: 'After Up from sleep, going to Stand. Clicked awake: straight to Stand',
    eat: 'With Eat snack', full: 'After Eat snack, going to Stand', dance: 'With Dance', sing: 'With Sing', spin: 'With Happy, spinning', roll: 'With Roll',
    greet: 'With Wave', hug: 'With Happy', bump: 'With Walk, heading apart', bumped: 'With Walk, heading apart', bye: "With Wave on the floor. Anywhere else, the pose it's in"
  });
});

test('with none of the optional art, the conditional captions change', () => {
  const r = rendered(NONE);
  assert.strictEqual(r.think, 'Over any calm pose');
  assert.strictEqual(r.hurt, 'On a hard hit, then Dizzy');
  assert.strictEqual(r.getup, 'Going back to Stand');
  assert.strictEqual(r.wake, 'Going back to Stand. Clicked awake: straight to Stand');
  assert.strictEqual(r.yawn, 'With Sleep');
  assert.strictEqual(plain(capOf(withArt('fall_asleep'), sitOf('yawn'))), 'As Fall asleep starts, when she was standing, or else with Sleep', 'from a low pose the clip is skipped');
  assert.strictEqual(r.roll, 'With Stand, rolling');
  assert.strictEqual(plain(capOf(withArt('stand_up'), sitOf('getup'))), 'After Stand up, going to Stand', 'the shared one stands in');
  assert.strictEqual(plain(capOf(withArt('stand_up'), sitOf('wake'))), 'After Stand up, going to Stand. Clicked awake: straight to Stand');
  assert.strictEqual(r.tired, 'Going to Sit');
  assert.strictEqual(plain(capOf(withArt('watch_cursor'), sitOf('tired'))), 'Going to Watch cursor');
  assert.strictEqual(plain(capOf(withArt('tired', 'watch_cursor'), sitOf('tired'))), 'Going to Tired');
});

/* Each situation the book says on entering a behaviour, with what that behaviour shows. */
test('a line the book says on entry names the pose that behaviour shows', () => {
  for (const b of Object.values(BOOK.behaviours)) {
    if (!b.main.say) continue;
    const s = sitOf(b.main.say as Situation);
    /* Roll's motion shows her Roll art when it's drawn, and Stand without it */
    if (b.main.motion === 'roll') assert.ok(artsIn(capOf(NONE, s)).includes(b.main.pose as PoseKey), 'roll without art');
    const shows = b.main.motion === 'roll' ? 'roll' : b.main.pose;
    assert.ok(artsIn(capOf(FULL, s)).includes(shows as PoseKey), `${b.main.say} should name ${shows}`);
  }
});

/* Each situation the book says on the way out, with where it's going. */
test('a line the book says on leaving names where it goes', () => {
  const poseOf = (to: string) => BOOK.behaviours[to]!.main.pose as PoseKey;
  for (const b of Object.values(BOOK.behaviours)) {
    if (!Array.isArray(b.then)) continue;
    for (const r of b.then) if (r.say) {
      if (r.say === 'tired') continue; /* depends on the art, and has its own check below */
      const names = artsIn(capOf(FULL, sitOf(r.say as Situation)));
      assert.ok(names.includes(poseOf(r.to!)), `${r.say} should name ${poseOf(r.to!)}`);
      if (r.say === 'full') assert.ok(names.includes(b.main.pose as PoseKey), 'full follows eat');
    }
  }
  const chase = BOOK.behaviours.chase!.then as { when?: string; to: string }[];
  assert.deepStrictEqual(chase.map(r => r.to), ['tired', 'watch_cursor', 'sit']);
  assert.deepStrictEqual(chase.map(r => r.when), ['canTire', 'canWatch', undefined]);
});

test('the events the captions describe are still the book\'s', () => {
  const rules = (o: unknown) => JSON.stringify(o);
  assert.match(rules(BOOK.events.clicked), /"when":"asleep","say":"wake","cue":"startled","to":"idle"/);
  assert.match(rules(BOOK.events.clicked), /"when":"angry","say":"grumpy"/);
  assert.match(rules(BOOK.events.clicked), /"below":0.55,"to":"wave"/);
  assert.match(rules(BOOK.events.petted), /"when":"upset","to":"love","lineOf":"comfort"/);
  assert.deepStrictEqual(BOOK.behaviours.chase!.events!.caught, [{ say: 'caught', to: 'love', arg: { line: '' } }]);
  assert.strictEqual(BOOK.events.hovered, 'shy');
  assert.strictEqual(BOOK.behaviours.air!.events!.grabbedWall, 'wall');
  assert.strictEqual(BOOK.behaviours.air!.events!.grabbedCeiling, 'hang');
  assert.match(rules(BOOK.behaviours.air!.events!.slammed), /"when":"knockedOut","to":"knocked_out".*"to":"dizzy"/);
  assert.strictEqual(BOOK.behaviours.cry!.then, 'sit');
  assert.strictEqual(BOOK.behaviours.sit!.exit!.clip, 'stand_from_sit');
  assert.deepStrictEqual(BOOK.behaviours.sleep!.exit, { clip: 'stand_up_from_sleep', or: 'stand_up' });
  assert.deepStrictEqual(BOOK.behaviours.sleep!.enter, { clip: 'fall_asleep' });
  assert.deepStrictEqual(BOOK.behaviours.sit!.enter, { clip: 'sit_down' });
  assert.deepStrictEqual(BOOK.behaviours.watch_cursor!.enter, { clip: 'sit_down', ifDown: true });
  assert.deepStrictEqual(BOOK.behaviours.dizzy!.exit, { clip: 'stand_up_from_dizzy', or: 'stand_up', ifDown: true });
  assert.deepStrictEqual(BOOK.behaviours.knocked_out!.exit, { clip: 'stand_up_from_knocked_out', or: 'stand_up' });
  assert.strictEqual(BOOK.behaviours.face_away!.exit!.clip, 'turn_back');
  assert.deepStrictEqual(BOOK.behaviours.trip!.exit, { clip: 'stand_up_from_sprawl', or: 'stand_up' });
  assert.strictEqual(BOOK.behaviours.roll!.main.motion, 'roll');
  assert.strictEqual(BOOK.behaviours.spin!.main.pose, 'happy');
  assert.strictEqual(BOOK.behaviours.roll!.main.pose, 'stand');
  assert.match(rules(BOOK.behaviours.spin!.then), /"to":"dizzy"/);
  assert.match(rules(BOOK.behaviours.roll!.then), /"to":"dizzy"/);
  assert.strictEqual(BOOK.actions.held!.say, 'dragme');
});

const source = (f: string) => fs.readFileSync(new URL(`../../engine/src/${f}.ts`, import.meta.url), 'utf8');
const ENGINE = fs.readdirSync(new URL('../../engine/src/', import.meta.url)).filter(f => f.endsWith('.ts')).map(f => f.slice(0, -3));

/* Lines said from code, not the book. A new place or a moved one fails here, so its caption gets checked. */
test('the lines said from code are said where the captions say', () => {
  const sites: Record<string, Set<string>> = {};
  for (const f of ENGINE) for (const m of source(f).matchAll(/\bline\('(\w+)'\)/g)) (sites[m[1]!] ||= new Set()).add(f);
  assert.deepStrictEqual(Object.fromEntries(Object.entries(sites).map(([k, v]) => [k, [...v].sort()])), {
    held: ['motions'], greet: ['sim'], hug: ['sim'], bump: ['sim'], bumped: ['sim'], bye: ['create-pet'],
    drop: ['body', 'hands'], climb: ['body'], grab: ['body'], hurt: ['body']
  });
});

test('calm chatter is the only source of chat, and think can come from it too', () => {
  assert.match(source('create-pet'), /calm && world\.bubbles[\s\S]*random\(\) < \.3 \? 'think' : 'chat'/);
});

test('what the code does around those lines is what the captions say', () => {
  const sim = source('sim');
  assert.match(sim, /a\.go\('wave'\); a\.say\(a\.line\('greet'\)\)/);
  assert.match(sim, /a\.go\('love', \{ line: a\.line\('hug'\) \}\)/);
  assert.match(sim, /a\.say\(a\.line\('bump'\)\); b\.say\(b\.line\('bumped'\)\); a\.go\('walk'/);
  assert.match(source('create-pet'), /farewell\(\) \{ if \(P\.surf === 'floor'\) runner\.go\('wave'\); voice\.say\(voice\.line\('bye'\)\); \}/);
  const motions = source('motions');
  assert.match(motions, /pose: c => c\.P\.thrown && c\.hasArt\('thrown'\) \? 'thrown' : c\.P\.vy < 0 \? 'jump' : 'fall'/);
  assert.match(motions, /pose: c => c\.P\.swing > 10 \? 'dragL' : c\.P\.swing < -10 \? 'dragR' : 'drag'/);
  assert.match(motions, /const STRUGGLE_AFTER = 600;/);
  assert.match(source('conditions'), /clickedOut: c => c\.P\.clicks\.length >= 5/);
  assert.match(source('conditions'), /knockedOut: c => .*c\.hasArt\('knocked_out'\)/);
  assert.match(source('body'), /say\(line\('climb'\)\);\s*emit\('wall'/);
  assert.match(source('look'), /\(key === 'dragL' \|\| key === 'dragR'\) && r\.exact && r\.frames\.length === 2\) fi = Math\.abs\(P\.swing\) > 30 \? 1 : 0/);
});

test('nothing calls the one action that says dragme', () => {
  const held = /\bact\(\s*(\w+\.id\s*,\s*)?'held'\s*\)/;
  for (const f of ENGINE) assert.doesNotMatch(source(f), held, f);
  for (const f of fs.readdirSync(new URL('../../../apps/desktop/src/', import.meta.url)).filter(x => x.endsWith('.ts'))) {
    assert.doesNotMatch(fs.readFileSync(new URL(`../../../apps/desktop/src/${f}`, import.meta.url), 'utf8'), held, f);
  }
});
