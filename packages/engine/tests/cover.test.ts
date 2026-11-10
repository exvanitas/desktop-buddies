/* A window in front of where she holds on. Her body is the box a jump works out: over a top, under a
   ceiling, beside a wall. Anything in front of her window reaching into it covers her, and she lets
   go. A covered stretch is no surface for as long as it is covered: she won't walk, climb or crawl
   into it, land on it or grab it. A tester's report on preview 5: she stayed on a side with a window
   in front of her. */
import assert from 'node:assert';
import { test } from 'vitest';
import type { Rectangle } from '@buddies/terrain';
import type { Pet } from '../src/index';
import { BUDDY, DESK, screen, windowRect, world, type TestWorld } from './support';

const SCREEN = () => screen('s', 0, 0, 1600, 900);
/* her window: left side at x 600, right at 1000, top at y 300, bottom at 700 */
const A = (z = 1) => windowRect('a', 600, 300, 400, 400, z);
const desk = (...more: Rectangle[]) => [SCREEN(), A(), ...more];
const over = (id: string, x: number, y: number, w: number, h: number, z = 2) => windowRect(id, x, y, w, h, z);
const STATE = { floor: 'sit', wall: 'wall', ceil: 'hang' } as const;
const where = (pet: Pet) => pet.P.on ? `${pet.P.on.surface.owner}:${pet.P.on.surface.kind}` : 'air';

/* Puts her on a surface at t, still. The buddy is 72 wide and 120 tall: at t 200 on a's left side
   her body is x 528 to 600, y 440 to 560. */
function put(w: TestWorld, id: string, t: number, pet = w.add(BUDDY())) {
  const s = w.terrain.surfaceById(id)!, p = w.terrain.pointOn(s, t);
  Object.assign(pet.P, { on: { surface: s, t }, x: p.x, y: p.y, vx: 0, vy: 0 });
  pet.go(STATE[s.kind]); pet.P.dur = 1e9; pet.P.chatT = 1e9;
  w.frame(); w.frame();
  assert.strictEqual(pet.P.on?.surface.id, id, 'placed');
  return pet;
}
/* The world changes, and she's given a frame to notice. */
const change = (w: TestWorld, rects: Rectangle[]) => { w.sim.setRects(rects); w.frame(); };
const fell = (pet: Pet) => pet.P.on === null && pet.P.state === 'air';

for (const [name, id, t, cover, falls] of <[string, string, number, Rectangle, boolean][]>[
  ['the left side, over her hands but not her middle', 'a:left:0', 200, over('b', 500, 380, 300, 80), true],
  ['the left side, over her feet but not her middle', 'a:left:0', 200, over('b', 500, 545, 300, 100), true],
  ['the left side, over her middle', 'a:left:0', 200, over('b', 500, 450, 300, 100), true],
  ['the left side, beside it and into her, not over the side', 'a:left:0', 200, over('b', 400, 450, 199, 100), true],
  ['the right side, over her hands', 'a:right:0', 200, over('b', 950, 380, 300, 80), true],
  ['the right side, beside it and into her', 'a:right:0', 200, over('b', 1001, 450, 199, 100), true],
  ['the left side above her, short of her hands', 'a:left:0', 200, over('b', 500, 300, 300, 130), false],
  ['the left side below her, short of her feet', 'a:left:0', 200, over('b', 500, 570, 300, 130), false],
  ['beside the left side, short of her back', 'a:left:0', 200, over('b', 300, 450, 220, 100), false],
  ['the left side, touching her hands and no more', 'a:left:0', 200, over('b', 500, 340, 300, 100), false],
  ['a top, over her head but not the top', 'a:top:0', 200, over('b', 700, 100, 200, 150), true],
  ['a top, over her feet', 'a:top:0', 200, over('b', 700, 250, 200, 100), true],
  ['a top, the top beside her', 'a:top:0', 200, over('b', 900, 200, 300, 300), false],
  ['a top, above her head', 'a:top:0', 200, over('b', 700, 50, 200, 120), false],
  ['a ceiling, into her but not the ceiling', 'a:bottom:0', 200, over('b', 700, 760, 200, 100), true],
  ['a ceiling, over it where she hangs', 'a:bottom:0', 200, over('b', 700, 650, 200, 100), true],
  ['a ceiling, beside her', 'a:bottom:0', 200, over('b', 900, 650, 300, 200), false],
  ['the left side, by something you cannot stand on', 'a:left:0', 200, windowRect('max', 0, 0, 1600, 900, 2, { terrain: false }), true]
]) {
  test(`a window opened in front of ${name}: ${falls ? 'she lets go' : 'she stays'}`, () => {
    const w = world(desk()), pet = put(w, id, t);
    change(w, desk(cover));
    assert.strictEqual(fell(pet), falls, `${where(pet)} as ${pet.P.state}`);
    if (!falls) { w.run(30); assert.strictEqual(pet.P.on?.surface.id, id, 'and goes on staying'); }
  });
}

