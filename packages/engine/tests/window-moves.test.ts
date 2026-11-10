/* Getting onto and around windows on her own: homing jumps, walks to a jump, leaps off an edge. */
import assert from 'node:assert';
import { test } from 'vitest';
import type { Rectangle } from '@buddies/terrain';
import { BOOK, lively, type Pace, type Pet } from '../src/index';
import { BUDDY, mulberry32, screen, windowRect, world, type TestWorld } from './support';

const SCREEN = () => screen('s', 0, 0, 1600, 900);
const FLOOR = 900;
/* A pace with nothing to pick but what's named. */
function only(weights: Record<string, number>, more: Partial<Pace> = {}): Pace {
  return { ...lively, ...more, weights: { ...Object.fromEntries(Object.keys(lively.weights).map(k => [k, 0])), ...weights } };
}
const JUST_HOP = (hopSide = 0) => only({ hop: 1, hopSide });
const JUST_WALK = (more: Partial<Pace> = {}) => only({ hopWalk: 1 }, more);

/* Drops a buddy a little above a surface at x, and waits for her to stand there. */
function placed(w: TestWorld, x: number, y = FLOOR, pet = w.add(BUDDY())) {
  pet.go('sit'); pet.P.dur = 1e9; pet.P.chatT = 1e9;
  pet.go('air'); Object.assign(pet.P, { x, y: y - 2, vx: 0, vy: 0, thrown: false, hard: false, bound: null, on: null });
  assert.ok(w.until(() => pet.P.on && pet.P.state !== 'land', 200), 'stood');
  hold(pet);
  return pet;
}
const hold = (pet: Pet) => { pet.go('sit'); pet.P.dur = 1e9; pet.P.chatT = 1e9; };
/* Lets her pick now. */
const pickNow = (w: TestWorld, pet: Pet) => { pet.P.dur = 0; w.frame(); w.frame(); };
const standing = (pet: Pet) => pet.P.on !== null && pet.P.state !== 'air';
const on = (pet: Pet) => pet.P.on ? `${pet.P.on.surface.owner}:${pet.P.on.surface.kind}` : 'air';
const tick = (w: TestWorld, ms: number) => { w.now.t += ms - 16.667; w.frame(); };
/* Waits for her to stop being in the air, at a given tick length. */
function flies(w: TestWorld, pet: Pet, ms = 16.667) { for (let i = 0; i < 400 && pet.P.state === 'air'; i++) tick(w, ms); assert.notStrictEqual(pet.P.state, 'air', 'came down'); }

for (const [name, rects, x, y, owner] of <[string, Rectangle[], number, number, string][]>[
  ['from the floor, up to a top', [SCREEN(), windowRect('w', 800, 500, 400, 100)], 500, FLOOR, 'w'],
  ['from the floor, the other way', [SCREEN(), windowRect('w', 300, 500, 400, 100)], 1200, FLOOR, 'w'],
  ['from one window up to another', [SCREEN(), windowRect('a', 100, 700, 400, 100), windowRect('w', 800, 400, 400, 100)], 300, 700, 'w'],
  ['from a window down to a lower one', [SCREEN(), windowRect('a', 100, 300, 400, 100), windowRect('w', 800, 700, 400, 100)], 300, 300, 'w']
]) {
  test(`a homing jump lands where she worked out: ${name}`, () => {
    const w = world(rects, { pace: JUST_HOP() }), pet = placed(w, x, y);
    pickNow(w, pet);
    const aim = pet.P.aim!;
    assert.ok(aim, 'jumped'); assert.strictEqual(pet.P.state, 'air'); assert.strictEqual(aim.owner, owner); assert.strictEqual(pet.P.dir, Math.sign(aim.x - x));
    flies(w, pet);
    assert.strictEqual(on(pet), `${owner}:floor`);
    assert.ok(Math.abs(pet.P.x - aim.x) < .5, `${pet.P.x} against ${aim.x}`); assert.strictEqual(pet.P.y, aim.y);
    assert.strictEqual(pet.P.aim, null, 'and the aim is done with');
  });
}

for (const ms of [8, 16.667, 33.333, 50]) {
  test(`a homing jump gets there at a ${ms} ms tick`, () => {
    const w = world([SCREEN(), windowRect('w', 800, 500, 300, 100)], { pace: JUST_HOP() }), pet = placed(w, 300);
    pickNow(w, pet);
    flies(w, pet, ms);
    assert.strictEqual(on(pet), 'w:floor');
  });
}

