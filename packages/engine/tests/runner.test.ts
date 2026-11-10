/* The runner on its own: no physics, no drawing. Scripted draws, so each test shows exactly how
   many random numbers it used. */
import assert from 'node:assert';
import { test } from 'vitest';
import { createRunner, type Actor, type Arg, type Book, type Motion, type Parts, type Place, type Playing } from '../src/runner';

interface Fake extends Actor { log: string[]; at: Place; draws: number[]; used: number }

function rig(book: Partial<Book>, parts: Partial<Parts<Fake>> = {}, draws: number[] = []) {
  const actor: Fake = {
    P: { state: '', t: 0, dur: 0, arg: null, next: null, clip: null } as Playing,
    log: [], at: 'floor', draws, used: 0,
    random() { this.used++; assert.ok(this.draws.length, 'an unexpected draw'); return this.draws.shift()!; },
    place() { return this.at; },
    say(t) { this.log.push('say ' + t); },
    line(k) { return 'line:' + k; },
    canShow: pose => pose !== 'missing',
    hasArt: pose => pose === 'clip',
    down: pose => pose === 'low',
    clipLength: () => 30,
    loop: () => 0,
    duration: name => ({ short: 5, range: [10, 20], long: 100 } as Record<string, number | [number, number]>)[name]!,
    weight: name => ({ a: 1, b: 3, off: 0 } as Record<string, number>)[name] ?? 0
  };
  const full: Book = { behaviours: {}, picks: {}, aliases: {}, direct: {}, actions: {}, events: {}, ...book };
  const all: Parts<Fake> = { motions: {}, cues: {}, moves: {}, conditions: {}, ...parts };
  return { actor, P: actor.P, r: createRunner(full, all, actor) };
}
const still = (pose = 'stand') => ({ pose });

test('entering runs the motion, then the hold, then the line, then the cue', () => {
  const order: string[] = [];
  const motion: Motion<Fake> = { start() { order.push('motion'); } };
  const { r, P, actor } = rig({ behaviours: { a: { on: ['floor'], main: { pose: 'x', motion: 'm', hold: 'range', say: 'hi', cue: 'c' } } } },
    { motions: { m: motion }, cues: { c: a => { order.push('cue ' + a.log.join()); } } }, [.5]);
  r.go('a');
  assert.strictEqual(P.state, 'a'); assert.strictEqual(P.t, 0); assert.strictEqual(P.dur, 15);
  assert.deepStrictEqual(order, ['motion', 'cue say line:hi']);
  assert.strictEqual(actor.used, 1);
});

test('a line can be left to chance, and an argument\'s own line wins with no draw', () => {
  const b = { a: { on: ['floor'] as Place[], main: { pose: 'x', say: 'hi', odds: .5 } } };
  const one = rig({ behaviours: b }, {}, [.2]); one.r.go('a'); assert.deepStrictEqual(one.actor.log, ['say line:hi']);
  const two = rig({ behaviours: b }, {}, [.9]); two.r.go('a'); assert.deepStrictEqual(two.actor.log, []);
  const own = rig({ behaviours: b }); own.r.go('a', { line: 'mine' }); assert.deepStrictEqual(own.actor.log, ['say mine']);
  const hush = rig({ behaviours: b }); hush.r.go('a', { line: '' }); assert.deepStrictEqual(hush.actor.log, ['say ']);
});

test('a hold: the pace table, an alternative, or the argument\'s duration', () => {
  const b = { a: { on: ['floor'] as Place[], main: { pose: 'x', hold: 'long', alt: { short: 'short' } } } };
  const { r, P } = rig({ behaviours: b });
  r.go('a'); assert.strictEqual(P.dur, 100);
  r.go('a', { short: true }); assert.strictEqual(P.dur, 5);
  r.go('a', { dur: 42 }); assert.strictEqual(P.dur, 42);
});

