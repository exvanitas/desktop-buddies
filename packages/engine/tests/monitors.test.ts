/* The real layout: 3440x1392 at 100% over 1920x1008 at 150%, offset 720 px. */
import assert from 'node:assert';
import { test } from 'vitest';
import { lively, type Pet } from '../src/index';
import { BUDDY, DESK, screen, world, type TestWorld } from './support';

const rest = (pet: Pet, state: Parameters<Pet['go']>[0] = 'sit') => { pet.go(state); pet.P.dur = 1e9; pet.P.chatT = 1e9; };
const onFloor = (pet: Pet) => pet.P.surf === 'floor' && pet.P.state !== 'land';
function dropAt(w: TestWorld, pet: Pet, x: number, y: number) {
  w.sim.input.down(pet.id, pet.P.x, pet.P.y); w.sim.input.move(pet.id, x, y); w.frame();
  w.run(10); w.sim.input.up(pet.id);
}
function fling(w: TestWorld, pet: Pet, from: { x: number; y: number }, v: { x: number; y: number }, n = 5) {
  w.sim.input.down(pet.id, pet.P.x, pet.P.y); w.sim.input.move(pet.id, from.x, from.y); w.frame();
  let { x, y } = from;
  for (let i = 0; i < n; i++) { x += v.x; y += v.y; w.sim.input.move(pet.id, x, y); w.frame(); }
  w.sim.input.up(pet.id);
}
function onLow(w: TestWorld) {
  const pet = w.add(BUDDY()); w.until(() => onFloor(pet));
  dropAt(w, pet, 1500, 2000); assert.ok(w.until(() => onFloor(pet), 400));
  assert.strictEqual(pet.P.on!.surface.owner, 'low');
  rest(pet);
  return pet;
}

test('a new buddy arrives at the top of the primary monitor and lands on its floor', () => {
  const w = world(DESK()), pet = w.add(BUDDY());
  assert.ok(pet.P.x >= 860 && pet.P.x <= 2580); assert.ok(pet.P.y < 0);
  assert.ok(w.until(() => onFloor(pet), 300));
  assert.strictEqual(pet.P.on!.surface.owner, 'top'); assert.strictEqual(pet.P.y, 1392);
});

test('with the primary below another monitor, it still lands on the primary', () => {
  const w = world([screen('up', 0, -1080, 1920, 1032), screen('main', 0, 0, 1920, 1032)], { seed: 3 }), pet = w.add(BUDDY());
  assert.ok(w.until(() => onFloor(pet), 300));
  assert.strictEqual(pet.P.on!.surface.owner, 'main');
});

test('sizes, speeds and gravity scale with the screen a buddy is on', () => {
  const w = world(DESK()), pet = onLow(w);
  w.frame();
  assert.strictEqual(pet.P.k, 1.5);
  assert.ok(Math.abs(pet.bw() - .6 * 120 * 1.5) < 1e-9);
  const a = pet.P.on!.t; pet.P.dir = 1; pet.go('walk', { dir: 1 }); pet.P.dur = 1e9; w.frame();
  const low = pet.P.on!.t - a;
  const u = world(DESK()), top = u.add(BUDDY()); u.until(() => onFloor(top)); u.frame();
  assert.strictEqual(top.P.k, 1);
  const b = top.P.on!.t; top.P.sp = pet.P.sp; top.go('walk', { dir: 1 }); top.P.dur = 1e9; u.frame();
  assert.ok(Math.abs(low / (top.P.on!.t - b) - 1.5) < .01, 'walks 1.5 times as far per frame');
});

test('grip limits scale too', () => {
  const w = world([screen('s', 0, 0, 3000, 1500, 2), { id: 'w', kind: 'window', rect: { x: 500, y: 800, w: 900, h: 200 }, z: 1, terrain: true, scale: 1 }]);
  const pet = w.add(BUDDY()); w.until(() => onFloor(pet));
  dropAt(w, pet, 800, 300); assert.ok(w.until(() => onFloor(pet), 400)); rest(pet);
  const dx = 80 * 16.667 / 40 * 1.5;
  w.sim.setRects([screen('s', 0, 0, 3000, 1500, 2), { id: 'w', kind: 'window', rect: { x: 500 + dx, y: 800, w: 900, h: 200 }, z: 1, terrain: true, scale: 1 }]); w.frame();
  assert.strictEqual(pet.P.state, 'sit', 'over the 100% limit, under the 200% one');
});

