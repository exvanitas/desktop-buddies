/* Held: how far she leans as she swings, struggling on a hard shake, and Held's side poses being optional. */
import assert from 'node:assert';
import { test } from 'vitest';
import { POSE, canShow, type PoseKey } from '@buddies/buddy-file';
import { BOOK, type BuddyData, type Pet } from '../src/index';
import { BUDDY, screen, world, type TestWorld } from './support';

const BB = { x0: 0, y0: 0, x1: 1, y1: 1 };
const frames = (key: string, n = 1) => ({ fps: 6, frames: Array.from({ length: n }, (_, i) => ({ src: `data:image/png;base64,${key}${i}`, bb: BB })) });
const VP = { x: 0, y: 0, scale: 1 };
const shown = (pet: Pet) => pet.frame(VP).src;
/* the animation's turn: the second rotate in the drawing's transform */
const turn = (pet: Pet) => { const m = /rotate\(-?[\d.]+deg\).*?rotate\((-?[\d.]+)deg\)/.exec(pet.frame(VP).body!); assert.ok(m, pet.frame(VP).body!); return +m[1]!; };

function onFloor(poses: BuddyData['poses'], scale = 1) {
  const w = world([screen('s', 0, 0, 1600, 900, scale)]), pet = w.add(BUDDY('a', { poses }));
  assert.ok(w.until(() => pet.P.surf === 'floor' && pet.P.state !== 'land', 2000));
  return { w, pet };
}
/* picked up and held at a point, with nothing moving */
function hold(w: TestWorld, pet: Pet, x = 600, y = 300) {
  w.sim.input.down(pet.id, pet.P.x, pet.P.y); w.sim.input.move(pet.id, x, y); w.sim.input.move(pet.id, x, y); w.frame();
  assert.strictEqual(pet.P.state, 'held');
}

/* ---------- 1. the swing doesn't jump as the pose crosses plus or minus 10 ---------- */

const HELD = { none: {}, drawn: { drag: frames('held') } };
const SIDES = {
  none: {},
  'one frame each': { dragL: frames('left'), dragR: frames('right') },
  'two frames each': { dragL: frames('left', 2), dragR: frames('right', 2) },
  'left only': { dragL: frames('left') }
};

for (const [held, h] of Object.entries(HELD)) for (const [sides, s] of Object.entries(SIDES)) {
  test(`Held ${held}, side poses ${sides}: the lean follows the swing, never the pose`, () => {
    const { w, pet } = onFloor({ ...h, ...s });
    hold(w, pet);
    const seen = new Set<string>(), sweep: number[] = [];
    for (let v = -20; v <= 20; v += .25) sweep.push(v);
    let last: { swing: number; rot: number } | null = null, worst = 0;
    for (const v of [...sweep, ...sweep.reverse()]) {
      pet.P.swing = v; pet.P.swv = 0; w.frame();
      const now = { swing: pet.P.swing, rot: turn(pet) };
      seen.add(shown(pet)!);
      /* a quarter when any of her held art is drawn, else whole */
      const k = held === 'drawn' || sides !== 'none' ? .25 : 1;
      assert.ok(Math.abs(now.rot - k * now.swing) <= .051, `at swing ${now.swing.toFixed(2)}: turned ${now.rot}, want ${(k * now.swing).toFixed(2)}`);
      if (last) worst = Math.max(worst, Math.abs(now.rot - last.rot) - Math.abs(now.swing - last.swing));
      last = now;
    }
    assert.ok(worst <= .11, `the turn stepped ${worst.toFixed(2)} degrees more than the swing moved`);
    assert.ok(Math.min(...sweep) < -10 / .92 && Math.max(...sweep) > 10 / .92, 'the sweep crosses both thresholds');
    if (sides !== 'none') assert.ok(seen.size > 1, 'and the pose did change on the way');
  });
}

/* ---------- 4. a hard shake ---------- */