test('a tick: motion, then the per-tick cue, then the chance, then the timer', () => {
  const order: string[] = [];
  const { r, P } = rig({
    behaviours: {
      a: { on: ['floor'], main: { pose: 'x', motion: 'm', each: 'e', chance: { odds: .5, to: 'b' }, hold: 'short' }, then: 'c' },
      b: { on: ['floor'], main: still() }, c: { on: ['floor'], main: still() }
    }
  }, { motions: { m: { tick() { order.push('motion'); } } }, cues: { e: () => { order.push('each'); } } }, [.9, .9, .1]);
  r.go('a');
  P.t = 1; r.tick(1); assert.strictEqual(P.state, 'a');
  P.t = 6; r.tick(1); assert.strictEqual(P.state, 'c', 'the timer');
  assert.deepStrictEqual(order, ['motion', 'each', 'motion', 'each']);
  r.go('a'); P.t = 6; r.tick(1); assert.strictEqual(P.state, 'b', 'the chance comes before the timer');
});

test('a chance scales with the tick', () => {
  const { r, P } = rig({ behaviours: { a: { on: ['floor'], main: { pose: 'x', chance: { odds: .1, to: 'b' } } }, b: { on: ['floor'], main: still() } } }, {}, [.15]);
  r.go('a'); r.tick(2);
  assert.strictEqual(P.state, 'b');
});

test('a motion that moves on ends the tick', () => {
  const each: number[] = [];
  const { r, P } = rig({
    behaviours: { a: { on: ['floor'], main: { pose: 'x', motion: 'm', each: 'e', hold: 'short' }, then: 'c' }, b: { on: ['floor'], main: still() }, c: { on: ['floor'], main: still() } }
  }, { motions: { m: { tick() { r2().go('b'); } } }, cues: { e: () => { each.push(1); } } });
  let held = r; const r2 = () => held;
  r.go('a'); P.t = 99; r.tick(1);
  assert.strictEqual(P.state, 'b'); assert.deepStrictEqual(each, []);
});

test('a step with no hold has no timer', () => {
  const { r, P } = rig({ behaviours: { a: { on: ['air'], main: still(), then: 'b' }, b: { on: ['floor'], main: still() } } });
  r.go('a'); P.t = 1e6; r.tick(1);
  assert.strictEqual(P.state, 'a');
});

test('rules: first that passes, one shared draw, none unless asked for', () => {
  const b = { x: { on: ['floor'] as Place[], main: still() }, y: { on: ['floor'] as Place[], main: still() }, z: { on: ['floor'] as Place[], main: still() } };
  const rules = [{ below: .12, to: 'x' }, { below: .6, to: 'y' }, { to: 'z' }];
  for (const [draw, want] of [[.1, 'x'], [.3, 'y'], [.9, 'z']] as [number, string][]) {
    const { r, P, actor } = rig({ behaviours: b }, {}, [draw]); r.follow(rules);
    assert.strictEqual(P.state, want); assert.strictEqual(actor.used, 1);
  }
  const none = rig({ behaviours: b }, { conditions: { no: () => false } });
  none.r.follow([{ when: 'no', below: .5, to: 'x' }, { to: 'y' }]);
  assert.strictEqual(none.P.state, 'y'); assert.strictEqual(none.actor.used, 0, 'a rule that fails its condition draws nothing');
});

test('rules: says, cues and goes, in that order, and a rule can do nothing at all', () => {
  const seen: string[] = [];
  const { r, P, actor } = rig({ behaviours: { x: { on: ['floor'], main: still() } } }, { cues: { c: a => { seen.push(a.log.join()); } } });
  r.follow([{ say: 'bye', cue: 'c', to: 'x' }]);
  assert.deepStrictEqual(seen, ['say line:bye']); assert.strictEqual(P.state, 'x');
  actor.log.length = 0; P.state = 'keep';
  r.follow([{ }, { to: 'x' }]);
  assert.strictEqual(P.state, 'keep');
});

test('rules can enter with an argument, a coin toss, a pace duration or a line', () => {
  let got: Arg | undefined;
  const b = { x: { on: ['floor'] as Place[], main: { pose: 'x', motion: 'm' } } };
  const parts = { motions: { m: { start(_: Fake, a: Arg | undefined) { got = a; } } } };
  rig({ behaviours: b }, parts).r.follow([{ to: 'x', arg: { hurt: true } }]); assert.deepStrictEqual(got, { hurt: true });
  rig({ behaviours: b }, parts, [.2]).r.follow([{ to: 'x', dir: 'either' }]); assert.deepStrictEqual(got, { dir: -1 });
  rig({ behaviours: b }, parts, [.8]).r.follow([{ to: 'x', dir: 'either' }]); assert.deepStrictEqual(got, { dir: 1 });
  rig({ behaviours: b }, parts).r.follow([{ to: 'x', dur: 'short' }]); assert.deepStrictEqual(got, { dur: 5 });
  rig({ behaviours: b }, parts).r.follow([{ to: 'x', lineOf: 'hey' }]); assert.deepStrictEqual(got, { line: 'line:hey' });
});