test('a window behind hers, over the same place, changes nothing', () => {
  const w = world([SCREEN(), A(2)]), pet = put(w, 'a:left:0', 200);
  change(w, [SCREEN(), A(2), over('b', 500, 380, 300, 80, 1)]);
  w.run(30);
  assert.strictEqual(pet.P.on?.surface.id, 'a:left:0');
});

test('raised in front: the same window, behind and then on top', () => {
  const behind = over('b', 500, 380, 300, 80, 1);
  const w = world([SCREEN(), A(2), behind]), pet = put(w, 'a:left:0', 200);
  change(w, [SCREEN(), A(2), { ...behind, z: 3 }]);
  assert.ok(fell(pet));
});

test('moved in front: a window in front of hers dragged over her', () => {
  const w = world(desk(over('b', 100, 100, 300, 80))), pet = put(w, 'a:left:0', 200);
  change(w, desk(over('b', 500, 380, 300, 80)));
  assert.ok(fell(pet));
});

test('the cover goes again, minimized or closed: the side holds her once more', () => {
  const w = world(desk()), pet = put(w, 'a:left:0', 200);
  change(w, desk(over('b', 500, 380, 300, 80)));
  assert.ok(fell(pet));
  change(w, desk());
  put(w, 'a:left:0', 200, pet);
  w.run(30);
  assert.strictEqual(pet.P.on?.surface.id, 'a:left:0');
});

test('held, she stays held; in the air, she falls as she was', () => {
  const w = world(desk()), pet = put(w, 'a:left:0', 200);
  w.sim.input.down(pet.id, pet.P.x, pet.P.y); w.sim.input.move(pet.id, 560, 500); w.frame();
  assert.strictEqual(pet.P.state, 'held');
  change(w, desk(over('b', 500, 380, 300, 80)));
  w.run(10);
  assert.strictEqual(pet.P.state, 'held');
  w.sim.input.up(pet.id); w.frame();
  assert.strictEqual(pet.P.state, 'air');
  const vy = pet.P.vy;
  change(w, desk());
  assert.ok(pet.P.state === 'air' && pet.P.vy > vy, 'still falling');
});

test('walking on a top toward a covered stretch, she turns back at it, all of her clear of it', () => {
  const w = world(desk(over('b', 900, 200, 300, 300))), pet = put(w, 'a:top:0', 100);
  pet.go('walk', { dir: 1 }); pet.P.dur = 1e9;
  let turned = -1;
  for (let i = 0; i < 600 && (turned < 0 || i < turned + 20); i++) {
    w.frame();
    assert.strictEqual(where(pet), 'a:floor', `frame ${i}`);
    assert.ok(pet.P.x + pet.bw() / 2 <= 900, `clear of it: ${pet.P.x}`);
    if (pet.P.dir === -1 && turned < 0) turned = i;
  }
  assert.ok(turned >= 0, 'turned back');
});

test('climbing a side up into a window in front, she turns back at it', () => {
  const w = world(desk(over('b', 500, 300, 300, 130))), pet = put(w, 'a:left:0', 200);
  pet.go('climb', { dir: -1 }); pet.P.dur = 1e9;
  let turned = -1;
  for (let i = 0; i < 600 && (turned < 0 || i < turned + 20); i++) {
    w.frame();
    assert.strictEqual(where(pet), 'a:wall', `frame ${i}`);
    assert.ok(pet.P.y - 60 >= 430, `clear of it: ${pet.P.y}`);
    if (pet.P.dir === 1 && turned < 0) turned = i;
  }
  assert.ok(turned >= 0, 'turned back');
});