test('every overlay draws a buddy at the same apparent size', () => {
  const w = world(DESK()), pet = onLow(w);
  w.frame();
  const top = pet.frame({ x: 0, y: 0, scale: 1, w: 3440, h: 1392 }), low = pet.frame({ x: 720, y: 1440, scale: 1.5, w: 1280, h: 672 });
  assert.strictEqual(top.size, low.size); assert.strictEqual(low.size, '120px');
  assert.strictEqual(top.off, true); assert.strictEqual(low.off, false);
  const [x = 0, y = 0] = low.tf!.match(/-?[\d.]+/g)!.map(Number);
  assert.ok(x > 0 && x < 1280 && y > 0 && y < 672, low.tf!);
});

test('climbing: up a wall of the low monitor and round onto its own ceiling', () => {
  let done = false;
  for (let seed = 1; seed < 9 && !done; seed++) {
    const w = world(DESK(), { seed }), pet = onLow(w);
    pet.act('climbGo');
    assert.ok(w.until(() => pet.P.state === 'climb', 2000), 'reached a wall');
    assert.strictEqual(pet.P.on!.surface.owner, 'low');
    done = w.until(() => {
      if (pet.P.state === 'wall') pet.go('climb', { dir: -1 });
      if (pet.P.state === 'climb') { pet.P.dur = 1e9; pet.P.dir = -1; }
      return pet.P.surf === 'ceil' || pet.P.state === 'air';
    }, 6000) && pet.P.surf === 'ceil';
    if (done) assert.strictEqual(pet.P.on!.surface.owner, 'low');
  }
  assert.ok(done, 'a climb reached the ceiling');
});

for (const [name, start, owner] of <[string, { x: number; y: number }, string][]>[['top', { x: 3300, y: 400 }, 'top'], ['low', { x: 2500, y: 1620 }, 'low']]) {
  test(`crawling: the ${name} monitor's ceiling, then down its wall`, () => {
    let saw = false;
    for (let seed = 1; seed < 9 && !saw; seed++) {
      const w = world(DESK(), { seed }), pet = w.add(BUDDY());
      w.until(() => onFloor(pet));
      fling(w, pet, start, { x: 0, y: -22 }, 3);
      assert.ok(w.until(() => pet.P.surf === 'ceil', 100), 'grabbed the ceiling');
      assert.strictEqual(pet.P.on!.surface.owner, owner);
      pet.go('crawl', { dir: 1 }); pet.P.dur = 1e9;
      saw = w.until(() => pet.P.state === 'climb' || pet.P.state === 'air', 800) && pet.P.state === 'climb';
      if (saw) assert.strictEqual(pet.P.on!.surface.owner, owner);
    }
    assert.ok(saw);
  });
}

test('a jump for the ceiling on the low monitor reaches the low monitor\'s ceiling', () => {
  const w = world(DESK()), pet = onLow(w);
  pet.act('ceilGo');
  assert.ok(w.until(() => pet.P.surf === 'ceil', 300));
  assert.strictEqual(pet.P.on!.surface.at, 1440);
});

test('a soft throw stays on its monitor: a floor holds, a ceiling holds', () => {
  const w = world(DESK()), pet = w.add(BUDDY()); w.until(() => onFloor(pet));
  fling(w, pet, { x: 1500, y: 800 }, { x: 0, y: 15 }, 4);
  assert.ok(w.until(() => pet.P.on, 200)); assert.strictEqual(pet.P.on!.surface.owner, 'top');
  const u = world(DESK()), low = onLow(u);
  fling(u, low, { x: 1500, y: 2000 }, { x: 0, y: -18 }, 3);
  assert.ok(u.until(() => low.P.on, 200)); assert.strictEqual(low.P.on!.surface.owner, 'low');
});

