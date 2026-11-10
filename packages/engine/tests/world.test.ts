/* One tick per buddy: carry, grip, check, and everything that has to follow surfaces. */
import assert from 'node:assert';
import fs from 'node:fs';
import { test } from 'vitest';
import { BOOK, LINES, canDo, createSim, lively, type BuddyData, type Pet } from '../src/index';
import { BUDDY, churn, messy, mulberry32, screen, windowRect, world, type TestWorld } from './support';

const SCREEN = () => screen('s', 0, 0, 1600, 900);
/* Stands a buddy on a rectangle's top, still, for as long as the test needs. */
function standOn(w: TestWorld, id = 'a', x = 400, y = 100) {
  const pet = w.sim.pets.get(id) || w.add(BUDDY(id));
  drop(w, pet, x, y);
  assert.ok(w.until(() => pet.P.surf === 'floor' && pet.P.state !== 'land', 2000), 'landed');
  rest(pet);
  return pet;
}
const rest = (pet: Pet, state: Parameters<Pet['go']>[0] = 'sit') => { pet.go(state); pet.P.dur = 1e9; pet.P.chatT = 1e9; };
/* Lets go of a buddy at a point, with no throw. */
function drop(w: TestWorld, pet: Pet, x: number, y: number) {
  w.sim.input.down(pet.id, pet.P.x, pet.P.y); w.sim.input.move(pet.id, x, y); w.frame();
  w.run(10); w.sim.input.up(pet.id);
}
/* Drags from a point in a straight line and lets go moving. */
function fling(w: TestWorld, pet: Pet, from: { x: number; y: number }, v: { x: number; y: number }, n = 5) {
  w.sim.input.down(pet.id, pet.P.x, pet.P.y); w.sim.input.move(pet.id, from.x, from.y); w.frame();
  let { x, y } = from;
  for (let i = 0; i < n; i++) { x += v.x; y += v.y; w.sim.input.move(pet.id, x, y); w.frame(); }
  w.sim.input.up(pet.id);
}
const onWindow = (r = [300, 500, 600, 200]) => [SCREEN(), windowRect('w', r[0]!, r[1]!, r[2]!, r[3]!)];
const moved = (x: number, y: number, w = 600, h = 200) => [SCREEN(), windowRect('w', x, y, w, h)];

test('carry: a buddy moves with its owner and keeps its place along the surface', () => {
  const w = world(onWindow()), pet = standOn(w);
  assert.strictEqual(pet.P.on!.surface.owner, 'w');
  const t = pet.P.on!.t;
  for (let i = 1; i <= 30; i++) { w.sim.setRects(moved(300 + i * 5, 500 - i * 2)); w.frame(); }
  assert.strictEqual(pet.P.on!.t, t);
  assert.strictEqual(pet.P.x, 450 + t); assert.strictEqual(pet.P.y, 440);
});

test('carry: resizing keeps the place too, until the place is gone', () => {
  const w = world(onWindow()), pet = standOn(w, 'a', 700), t = pet.P.on!.t;
  w.sim.setRects(moved(300, 500, 500)); w.frame();
  assert.strictEqual(pet.P.on!.t, t);
  w.sim.setRects(moved(300, 500, 300)); w.frame();
  assert.strictEqual(pet.P.state, 'air', 'the edge moved in past it');
});

const limit = (px: number, k = 1) => px * 16.667 / 40 * k; /* per 16.667 ms frame */
for (const [name, dx, dy, kept] of <[string, number, number, boolean][]>[
  ['sideways, under the limit', limit(80) - 1, 0, true], ['sideways, over', limit(80) + 1, 0, false],
  ['down, under', 0, limit(20) - 1, true], ['down, over', 0, limit(20) + 1, false],
  ['up, under', 0, -limit(80) + 1, true], ['up, over', 0, -limit(80) - 1, false]
]) {
  test(`grip on a floor: ${name}`, () => {
    const w = world(onWindow()), pet = standOn(w);
    const t = pet.P.on!.t;
    w.sim.setRects(moved(300 + dx, 500 + dy)); w.frame();
    assert.strictEqual(pet.P.state === 'sit' && pet.P.on!.t === t, kept);
  });
}

test('grip is time-scaled: the same jump holds across a longer tick', () => {
  const w = world(onWindow()), pet = standOn(w), dx = limit(80) + 1;
  w.now.t += 16.667;
  w.sim.setRects(moved(300 + dx, 500)); w.frame();
  assert.strictEqual(pet.P.state, 'sit');
});

test('grip on a wall: the same limit either way', () => {
  for (const [dx, dy, kept] of <[number, number, boolean][]>[[limit(80) - 1, 0, true], [limit(80) + 1, 0, false], [0, limit(80) - 1, true], [0, limit(80) + 1, false]]) {
    const w = world(onWindow()), pet = w.add(BUDDY());
    w.until(() => pet.P.surf === 'floor');
    fling(w, pet, { x: 170, y: 420 }, { x: 8, y: 0 }, 6);
    assert.ok(w.until(() => pet.P.state === 'wall', 200), 'grabbed the window side');
    rest(pet, 'wall');
    w.sim.setRects(moved(300 + dx, 500 + dy)); w.frame();
    assert.strictEqual(pet.P.state === 'wall', kept, `${dx},${dy}`);
  }
});