/* Ticks of these lengths, over and over. */
const JITTERS: [string, number[]][] = [
  ['30 Hz', [33.333]], ['20 Hz', [50]], ['a 16 ms timer', [16]], ['an 18 ms timer', [18]],
  ['a timer that jitters', [16, 17, 15, 18, 16, 14, 19]], ['a timer under load', [16, 33, 16, 50, 17, 41, 16, 16, 66]]
];
const flyWith = (w: TestWorld, pet: Pet, ticks: number[]) => { for (let i = 0; i < 2000 && pet.P.state === 'air'; i++) tick(w, ticks[i % ticks.length]!); assert.notStrictEqual(pet.P.state, 'air', 'came down'); };

for (const [name, ticks] of JITTERS) {
  test(`a marginal arc lands as planned on ${name}`, () => {
    const w = world([SCREEN(), windowRect('w', 950, 240, 150, 350)], { pace: JUST_HOP() }), pet = placed(w, 750);
    pickNow(w, pet);
    const aim = pet.P.aim!;
    assert.strictEqual(aim.way, 'top');
    flyWith(w, pet, ticks);
    assert.strictEqual(on(pet), 'w:floor'); assert.ok(Math.abs(pet.P.x - aim.x) < .5, `${pet.P.x} against ${aim.x}`);
  });

  test(`a side hop grabs where planned on ${name}`, () => {
    const w = world([SCREEN(), windowRect('w', 800, 300, 300, 450)], { pace: JUST_HOP(1) }), pet = placed(w, 400);
    pickNow(w, pet);
    flyWith(w, pet, ticks);
    assert.strictEqual(pet.P.state, 'wall'); assert.strictEqual(on(pet), 'w:wall');
  });
}

test('an aimed flight takes the same path however the ticks fall', () => {
  const path = (ticks: number[]) => {
    const w = world([SCREEN(), windowRect('w', 800, 400, 400, 100)], { pace: JUST_HOP() }), pet = placed(w, 300);
    pickNow(w, pet);
    const seen = new Set<string>();
    for (let i = 0; i < 2000 && pet.P.state === 'air'; i++) { tick(w, ticks[i % ticks.length]!); seen.add(`${pet.P.x.toFixed(6)},${pet.P.y.toFixed(6)}`); }
    return seen;
  };
  const even = path([16.667]), rough = path([33.334, 50.001, 16.667]);
  assert.ok(rough.size > 5); for (const p of rough) assert.ok(even.has(p), `${p} is off the path`);
});

test('a fall with no aim still takes the tick as it comes', () => {
  const w = world([SCREEN()]), pet = placed(w, 500);
  pet.go('air'); Object.assign(pet.P, { on: null, x: 500, y: 300, vx: 2, vy: 1 });
  tick(w, 50.001);
  assert.ok(Math.abs(pet.P.vy - (1 + .6 * 3)) < .01, `one long step: ${pet.P.vy}`);
  assert.ok(Math.abs(pet.P.x - 506) < .01);
});

test('a flight stops at the frame she lands, whatever is left of the tick', () => {
  /* a frame after the grab would have her falling off the spot she just took */
  for (const lead of [0, 1, 2]) {
    const w = world([SCREEN(), windowRect('w', 800, 300, 300, 450)], { pace: JUST_HOP(1) }), pet = placed(w, 400);
    pickNow(w, pet);
    for (let i = 0; i < lead; i++) tick(w, 16.667);
    flyWith(w, pet, [50.001]);
    const { surface, t } = pet.P.on!;
    assert.strictEqual(pet.P.y, w.terrain.pointOn(surface, t).y, `lead ${lead}`);
    assert.strictEqual(pet.P.vy, 0);
  }
});

test('a flight owes nothing to the one before it', () => {
  const w = world([SCREEN(), windowRect('w', 800, 500, 400, 100)], { pace: JUST_HOP() }), pet = placed(w, 300);
  const ticksToLand = () => { pickNow(w, pet); let n = 0; while (pet.P.state === 'air' && n < 400) { tick(w, 25); n++; } return n; };
  /* each flight starts as the first did, with whatever the last left over */
  const first = ticksToLand();
  for (let i = 0; i < 4; i++) { hold(pet); placed(w, 300, FLOOR, pet); assert.strictEqual(ticksToLand(), first, `flight ${i + 2}`); }
});