/* Back and forth `legs` times, `amp` px a stroke at `step` px a frame, from x. Returns whether a
   struggle started on the way. `rest` frames of stillness at each end. */
function shake(w: TestWorld, pet: Pet, amp: number, step: number, legs: number, rest = 0, x = 600, y = 300) {
  let started = false, dir = 1, at = x;
  for (let l = 0; l < legs; l++) {
    for (let d = 0; d < amp; d += step) { at += dir * step; w.sim.input.move(pet.id, at, y); w.frame(); started ||= pet.P.clip?.pose === 'struggle'; }
    w.run(rest); started ||= pet.P.clip?.pose === 'struggle';
    dir = -dir;
  }
  return started;
}
const KICK = { struggle: frames('kick', 2) };

test('shaken hard, with the art, she struggles and breaks free, well before ten still seconds', () => {
  const { w, pet } = onFloor(KICK);
  hold(w, pet);
  assert.ok(shake(w, pet, 80, 20, 8), 'eight quick strokes of 80 px start a struggle');
  assert.ok(w.until(() => pet.P.state !== 'held', 60), 'and she got away');
  assert.deepStrictEqual([pet.P.state, pet.P.vx, pet.P.thrown], ['air', 0, false], 'dropped, nothing thrown');
});

test('four quick turns are enough, three are not: a turn counts once the stroke after it is done', () => {
  const four = onFloor(KICK); hold(four.w, four.pet);
  assert.ok(shake(four.w, four.pet, 60, 15, 6), 'six strokes: five done, four turns between them');
  const three = onFloor(KICK); hold(three.w, three.pet);
  assert.ok(!shake(three.w, three.pet, 60, 15, 5), 'five strokes: four done, three turns');
  three.w.run(30);
  assert.strictEqual(three.pet.P.clip, null);
});

test('a steady drag, a slow wiggle, a small jitter or turns spread out never start one', () => {
  for (const [what, amp, step, legs, rest] of [
    ['a steady drag across the screen and back', 600, 10, 3, 0],
    ['a wiggle under the speed', 60, 4, 10, 0],
    ['jitter too small to count', 30, 10, 30, 0],
    ['fast strokes with pauses: a stroke counts from the last move before it', 80, 20, 8, 18],
    ['long fast sweeps, turns 450 ms apart: four take more than the window', 540, 20, 6, 0]
  ] as const) {
    const { w, pet } = onFloor(KICK); hold(w, pet, 300);
    assert.ok(!shake(w, pet, amp, step, legs, rest, 300), what);
  }
});

/* the hand through these points, a frame each; whether a struggle started */
function along(w: TestWorld, pet: Pet, points: { x: number; y: number }[]) {
  let started = false;
  for (const p of points) { w.sim.input.move(pet.id, p.x, p.y); w.frame(); started ||= pet.P.clip?.pose === 'struggle'; }
  return started;
}

/* The hand from (600, 300) by these moves, a frame each: `n` frames of each [x, y] in turn, round and round for `strokes` strokes. */
function moves(strokes: number, n: number, ...ways: [number, number][]) {
  const out: { x: number; y: number }[] = [];
  let x = 600, y = 300;
  for (let s = 0; s < strokes; s++) for (let i = 0; i < n; i++) { const [dx, dy] = ways[s % ways.length]!; x += dx; y += dy; out.push({ x, y }); }
  return out;
}
/* 80 px strokes at 20 px a frame, back and forth along a line `deg` degrees from level */
const along80 = (deg: number) => { const c = 20 * Math.cos(deg * Math.PI / 180), s = 20 * Math.sin(deg * Math.PI / 180); return moves(10, 4, [c, s], [-c, -s]); };

test('a shake counts in any direction: level, upright, and at 30, 45 and 60 degrees', () => {
  for (const deg of [0, 30, 45, 60, 90, 135]) {
    const { w, pet } = onFloor(KICK); hold(w, pet);
    assert.ok(along(w, pet, along80(deg)), `${deg} degrees`);
  }
});