for (const [name, change] of <[string, () => ReturnType<typeof moved>][]>[
  ['closed', () => [SCREEN()]],
  ['covered', () => [SCREEN(), windowRect('w', 300, 500, 600, 200), windowRect('over', 200, 300, 800, 300, 2)]],
  ['covered by something you cannot stand on', () => [SCREEN(), windowRect('w', 300, 500, 600, 200), windowRect('max', 0, 0, 1600, 900, 2, { terrain: false })]],
  ['snapped away', () => moved(50, 50)]
]) {
  test(`one way down: owner ${name}`, () => {
    const w = world(onWindow()), pet = standOn(w);
    w.sim.setRects(change()); w.frame();
    assert.strictEqual(pet.P.state, 'air');
    assert.strictEqual(pet.P.on, null);
    assert.ok(w.until(() => pet.P.surf === 'floor', 400));
  });
}

test('a window over the screen floor leaves it standing', () => {
  const w = world([SCREEN(), windowRect('w', 300, 100, 600, 800)]), pet = standOn(w, 'a', 1200, 500);
  w.sim.setRects([SCREEN(), windowRect('w', 300, 100, 1200, 800)]); w.run(5);
  assert.strictEqual(pet.P.state, 'sit');
});

test('walking off an open end falls', () => {
  const w = world([SCREEN()]), pet = standOn(w, 'a', 1400, 500);
  pet.P.on!.surface.next = null; /* no corner past this end */
  pet.go('walk', { dir: 1 }); pet.P.dur = 1e9;
  assert.ok(w.until(() => pet.P.state !== 'walk', 800), 'walked off');
  assert.ok(pet.P.x > 1550, 'all the way to the end, with no turning back');
});

test('a window cut off at the monitor turns her back: past it she would be off every screen', () => {
  const w = world([SCREEN(), windowRect('w', 0, 500, 600, 200, 1, { cut: ['left'] })]), pet = standOn(w, 'a', 300, 100);
  pet.go('walk', { dir: -1 }); pet.P.dur = 1e9;
  assert.ok(w.until(() => pet.P.dir === 1, 800), 'turned back');
  assert.strictEqual(pet.P.on?.surface.owner, 'w');
  assert.ok(pet.P.x >= pet.bw() / 2 - .01, `all of her stayed on: ${pet.P.x}`);
});

test('a screen changing size is a re-fit, not a lost grip', () => {
  const w = world([SCREEN()]), pet = standOn(w);
  w.sim.setRects([screen('s', 0, 0, 900, 500)]); w.frame();
  assert.strictEqual(pet.P.state, 'sit'); assert.strictEqual(pet.P.y, 500);
});

test('a floor catches something falling onto it, once, at a fast fall', () => {
  const w = world([SCREEN(), windowRect('w', 300, 500, 600, 4)]), pet = w.add(BUDDY());
  w.until(() => pet.P.surf === 'floor');
  fling(w, pet, { x: 500, y: 60 }, { x: 0, y: 40 }, 3);
  assert.ok(w.until(() => pet.P.on, 200));
  assert.strictEqual(pet.P.on!.surface.owner, 'w');
});

test('a jump passes up through a floor and lands on it coming down', () => {
  const w = world([SCREEN(), windowRect('w', 300, 700, 600, 100)]), pet = standOn(w, 'a', 200, 500);
  fling(w, pet, { x: 500, y: 400 }, { x: 0, y: 0 }, 1);
  assert.ok(w.until(() => pet.P.surf === 'floor', 400));
  assert.strictEqual(pet.P.y, 700);
});

test('the bottom of a window is a ceiling', () => {
  const w = world([SCREEN(), windowRect('w', 300, 300, 600, 100)]), pet = w.add(BUDDY());
  w.until(() => pet.P.surf === 'floor');
  fling(w, pet, { x: 600, y: 700 }, { x: 0, y: -25 }, 3);
  assert.ok(w.until(() => pet.P.state === 'hang', 100), 'grabbed');
  assert.strictEqual(pet.P.surf, 'ceil'); assert.strictEqual(pet.P.y, 400);
});

test('a window side poses like the screen wall that faces the same way', () => {
  const w = world(onWindow()), pet = w.add(BUDDY());
  w.until(() => pet.P.surf === 'floor');
  fling(w, pet, { x: 170, y: 420 }, { x: 8, y: 0 }, 6);
  assert.ok(w.until(() => pet.P.state === 'wall', 200));
  rest(pet, 'wall'); w.frame();
  assert.strictEqual(pet.P.on!.surface.at, 300); assert.strictEqual(pet.P.surf, 'right');
  assert.match(pet.frame({ x: 0, y: 0, scale: 1 }).body!, /^rotate\(-90deg\)/);
  const low = pet.P.on!;
  assert.deepStrictEqual(low.surface.normal, { x: -1, y: 0 });
});