test('a homing jump works at a scaled screen, with the speeds scaled', () => {
  const at = (scale: number) => { const w = world([screen('s', 0, 0, 1600, 900, scale), windowRect('w', 800, 500, 400, 100)], { pace: JUST_HOP() }), pet = placed(w, 500); pickNow(w, pet); const a = pet.P.aim!; flies(w, pet); return { a, where: on(pet), pet }; };
  const one = at(1), big = at(1.5);
  assert.strictEqual(one.where, 'w:floor'); assert.strictEqual(big.where, 'w:floor');
  assert.ok(Math.abs(big.a.vy) > Math.abs(one.a.vy), 'gravity is scaled, so she pushes harder');
});

test('she takes off as a jump: not thrown, not hard, and lands without being hurt', () => {
  const w = world([SCREEN(), windowRect('w', 800, 300, 400, 100)], { pace: JUST_HOP() }), pet = placed(w, 500);
  pickNow(w, pet);
  assert.strictEqual(pet.P.thrown, false); assert.strictEqual(pet.P.hard, false);
  flies(w, pet);
  assert.strictEqual(pet.P.state, 'land');
});

test('going for a side: she grabs on, then climbs to the top', () => {
  const pace = only({ hop: 1, hopSide: 1, climbUp: 1 }, { wall: [1, 2], climb: [400, 500] });
  const w = world([SCREEN(), windowRect('w', 800, 300, 300, 450)], { pace }), pet = placed(w, 400);
  pickNow(w, pet);
  const aim = pet.P.aim!;
  assert.strictEqual(aim.way, 'side');
  flies(w, pet);
  assert.strictEqual(pet.P.state, 'wall'); assert.strictEqual(on(pet), 'w:wall'); assert.strictEqual(pet.P.x, 800);
  assert.strictEqual(pet.P.aim, null);
  /* round the corner is random: she keeps climbing till she takes it */
  assert.ok(w.until(() => on(pet) === 'w:floor', 6000), 'over the top');
});

test('a side hop never leaves her gripping something she can\'t hold: she meets it early, under a window in front', () => {
  const rects = [SCREEN(), windowRect('w', 800, 300, 300, 500, 1), windowRect('front', 790, 450, 200, 90, 2, { cut: ['left', 'right'] })];
  const w = world(rects, { pace: JUST_HOP(1) }), pet = placed(w, 763.5);
  pickNow(w, pet);
  if (!pet.P.aim) return; /* nothing worth aiming at is fine: a grip that drops her is not */
  flies(w, pet);
  w.run(30);
  assert.strictEqual(on(pet), 'w:wall', 'still holding on half a second later');
});

test('the same move without the intent to grab just bounces off: only a side aim holds on', () => {
  const w = world([SCREEN(), windowRect('w', 800, 300, 300, 450)], { pace: only({ hop: 1, hopSide: 1 }) }), pet = placed(w, 400);
  pickNow(w, pet);
  pet.P.aim = null;
  flies(w, pet);
  assert.strictEqual(on(pet), 's:floor');
});

for (const [name, change] of <[string, (a: Rectangle) => Rectangle[]][]>[
  ['closes', () => [SCREEN()]],
  ['moves away', a => [SCREEN(), { ...a, rect: { ...a.rect, x: 100, y: 100 } }]],
  ['gets covered', a => [SCREEN(), a, windowRect('over', 600, 300, 800, 500, 5, { terrain: false })]]
]) {
  for (const hopSide of [0, 1]) {
    test(`no steering: the target ${name} with her in the air, going for a ${hopSide ? 'side' : 'top'}, and she falls like anyone`, () => {
      const target = windowRect('w', 800, 400, 300, 400), w = world([SCREEN(), target], { pace: JUST_HOP(hopSide) }), pet = placed(w, 300);
      pickNow(w, pet);
      const { vx } = pet.P;
      assert.strictEqual(pet.P.aim!.way, hopSide ? 'side' : 'top');
      w.run(6);
      w.sim.setRects(change(target));
      for (let i = 0; i < 30; i++) { w.frame(); assert.strictEqual(pet.P.vx, vx, 'she flies on as she was'); }
      flies(w, pet);
      assert.strictEqual(on(pet), 's:floor');
      assert.strictEqual(pet.P.aim, null);
    });
  }
}