test('crawling under a window toward a covered stretch, she turns back at it', () => {
  const w = world(desk(over('b', 900, 650, 300, 300))), pet = put(w, 'a:bottom:0', 100);
  pet.go('crawl', { dir: 1 }); pet.P.dur = 1e9;
  let turned = -1;
  for (let i = 0; i < 600 && (turned < 0 || i < turned + 20); i++) {
    w.frame();
    assert.strictEqual(where(pet), 'a:ceil', `frame ${i}`);
    assert.ok(pet.P.x + pet.bw() / 2 <= 900, `clear of it: ${pet.P.x}`);
    if (pet.P.dir === -1 && turned < 0) turned = i;
  }
  assert.ok(turned >= 0, 'turned back');
});

/* Drops her from just above a's top at x 800, and says where she ends up. */
function dropOnto(w: TestWorld, pet = w.add(BUDDY())) {
  pet.go('air'); Object.assign(pet.P, { on: null, x: 800, y: 280, vx: 0, vy: 0, thrown: false, hard: false, bound: null, aim: null });
  assert.ok(w.until(() => pet.P.on && pet.P.state !== 'air', 400), 'came down');
  pet.go('sit'); pet.P.dur = 1e9; pet.P.chatT = 1e9;
  w.run(5);
  return pet;
}

test('a covered top is no floor to land on, until the window over it goes', () => {
  /* over her head where she'd stand, not over the top itself */
  const w = world(desk(over('b', 700, 100, 200, 150))), pet = dropOnto(w);
  assert.strictEqual(where(pet), 's:floor', 'fell past it to the screen');
  change(w, desk());
  dropOnto(w, pet);
  assert.strictEqual(where(pet), 'a:floor');
});

test('several monitors: her body is the size she is on that monitor', () => {
  /* a's left side on the owner's lower monitor at 150%: there her body reaches 108 out from it */
  const a = windowRect('a', 1200, 1700, 600, 500, 1);
  for (const [x, falls] of <[number, boolean][]>[[1000 + 110, true], [1000 + 90, false]]) {
    const w = world([...DESK(), a]), pet = put(w, 'a:left:0', 250);
    assert.strictEqual(pet.P.k, 1.5);
    change(w, [...DESK(), a, over('b', 1000, 1900, x - 1000, 100)]);
    assert.strictEqual(fell(pet), falls, `a cover reaching to ${x}`);
  }
});

test('walking to a spot to jump from, past a covered stretch: she turns back at it and gives the spot up', () => {
  const w = world([SCREEN(), windowRect('a', 200, 500, 1200, 100), over('b', 700, 400, 100, 300)]), pet = put(w, 'a:top:0', 100);
  pet.go('hopWalk'); pet.P.spot = { owner: 'far', t: 1000 }; pet.P.dur = 1e9;
  assert.ok(w.until(() => pet.P.state !== 'hopWalk' || pet.P.x + pet.bw() / 2 > 700, 1000), 'gave up');
  assert.ok(pet.P.x + pet.bw() / 2 <= 700, `short of it: ${pet.P.x}`);
});

/* Moves that would take her behind a covering window, with measured numbers. */
const SEEN = (w: TestWorld, pet: Pet, n: number, each: (i: number) => void) => { for (let i = 0; i < n; i++) { w.frame(); each(i); } };

test('to a wall between two covers: she gives the wall up and does something else', () => {
  const w = world(desk(over('l', 450, 200, 250, 300), over('r', 900, 200, 300, 300))), pet = put(w, 'a:top:0', 200);
  pet.go('climbGo');
  assert.strictEqual(pet.P.state, 'climbGo');
  assert.ok(w.until(() => { assert.strictEqual(where(pet), 'a:floor'); return pet.P.state !== 'climbGo'; }, 600), `gave up: still ${pet.P.state} at ${pet.P.x}`);
});