test('a rule can end in a move as well as a behaviour', () => {
  let moved = 0;
  rig({}, { moves: { leap: () => { moved++; } } }).r.follow([{ to: 'leap' }]);
  assert.strictEqual(moved, 1);
});

const PICKS: Partial<Book> = {
  behaviours: { a: { on: ['floor'], main: still() }, b: { on: ['floor'], main: still() }, idle: { on: ['floor'], main: still() }, w: { on: ['wall'], main: still() } },
  picks: { floor: [{ to: 'a' }, { to: 'b' }, { to: 'a', weight: 'off' }] }
};

test('a pick is weighted, in table order, with one draw', () => {
  for (const [draw, want] of [[.2, 'a'], [.25, 'a'], [.26, 'b'], [.99, 'b']] as [number, string][]) {
    const { r, P, actor } = rig(PICKS, {}, [draw]); r.pick('floor');
    assert.strictEqual(P.state, want, String(draw)); assert.strictEqual(actor.used, 1);
  }
});

test('a pick leaves out what its condition rules out, drawing nothing for it', () => {
  const { r, P } = rig({ ...PICKS, picks: { floor: [{ to: 'a', when: 'no' }, { to: 'b' }] } }, { conditions: { no: () => false } }, [0]);
  r.pick('floor');
  assert.strictEqual(P.state, 'b');
});

test('`then: pick` uses the table of the behaviour\'s own surface, wherever she is', () => {
  const { r, P, actor } = rig({ ...PICKS, behaviours: { ...PICKS.behaviours, s: { on: ['floor'], main: { pose: 'x', hold: 'short' }, then: 'pick' } } }, { moves: { dropDown: () => {} } }, [.1]);
  actor.at = 'wall'; r.go('s'); P.t = 9; r.tick(1);
  assert.strictEqual(P.next, 'a', 'not allowed here, so queued');
});

test('act: a behaviour, where it is allowed', () => {
  const { r, P } = rig(PICKS); r.act('a');
  assert.strictEqual(P.state, 'a');
});

test('act: somewhere else, it queues and comes down', () => {
  let dropped = 0;
  const up = rig(PICKS, { moves: { dropDown: () => { dropped++; } } });
  up.actor.at = 'wall'; up.P.state = 'w'; up.r.act('a');
  assert.strictEqual(up.P.next, 'a'); assert.strictEqual(dropped, 1); assert.strictEqual(up.P.state, 'w');
  const air = rig(PICKS, { moves: { dropDown: () => { dropped++; } } });
  air.actor.at = 'air'; air.r.act('a');
  assert.strictEqual(air.P.next, 'a'); assert.strictEqual(dropped, 1, 'already coming down');
});

test('a direct name waits for the floor in the air, and goes ahead for what belongs there', () => {
  const { r, P, actor } = rig({ behaviours: { a: { on: ['floor'], main: still() }, up: { on: ['air'], main: still() } }, direct: { now: 'a', lift: 'up' } });
  P.state = 'up'; actor.at = 'air'; r.act('now');
  assert.strictEqual(P.state, 'up'); assert.strictEqual(P.next, 'now');
  P.state = 'a'; r.act('lift');
  assert.strictEqual(P.state, 'up');
});

test('act: aliases, direct names, actions and nonsense', () => {
  let moved = 0;
  const { r, P, actor } = rig({ ...PICKS, aliases: { other: 'a', twice: 'other' }, direct: { now: 'a' }, actions: { hop: { on: ['floor'], move: 'hop' }, speak: { say: 'hi' } } }, { moves: { hop: () => { moved++; } } });
  r.act('twice'); assert.strictEqual(P.state, 'a');
  P.state = 'b'; actor.at = 'wall'; r.act('now'); assert.strictEqual(P.state, 'a', 'direct ignores where she is');
  actor.at = 'floor'; r.act('hop'); assert.strictEqual(moved, 1);
  r.act('speak'); assert.deepStrictEqual(actor.log, ['say line:hi']);
  P.state = 'b'; r.act('nonsense'); r.act('constructor'); assert.strictEqual(P.state, 'b');
});