test('going for a top, a side that turns up in the way only bounces her: grabbing is for side hops', () => {
  const target = windowRect('w', 900, 500, 300, 100), w = world([SCREEN(), target], { pace: JUST_HOP() }), pet = placed(w, 400);
  pickNow(w, pet);
  assert.strictEqual(pet.P.aim!.way, 'top');
  w.run(4);
  w.sim.setRects([SCREEN(), target, windowRect('wall', Math.round(pet.P.x) + 120, 100, 60, 780, 2)]);
  assert.ok(w.until(() => pet.P.vx < 0 || pet.P.state !== 'air', 80), 'met it');
  assert.strictEqual(pet.P.state, 'air'); assert.ok(pet.P.vx < 0, 'off it');
});

test('her screen going away with her in the air ends the aim too', () => {
  const w = world([SCREEN(), windowRect('w', 800, 300, 300, 450)], { pace: JUST_HOP(1) }), pet = placed(w, 400);
  pickNow(w, pet);
  w.sim.setRects([screen('other', 0, 0, 1600, 900)]); w.frame();
  assert.strictEqual(pet.P.aim, null);
});

test('caught in the air, she has lost the aim: a slow throw at a wall after a side hop bounces', () => {
  const w = world([SCREEN(), windowRect('w', 800, 300, 300, 450)], { pace: JUST_HOP(1) }), pet = placed(w, 400);
  pickNow(w, pet);
  w.sim.input.down('a', pet.P.x, pet.P.y); w.sim.input.move('a', pet.P.x + 30, pet.P.y); w.frame();
  assert.strictEqual(pet.P.state, 'held'); assert.strictEqual(pet.P.aim, null);
});

/* Eight buddies whose time runs out on the same tick. */
function together(rects: Rectangle[], n = 8) {
  const w = world(rects, { pace: only({ hop: 1, idle: .001 }, { idle: [2, 3], reach: { ...lively.reach, across: 1500, speed: 40 } }) }), pets = Array.from({ length: n }, (_, i) => placed(w, 60 + i * 90, FLOOR, w.add(BUDDY('b' + i))));
  for (const p of pets) p.P.dur = 0;
  return { w, pets };
}
const hopped = (pets: Pet[]) => pets.filter(p => p.P.aim).length;

test('one buddy plans per tick: of eight picking together, one hops and the others wait their turn', () => {
  const { w, pets } = together([SCREEN(), windowRect('w', 900, 500, 500, 100)]);
  w.frame();
  assert.strictEqual(hopped(pets), 1);
  assert.ok(pets.filter(p => !p.P.aim).every(p => p.P.state === 'idle' || p.P.state === 'sit'), 'the rest just get something else');
  assert.ok(w.until(() => pets.filter(p => p.P.on?.surface.owner === 'w').length === 8, 1500), 'and they all get there');
});

test('a walk that reaches its spot while someone else plans waits a tick, it doesn\'t give up', () => {
  const reach = { ...lively.reach, across: 400 };
  const w = world([SCREEN(), windowRect('w', 1000, 500, 300, 100)], { pace: JUST_WALK({ reach }) }), pet = placed(w, 100);
  pickNow(w, pet);
  const on = pet.P.on!, spot = pet.P.spot!;
  on.t = spot.t - .5;
  w.sim.world.planned = w.sim.world.tick + 1; /* the next tick's plan is taken */
  w.frame();
  assert.strictEqual(pet.P.state, 'hopWalk', 'still there');
  w.frame();
  assert.ok(pet.P.aim, 'and off she goes');
});

test('two walks that reach their spots on one tick take turns', () => {
  const reach = { ...lively.reach, across: 400 };
  const w = world([SCREEN(), windowRect('w', 1000, 500, 300, 100)], { pace: JUST_WALK({ reach }) }), one = placed(w, 100, FLOOR, w.add(BUDDY('a'))), two = placed(w, 300, FLOOR, w.add(BUDDY('b')));
  /* one plan a tick, so they set off a tick apart */
  one.go('hopWalk'); w.frame(); two.go('hopWalk');
  for (const p of [one, two]) { p.P.dur = 1e9; p.P.on!.t = p.P.spot!.t - .5; }
  w.frame();
  assert.strictEqual([one, two].filter(p => p.P.aim).length, 1);
  w.frame();
  assert.strictEqual([one, two].filter(p => p.P.aim).length, 2);
});

test('a pick and the move it chooses share one search', () => {
  const w = world([SCREEN(), windowRect('w', 800, 500, 400, 100)], { pace: JUST_HOP() }), pet = placed(w, 300);
  const open = w.terrain.open, top = w.terrain.surfaces().find(s => s.owner === 'w' && s.kind === 'floor')!;
  let searches = 0;
  w.terrain.open = s => { if (s === top) searches++; return open(s); };
  pickNow(w, pet);
  assert.ok(pet.P.aim); assert.strictEqual(searches, 1);
});