test('going round a window: top, down the side, under, up the other side', () => {
  const w = world(onWindow(), { pace: { ...lively, weights: { ...lively.weights, edgeLeap: 0 } } });
  const pet = standOn(w, 'a', 500, 100), s0 = pet.P.on!.surface;
  const seen = new Set<string>();
  w.terrain.surfaces().filter(s => s.owner === 'w').forEach(s => assert.ok(s.next && s.prev));
  pet.go('walk', { dir: 1 }); pet.P.dur = 1e9;
  w.until(() => { if (pet.P.on) seen.add(pet.P.on.surface.owner + pet.P.on.surface.kind); return seen.has('wwall') || pet.P.state === 'air'; }, 8000);
  assert.ok(seen.has('wfloor')); assert.ok(seen.has('wwall'), 'stepped from the top onto the side');
  assert.strictEqual(pet.P.dir, 1, 'heading down it'); assert.ok(pet.P.on!.t < 150);
  assert.strictEqual(s0.owner, 'w');
});

test('the first surface crossed wins, whatever its kind', () => {
  const w = world([SCREEN(), windowRect('a', 100, 490, 800, 100, 1), windowRect('b', 600, 0, 300, 900, 2)]), pet = w.add(BUDDY());
  w.until(() => pet.P.surf === 'floor');
  pet.go('air'); Object.assign(pet.P, { x: 500, y: 480, vx: 25, vy: 10, thrown: true, catches: true, bound: null });
  w.now.t += 33.333; w.frame(); /* a 50 ms tick */
  assert.ok(pet.P.on, 'caught');
  assert.strictEqual(pet.P.on!.surface.owner, 'a'); assert.strictEqual(pet.P.surf, 'floor');
  assert.strictEqual(pet.P.y, 490); assert.ok(pet.P.x < 540, `at the crossing, not the end of the tick: ${pet.P.x}`);
});

/* Puts her in the air at a point and runs one 50 ms tick. */
function oneLongTick(w: TestWorld, pet: Pet, at: Partial<Pet['P']>) {
  pet.go('air'); Object.assign(pet.P, { thrown: false, catches: false, hard: false, bound: null }, at);
  w.now.t += 33.333; w.frame();
}

test('a screen wall puts her back, and the top she then passes over still catches her (led #1354)', () => {
  for (const thrown of [false, true]) {
    const w = world([screen('s', 0, 0, 1000, 800), windowRect('w', 700, 500, 300, 100)]), pet = w.add(BUDDY());
    w.until(() => pet.P.surf === 'floor');
    oneLongTick(w, pet, { x: 950, y: 480, vx: 40, vy: 10, thrown, catches: thrown });
    assert.ok(pet.P.on, 'caught');
    assert.strictEqual(pet.P.on!.surface.owner, 'w'); assert.strictEqual(pet.P.surf, 'floor');
    assert.strictEqual(pet.P.y, 500); assert.ok(pet.P.x <= 964, `inside the screen wall: ${pet.P.x}`);
  }
});

test('a screen ceiling puts her back, and the window side she then runs into still stops her', () => {
  const w = world([screen('s', 0, 0, 1000, 800), windowRect('w', 500, 100, 300, 300)]), pet = w.add(BUDDY());
  w.until(() => pet.P.surf === 'floor');
  oneLongTick(w, pet, { x: 450, y: 130, vx: 20, vy: -30 });
  assert.strictEqual(pet.P.x, 464, 'stopped against the side, not inside the window');
  assert.ok(pet.P.vx < 0, 'and off it');
});

test('a screen wall still bounces her when no window is on the way back', () => {
  const w = world([screen('s', 0, 0, 1000, 800), windowRect('w', 100, 500, 300, 100)]), pet = w.add(BUDDY());
  w.until(() => pet.P.surf === 'floor');
  oneLongTick(w, pet, { x: 950, y: 480, vx: 20, vy: 10 });
  assert.strictEqual(pet.P.on, null); assert.strictEqual(pet.P.x, 964); assert.strictEqual(pet.P.vx, -7);
});

test('pairs meet on the same surface only', () => {
  const w = world(onWindow()), a = standOn(w, 'a', 500, 300), b = standOn(w, 'b', 150, 700);
  let met = 0; a.faceTo = () => { met++; };
  rest(a);
  /* same x, different surfaces */
  w.sim.input.down('b', b.P.x, b.P.y); w.sim.input.move('b', 500, 880); w.run(8); w.sim.input.up('b');
  /* a window over the floor at the same x */
  assert.ok(w.until(() => b.P.surf === 'floor' && b.P.state !== 'land', 400)); rest(b);
  assert.notStrictEqual(a.here()!.id, b.here()!.id);
  assert.ok(Math.abs(a.P.x - b.P.x) < 60);
  w.run(120);
  assert.strictEqual(met, 0);
  /* now the same floor */
  w.sim.input.down('b', b.P.x, b.P.y); w.sim.input.move('b', a.P.x, 300); w.run(8); w.sim.input.up('b');
  assert.ok(w.until(() => met > 0, 400), 'they met');
  assert.strictEqual(b.here()!.id, a.here()!.id);
});