test('a hard throw down breaks through the top monitor\'s floor, onto the low one', () => {
  const w = world(DESK()), pet = w.add(BUDDY()); w.until(() => onFloor(pet));
  fling(w, pet, { x: 1500, y: 800 }, { x: 0, y: 30 }, 4);
  assert.ok(w.until(() => pet.P.y > 1500, 60), 'through');
  assert.ok(w.until(() => pet.P.on, 300));
  assert.strictEqual(pet.P.on!.surface.owner, 'low');
  assert.strictEqual(pet.P.on!.surface.kind, 'floor');
});

test('a hard throw up breaks through the low monitor\'s ceiling, into the top one', () => {
  const w = world(DESK()), pet = onLow(w);
  fling(w, pet, { x: 1500, y: 2100 }, { x: 0, y: -60 }, 4);
  assert.ok(w.until(() => pet.P.y < 1300, 120), 'through');
  w.frame();
  assert.strictEqual(pet.P.k, 1, 'and took on the top monitor\'s scale');
  assert.ok(w.until(() => pet.P.on, 900));
  assert.strictEqual(pet.P.on!.surface.owner, 'top');
});

test('a hard throw breaks through one, not two', () => {
  /* three monitors stacked: one throw gets from the top to the middle and stops there */
  const w = world([screen('a', 0, 0, 1000, 700), screen('b', 0, 700, 1000, 300), screen('c', 0, 1000, 1000, 700)], { seed: 2 }), pet = w.add(BUDDY());
  w.until(() => onFloor(pet));
  fling(w, pet, { x: 500, y: 200 }, { x: 0, y: 40 }, 3);
  assert.ok(w.until(() => pet.P.on, 200));
  assert.strictEqual(pet.P.on!.surface.owner, 'b');
});

test('a hard throw where nothing is stacked below is an ordinary hard landing', () => {
  const w = world(DESK()), pet = w.add(BUDDY()); w.until(() => onFloor(pet));
  fling(w, pet, { x: 300, y: 800 }, { x: 0, y: 30 }, 4);
  assert.ok(w.until(() => pet.P.on, 100));
  assert.strictEqual(pet.P.on!.surface.owner, 'top'); assert.strictEqual(pet.P.state, 'dizzy');
});

test('the break threshold scales with the buddy', () => {
  const w = world(DESK()), pet = onLow(w);
  fling(w, pet, { x: 1500, y: 2100 }, { x: 0, y: -30 }, 4); /* hard at 100%, not at 150% */
  assert.ok(w.until(() => pet.P.on, 200));
  assert.strictEqual(pet.P.on!.surface.owner, 'low');
});

test('the trip down: through the floor, onto the low monitor, only where it is below', () => {
  const w = world(DESK()), pet = w.add(BUDDY()); w.until(() => onFloor(pet));
  rest(pet); pet.act('dropThrough');
  assert.strictEqual(pet.P.state, 'air');
  assert.ok(w.until(() => pet.P.on, 200));
  assert.strictEqual(pet.P.on!.surface.owner, 'low'); assert.strictEqual(pet.P.y, 2448);
  const u = world(DESK()), far = u.add(BUDDY()); u.until(() => onFloor(far));
  dropAt(u, far, 300, 800); u.until(() => onFloor(far), 300); rest(far);
  far.act('dropThrough');
  assert.strictEqual(far.P.state, 'sit', 'nothing below the ledge side');
});

test('the trip up: through the ceiling, landing on the top monitor\'s floor', () => {
  const w = world(DESK()), pet = onLow(w);
  pet.act('jumpThrough');
  assert.strictEqual(pet.P.state, 'air');
  assert.ok(w.until(() => pet.P.on, 400));
  assert.strictEqual(pet.P.on!.surface.owner, 'top'); assert.strictEqual(pet.P.y, 1392);
  pet.act('jumpThrough');
  assert.strictEqual(pet.P.surf, 'floor', 'nothing stacked above the top monitor');
});

test('on one rectangle the trips do not exist', () => {
  const w = world([screen('s', 0, 0, 1600, 900)]), pet = w.add(BUDDY()); w.until(() => onFloor(pet));
  rest(pet); pet.act('dropThrough'); pet.act('jumpThrough');
  assert.strictEqual(pet.P.state, 'sit');
});