test('a world with no windows pays nothing for any of this', () => {
  const w = world([SCREEN()], { pace: JUST_HOP() }), pet = placed(w, 300), sweep = w.terrain.sweep;
  let flown = 0;
  w.terrain.sweep = (...a) => { flown++; return sweep(...a); };
  pickNow(w, pet); w.run(5);
  assert.strictEqual(flown, 0);
});

test('she picks a hop only with something to hop to, and only by its weight', () => {
  const hops = (rects: Rectangle[], pace: Pace, n = 40000) => {
    const w = world(rects, { seed: 5, pace }), pet = w.add(BUDDY()); let count = 0, was: unknown = null;
    for (let i = 0; i < n; i++) { w.frame(); if (pet.P.aim && pet.P.aim !== was) count++; was = pet.P.aim; }
    return count;
  };
  const rects = [SCREEN(), windowRect('w', 700, 550, 300, 100)];
  assert.strictEqual(hops(rects, { ...lively, weights: { ...lively.weights, hop: 0, hopWalk: 0 } }), 0);
  assert.strictEqual(hops([SCREEN()], lively), 0);
  const some = hops(rects, lively), lots = hops(rects, { ...lively, weights: { ...lively.weights, hop: 15 } });
  assert.ok(some > 0); assert.ok(lots > some * 1.5, `${some} against ${lots}`);
}, 60000);

test('hopSide is the share of hops that go for a side, when both are on offer', () => {
  const sides = (hopSide: number) => {
    let side = 0, n = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const w = world([SCREEN(), windowRect('w', 800, 500, 300, 300)], { seed, pace: JUST_HOP(hopSide) }), pet = placed(w, 400);
      pickNow(w, pet);
      assert.ok(pet.P.aim); n++; if (pet.P.aim!.way === 'side') side++;
    }
    return side / n;
  };
  assert.strictEqual(sides(0), 0); assert.strictEqual(sides(1), 1);
  const third = sides(.3);
  assert.ok(third > .2 && third < .4, String(third));
});

test('with only a side in reach she goes for it, whatever the weight', () => {
  const w = world([SCREEN(), windowRect('w', 800, 100, 300, 700)], { pace: { ...JUST_HOP(0), reach: { ...lively.reach, up: 500 } } }), pet = placed(w, 400);
  pickNow(w, pet);
  assert.strictEqual(pet.P.aim!.way, 'side');
});

test('out of reach, she walks to a spot she can jump from, then jumps, and gets there', () => {
  const reach = { ...lively.reach, across: 400 };
  const w = world([SCREEN(), windowRect('w', 1000, 500, 300, 100)], { pace: JUST_WALK({ reach }) }), pet = placed(w, 100);
  pickNow(w, pet);
  assert.strictEqual(pet.P.state, 'hopWalk'); assert.strictEqual(pet.P.spot!.owner, 'w'); assert.strictEqual(pet.P.dir, 1);
  const start = pet.P.x, spot = pet.P.spot!;
  assert.ok(w.until(() => pet.P.state !== 'hopWalk', 1200), 'got there');
  assert.strictEqual(pet.P.x, spot.t, 'exactly on the spot she worked the jump out from');
  assert.ok(pet.P.aim, 'jumped'); assert.strictEqual(pet.P.aim!.owner, 'w');
  assert.ok(pet.P.x > start + 200 && Math.abs(pet.P.aim!.x - pet.P.x) <= 400, 'and it was the walk that put it in reach');
  flies(w, pet);
  assert.strictEqual(on(pet), 'w:floor');
});

test('she jumps for the window she walked to, not whatever else came into reach', () => {
  const reach = { ...lively.reach, across: 700 };
  const owners = new Set<string>();
  for (let seed = 1; seed <= 30; seed++) {
    const w = world([SCREEN(), windowRect('w', 900, 650, 120, 100), windowRect('x', 1040, 600, 150, 100)], { seed, pace: JUST_WALK({ reach }) }), pet = placed(w, 100);
    pickNow(w, pet);
    const { owner } = pet.P.spot!;
    assert.ok(w.until(() => pet.P.state !== 'hopWalk', 1200));
    assert.strictEqual(pet.P.aim!.owner, owner, `seed ${seed}`);
    owners.add(owner);
  }
  assert.strictEqual(owners.size, 2, 'both were walked to');
});