/* Two buddies side by side, one waving. The other waves back once pairGreetMs is up, if she still can. */
function greeting(rects = [SCREEN()], x = 500) {
  const w = world(rects, { random: () => .1 }), a = standOn(w, 'a', x), b = standOn(w, 'b', x + 20);
  assert.ok(w.until(() => a.P.state === 'wave', 60), 'a waved');
  return { w, b, wait: () => w.run(50) };
}

test('waving back: she does, if she is still there', () => {
  const { b, wait } = greeting();
  wait();
  assert.strictEqual(b.P.state, 'wave');
});

test('waving back: not once she has been thrown, and she still falls', () => {
  const { w, b, wait } = greeting();
  fling(w, b, { x: 800, y: 100 }, { x: 2, y: 0 });
  wait();
  assert.notStrictEqual(b.P.state, 'wave');
  assert.ok(w.until(() => b.P.surf === 'floor', 400), 'landed');
});

test('waving back: not out of someone\'s hand', () => {
  const { w, b, wait } = greeting();
  w.sim.input.down(b.id, b.P.x, b.P.y); w.sim.input.move(b.id, 800, 300); w.frame();
  wait();
  assert.strictEqual(b.P.state, 'held');
});

test('waving back: not from a wall', () => {
  const { w, b, wait } = greeting(onWindow(), 150), start = w.now.t;
  fling(w, b, { x: 170, y: 420 }, { x: 8, y: 0 }, 6);
  assert.ok(w.until(() => b.P.state === 'wall', 200), 'grabbed the window side');
  assert.ok(w.now.t - start < lively.pairGreetMs, 'on the wall before the wave was due');
  rest(b, 'wall');
  wait();
  assert.strictEqual(b.P.state, 'wall');
});

test('a floor action asked for in the air waits for the floor', () => {
  for (const name of Object.keys(BOOK.direct).filter(n => n !== 'air')) {
    const w = world([SCREEN()]), pet = standOn(w);
    fling(w, pet, { x: 800, y: 100 }, { x: 2, y: 0 });
    pet.act(name);
    assert.strictEqual(pet.P.state, 'air', name);
    assert.ok(w.until(() => pet.P.surf === 'floor', 400), `${name}: landed`);
    assert.ok(w.until(() => pet.P.state === BOOK.direct[name], 400), `${name}: then did it`);
  }
});

test('whatever happens to her, a buddy in the air is doing something that belongs there', () => {
  const all = { poses: Object.fromEntries(Object.values(BOOK.behaviours).map(b => [b.main.pose, { frames: [ART] }])) };
  const names = [...new Set([...Object.keys(BOOK.direct), ...Object.keys(BOOK.aliases), ...Object.keys(BOOK.actions), ...Object.keys(BOOK.behaviours)])];
  for (let seed = 1; seed <= 25; seed++) {
    const draw = mulberry32(seed), one = <T>(list: T[]) => list[Math.floor(draw() * list.length)]!;
    let rects = seed % 5 ? messy(seed, 1600, 900, 7) : onWindow();
    const w = world(rects, { seed }), pets = ['a', 'b', 'c'].map(id => w.add(BUDDY(id, all)));
    let held: Pet | null = null;
    for (let i = 0; i < 4000; i++) {
      w.frame();
      if (draw() < .03) one(pets).act(one(names));
      if (draw() < .03) w.sim.setRects(rects = churn(rects, draw));
      if (held && draw() < .1) { w.sim.input.up(held.id); held = null; }
      else if (!held && draw() < .01) { held = one(pets); w.sim.input.down(held.id, held.P.x, held.P.y); }
      if (held) w.sim.input.move(held.id, 100 + draw() * 1400, 100 + draw() * 700);
      for (const p of pets) if (p.P.surf === 'air') assert.ok(BOOK.behaviours[p.P.state]!.on.includes('air'), `seed ${seed}, frame ${i}: ${p.id} ${p.P.state} in the air`);
    }
  }
}, 60000);

/* An arrival counts if she's still there half a second on, not for a one-frame touch. */
const HOLD = 30;
/* Measured on 12 seeded messy desktops, 30000 frames and 3 buddies each, still and in use. Worst
   seen: 2181 frames in one state, 3351 in one spot. On the seeds below, 12795 to 14747 without an
   arrival and at least 4 arrivals each. Aims came down at most 2 frames past plan on a still desktop
   and 37 on one in use. Limits are those times 1.5, except arrivals, which is one under, and a still
   desktop's aims, which get one frame: they run in whole frames, so that's all rounding can owe.
   Seed 12 is left out: its only way up is a 16 px strip at one end, and it does what it can. */