test('chasing the cursor past a cover: she gives the chase up', () => {
  const w = world(desk(over('b', 900, 200, 300, 300))), pet = put(w, 'a:top:0', 100);
  w.sim.input.pointer(1300, 280);
  pet.go('chase'); pet.P.dur = 1e9;
  assert.ok(w.until(() => pet.P.state !== 'chase', 600), `gave up: still ${pet.P.state} at ${pet.P.x}`);
  assert.strictEqual(where(pet), 'a:floor');
  assert.ok(pet.P.x + pet.bw() / 2 <= 900, `short of it: ${pet.P.x}`);
});

test('climbing up to a corner onto a covered top: she turns back before it', () => {
  /* a random number under every odds, so she always tries the corner */
  const w = world(desk(over('b', 620, 150, 200, 100)), { random: () => .1 }), pet = put(w, 'a:left:0', 63);
  pet.go('climb', { dir: -1 }); pet.P.dur = 1e9;
  let turned = false;
  SEEN(w, pet, 200, i => { assert.strictEqual(where(pet), 'a:wall', `frame ${i}`); if (pet.P.dir === 1) turned = true; });
  assert.ok(turned, 'turned back');
});

test('walking to a wall whose corner is covered: she never goes round onto it', () => {
  const w = world(desk(over('b', 500, 330, 90, 60))), pet = put(w, 'a:top:0', 100);
  pet.go('climbGo');
  assert.ok(w.until(() => { assert.strictEqual(where(pet), 'a:floor', pet.P.state); return pet.P.state !== 'climbGo'; }, 300), 'gave the wall up');
});

test('crawling to corners onto covered sides: she never goes round onto either', () => {
  const w = world(desk(over('l', 500, 600, 90, 80), over('r', 1010, 600, 90, 80)), { random: () => .1 }), pet = put(w, 'a:bottom:0', 100);
  pet.go('crawl', { dir: -1 }); pet.P.dur = 1e9;
  SEEN(w, pet, 600, i => assert.strictEqual(where(pet), 'a:ceil', `frame ${i}`));
});

/* Throws her from feet at x, y, and watches until she's down on something. */
function thrown(w: TestWorld, x: number, y: number, vx: number, vy: number) {
  const pet = w.add(BUDDY());
  pet.go('air'); Object.assign(pet.P, { on: null, x, y, vx, vy, thrown: true, catches: true, hard: false, bound: null, aim: null });
  const held: string[] = [];
  let first: number | null = null;
  SEEN(w, pet, 400, () => { if (pet.P.on) { held.push(pet.P.on.surface.id); first ??= pet.P.on.t; } });
  return { pet, held, first };
}

test('a grab where she would be held behind a window: no grab, though where she met it was clear', () => {
  const w = world(desk(over('b', 400, 320, 150, 150)));
  const { held } = thrown(w, 560, 310, 10, 0);
  /* she bounces off it, and may grab the cover's own side on the way back: it's in front */
  assert.ok(!held.includes('a:left:0'), 'never held on the side');
  assert.ok(held.length > 0, 'and caught by something');
});

test('a ceiling grab where she would be held behind a window: no grab either', () => {
  const w = world(desk(over('b', 645, 710, 150, 150)));
  const { held } = thrown(w, 605, 825, 0, -10);
  assert.ok(!held.includes('a:bottom:0'), 'never held under it');
});

test('a grab where she is held clear of the window: she still grabs', () => {
  const w = world(desk(over('b', 400, 450, 150, 150)));
  const { held } = thrown(w, 560, 310, 10, 0);
  assert.strictEqual(held[0], 'a:left:0');
});

test('round a clear corner she comes out with all of her on the top, and a grab near an end holds all of her on', () => {
  const w = world(desk(), { random: () => .1 }), pet = put(w, 'a:left:0', 63);
  pet.go('climb', { dir: -1 }); pet.P.dur = 1e9;
  assert.ok(w.until(() => where(pet) === 'a:floor', 20), 'went round');
  assert.strictEqual(pet.P.x, 600 + pet.bw() / 2);
  const { held, first } = thrown(world(desk()), 990, 825, 0, -10);
  assert.strictEqual(held[0], 'a:bottom:0');
  assert.strictEqual(first, 400 - 62, 'held all of her on, half her height and a little short of the end');
});