test('with no weight in the pace, the trips are never chosen', () => {
  const pace = { ...lively, weights: { ...lively.weights, travelDown: 0, travelUp: 0 } };
  const w = world(DESK(), { seed: 4, pace }), pet = w.add(BUDDY());
  w.run(40000);
  assert.ok(pet.P.y <= 1392);
});

test('thrown about at random, it always ends up on something', () => {
  const w = world(DESK(), { seed: 9 }), pet = w.add(BUDDY()), r = Math;
  let n = 12345; const rnd = () => (n = (n * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 300; i++) {
    const a = rnd() * r.PI * 2, sp = rnd() * 70;
    fling(w, pet, { x: rnd() * 3440, y: rnd() * 2448 }, { x: r.cos(a) * sp, y: r.sin(a) * sp }, 3);
    assert.ok(w.until(() => pet.P.on, 900), `throw ${i} landed: ${pet.P.x},${pet.P.y} ${pet.P.state}`);
    assert.ok(w.terrain.rectById(pet.P.on!.surface.owner));
  }
});

test('side by side at the same height, a walker crosses the seam', () => {
  const w = world([screen('a', 0, 0, 1000, 800, 1), screen('b', 1000, 0, 1000, 800, 1.25)]), pet = w.add(BUDDY());
  w.until(() => onFloor(pet));
  dropAt(w, pet, 900, 500); w.until(() => onFloor(pet), 300);
  pet.go('walk', { dir: 1 }); pet.P.dur = 1e9;
  assert.ok(w.until(() => pet.P.on!.surface.owner === 'b', 600));
  assert.strictEqual(pet.P.state, 'walk'); assert.ok(Math.abs(pet.P.x - 1000) < 10, 'no jump at the seam');
  w.frame(); assert.strictEqual(pet.P.k, 1.25);
});

test('crossing a side seam low down: the far monitor\'s floor does not stretch to catch it', () => {
  const w = world([screen('a', 0, 0, 1000, 800), screen('b', 1000, 0, 1000, 400)]), pet = w.add(BUDDY());
  w.until(() => onFloor(pet));
  pet.go('air'); Object.assign(pet.P, { x: 1020, y: 390, vx: -25, vy: 10, home: 'b', bound: null });
  w.frame();
  assert.strictEqual(pet.P.on, null, 'still falling');
  assert.ok(w.until(() => pet.P.on, 200));
  assert.strictEqual(pet.P.on!.surface.owner, 'a'); assert.strictEqual(pet.P.y, 800);
});

test('let go in a dead zone: back above the nearest screen, and it falls', () => {
  const w = world(DESK()), pet = w.add(BUDDY()); w.until(() => onFloor(pet));
  dropAt(w, pet, 200, 2100);
  w.frame();
  assert.strictEqual(pet.P.state, 'air');
  assert.ok(pet.P.y <= 1440, `brought back up, y ${pet.P.y}`);
  assert.ok(w.until(() => onFloor(pet), 600));
  assert.strictEqual(pet.P.on!.surface.owner, 'low', 'the nearest screen, not the floor over it');
});

test('its monitor vanishes under it: back above the one left, and it falls', () => {
  const w = world(DESK()), pet = onLow(w);
  w.sim.setRects([DESK()[0]]); w.frame();
  assert.strictEqual(pet.P.state, 'air'); assert.strictEqual(pet.P.on, null);
  assert.ok(pet.P.y < 0, 'above the top monitor'); assert.strictEqual(pet.P.k, 1);
  assert.ok(w.until(() => onFloor(pet), 400));
  assert.strictEqual(pet.P.y, 1392); assert.strictEqual(pet.P.on!.surface.from, 0); assert.strictEqual(pet.P.on!.surface.to, 3440);
});

test('its monitor vanishes while it flies, or hangs, or is held', () => {
  for (const place of ['air', 'wall', 'held']) {
    const w = world(DESK()), pet = onLow(w);
    if (place === 'air') pet.act('jump');
    if (place === 'wall') { pet.act('climbGo'); w.until(() => pet.P.state === 'climb', 2000); }
    if (place === 'held') { w.sim.input.down('a', pet.P.x, pet.P.y); w.sim.input.move('a', 1500, 2000); w.run(5); }
    w.sim.setRects([DESK()[0]]); w.run(3);
    if (place === 'held') { assert.strictEqual(pet.P.state, 'held'); w.sim.input.up('a'); }
    assert.ok(w.until(() => onFloor(pet), 1200), place);
    assert.strictEqual(pet.P.y, 1392);
  }
});

test('the top monitor vanishes: the low one becomes the world, ledge buddies and all', () => {
  const w = world(DESK()), pet = w.add(BUDDY()); w.until(() => onFloor(pet));
  rest(pet);
  w.sim.setRects([DESK()[1]]); w.run(2);
  assert.ok(w.until(() => onFloor(pet), 800));
  assert.strictEqual(pet.P.y, 2448); assert.strictEqual(pet.P.k, 1.5);
});

test('a monitor plugged back in', () => {
  const w = world(DESK()), pet = onLow(w);
  w.sim.setRects([DESK()[0]]); w.run(300);
  w.sim.setRects(DESK()); w.run(1000);
  assert.ok(pet.P.y <= 2448);
});

test('act("drop") comes down from the top of the monitor it is on', () => {
  const w = world(DESK()), pet = onLow(w);
  pet.act('drop');
  assert.ok(pet.P.y < 1440 && pet.P.y > 1300, `y ${pet.P.y}`);
  assert.ok(pet.P.x >= 720 && pet.P.x <= 2640);
  assert.ok(w.until(() => onFloor(pet), 300));
  assert.strictEqual(pet.P.on!.surface.owner, 'low');
});

test('bubbles and tags stay on the buddy\'s own screen', () => {
  const w = world(DESK()), pet = onLow(w);
  pet.say('Hello there'); pet.act('climbGo'); w.until(() => pet.P.state === 'climb', 2000);
  pet.say('Hello there'); rest(pet, 'wall'); w.frame();
  const f = pet.frame({ x: 720, y: 1440, scale: 1.5 });
  const [x = 0] = f.bubble.tf!.match(/-?[\d.]+/g)!.map(Number);
  assert.ok(x >= 70 && x <= 1280 - 70, f.bubble.tf!);
  const [tx = 0, ty = 0] = f.tag.tf!.match(/-?[\d.]+/g)!.map(Number);
  assert.ok(tx >= 40 && tx <= 1240 && ty <= 672 - 19, f.tag.tf!);
});

test('a burst of particles shows only where it can be seen', () => {
  const w = world(DESK()), pet = onLow(w);
  w.frame(); w.sim.poof('a'); w.frame();
  assert.strictEqual(w.sim.frame({ x: 720, y: 1440, scale: 1.5, w: 1280, h: 672 }).fx.length, 10);
  assert.strictEqual(w.sim.frame({ x: 0, y: 0, scale: 1, w: 3440, h: 1392 }).fx.length, 0);
});

for (const seed of [1, 2, 3, 4, 5, 6]) {
  test(`a long run across both monitors stays in the world, seed ${seed}`, () => {
    const w = world(DESK(), { seed }), a = w.add(BUDDY('a')), b = w.add(BUDDY('b'));
    const seen = new Set<string>();
    let trips = 0, last: string | null = null;
    for (let i = 0; i < 60000; i++) {
      w.frame();
      if (a.P.on && a.P.on.surface.owner !== last) { if (last) trips++; last = a.P.on.surface.owner; }
      for (const p of [a, b]) {
        const P = p.P;
        assert.ok(Number.isFinite(P.x) && Number.isFinite(P.y), 'position is a number');
        assert.ok(P.x >= -5 && P.x <= 3445 && P.y >= -700 && P.y <= 2460, `in the world at frame ${i}: ${P.x},${P.y} ${P.state}`);
        if (P.on) { const s = P.on.surface; assert.ok(w.terrain.surfaceById(s.id)); seen.add(s.owner + ':' + s.kind); }
      }
    }
    assert.ok(seen.has('top:floor'), `spent time on the top monitor: ${[...seen]}`);
    assert.ok(trips < 60, `an occasional trip, not a commute: ${trips}`);
  });
}