const LIMITS = { state: 3500, place: 5000, arrivalGap: 22000, arrivals: 3, lateStill: 3, lateBusy: 60 };
for (const busy of [false, true]) {
  test(`nobody gets stuck: on a messy desktop${busy ? ' someone is using' : ''}, each buddy keeps moving, every aim resolves, and each keeps arriving on windows`, () => {
    const all = { poses: Object.fromEntries(Object.values(BOOK.behaviours).map(b => [b.main.pose, { frames: [ART] }])) };
    for (let seed = 1; seed <= 4; seed++) {
      const draw = mulberry32(seed + 100);
      let rects = messy(seed), changed = -1;
      const w = world(rects, { seed }), pets = ['a', 'b', 'c'].map((id, n) => w.add(BUDDY(id, n ? all : {})));
      const seen = pets.map(p => ({ state: p.P.state, since: 0, x: 0, y: 0, at: 0, stood: null as string | null, standing: 0, arrivals: 0, arrived: 0, aim: null as Pet['P']['aim'], aimAt: 0, landed: null as string | null, landedAt: 0 }));
      for (let i = 0; i < 30000; i++) {
        w.frame();
        if (busy && draw() < .002) { w.sim.setRects(rects = churn(rects, draw)); changed = i; }
        pets.forEach((p, n) => {
          const s = seen[n]!, { P } = p, where = `seed ${seed}, frame ${i}: ${p.id}`;
          if (P.state !== s.state) { s.state = P.state; s.since = i; }
          if (Math.hypot(P.x - s.x, P.y - s.y) > 60) { s.x = P.x; s.y = P.y; s.at = i; }
          assert.ok(i - s.since < LIMITS.state, `${where} stuck as ${P.state}`);
          assert.ok(i - s.at < LIMITS.place, `${where} stuck at ${P.x},${P.y} as ${P.state}`);

          /* every aim resolves in time, on what it was for, unless the desktop changed under it */
          if (P.aim && P.aim !== s.aim) { s.aim = P.aim; s.aimAt = i; }
          if (s.aim) {
            assert.ok(i - s.aimAt <= s.aim.frames + (busy ? LIMITS.lateBusy : LIMITS.lateStill), `${where} still in the air for ${s.aim.owner}`);
            if (!P.aim) {
              const moved = changed >= s.aimAt;
              if (!moved) assert.strictEqual(P.on?.surface.owner, s.aim.owner, `${where} missed`);
              if (!moved) { s.landed = s.aim.owner; s.landedAt = i; }
              s.aim = null;
            }
          }
          if (s.landed && i - s.landedAt <= HOLD && changed < s.landedAt) assert.strictEqual(P.on?.surface.owner, s.landed, `${where} couldn't stay where she landed`);

          /* and each buddy, herself, keeps getting somewhere */
          const owner = P.on && w.terrain.rectById(P.on.surface.owner)?.kind === 'window' ? P.on.surface.owner : null;
          if (owner && owner === s.stood) s.standing++; else { s.stood = owner; s.standing = 0; }
          if (owner && s.standing === HOLD) { s.arrivals++; s.arrived = i; }
          assert.ok(i - s.arrived < LIMITS.arrivalGap, `${where} hasn't got anywhere since frame ${s.arrived}`);
        });
      }
      seen.forEach((s, n) => assert.ok(s.arrivals >= LIMITS.arrivals, `seed ${seed}: ${pets[n]!.id} arrived on windows ${s.arrivals} times`));
    }
  }, 60000);
}

test('a puddle, tears and crumbs land on the buddy\'s floor, not the screen\'s', () => {
  const w = world(onWindow()), pet = w.add(BUDDY('a', { poses: { eat: { frames: [ART] } } }));
  standOn(w);
  pet.act('cry');
  w.frame();
  const puddle = w.sim.world.fx.find(p => p.kind === 'puddle')!;
  assert.ok(puddle.y < 500 && puddle.y > 480, `puddle at ${puddle.y}`);
  w.until(() => w.sim.world.fx.some(p => p.kind === 'tear'), 100);
  assert.strictEqual(w.sim.world.fx.find(p => p.kind === 'tear')!.floor, 496);
  pet.act('sit'); rest(pet); pet.act('eat');
  w.until(() => w.sim.world.fx.some(p => p.kind === 'crumb'), 100);
  assert.strictEqual(w.sim.world.fx.find(p => p.kind === 'crumb')!.floor, 498);
});

test('chase judges the cursor against the floor it is on', () => {
  const w = world(onWindow()), pet = standOn(w);
  pet.act('chase'); w.sim.input.pointer(pet.P.x, 480); w.frame();
  assert.strictEqual(pet.P.state, 'love', 'caught, at the height of its own floor');
});