test('carried from a 200% monitor onto a 100% one: she is checked at the size she is there', () => {
  const rects = (x: number) => [screen('l', 0, 0, 800, 900, 2), screen('r', 800, 0, 800, 900, 1), windowRect('a', x, 500, 400, 200), over('b', 870, 400, 150, 100)];
  const w = world(rects(595)), pet = put(w, 'a:top:0', 200);
  assert.strictEqual(pet.P.k, 2);
  change(w, rects(605));
  assert.strictEqual(where(pet), 'a:floor', `carried, not dropped: ${pet.P.state}`);
  assert.strictEqual(pet.P.k, 1);
  assert.strictEqual(pet.P.x, 805);
});

/* Where she ends up is on another monitor, at another scale. Upper
   monitor down to y 400, lower one below it. */
const STACK = (up: number, low: number) => [screen('u', 0, 0, 1600, 400, up), screen('d', 0, 400, 1600, 500, low)];
/* Held on a window, she's the size she is on that spot's monitor, with that monitor as her home, and
   at that size no window in front reaches into her. */
function neverCovered(w: TestWorld, pet: Pet, frame: number) {
  const on = pet.P.on; if (!on || w.terrain.rectById(on.surface.owner)!.kind !== 'window') return;
  const p = w.terrain.pointOn(on.surface, on.t), there = w.terrain.home(p), k = there.scale;
  assert.ok(!w.terrain.behind(on.surface, p, { side: 36 * k, up: 120 * k }), `frame ${frame}: held behind a window at ${p.x},${p.y}`);
  assert.strictEqual(pet.P.k, k, `frame ${frame}: her size there`);
  assert.strictEqual(pet.P.home, there.id, `frame ${frame}: her monitor there`);
}

test('round a corner onto another monitor: a top clear at the size she is there is taken', () => {
  const w = world([...STACK(1, 2), windowRect('a', 600, 350, 400, 400), over('b', 620, 150, 180, 50)], { random: () => .1 }), pet = put(w, 'a:left:0', 126);
  assert.strictEqual(pet.P.k, 2);
  pet.go('climb', { dir: -1 }); pet.P.dur = 1e9;
  assert.ok(w.until(() => where(pet) === 'a:floor', 40), `went round: ${where(pet)} at ${pet.P.x},${pet.P.y}`);
  assert.strictEqual(pet.P.x, 636, 'all of her on it, at her size there');
  assert.strictEqual(pet.P.k, 1);
  neverCovered(w, pet, 0);
});

test('round a corner onto another monitor: a top covered at the size she is there is not', () => {
  const w = world([...STACK(2, 1), windowRect('a', 600, 350, 400, 400), over('b', 680, 200, 100, 50)], { random: () => .1 }), pet = put(w, 'a:left:0', 64);
  assert.strictEqual(pet.P.k, 1);
  pet.go('climb', { dir: -1 }); pet.P.dur = 1e9;
  SEEN(w, pet, 100, i => { assert.strictEqual(where(pet), 'a:wall', `frame ${i}`); neverCovered(w, pet, i); });
});

test('a grab onto another monitor: held only where she is clear at the size she is there', () => {
  const w = world([...STACK(2, 1), windowRect('a', 600, 300, 400, 400), over('b', 500, 250, 50, 50)]), pet = w.add(BUDDY());
  pet.go('air'); Object.assign(pet.P, { on: null, x: 560, y: 450, vx: 10, vy: 0, thrown: true, catches: true, hard: false, bound: null, aim: null });
  SEEN(w, pet, 300, i => neverCovered(w, pet, i));
});

test('up onto a side from a top, round onto another monitor: placed and sized for that monitor at once', () => {
  /* a's top on the upper monitor at 100%, and the side runs down onto the lower one at 200% */
  const w = world([...STACK(1, 2), windowRect('a', 600, 350, 400, 400)]), pet = put(w, 'a:top:0', 100);
  pet.go('climbGo');
  assert.ok(w.until(() => where(pet) === 'a:wall', 200), 'went up');
  neverCovered(w, pet, 0);
  /* 124 down: half of her 240 and 4, all of her on it at 200% */
  assert.strictEqual(pet.P.y, 350 + 124);
});