test('from under a window, she walks out from under it', () => {
  const w = world([SCREEN(), windowRect('w', 400, 400, 800, 100)], { pace: JUST_WALK() }), pet = placed(w, 800);
  pickNow(w, pet);
  assert.ok(w.until(() => pet.P.state !== 'hopWalk', 1200));
  flies(w, pet);
  assert.strictEqual(on(pet), 'w:floor');
});

test('a walk can go along a window top too, for what is out of reach from where she stands', () => {
  const reach = { ...lively.reach, across: 450 };
  const w = world([SCREEN(), windowRect('a', 100, 700, 700, 100), windowRect('w', 1100, 500, 300, 100)], { pace: JUST_WALK({ reach }) }), pet = placed(w, 200, 700);
  assert.strictEqual(on(pet), 'a:floor');
  pickNow(w, pet);
  assert.strictEqual(pet.P.state, 'hopWalk');
  assert.ok(w.until(() => pet.P.state !== 'hopWalk', 1200));
  flies(w, pet);
  assert.strictEqual(on(pet), 'w:floor');
});

test('giving up: her time runs out, and she does whatever is next', () => {
  const pace = only({ hopWalk: 1, sit: 5 }, { hopWalk: [20, 30], reach: { ...lively.reach, across: 300 } });
  const w = world([SCREEN(), windowRect('w', 1200, 500, 300, 100)], { seed: 2, pace }), pet = placed(w, 100);
  pet.go('hopWalk');
  assert.ok(pet.P.spot, 'set off');
  assert.ok(w.until(() => pet.P.state !== 'hopWalk', 60), 'gave up');
  assert.notStrictEqual(pet.P.state, 'air'); assert.strictEqual(pet.P.aim, null);
});

test('giving up: the window goes while she walks, and she gets there to find nothing', () => {
  const w = world([SCREEN(), windowRect('w', 1000, 500, 300, 100)], { pace: JUST_WALK({ reach: { ...lively.reach, across: 400 } }) }), pet = placed(w, 100);
  pet.go('hopWalk'); pet.P.dur = 1e9;
  const spot = pet.P.spot!;
  w.run(20);
  w.sim.setRects([SCREEN()]);
  assert.ok(w.until(() => pet.P.on!.t >= spot.t - 3 || pet.P.state !== 'hopWalk', 1200), 'arrived');
  w.run(3);
  assert.notStrictEqual(pet.P.state, 'hopWalk'); assert.strictEqual(pet.P.aim, null); assert.strictEqual(pet.P.surf, 'floor');
});

test('giving up: the surface under her shrinks past the spot', () => {
  const rects = (wide: number) => [SCREEN(), windowRect('a', 100, 700, wide, 100), windowRect('w', 1200, 500, 300, 100)];
  const w = world(rects(800), { pace: JUST_WALK({ reach: { ...lively.reach, across: 440 } }) }), pet = placed(w, 200, 700);
  pet.go('hopWalk'); pet.P.dur = 1e9;
  assert.ok(pet.P.spot && pet.P.spot.t > 300, 'a spot along the top');
  w.sim.setRects(rects(300)); w.run(3);
  assert.notStrictEqual(pet.P.state, 'hopWalk');
});

test('giving up: nothing out of reach, nowhere to walk', () => {
  const w = world([SCREEN()], { pace: JUST_WALK() }), pet = placed(w, 500);
  pet.go('hopWalk');
  assert.strictEqual(pet.P.spot, null);
  w.run(3);
  assert.notStrictEqual(pet.P.state, 'hopWalk');
});

/* Sets her walking to the end of a top, and says how it ended. */
function atTheEnd(seed: number, edgeLeap: number, state: 'walk' | 'run' = 'walk', dir = 1) {
  const w = world([SCREEN(), windowRect('w', 400, 500, 400, 100)], { seed, pace: only({ idle: 1, edgeLeap }) }), pet = placed(w, 600, 500);
  pet.go(state, { dir }); pet.P.dur = 1e9;
  for (let i = 0; i < 400; i++) {
    w.frame();
    if (pet.P.state === 'air') return 'leap';
    if (pet.P.surf !== 'floor') return 'side';
    if (pet.P.dir !== dir) return 'turn';
    if (pet.P.state !== state) return 'trip'; /* a run can end in a trip on the way */
  }
  throw new Error('never got there');
}
const shares = (edgeLeap: number, state: 'walk' | 'run' = 'walk') => { const n: Record<string, number> = { leap: 0, side: 0, turn: 0, trip: 0 }; for (let seed = 1; seed <= 300; seed++) n[atTheEnd(seed, edgeLeap, state)]!++; return n; };