test('act does nothing while she is held', () => {
  const { r, P } = rig(PICKS);
  P.state = 'held'; r.act('a');
  assert.strictEqual(P.state, 'held');
});

test('a behaviour without its art is never done: not picked, not acted, not queued', () => {
  const book: Partial<Book> = {
    behaviours: { a: { on: ['floor'], main: still() }, b: { on: ['floor'], main: still('missing') } },
    picks: { floor: [{ to: 'b' }, { to: 'a' }] }
  };
  const picked = rig(book, {}, [.1]); picked.r.pick('floor');
  assert.strictEqual(picked.P.state, 'a', 'all the weight goes to what is left');
  const asked = rig(book); asked.P.state = 'a'; asked.r.act('b');
  assert.strictEqual(asked.P.state, 'a');
  const up = rig(book); up.actor.at = 'wall'; up.r.act('b');
  assert.strictEqual(up.P.next, null, 'no coming down for it');
});

const CLIP: Partial<Book> = {
  behaviours: {
    a: { on: ['floor'], main: { pose: 'x', hold: 'short' }, exit: { clip: 'clip' }, then: 'b' },
    gone: { on: ['floor'], main: { pose: 'x', hold: 'short' }, exit: { clip: 'absent' }, then: 'b' },
    b: { on: ['floor'], main: still('y') }
  },
  events: { grabbed: 'b' }
};

test('an exit clip plays once on a normal ending, then the behaviour moves on', () => {
  const { r, P } = rig(CLIP);
  r.go('a'); P.t = 9; r.tick(1);
  assert.strictEqual(P.state, 'a', 'still here, in the clip');
  assert.strictEqual(r.pose(), 'clip'); assert.strictEqual(r.once(), true); assert.strictEqual(r.anim(), undefined);
  assert.strictEqual(P.t, 0); assert.strictEqual(P.dur, 30);
  P.t = 20; r.tick(1); assert.strictEqual(P.state, 'a');
  P.t = 31; r.tick(1); assert.strictEqual(P.state, 'b'); assert.strictEqual(P.clip, null);
});

test('an exit clip that asks if she is down plays only when the pose says so', () => {
  const book = (pose: string): Partial<Book> => ({ behaviours: { a: { on: ['floor'], main: { pose, hold: 'short' }, exit: { clip: 'clip', ifDown: true }, then: 'b' }, b: { on: ['floor'], main: still('y') } } });
  const low = rig(book('low')), tall = rig(book('x'));
  low.r.go('a'); low.P.t = 9; low.r.tick(1);
  assert.strictEqual(low.P.clip!.pose, 'clip');
  tall.r.go('a'); tall.P.t = 9; tall.r.tick(1);
  assert.deepStrictEqual([tall.P.state, tall.P.clip], ['b', null]);
});

test('art that isn\'t there is skipped', () => {
  const { r, P } = rig(CLIP);
  r.go('gone'); P.t = 9; r.tick(1);
  assert.strictEqual(P.state, 'b');
});

test('events beat clips', () => {
  const { r, P } = rig(CLIP);
  r.go('a'); P.t = 9; r.tick(1); assert.ok(P.clip);
  r.emit('grabbed');
  assert.strictEqual(P.clip, null); assert.strictEqual(P.state, 'b'); assert.strictEqual(r.pose(), 'y');
});

test('a clip stops the motion and the per-tick cue', () => {
  let ticks = 0;
  const { r, P } = rig({ behaviours: { a: { on: ['floor'], main: { pose: 'x', motion: 'm', each: 'e', hold: 'short' }, exit: { clip: 'clip' }, then: 'a' } } },
    { motions: { m: { tick() { ticks++; } } }, cues: { e: () => { ticks++; } } });
  r.go('a'); P.t = 9; r.tick(1);
  const before = ticks; r.tick(1); r.tick(1);
  assert.strictEqual(ticks, before);
});