test('a grab onto another monitor: gripped and sized for the monitor holding the grip', () => {
  /* thrown from the lower monitor at 200%; at 100% her middle is up on the upper one */
  const w = world([...STACK(1, 2), windowRect('a', 600, 200, 400, 500), over('b', 550, 250, 50, 30)]), pet = w.add(BUDDY());
  pet.go('air'); Object.assign(pet.P, { on: null, x: 520, y: 405, vx: 10, vy: 0, thrown: true, catches: true, hard: false, bound: null, aim: null });
  assert.ok(w.until(() => { neverCovered(w, pet, 0); return pet.P.on; }, 50), 'caught');
  assert.strictEqual(pet.P.on!.surface.id, 'a:left:0', 'held, clear of b at her size there');
  assert.ok(pet.P.on!.t > 140, `her middle half her height at 100% above her feet: ${pet.P.on!.t}`);
});

/* Side by side: the left monitor at 100% up to x 750, the right one at 200% beyond it. Stacked ones
   would put a screen floor or ceiling between her and the window. */
const SIDE = () => [screen('l', 0, 0, 750, 900, 1), screen('r', 750, 0, 850, 900, 2)];

test('a ceiling grab onto another monitor, near its end: all of her on it at her size there', () => {
  /* her head meets a's bottom at x 701; the grip in from its end is over the seam */
  const w = world([...SIDE(), windowRect('a', 700, 100, 400, 300)]), pet = w.add(BUDDY());
  pet.go('air'); Object.assign(pet.P, { on: null, x: 701, y: 650, vx: 0, vy: -14, thrown: true, catches: true, hard: false, bound: null, aim: null });
  assert.ok(w.until(() => { neverCovered(w, pet, 0); return pet.P.on; }, 80), 'caught');
  assert.strictEqual(pet.P.on!.surface.id, 'a:bottom:0');
  assert.strictEqual(pet.P.on!.t, 124, 'half her width at 200% and a little in from the end');
});

test('a landing onto another monitor: sized for it, so a window over her head there counts, and a clear top takes her', () => {
  /* from the left monitor onto a's top just over the seam */
  const drop = (more: Rectangle[]) => {
    const w = world([...SIDE(), windowRect('a', 600, 400, 400, 300), ...more]), pet = w.add(BUDDY());
    pet.go('air'); Object.assign(pet.P, { on: null, x: 745, y: 397, vx: 10, vy: 3, thrown: false, hard: false, bound: null, aim: null });
    w.until(() => { neverCovered(w, pet, 0); return pet.P.on; }, 400);
    return where(pet);
  };
  assert.strictEqual(drop([]), 'a:floor');
  /* 200 to 270 over her: clear of a body 120 tall, not of one 240 tall */
  assert.notStrictEqual(drop([over('b', 700, 200, 100, 70)]), 'a:floor');
});

test('a screen floor keeps her on its own monitor, whatever else holds the spot', () => {
  /* the lower monitor listed first, so it is the one a point on the line between them finds */
  const w = world([screen('d', 0, 400, 1600, 500, 2), screen('u', 0, 0, 1600, 400, 1)]), pet = w.add(BUDDY());
  pet.go('air'); Object.assign(pet.P, { on: null, x: 800, y: 390, vx: 0, vy: 1, thrown: false, hard: false, bound: null, aim: null, home: 'u', k: 1 });
  assert.ok(w.until(() => pet.P.on, 50), 'landed');
  assert.strictEqual(pet.P.on!.surface.owner, 'u');
  assert.strictEqual(pet.P.home, 'u'); assert.strictEqual(pet.P.k, 1);
});

test('down a side round onto a ceiling: she hangs there and crawls, as round any clear corner', () => {
  const w = world(desk(), { random: () => .1 }), pet = put(w, 'a:left:0', 300);
  pet.go('climb', { dir: 1 }); pet.P.dur = 1e9;
  assert.ok(w.until(() => where(pet) === 'a:ceil', 200), 'went round');
  assert.strictEqual(pet.P.state, 'crawl');
});