test('at the end of a window top: with no weight she does as she always has', () => {
  const n = shares(0);
  assert.strictEqual(n.leap, 0); assert.ok(n.side! > 30 && n.turn! > 180, JSON.stringify(n));
});

test('at the end of a window top: she leaps as often as the pace says', () => {
  const n = shares(.25);
  assert.ok(n.leap! > 50 && n.leap! < 100, JSON.stringify(n));
  assert.ok(n.side! > 0 && n.turn! > 0);
  assert.strictEqual(shares(1).leap, 300);
});

test('running off the end counts, climbing for the wall does not', () => {
  const n = shares(1, 'run');
  assert.strictEqual(n.leap! + n.trip!, 300); assert.ok(n.leap! > 200, JSON.stringify(n));
  const w = world([SCREEN(), windowRect('w', 400, 500, 400, 100)], { seed: 1, pace: only({ idle: 1, edgeLeap: 1 }) }), pet = placed(w, 600, 500);
  pet.P.dir = 1; pet.go('climbGo');
  assert.ok(w.until(() => pet.P.surf !== 'floor', 400));
  assert.notStrictEqual(pet.P.state, 'air');
});

for (const [name, dir] of [['right', 1], ['left', -1]] as const) {
  test(`a leap off the ${name} end goes out over it and comes down elsewhere`, () => {
    for (const size of [60, 120, 300]) {
      const w = world([SCREEN(), windowRect('w', 500, 500, 500, 100)], { seed: size, pace: only({ idle: 1, edgeLeap: 1 }) }), pet = w.add(BUDDY('a', { size }));
      placed(w, 750, 500, pet);
      pet.go('walk', { dir }); pet.P.dur = 1e9;
      assert.ok(w.until(() => pet.P.state === 'air', 800));
      assert.strictEqual(Math.sign(pet.P.vx), dir); assert.ok(pet.P.vy < 0, 'up and out');
      assert.strictEqual(pet.P.thrown, false);
      flies(w, pet);
      assert.strictEqual(on(pet), 's:floor', `size ${size}`);
    }
  });
}

test('a leap needs a window top: the end of a screen floor stays as it was, and draws nothing', () => {
  const w = world([screen('s', 0, 0, 800, 600)], { pace: only({ idle: 1, edgeLeap: 1 }) }), pet = placed(w, 500, 600);
  pet.go('walk', { dir: 1 }); pet.P.dur = 1e9;
  for (let i = 0; i < 600; i++) { w.frame(); assert.notStrictEqual(pet.P.state, 'air'); }
  pet.P.dur = 1e9; hold(pet); pet.act('leapOff');
  assert.strictEqual(pet.P.state, 'sit', 'and asking changes nothing');
});

test('hop and leapOff asked for with nothing to do leave her as she is', () => {
  const w = world([SCREEN()]), pet = placed(w, 500);
  pet.act('hop'); pet.act('leapOff');
  assert.strictEqual(pet.P.state, 'sit');
});

test('a hop asked for in the air waits for the floor', () => {
  const w = world([SCREEN(), windowRect('w', 700, 500, 300, 100)], { pace: only({ idle: 1 }) }), pet = placed(w, 300);
  pet.go('air'); Object.assign(pet.P, { on: null, vy: -5 });
  pet.act('hop');
  assert.strictEqual(pet.P.next, 'hop');
  assert.ok(w.until(() => pet.P.aim, 200), 'hopped once she landed');
});

test('a world with no windows runs the same whatever the new weights say', () => {
  const trace = (weights: Partial<Record<string, number>>) => {
    const w = world([SCREEN()], { seed: 11, pace: { ...lively, weights: { ...lively.weights, ...weights } as Record<string, number> } }), pet = w.add(BUDDY()), out: string[] = [];
    for (let i = 0; i < 30000; i++) { w.frame(); if (i % 50 === 0) out.push(`${pet.P.state} ${pet.P.x.toFixed(3)} ${pet.P.y.toFixed(3)}`); }
    return out;
  };
  assert.deepStrictEqual(trace({ hop: 0, hopWalk: 0, hopSide: 0, edgeLeap: 0 }), trace({ hop: 50, hopWalk: 50, hopSide: 1, edgeLeap: 1 }));
});