test('an action can be a clip, on its own, if the art is there', () => {
  const book = { behaviours: { idle: { on: ['floor'] as Place[], main: still() } }, actions: { try: { on: ['floor'] as Place[], clip: 'clip' }, none: { on: ['floor'] as Place[], clip: 'absent' } } };
  const { r, P } = rig(book); r.go('idle');
  r.act('none'); assert.strictEqual(P.clip, null);
  r.act('try'); assert.strictEqual(r.pose(), 'clip');
  P.t = 31; r.tick(1); assert.strictEqual(r.pose(), 'stand');
});

test('a clip whose art goes away ends at once, with no timer left running', () => {
  const { r, P, actor } = rig(CLIP);
  r.go('a'); P.t = 9; r.tick(1); assert.ok(P.clip);
  actor.hasArt = () => false;
  P.t = 1; r.tick(1);
  assert.strictEqual(P.state, 'b'); assert.strictEqual(P.clip, null);
});

test('a play-once step whose art goes away ends at once', () => {
  const { r, P, actor } = rig({ behaviours: { a: { on: ['floor'], main: { pose: 'clip', once: true }, then: 'b' }, b: { on: ['floor'], main: still() } } });
  r.go('a'); actor.hasArt = () => false;
  P.t = 1; r.tick(1);
  assert.strictEqual(P.state, 'b');
});

test('a clip whose art changes takes on its new length', () => {
  const { r, P, actor } = rig(CLIP);
  r.go('a'); P.t = 9; r.tick(1);
  actor.clipLength = () => 5;
  P.t = 6; r.tick(1);
  assert.strictEqual(P.state, 'b');
});

test('a clip action without its art is skipped, without coming down for it', () => {
  let dropped = 0;
  const { r, P, actor } = rig({ behaviours: { a: { on: ['wall'], main: still() } }, actions: { none: { on: ['floor'], clip: 'absent' } } }, { moves: { dropDown: () => { dropped++; } } });
  actor.at = 'wall'; r.go('a'); r.act('none');
  assert.strictEqual(dropped, 0); assert.strictEqual(P.next, null); assert.strictEqual(P.state, 'a');
});

test('a step can itself play once, then move on', () => {
  const { r, P } = rig({ behaviours: { a: { on: ['floor'], main: { pose: 'clip', once: true }, then: 'b' }, b: { on: ['floor'], main: still() } } });
  r.go('a');
  assert.strictEqual(P.dur, 30); assert.strictEqual(r.once(), true);
  P.t = 31; r.tick(1); assert.strictEqual(P.state, 'b'); assert.strictEqual(r.once(), false);
});

test('then: queued plays what was asked for, or goes to idle', () => {
  const book = { ...PICKS, behaviours: { ...PICKS.behaviours, l: { on: ['floor'] as Place[], main: { pose: 'x', hold: 'short' }, then: 'queued' } } };
  const one = rig(book); one.r.go('l'); one.P.next = 'a'; one.P.t = 9; one.r.tick(1);
  assert.strictEqual(one.P.state, 'a'); assert.strictEqual(one.P.next, null);
  const two = rig(book); two.r.go('l'); two.P.t = 9; two.r.tick(1);
  assert.strictEqual(two.P.state, 'idle');
});

test('events: the behaviour first, then the book, then nothing', () => {
  const { r, P } = rig({
    behaviours: { a: { on: ['floor'], main: still(), events: { hit: 'b' } }, b: { on: ['floor'], main: still() }, c: { on: ['floor'], main: still() } },
    events: { hit: 'c', grabbed: 'c' }
  });
  r.go('a'); r.emit('hit'); assert.strictEqual(P.state, 'b');
  r.emit('hit'); assert.strictEqual(P.state, 'c');
  r.emit('unknown'); assert.strictEqual(P.state, 'c');
});

test('events carry an argument, or run rules', () => {
  let got: Arg | undefined;
  const { r, P, actor } = rig({
    behaviours: { a: { on: ['floor'], main: still(), events: { hit: 'b', said: [{ say: 'ow', to: 'b' }] } }, b: { on: ['floor'], main: { pose: 'x', motion: 'm' } } }
  }, { motions: { m: { start(_, a) { got = a; } } } });
  r.go('a'); r.emit('hit', { big: true }); assert.deepStrictEqual(got, { big: true });
  r.go('a'); r.emit('said'); assert.strictEqual(P.state, 'b'); assert.deepStrictEqual(actor.log, ['say line:ow']);
});