test('a jump for the ceiling is sized by the ceiling above, not the screen', () => {
  const w = world([SCREEN(), windowRect('w', 300, 300, 600, 100)]), pet = standOn(w, 'a', 600, 700);
  assert.strictEqual(pet.P.y, 900);
  pet.act('ceilGo');
  assert.ok(Math.abs(pet.P.vy) < Math.sqrt(2 * .6 * 520) * 1.09, `vy ${pet.P.vy}`);
});

const ART = { src: 'data:image/png;base64,AAAA', bb: { x0: 0, y0: 0, x1: 1, y1: 1 } };
const OPTIONAL = ['dance', 'sing', 'eat', 'think'] as const;

test('a buddy without the art for an optional action never does it, and one with it does', () => {
  const seen = (poses: BuddyData['poses']) => {
    const w = world([SCREEN()], { seed: 7 }), pet = w.add(BUDDY('a', { poses })), got = new Set<string>();
    for (let i = 0; i < 60000; i++) { w.frame(); got.add(pet.P.state); }
    return got;
  };
  const without = seen({});
  for (const a of OPTIONAL) assert.ok(!without.has(a), a);
  for (const a of ['idle', 'walk', 'sit', 'sleep', 'climb', 'run']) assert.ok(without.has(a), `${a} still happens on one image`);
  const with_ = seen(Object.fromEntries(OPTIONAL.map(k => [k, { frames: [ART] }])));
  for (const a of OPTIONAL) assert.ok(with_.has(a), a);
});

test('asked for an optional action without the art, nothing happens', () => {
  const w = world([SCREEN()]), pet = standOn(w);
  for (const a of OPTIONAL) { pet.act(a); assert.strictEqual(pet.P.state, 'sit', a); }
});

test('a fallback pose doesn\'t count as the art', () => {
  const w = world([SCREEN()]), pet = w.add(BUDDY('a', { poses: { happy: { frames: [ART] }, sit: { frames: [ART] } } }));
  assert.ok(w.until(() => pet.P.surf === 'floor' && pet.P.state !== 'land', 2000)); rest(pet);
  pet.act('dance'); pet.act('eat');
  assert.strictEqual(pet.P.state, 'sit');
});

test('menus can ask what a character can do', () => {
  const one = { poses: {} }, has = { poses: { dance: { frames: [ART] } } };
  assert.strictEqual(canDo(one, 'dance'), false); assert.strictEqual(canDo(has, 'dance'), true);
  assert.strictEqual(canDo(has, 'sing'), false);
  assert.strictEqual(canDo(one, 'stand_up'), false, 'a clip needs its art');
  assert.strictEqual(canDo({ poses: { stand_up: { frames: [ART] } } }, 'stand_up'), true);
  for (const a of ['love', 'wave', 'climbGo', 'climb', 'ceilGo', 'hang', 'jump', 'drop', 'chase', 'happy', 'stand', 'sprawl', 'nonsense']) assert.strictEqual(canDo(one, a), true, a);
});

/* art with a frame per number, so a frame tells which is showing */
const frames = (key: string, n: number) => ({ fps: 6, frames: Array.from({ length: n }, (_, i) => ({ src: `data:image/png;base64,${key}${i}`, bb: ART.bb })) });
const shown = (pet: Pet) => pet.frame({ x: 0, y: 0, scale: 1 }).src;
const onFloorWith = (poses: BuddyData['poses'], o: Partial<BuddyData> = {}) => {
  const w = world([SCREEN()]), pet = w.add(BUDDY('a', { poses, ...o }));
  assert.ok(w.until(() => pet.P.surf === 'floor' && pet.P.state !== 'land', 2000));
  return { w, pet };
};

test('sitting ends in its stand-up clip, played once, stopping on the last frame', () => {
  const { w, pet } = onFloorWith({ sit: frames('sit', 1), stand_from_sit: frames('up', 3) });
  pet.go('sit'); pet.P.dur = 1;
  assert.ok(w.until(() => pet.P.clip, 20), 'the clip started');
  w.frame(); assert.strictEqual(shown(pet), 'data:image/png;base64,up0');
  assert.strictEqual(pet.P.state, 'sit');
  const dur = pet.P.dur; assert.ok(Math.abs(dur - 30) < 1e-9, 'three frames at six a second');
  w.run(20); assert.strictEqual(shown(pet), 'data:image/png;base64,up2', 'the last frame holds');
  assert.ok(w.until(() => !pet.P.clip, 40));
  assert.notStrictEqual(shown(pet), 'data:image/png;base64,up2');
});

test('without the clip, sitting ends as it always has', () => {
  const { w, pet } = onFloorWith({ sit: frames('sit', 1) });
  pet.go('sit'); pet.P.dur = 1; w.run(3);
  assert.strictEqual(pet.P.clip, null); assert.notStrictEqual(pet.P.state, 'sit');
});