test('every new floor pick says when it can happen', () => {
  for (const to of ['hop', 'hopWalk']) assert.ok(BOOK.picks.floor!.find(p => p.to === to)!.when, to);
});

/* Where a contact can differ from the plan: pressed close, with strips of window in front of the side. */
test('pressed up close, seeded: on a still desktop, every aim lands and she can stay', () => {
  let held = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const draw = mulberry32(seed), at = 500 + Math.floor(draw() * 500), rects: Rectangle[] = [SCREEN(), windowRect('w', at, 200 + Math.floor(draw() * 200), 300, 450 + Math.floor(draw() * 200))];
    for (let i = 0; i < 3; i++) rects.push(windowRect('strip' + i, at - 10, 300 + Math.floor(draw() * 500), 200, 40 + Math.floor(draw() * 80), 2 + i, { cut: ['left', 'right'] }));
    const w = world(rects, { seed, pace: JUST_HOP(1) }), pet = placed(w, at - 36 - [.05, .1, .2, .5, 1, 3][seed % 6]!);
    pickNow(w, pet);
    if (pet.P.aim?.way !== 'side') continue;
    flies(w, pet);
    w.run(30);
    assert.strictEqual(on(pet), 'w:wall', `seed ${seed}: she couldn't stay`);
    held++;
  }
  assert.ok(held > 10, `${held} grips`);
});

/* Each hop on a still desktop: down in the frames it was planned for, on what it was for, and still
   there half a second later, at any tick. A flight runs in whole frames, so only the tick that
   finishes it can run over: its length, plus one for rounding. */
for (const [name, ticks] of [['60 Hz', [16.667]], ...JITTERS.slice(4)] as [string, number[]][]) {
  test(`a jump between windows, seeded, on ${name}: on a still desktop, every aim lands, on time, and stays`, () => {
    const HOLD = 30, late = Math.ceil(Math.max(...ticks) / 16.667) + 1;
    let hops = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const draw = mulberry32(seed), rects: Rectangle[] = [SCREEN()];
      for (let i = 0; i < 7; i++) rects.push(windowRect('w' + i, Math.floor(draw() * 1200), 120 + Math.floor(draw() * 620), 180 + Math.floor(draw() * 420), 140 + Math.floor(draw() * 300), i + 1));
      const w = world(rects, { seed, pace: only({ hop: 1, hopWalk: 1, hopSide: .3, idle: 1, walk: 1, climbUp: 1, leap: 1, letGo: 1, crawl: 1 }) }), pet = w.add(BUDDY());
      let aim = pet.P.aim, took = 0, stay = 0, owner = '';
      for (let i = 0; i < 12000; i++) {
        const ms = ticks[i % ticks.length]!;
        tick(w, ms);
        const frames = ms / 16.667;
        if (stay > 0) { assert.strictEqual(pet.P.on?.surface.owner, owner, `seed ${seed}, frame ${i}: couldn't stay`); stay -= frames; }
        if (pet.P.aim && pet.P.aim !== aim) { aim = pet.P.aim; took = 0; }
        else if (aim) took += frames;
        if (aim && pet.P.aim) assert.ok(took <= aim.frames + late, `seed ${seed}, frame ${i}: still up after ${took} of ${aim.frames}`);
        if (aim && !pet.P.aim) { assert.strictEqual(pet.P.on?.surface.owner, aim.owner, `seed ${seed}, frame ${i}`); hops++; owner = aim.owner; stay = HOLD; aim = null; }
      }
    }
    assert.ok(hops > 60, `${hops} hops`);
  }, 60000);
}

test('a window she can only jump for from one place, behind places that use up its share, still gets jumped for', () => {
  const w = world([SCREEN(), windowRect('w', 100, 200, 120, 150)], { pace: JUST_WALK() }), pet = placed(w, 300);
  pet.P.dur = 0;
  assert.ok(w.until(() => pet.P.aim, 5000), 'set off and jumped');
  assert.strictEqual(pet.P.aim!.owner, 'w');
});

test('a plan doesn\'t outlive the windows it was made from', () => {
  const w = world([SCREEN(), windowRect('w', 800, 500, 400, 100)], { pace: only({ walk: 1, hop: 1e-9 }) }), pet = placed(w, 300);
  pet.P.dur = 0;
  assert.ok(w.until(() => pet.P.state === 'walk', 20), 'picked, with a hop worked out on the way');
  w.sim.setRects([SCREEN()]);
  pet.act('hop');
  assert.strictEqual(pet.P.aim, null, 'no jump for a window that closed');
});