test('the pose: the step\'s, unless its motion says otherwise', () => {
  const { r } = rig({ behaviours: { a: { on: ['air'], main: { pose: 'x', motion: 'm' } }, b: { on: ['air'], main: still('y') } } }, { motions: { m: { pose: () => 'z' } } });
  r.go('a'); assert.strictEqual(r.pose(), 'z');
  r.go('b'); assert.strictEqual(r.pose(), 'y');
});

test('calm comes from the behaviour', () => {
  const { r } = rig({ behaviours: { a: { on: ['floor'], main: still(), calm: true }, b: { on: ['floor'], main: still() } } });
  r.go('a'); assert.strictEqual(r.calm(), true);
  r.go('b'); assert.strictEqual(r.calm(), false);
});

/* Entry clips, a clip that stands in for another, and a timed step that finishes its pass. */
const ENTER: Partial<Book> = {
  behaviours: {
    up: { on: ['floor'], main: still('x') },
    low: { on: ['floor'], main: still('low') },
    a: { on: ['floor'], main: { pose: 'y', hold: 'short', say: 'hi', cue: 'c' }, enter: { clip: 'clip' }, then: 'up' },
    b: { on: ['floor'], main: { pose: 'x', hold: 'short' }, enter: { clip: 'clip', ifDown: true }, then: 'up' },
    c: { on: ['floor'], main: { pose: 'low', hold: 'short' }, enter: { clip: 'clip', ifDown: true }, then: 'up' },
    gone: { on: ['floor'], main: { pose: 'y', hold: 'short' }, enter: { clip: 'absent' }, then: 'up' },
    sat: { on: ['floor'], main: { pose: 'low', hold: 'short' }, exit: { clip: 'clip' }, then: 'a' }
  },
  events: { grabbed: 'up' }
};
const QUIET: Partial<Parts<Fake>> = { cues: { c: () => {} } };

test('an entry clip plays first from standing: the line on the way in, the hold and cue after', () => {
  const cued: number[] = [];
  const { r, P, actor } = rig(ENTER, { cues: { c: () => { cued.push(1); } } });
  r.go('up'); r.go('a');
  assert.deepStrictEqual([P.state, r.pose(), r.once(), P.dur], ['a', 'clip', true, 30]);
  assert.deepStrictEqual(actor.log, ['say line:hi']); assert.deepStrictEqual(cued, []);
  P.t = 31; r.tick(1);
  assert.deepStrictEqual([P.state, P.clip, r.pose(), P.t, P.dur], ['a', null, 'y', 0, 5]);
  assert.deepStrictEqual(actor.log, ['say line:hi'], 'said once'); assert.deepStrictEqual(cued, [1]);
});

test('an entry clip is skipped when she was already down, or has no art for it', () => {
  const low = rig(ENTER, QUIET); low.r.go('low'); low.r.go('a');
  assert.strictEqual(low.P.clip, null);
  const none = rig(ENTER, QUIET); none.r.go('up'); none.r.go('gone');
  assert.strictEqual(none.P.clip, null);
});

test('without an entry clip, entering draws and says in the order it always has', () => {
  const { r, actor } = rig({ behaviours: { a: { on: ['floor'], main: { pose: 'y', hold: 'range', say: 'hi', odds: .5 } } } }, {}, [.5, .1]);
  r.go('a');
  assert.deepStrictEqual(actor.log, ['say line:hi']); assert.strictEqual(actor.used, 2);
});

test('an entry clip that asks if she is down plays only into a low pose', () => {
  const tall = rig(ENTER, QUIET); tall.r.go('up'); tall.r.go('b');
  assert.strictEqual(tall.P.clip, null);
  const low = rig(ENTER, QUIET); low.r.go('up'); low.r.go('c');
  assert.strictEqual(low.P.clip!.pose, 'clip');
});

test('coming from a clip, it is the clip she was showing that counts', () => {
  const { r, P } = rig(ENTER, QUIET);
  r.go('sat'); P.t = 9; r.tick(1);
  assert.strictEqual(P.clip!.pose, 'clip', 'getting up');
  P.t = 31; r.tick(1);
  assert.deepStrictEqual([P.state, P.clip?.pose], ['a', 'clip'], 'she got up, so she sits down again');
});