/* Dizzy gets up through it only when what she shows is low: stand-up.test.ts */
for (const [from, set] of [['sleep', { }], ['trip', { }]] as [Parameters<Pet['go']>[0], object][]) {
  test(`${from} gets up through stand_up`, () => {
    const { w, pet } = onFloorWith({ stand_up: frames('up', 2) });
    pet.go(from, set as never); pet.P.dur = 1;
    assert.ok(w.until(() => pet.P.clip, 20));
    assert.strictEqual(pet.P.clip!.pose, 'stand_up');
  });
}

test('being grabbed cuts a clip at once', () => {
  const { w, pet } = onFloorWith({ stand_from_sit: frames('up', 3) });
  pet.go('sit'); pet.P.dur = 1;
  w.until(() => pet.P.clip, 20);
  w.sim.input.down('a', pet.P.x, pet.P.y); w.sim.input.move('a', 400, 200);
  assert.strictEqual(pet.P.clip, null); assert.strictEqual(pet.P.state, 'held');
});

test('thrown shows her tumble, if she has one', () => {
  const { w, pet } = onFloorWith({ thrown: frames('tumble', 1), fall: frames('fall', 1) });
  fling(w, pet, { x: 400, y: 200 }, { x: 12, y: -6 }, 3); w.frame();
  assert.strictEqual(shown(pet), 'data:image/png;base64,tumble0');
  const plain = onFloorWith({ fall: frames('fall', 1) });
  fling(plain.w, plain.pet, { x: 400, y: 200 }, { x: 12, y: 8 }, 3); plain.w.frame();
  assert.strictEqual(shown(plain.pet), 'data:image/png;base64,fall0');
});

test('a chase ends tired, then watching the cursor, with the art for each', () => {
  const { w, pet } = onFloorWith({ tired: frames('tired', 1), watch_cursor: frames('watch', 1) });
  pet.go('chase'); pet.P.dur = 0; w.sim.input.pointer(1e5, 100); w.frame();
  assert.strictEqual(pet.P.state, 'tired');
  pet.P.dur = 0; w.run(2);
  assert.strictEqual(pet.P.state, 'watch_cursor');
  w.sim.input.pointer(-1e5, 100); w.frame();
  assert.strictEqual(pet.P.dir, -1, 'she turns to follow it');
  const none = onFloorWith({});
  none.pet.go('chase'); none.pet.P.dur = 0; none.w.sim.input.pointer(1e5, 100); none.w.frame();
  assert.strictEqual(none.pet.P.state, 'sit', 'as it always has');
});

test('held still for 10 seconds with the art, she struggles and breaks free', () => {
  const { w, pet } = onFloorWith({ struggle: frames('kick', 2) });
  w.sim.input.down('a', pet.P.x, pet.P.y); w.sim.input.move('a', 400, 200); w.sim.input.move('a', 402, 200);
  assert.strictEqual(pet.P.state, 'held');
  assert.ok(w.until(() => pet.P.clip, 700), 'the struggle started');
  assert.strictEqual(pet.P.state, 'held');
  assert.ok(w.until(() => pet.P.state !== 'held', 60), 'and she got away');
  assert.strictEqual(pet.P.state, 'air'); assert.strictEqual(pet.P.vx, 0);
  w.sim.input.up('a');
  assert.strictEqual(pet.P.state, 'air', 'letting go now changes nothing');
  const none = onFloorWith({});
  none.w.sim.input.down('a', none.pet.P.x, none.pet.P.y); none.w.sim.input.move('a', 400, 200); none.w.sim.input.move('a', 402, 200); none.w.run(900);
  assert.strictEqual(none.pet.P.state, 'held', 'no art, no struggle');
});

test('paused time doesn\'t count toward a struggle', () => {
  const { w, pet } = onFloorWith({ struggle: frames('kick', 2) });
  w.sim.input.down('a', pet.P.x, pet.P.y); w.sim.input.move('a', 400, 200); w.sim.input.move('a', 402, 200);
  w.run(60);
  w.sim.world.paused = true; w.run(660); w.sim.world.paused = false;
  w.run(5);
  assert.strictEqual(pet.P.clip, null, 'one second held, not twelve');
  assert.ok(w.until(() => pet.P.clip, 600), 'and the rest of the ten seconds still counts');
});

test('a clip cleared while it plays ends now, through a sync', () => {
  const { w, pet } = onFloorWith({ sit: frames('sit', 1), stand_from_sit: { fps: .1, frames: frames('up', 120).frames } });
  pet.go('sit'); pet.P.dur = 1;
  assert.ok(w.until(() => pet.P.clip, 20));
  w.sim.sync({ pets: [BUDDY('a', { poses: { sit: frames('sit', 1) } })] });
  w.run(2);
  assert.strictEqual(pet.P.clip, null);
  assert.notStrictEqual(pet.P.state, 'sit');
});