test('a shake sent as many tiny moves a frame still counts: moves too small to have a way add up', () => {
  const { w, pet } = onFloor(KICK); hold(w, pet);
  let x = 600, started = false;
  for (const p of moves(10, 4, [20, 0], [-20, 0])) {
    /* a fast mouse: 25 moves of 0.8 px between frames */
    const d = (p.x - x) / 25;
    for (let i = 0; i < 25; i++) { x += d; w.sim.input.move(pet.id, x, 300); }
    w.frame(); started ||= pet.P.clip?.pose === 'struggle';
  }
  assert.ok(started);
});

test('circling her is not a shake, at any speed: a circle turns a little each move and never goes back', () => {
  for (const lap of [45, 30, 20, 12, 8, 5]) {
    const { w, pet } = onFloor(KICK); hold(w, pet);
    /* a 100 px radius, once round every `lap` frames: 30 is a lap in half a second, 5 is twelve a second */
    const round = Array.from({ length: lap * 8 }, (_, i) => ({ x: 500 + 100 * Math.cos(i / lap * 2 * Math.PI), y: 300 + 100 * Math.sin(i / lap * 2 * Math.PI) }));
    assert.ok(!along(w, pet, round), `a lap every ${lap} frames`);
    assert.strictEqual(pet.P.state, 'held');
  }
});

test('a shake that bobs or drifts as it goes still counts', () => {
  const bob = onFloor(KICK); hold(bob.w, bob.pet);
  /* 80 px strokes, 20 px a frame, with a 10 px bob up and down each stroke */
  assert.ok(along(bob.w, bob.pet, Array.from({ length: 40 }, (_, i) => { const u = Math.abs(((i / 4) % 2) - 1); return { x: 600 + 80 * u, y: 300 + 10 * Math.abs(((i / 2) % 2) - 1) }; })), 'bobbing');
  const drift = onFloor(KICK); hold(drift.w, drift.pet);
  /* each stroke 80 across and 22 down: about 150 degrees between strokes */
  assert.ok(along(drift.w, drift.pet, moves(10, 4, [20, 5.5], [-20, 5.5])), 'drifting down');
});

test('a fast zigzag, square, triangle or hooked zigzag is not a shake: none of them turns back over 135 degrees', () => {
  const zig = onFloor(KICK); hold(zig.w, zig.pet);
  assert.ok(!along(zig.w, zig.pet, moves(12, 4, [10, 17.32], [10, -17.32])), 'zigzag');
  const square = onFloor(KICK); hold(square.w, square.pet);
  assert.ok(!along(square.w, square.pet, moves(16, 4, [20, 0], [0, 20], [-20, 0], [0, -20])), 'square');
  /* A hooked zigzag: back a little over a quarter of the way, then off 120 degrees from the way it
     came. Each stroke is straight and ends where it hooks back, but the next one points about 131
     degrees away: back, but not back enough. */
  const hooked = onFloor(KICK); hold(hooked.w, hooked.pet);
  const pts: { x: number; y: number }[] = [];
  let x = 600, y = 300, c = { x: 150, y: 0 }, turn = 1;
  for (let i = 0; i < 10; i++) { x += c.x / 10; y += c.y / 10; pts.push({ x, y }); }
  for (let k = 0; k < 8; k++) {
    const len = Math.hypot(c.x, c.y), u = { x: c.x / len, y: c.y / len }, a = turn * 2 * Math.PI / 3;
    const v = { x: u.x * Math.cos(a) - u.y * Math.sin(a), y: u.x * Math.sin(a) + u.y * Math.cos(a) };
    const back = { x: -u.x * .27 * len, y: -u.y * .27 * len };
    for (let i = 0; i < 2; i++) { x += back.x / 2; y += back.y / 2; pts.push({ x, y }); }
    for (let i = 0; i < 10; i++) { x += v.x * 15; y += v.y * 15; pts.push({ x, y }); }
    c = { x: back.x + v.x * 150, y: back.y + v.y * 150 }; turn = -turn;
  }
  assert.ok(!along(hooked.w, hooked.pet, pts), 'hooked zigzag');
  const triangle = onFloor(KICK); hold(triangle.w, triangle.pet);
  assert.ok(!along(triangle.w, triangle.pet, moves(15, 4, [20, 0], [-10, 17.32], [-10, -17.32])), 'triangle, strokes 120 degrees apart');
});