test('events and requests cut an entry clip, as any clip', () => {
  const { r, P } = rig(ENTER, QUIET);
  r.go('up'); r.go('a'); r.emit('grabbed');
  assert.deepStrictEqual([P.state, P.clip], ['up', null]);
  r.go('a'); r.act('low');
  assert.deepStrictEqual([P.state, P.clip], ['low', null]);
});

test('an exit can name a clip to play when its own has no art', () => {
  const book = (clip: string, or: string): Partial<Book> => ({ behaviours: { a: { on: ['floor'], main: { pose: 'x', hold: 'short' }, exit: { clip, or }, then: 'b' }, b: { on: ['floor'], main: still('y') } } });
  const own = rig(book('clip', 'absent')); own.r.go('a'); own.P.t = 9; own.r.tick(1);
  assert.strictEqual(own.P.clip!.pose, 'clip');
  const other = rig(book('absent', 'clip')); other.r.go('a'); other.P.t = 9; other.r.tick(1);
  assert.strictEqual(other.P.clip!.pose, 'clip');
  const neither = rig(book('absent', 'nor')); neither.r.go('a'); neither.P.t = 9; neither.r.tick(1);
  assert.deepStrictEqual([neither.P.state, neither.P.clip], ['b', null]);
});

/* A pass of 30 frames, for a pose with frames of her own. */
const LOOPS: Partial<Book> = {
  behaviours: {
    a: { on: ['floor'], main: { pose: 'loops', hold: 'long' }, then: 'b' },
    m: { on: ['floor'], main: { pose: 'loops', motion: 'stop', hold: 'long' }, then: 'b' },
    o: { on: ['floor'], main: { pose: 'clip', once: true }, then: 'b' },
    b: { on: ['floor'], main: still('y') }
  }
};
const looping = (parts: Partial<Parts<Fake>> = {}) => { const x = rig(LOOPS, parts); x.actor.loop = pose => pose === 'loops' ? 30 : 0; return x; };

test('time up mid-pass, a timed step waits for the pass to end', () => {
  const { r, P } = looping();
  r.go('a'); P.dur = 100;
  P.t = 101; r.tick(1); assert.strictEqual(P.state, 'a', 'in the fourth pass');
  P.t = 119; r.tick(1); assert.strictEqual(P.state, 'a');
  P.t = 120; r.tick(1); assert.strictEqual(P.state, 'b', 'the pass is over');
});

test('time up on a pass\'s end, it ends at once; a pose with one frame never waits', () => {
  const one = looping(); one.r.go('a'); one.P.dur = 90; one.P.t = 91; one.r.tick(1);
  assert.strictEqual(one.P.state, 'b');
  const flat = rig(LOOPS); flat.r.go('a'); flat.P.t = 101; flat.r.tick(1);
  assert.strictEqual(flat.P.state, 'b');
});

test('a motion that stops the step cuts it at once, pass or no pass', () => {
  const { r, P } = looping({ motions: { stop: { tick(c) { if (c.P.t > 50) c.P.dur = 0; } } } });
  r.go('m'); P.t = 51; r.tick(1);
  assert.strictEqual(P.state, 'b');
});

test('she waits three seconds at most: a pass that ends later is cut on time, as before', () => {
  const long = (pass: number) => { const x = rig(LOOPS); x.actor.loop = () => pass; return x; };
  const far = long(300); far.r.go('a'); far.P.dur = 100; far.P.t = 101; far.r.tick(1);
  assert.strictEqual(far.P.state, 'b', 'the pass ends 200 frames on');
  const near = long(300); near.r.go('a'); near.P.dur = 130; near.P.t = 131; near.r.tick(1);
  assert.strictEqual(near.P.state, 'a', 'the pass ends 170 frames on');
  near.P.t = 300; near.r.tick(1); assert.strictEqual(near.P.state, 'b');
  const edge = long(300); edge.r.go('a'); edge.P.dur = 120; edge.P.t = 121; edge.r.tick(1);
  assert.strictEqual(edge.P.state, 'a', 'exactly 180 frames on still waits');
});

test('play-once steps are left as they were', () => {
  const { r, P } = looping();
  r.go('o'); P.t = 31; r.tick(1);
  assert.strictEqual(P.state, 'b');
});