test('with no stand_up art, playing it on a wall leaves her there', () => {
  const w = world([SCREEN()]), pet = w.add(BUDDY());
  w.until(() => pet.P.surf === 'floor');
  pet.act('climbGo');
  assert.ok(w.until(() => pet.P.surf === 'left' || pet.P.surf === 'right', 3000));
  const state = pet.P.state;
  pet.act('stand_up');
  assert.strictEqual(pet.P.state, state); assert.strictEqual(pet.P.next, null);
});

test('the hardest landings knock her out, then she gets up, with the art', () => {
  const { w, pet } = onFloorWith({ knocked_out: frames('ko', 1), stand_up: frames('up', 2) });
  fling(w, pet, { x: 400, y: 200 }, { x: 0, y: 44 }, 3);
  assert.ok(w.until(() => pet.P.state === 'knocked_out', 60));
  pet.P.dur = 0; w.run(2);
  assert.strictEqual(pet.P.clip!.pose, 'stand_up');
  const soft = onFloorWith({ knocked_out: frames('ko', 1) });
  fling(soft.w, soft.pet, { x: 400, y: 700 }, { x: 0, y: 28 }, 3);
  assert.ok(soft.w.until(() => soft.pet.P.state === 'dizzy', 60), 'a hard landing, not the hardest');
});

test('a signature move is data in the file: picked with its art, at its weight, with its line', () => {
  const said = (o: Partial<BuddyData>) => { const w = world([SCREEN()], { seed: 3 }), pet = w.add(BUDDY('a', o)); let n = 0, was = ''; for (let i = 0; i < 40000; i++) { w.frame(); if (pet.P.state === 'signature' && was !== 'signature') n++; was = pet.P.state; } return n; };
  assert.strictEqual(said({}), 0);
  const often = said({ poses: { signature: frames('sig', 2) }, signature: { weight: 5 } });
  assert.ok(often > 10, String(often));
  assert.strictEqual(said({ poses: { signature: frames('sig', 2) }, signature: { weight: 0 } }), 0);
  const { pet } = onFloorWith({ signature: frames('sig', 2) }, { signature: { line: 'Ta-da!' } });
  pet.act('signature');
  assert.strictEqual(pet.frame({ x: 0, y: 0, scale: 1 }).bubble.text, 'Ta-da!');
});

test('personality moves come when asked, with the art', () => {
  for (const [name, key] of [['laugh', 'laugh'], ['surprised', 'surprised'], ['excited', 'excited'], ['face_away', 'face_away'], ['stare', 'stare'], ['tap_screen', 'tap_screen']]) {
    const { pet } = onFloorWith({ [key!]: frames('p', 2) });
    rest(pet); pet.act(name!);
    assert.strictEqual(pet.P.state, name);
    const none = onFloorWith({}); rest(none.pet); none.pet.act(name!);
    assert.strictEqual(none.pet.P.state, 'sit', name);
  }
});

test('turning back follows facing away, as an exit clip', () => {
  const { w, pet } = onFloorWith({ face_away: frames('away', 1), turn_back: frames('back', 2) });
  pet.act('face_away'); pet.P.dur = 0;
  assert.ok(w.until(() => pet.P.clip, 5));
  assert.strictEqual(pet.P.clip!.pose, 'turn_back');
});

test('the pace is an option, and lively is what runs by default', () => {
  const w = world([SCREEN()]);
  assert.strictEqual(w.sim.world.pace, lively);
  const sleepy = Object.assign({}, lively, { think: 5000 });
  const sim = createSim({ terrain: w.terrain, pace: sleepy, random: () => .5, now: () => 0, after: () => 0, cancel() {} });
  sim.sync({ pets: [BUDDY('p')] });
  const p = sim.pets.get('p')!; p.go('think');
  assert.strictEqual(p.P.dur, 5000);
});

test('the simulation never reaches for a page', () => {
  const dir = new URL('../src/', import.meta.url);
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(new URL(f, dir), 'utf8');
    assert.doesNotMatch(src, /\b(document|window\.|performance|requestAnimationFrame|setTimeout|Math\.random)\b/, f);
  }
});

test('farewell: a wave and a goodbye on the floor, and only the goodbye anywhere else', () => {
  const w = world([SCREEN()]), pet = w.add();
  assert.ok(w.until(() => pet.P.surf === 'floor' && pet.P.state !== 'land', 2000));
  pet.farewell();
  assert.strictEqual(pet.P.state, 'wave');
  assert.ok(LINES.bye.includes(pet.frame({ x: 0, y: 0, scale: 1 }).bubble.text), 'bye comes after the wave says hello');
  const up = world([SCREEN()]), other = up.add();
  assert.notStrictEqual(other.P.surf, 'floor', 'it starts in the air');
  const before = other.P.state;
  other.farewell();
  assert.strictEqual(other.P.state, before);
  assert.ok(LINES.bye.includes(other.frame({ x: 0, y: 0, scale: 1 }).bubble.text));
});