test('a slow stroke is no side of a turn: a slow one, then five quick ones, is three turns', () => {
  const { w, pet } = onFloor(KICK); hold(w, pet);
  /* 80 px right at 4 px a frame, then from there 80 px strokes at 20 */
  assert.ok(!along(w, pet, [...moves(1, 20, [4, 0]), ...moves(5, 4, [-20, 0], [20, 0]).map(p => ({ x: p.x + 80, y: p.y }))]));
  w.run(5);
  assert.strictEqual(pet.P.clip, null);
});

test('a slow stroke in the middle of a shake starts the count again', () => {
  const { w, pet } = onFloor(KICK); hold(w, pet);
  /* four quick strokes (three turns), one slow one back, four quick ones (three turns) */
  const quick = moves(4, 4, [20, 0], [-20, 0]), slow = moves(1, 20, [4, 0]), again = moves(4, 4, [-20, 0], [20, 0]);
  assert.ok(!along(w, pet, [...quick, ...slow.map(p => ({ x: p.x - 600 + quick.at(-1)!.x, y: 300 })), ...again.map(p => ({ x: p.x - 600 + quick.at(-1)!.x + 80, y: 300 }))]));
  w.run(5);
  assert.strictEqual(pet.P.clip, null);
});

test('small steps back at the ends of a shake don\'t stop it: they never come back far enough to end a stroke', () => {
  const { w, pet } = onFloor(KICK); hold(w, pet);
  const xs: number[] = [];
  let x = 600;
  for (let g = 0; g < 6; g++) {
    const s = g % 2 ? -1 : 1;
    for (const [d, px, n] of [[s, 20, 4], [-s, 20, 4], [s, 3, 1]]) for (let i = 0; i < n!; i++) { x += d! * px!; xs.push(x); }
  }
  assert.ok(along(w, pet, xs.map(v => ({ x: v, y: 300 }))));
});

/* The hand at `fps` frames a second: each point at its own time, and a frame after it. */
function at(fps: number, w: TestWorld, pet: Pet, points: { x: number; y: number }[]) {
  let started = false;
  for (const p of points) { w.now.t += 1000 / fps - 16.667; w.sim.input.move(pet.id, p.x, p.y); w.frame(); started ||= pet.P.clip?.pose === 'struggle'; }
  return started;
}
/* A shake with rounded ends, `size` px end to end at `rate` turns a second, for `secs`, at `fps`: a
   ride along a thin figure of eight. */
const rounded = (size: number, rate: number, fps = 60, secs = 3) => Array.from({ length: Math.round(secs * fps) }, (_, i) => {
  const th = Math.PI * rate * i / fps;
  return { x: 600 + size / 2 * Math.cos(th), y: 300 + size / 20 * Math.sin(2 * th) };
});

test('a shake with rounded ends counts: the review\'s case, 200 px at four turns a second', () => {
  const { w, pet } = onFloor(KICK); hold(w, pet, 700, 300);
  const pts = Array.from({ length: 180 }, (_, i) => { const th = 2 * Math.PI * i / 30; return { x: 600 + 100 * Math.cos(th), y: 300 + 10 * Math.sin(2 * th) }; });
  assert.ok(along(w, pet, pts));
});

test('rounded shakes count when their strokes are quick: 40 to 300 px, 3 to 8 turns a second', () => {
  /* quick means 40 px or more at 6 px a frame, 360 px a second: size times rate */
  for (const size of [40, 80, 150, 300]) for (const rate of [3, 4, 6, 8]) {
    const { w, pet } = onFloor(KICK); hold(w, pet, 600 + size / 2, 300);
    const want = size * rate >= 400;
    assert.strictEqual(at(60, w, pet, rounded(size, rate)), want, `${size} px at ${rate} a second`);
  }
});

test('the window is about a second: under three turns a second still counts, two does not', () => {
  const near3 = onFloor(KICK); hold(near3.w, near3.pet, 675, 300);
  assert.ok(at(60, near3.w, near3.pet, rounded(150, 2.75)), '2.75 turns a second: four take 1.09 s');
  const two = onFloor(KICK); hold(two.w, two.pet, 750, 300);
  assert.ok(!at(60, two.w, two.pet, rounded(300, 2)), 'two a second: four take 1.5 s');
});

test('a wobble just after each turn, or a hiccup halfway along a stroke, doesn\'t break a shake', () => {
  /* after each turn: 24 px on, 6 back toward the turn, then on to 80. 6 px is under the 10 px a stroke needs to end. */
  const wobble = onFloor(KICK); hold(wobble.w, wobble.pet);
  const wob = [1, -1].flatMap(d => [[24 * d, 0], [-6 * d, 0], [22 * d, 0], [20 * d, 0], [20 * d, 0]] as [number, number][]);
  assert.ok(along(wobble.w, wobble.pet, moves(wob.length * 5, 1, ...wob)), 'wobble');
  /* 160 px strokes with a 10 px step back halfway: under a quarter of the 80 px so far */
  const hiccup = onFloor(KICK); hold(hiccup.w, hiccup.pet, 300);
  const hic = [1, -1].flatMap(d => [[20 * d, 0], [20 * d, 0], [20 * d, 0], [20 * d, 0], [-10 * d, 0], [30 * d, 0], [20 * d, 0], [20 * d, 0], [20 * d, 0]] as [number, number][]);
  assert.ok(along(hiccup.w, hiccup.pet, moves(hic.length * 4, 1, ...hic).map(p => ({ x: p.x - 300, y: p.y }))), 'hiccup');
});

test('a shake along a bent way counts only while it is nearly straight: 1.15 times as long does, 1.25 doesn\'t', () => {
  /* 120 px end to end, out and back by the same bend: through a point h off the middle */
  const bent = (h: number) => { const a: [number, number] = [20, h / 3], b: [number, number] = [20, -h / 3]; return moves(40, 3, a, b, [-20, h / 3], [-20, -h / 3]); };
  const ok = onFloor(KICK); hold(ok.w, ok.pet);
  assert.ok(along(ok.w, ok.pet, bent(34)), '1.15');
  const no = onFloor(KICK); hold(no.w, no.pet);
  assert.ok(!along(no.w, no.pet, bent(45)), '1.25');
});

test('at 30, 60 and 144 frames a second a shake counts and a circle doesn\'t', () => {
  for (const fps of [30, 60, 144]) {
    const shaken = onFloor(KICK); hold(shaken.w, shaken.pet, 675, 300);
    assert.ok(at(fps, shaken.w, shaken.pet, rounded(150, 4, fps)), `shake at ${fps}`);
    for (const laps of [1, 2, 4]) {
      const round = onFloor(KICK); hold(round.w, round.pet);
      const pts = Array.from({ length: 3 * fps }, (_, i) => { const th = 2 * Math.PI * laps * i / fps; return { x: 500 + 100 * Math.cos(th), y: 300 + 100 * Math.sin(th) }; });
      assert.ok(!at(fps, round.w, round.pet, pts), `${laps} laps a second at ${fps}`);
      assert.strictEqual(round.pet.P.state, 'held');
    }
  }
});

test('a forward drag with tiny steps back is not a shake: a stroke too small to count starts the count again', () => {
  const { w, pet } = onFloor(KICK); hold(w, pet);
  assert.ok(!along(w, pet, [660, 658, 718, 716, 776, 774, 834, 832, 892, 890, 950, 948].map(x => ({ x, y: 300 }))));
  w.run(5);
  assert.deepStrictEqual([pet.P.state, pet.P.clip], ['held', null]);
});

test('a fast fling, with or without a wind-up, stays a throw', () => {
  for (const wind of [0, 3]) {
    const { w, pet } = onFloor(KICK); hold(w, pet);
    let x = 600;
    for (let i = 0; i < wind; i++) { x -= 20; w.sim.input.move(pet.id, x, 300); w.frame(); }
    for (let i = 0; i < 6; i++) { x += 40; w.sim.input.move(pet.id, x, 300); w.frame(); assert.strictEqual(pet.P.clip, null, `wind-up ${wind}`); }
    w.sim.input.up(pet.id);
    assert.deepStrictEqual([pet.P.state, pet.P.thrown], ['air', true], `wind-up ${wind}`);
  }
});

test('without struggle art a shake does nothing, and a throw after it is still a throw', () => {
  const { w, pet } = onFloor({});
  hold(w, pet);
  assert.ok(!shake(w, pet, 80, 20, 8));
  w.run(5);
  assert.strictEqual(pet.P.state, 'held');
  let x = 600;
  for (let i = 0; i < 4; i++) { x += 30; w.sim.input.move(pet.id, x, 300); w.frame(); }
  w.sim.input.up(pet.id);
  assert.deepStrictEqual([pet.P.state, pet.P.thrown], ['air', true]);
});

test('the shake is measured at her size on that monitor', () => {
  const big = onFloor(KICK, 2); hold(big.w, big.pet);
  assert.ok(!shake(big.w, big.pet, 60, 15, 8), 'what shakes her at 100% is too small at 200%');
  const twice = onFloor(KICK, 2); hold(twice.w, twice.pet);
  assert.ok(shake(twice.w, twice.pet, 120, 30, 8), 'twice the gesture does');
  const one = onFloor(KICK); hold(one.w, one.pet);
  assert.ok(shake(one.w, one.pet, 120, 8, 8), '120 px at 8 px a frame shakes her at 100%');
  const slow = onFloor(KICK, 2); hold(slow.w, slow.pet);
  assert.ok(!shake(slow.w, slow.pet, 120, 8, 8), 'but is too slow at 200%');
});

test('ten still seconds still start one, as before', () => {
  const { w, pet } = onFloor(KICK);
  hold(w, pet);
  assert.ok(w.until(() => pet.P.clip, 700));
});

/* ---------- 5. Held's side poses are optional ---------- */

test('swung left and right are optional slots: she shows them only with art', () => {
  for (const k of ['dragL', 'dragR'] as PoseKey[]) {
    assert.notStrictEqual(POSE[k].tier, 'core', k);
    assert.strictEqual(canShow({ poses: {} }, k), false, k);
    assert.strictEqual(canShow({ poses: { [k]: frames(k) } }, k), true, k);
  }
  for (const [name, b] of Object.entries(BOOK.behaviours)) assert.ok(!['dragL', 'dragR'].includes(b.main.pose), `${name} needs no side pose to be done`);
});

test('without side poses she still swings on Held', () => {
  const { w, pet } = onFloor({ drag: frames('held') });
  hold(w, pet);
  let x = 600, most = 0;
  for (let i = 0; i < 20; i++) { x += 25; w.sim.input.move(pet.id, x, 300); w.frame(); most = Math.max(most, pet.P.swing); assert.strictEqual(shown(pet), 'data:image/png;base64,held0'); }
  assert.ok(most > 10, `swung to ${most}`);
  assert.ok(Math.abs(turn(pet)) > 2, 'and leans with it');
});
