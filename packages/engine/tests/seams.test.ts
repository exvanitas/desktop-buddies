/* Seams: what she's drawn as, from the frame a view gets, shouldn't jump from one tick to the next as
   one animation hands on to another. Each test measures the largest single-tick move (px, the edge
   of her drawn box that moved most) or turn (degrees) across a hand-over, and holds it under a limit. */
import assert from 'node:assert';
import { test } from 'vitest';
import type { BuddyData, Pet } from '../src/index';
import { drawn, step, turnPastMirror, worst, type Box, type Drawn } from './drawn';
import { wheel } from '../src/motions';
import { BUDDY, screen, world } from './support';

const VP = { x: 0, y: 0, scale: 1 };
const FULL: Box = { x0: 0, y0: 0, x1: 1, y1: 1 };
const art = (name: string, n: number, fps: number, bb: Box) => ({ fps, frames: Array.from({ length: n }, (_, i) => ({ src: `data:image/png;base64,${name}${i}`, bb })) });

function onFloor(data: BuddyData, seed = 1, w0 = 1600) {
  const w = world([screen('s', 0, 0, w0, 900)], { seed }), pet = w.add(data);
  assert.ok(w.until(() => pet.P.surf === 'floor' && pet.P.state !== 'land', 2000));
  /* nothing chatters or picks while a test looks */
  pet.P.chatT = 1e9;
  return { w, pet };
}
const look = (pet: Pet, bb: Box = FULL) => drawn(pet.frame(VP), bb);
/* drawings tick by tick, while `going` holds and `after` ticks more */
function record(w: ReturnType<typeof world>, pet: Pet, going: () => boolean, after = 8, bb: Box = FULL, max = 3000) {
  const out: Drawn[] = [look(pet, bb)];
  for (let i = 0; i < max && going(); i++) { w.frame(); out.push(look(pet, bb)); }
  for (let i = 0; i < after; i++) { w.frame(); out.push(look(pet, bb)); }
  return out;
}

/* ---------- 5. A roll ends upright ---------- */

const STAND_BB: Box = { x0: .25, y0: 0, x1: .75, y1: 1 };
const ROLLERS: [string, BuddyData['poses']][] = [
  /* the sample art's Stand: 16 frames at 4 fps stretch a 130-frame roll to 240 */
  ['a long Stand pass', { stand: art('stand', 16, 4, STAND_BB) }],
  ['a short Stand pass', { stand: art('stand', 4, 4, STAND_BB) }],
  ['no art', {}]
];
for (const [label, poses] of ROLLERS) {
  test(`a roll on Stand ends upright and doesn't slip: ${label}`, () => {
    let handOn = 0, slipped = 0, turned = 0, off = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const { w, pet } = onFloor(BUDDY('a', { poses }), seed);
      pet.go('roll');
      const seq: Drawn[] = [look(pet)], xs = [pet.P.x], dirs = [pet.P.dir];
      while (pet.P.state === 'roll') { w.frame(); seq.push(look(pet)); xs.push(pet.P.x); dirs.push(pet.P.dir); }
      const n = seq.length - 1, turnRound = dirs.some(d => d !== dirs[0]);
      /* The tick she hands on turns her no more than a tick of rolling does: the last tick of the
         roll is drawn as what follows, so it's one step of the wheel. Up to twice her pace, 6 degrees,
         and a little more just after a late turn round. */
      handOn = Math.max(handOn, step(seq[n - 1]!, seq[n]!).deg);
      /* the turns she rolled through, which come out whole */
      let total = 0;
      for (let i = 1; i < n; i++) total += ((seq[i]!.rot - seq[i - 1]!.rot + 540) % 360) - 180;
      turned = Math.max(turned, Math.abs(total) / 360); off = Math.max(off, Math.abs(total - Math.round(total / 360) * 360));
      /* No slip: she turns by the ground she covers over her radius. The transform's angles are
         written to a tenth of a degree, so it's read over the whole roll. A turn round late in a roll
         can't keep to it, so only rolls without one are held to it. */
      if (turnRound) continue;
      const r = (poses.stand ? STAND_BB.y1 - STAND_BB.y0 : 1) * 120 / 2, ground = Math.abs(xs[n - 1]! - xs[0]!), rim = Math.abs(total) * Math.PI / 180 * r;
      slipped = Math.max(slipped, Math.abs(rim - ground) / ground);
    }
    console.log(`roll, ${label}: worst turn as she hands on ${handOn.toFixed(1)} deg, turns up to ${turned.toFixed(2)}, ${off.toFixed(1)} deg off whole, worst slip ${(slipped * 100).toFixed(1)}%`);
    assert.ok(handOn <= 7, `she's turned ${handOn.toFixed(1)} degrees in the tick the roll hands on`);
    assert.ok(turned >= .9, 'she still rolls a turn or more');
    /* her last tick rolling is a step of the wheel short of upright, and a hand-on can't hide more */
    assert.ok(off <= 10, `her roll ends ${off.toFixed(1)} degrees off a whole turn`);
    assert.ok(slipped <= .02, `her turn and the ground she covers differ by ${(slipped * 100).toFixed(1)}%`);
  });
}

/* ---------- 6. Personality art plays on its own ---------- */

const PERSONALITY = ['excited', 'laugh', 'surprised', 'face_away', 'tap_screen', 'stare'] as const;
test('personality art plays on its own, a few times an hour each', { timeout: 30000 }, () => {
  const B = { x0: .2, y0: 0, x1: .8, y1: 1 };
  const poses = Object.fromEntries([['stand', art('stand', 2, 4, B)], ...PERSONALITY.map(k => [k, art(k, 3, 6, B)])]) as BuddyData['poses'];
  const HOURS = 2, plays = Object.fromEntries(PERSONALITY.map(k => [k, 0])) as Record<string, number>;
  const { w, pet } = onFloor(BUDDY('a', { poses }), 7, 1920);
  let was = pet.P.state;
  for (let i = 0; i < HOURS * 216000; i++) {
    w.frame();
    if (pet.P.state !== was && pet.P.state in plays) plays[pet.P.state]!++;
    was = pet.P.state;
  }
  const rate = Object.fromEntries(PERSONALITY.map(k => [k, plays[k]! / HOURS]));
  console.log(`personality plays per hour over ${HOURS} h: ${JSON.stringify(rate)}`);
  for (const k of PERSONALITY) assert.ok(plays[k]! >= 1 && rate[k]! <= 12, `${k} plays ${rate[k]} times an hour`);
});

/* ---------- 8. One-sided art keeps her body still ---------- */

/* the body sits in the middle of every picture; some poses have an arm out to one side */
const BODY: Box = { x0: .3, y0: .02, x1: .7, y1: 1 }, ARM: Box = { x0: .3, y0: .02, x1: .92, y1: 1 };
for (const faces of ['right', 'left'] as const) {
  test(`a pose with an arm out to one side doesn't move her body: art facing ${faces}`, () => {
    const poses = { stand: art('stand', 2, 4, BODY), wave: art('wave', 2, 6, ARM) } as BuddyData['poses'];
    for (const dir of [1, -1]) {
      const { w, pet } = onFloor(BUDDY('a', { faces, poses }));
      pet.go('idle'); pet.P.dir = dir; pet.P.dur = 1e9; w.run(4);
      pet.go('wave');
      const seq = record(w, pet, () => pet.P.state === 'wave', 8, BODY);
      const at = worst(seq);
      console.log(`one-sided art, faces ${faces}, dir ${dir}: worst body move ${at.px.toFixed(1)} px`);
      assert.ok(at.px <= .5, `her body moved ${at.px.toFixed(1)} px in one tick`);
    }
  });
}

test('one-sided art keeps her body where it was as she turns round in it', () => {
  const poses = { stand: art('stand', 2, 4, BODY), wave: art('wave', 2, 6, ARM) } as BuddyData['poses'];
  const { w, pet } = onFloor(BUDDY('a', { poses }));
  pet.go('wave'); pet.P.dur = 1e9; w.run(4);
  const a = look(pet, BODY); pet.P.dir = -pet.P.dir; w.frame();
  const moved = step(a, look(pet, BODY)).px;
  console.log(`one-sided art, turning round: body moved ${moved.toFixed(1)} px`);
  assert.ok(moved <= .5, `her body moved ${moved.toFixed(1)} px as she turned`);
});

/* A Shimeji set as the art pipeline brings it in: synthetic stand-ins (128 px pictures, the same body
   column in each, a limb out to one side in some) through the real importer, which squares every
   picture about the main image's middle. Legs out sitting, lying down, a hand up thinking. */
test('a Shimeji set brought in by the pipeline keeps her body still between poses', () => {
  const FEET: Box = { x0: .357, y0: 1, x1: .643, y1: 1 };
  const one = (name: string, bb: Box, scale = 1) => ({ fps: 4, scale, frames: [{ src: `data:image/png;base64,${name}`, bb }] });
  const poses = {
    sit: one('sit', { x0: .0714, y0: .408, x1: .643, y1: 1 }), think: one('think', { x0: .357, y0: 0, x1: .847, y1: 1 }),
    sprawl: one('sprawl', { x0: 0, y0: .759, x1: .621, y1: 1 }, 1.184)
  } as BuddyData['poses'];
  const base = { src: 'data:image/png;base64,base', bb: { x0: .357, y0: 0, x1: .643, y1: 1 } };
  let px = 0;
  for (const [to, feet] of [['sit', FEET], ['think', FEET], ['trip', { x0: .379, y0: 1, x1: .621, y1: 1 }]] as const) {
    const { w, pet } = onFloor(BUDDY('a', { size: 98, faces: 'left', base, poses }));
    pet.go('idle'); pet.P.dur = 1e9; w.run(4);
    const a = look(pet, FEET);
    pet.go(to); pet.P.dur = 1e9; w.frame();
    const s = step(a, look(pet, feet)).px;
    console.log(`Shimeji stand-in, stand to ${to}: body moved ${s.toFixed(1)} px`);
    px = Math.max(px, s);
  }
  assert.ok(px <= 1, `her body moved ${px.toFixed(1)} px`);
});

/* ---------- 9. Fallback animations hand on smoothly ---------- */

function plain(seed = 1) { return onFloor(BUDDY('a'), seed); }
const rest = (pet: Pet) => { pet.go('idle'); pet.P.dur = 1e9; };

test('a trip without the art falls over and gets up over a few ticks, not one', () => {
  const { w, pet } = plain();
  rest(pet); w.run(10);
  pet.go('trip');
  const seq = record(w, pet, () => pet.P.state === 'trip', 12);
  const at = worst(seq);
  console.log(`trip: worst ${at.px.toFixed(1)} px, ${at.deg.toFixed(1)} deg`);
  assert.ok(at.deg <= 12, `turned ${at.deg.toFixed(1)} degrees in one tick`);
  assert.ok(at.px <= 25, `moved ${at.px.toFixed(1)} px in one tick`);
});

test('a landing from a tilted flight comes upright over a few ticks', () => {
  let deg = 0;
  for (const vx of [14, -14]) {
    const { w, pet } = plain();
    pet.go('air'); pet.P.y -= 300; pet.P.vx = vx; pet.P.vy = 0;
    assert.ok(w.until(() => pet.P.state === 'air' && Math.abs(look(pet).rot) > 10, 20), 'tilted in flight');
    const seq = record(w, pet, () => pet.P.state === 'air', 12);
    deg = Math.max(deg, worst(seq.slice(-14)).deg);
  }
  console.log(`landing: worst turn ${deg.toFixed(1)} deg`);
  assert.ok(deg <= 5, `turned ${deg.toFixed(1)} degrees in one tick`);
});

test('a lean turns round with her: mirrored, and nothing past the mirror', () => {
  const { w, pet } = plain();
  w.sim.input.pointer(pet.P.x + 400, pet.P.y - 20);
  pet.go('chase'); pet.P.dur = 1e9;
  assert.ok(w.until(() => pet.P.dir === 1, 30));
  w.run(30);
  w.sim.input.pointer(pet.P.x - 400, pet.P.y - 20);
  const seq = record(w, pet, () => pet.P.dir === 1, 12);
  let deg = 0;
  for (let i = 1; i < seq.length; i++) deg = Math.max(deg, turnPastMirror(seq[i - 1]!, seq[i]!));
  console.log(`lean flip: worst turn past the mirror ${deg.toFixed(1)} deg`);
  assert.ok(deg <= 1, `turned ${deg.toFixed(1)} degrees past the mirror in one tick`);
});

for (const to of ['sit', 'sleep'] as const) {
  test(`a walk's bob settles into a ${to} over a few ticks`, () => {
    let px = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const { w, pet } = plain(seed);
      pet.go('walk'); pet.P.dur = 1e9;
      w.run(20 + seed * 3);
      pet.go(to); pet.P.dur = 1e9;
      const seq = [look(pet)];
      for (let i = 0; i < 16; i++) { w.frame(); seq.push(look(pet)); }
      px = Math.max(px, worst(seq).px);
    }
    console.log(`walk to ${to}: worst ${px.toFixed(1)} px`);
    assert.ok(px <= 5, `moved ${px.toFixed(1)} px in one tick`);
  });
}

test("Wave's sway ends at rest, not cut mid-sway", () => {
  const { w, pet } = plain();
  rest(pet); w.run(10);
  pet.go('wave');
  const seq = record(w, pet, () => pet.P.state === 'wave', 8);
  const at = worst(seq);
  console.log(`wave: worst turn ${at.deg.toFixed(1)} deg`);
  /* the sway itself turns her up to 3.2 degrees a tick */
  assert.ok(at.deg <= 3.5, `turned ${at.deg.toFixed(1)} degrees in one tick`);
});

/* ---------- Review: what a review found ---------- */

test('a roll tick of no time changes nothing', () => {
  const { w, pet } = plain();
  pet.go('roll'); w.sim.step(130);
  const before = { x: pet.P.x, roll: pet.P.roll, dur: pet.P.dur };
  w.sim.advance(w.now.t);
  const body = pet.frame(VP).body!;
  assert.ok(Number.isFinite(pet.P.x) && Number.isFinite(pet.P.roll) && !body.includes('NaN'), `x ${pet.P.x}, roll ${pet.P.roll}, ${body}`);
  assert.deepStrictEqual({ x: pet.P.x, roll: pet.P.roll, dur: pet.P.dur }, before);
});

test('the wheel plans nothing with no time to plan in', () => {
  for (const at of [0, 100, 376.9]) for (const left of [0, -1]) assert.strictEqual(wheel(at, left, 0, 2.8, 377), 2.8, `at ${at}, ${left} left`);
  for (const at of [0, 100, 376.9]) { const w = wheel(at, 1, 1, 2.8, 377); assert.ok(w === null || Number.isFinite(w), `at ${at}: ${w}`); }
});

for (const size of [240, 512]) {
  test(`a big buddy rolls whole turns too, with no art of her own: size ${size}`, () => {
    let turned = Infinity, slipped = 0, off = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const { w, pet } = onFloor(BUDDY('a', { size, base: { src: 'data:image/png;base64,big', bb: { x0: .25, y0: 0, x1: .75, y1: 1 } } }), seed, 20000);
      pet.P.sp = 1; pet.go('roll');
      const seq: Drawn[] = [look(pet)], xs = [pet.P.x], dirs = [pet.P.dir];
      while (pet.P.state === 'roll') { w.frame(); seq.push(look(pet)); xs.push(pet.P.x); dirs.push(pet.P.dir); }
      const n = seq.length - 1;
      let total = 0;
      for (let i = 1; i < n; i++) total += ((seq[i]!.rot - seq[i - 1]!.rot + 540) % 360) - 180;
      turned = Math.min(turned, Math.abs(total) / 360); off = Math.max(off, Math.abs(total - Math.round(total / 360) * 360));
      const ground = Math.abs(xs[n - 1]! - xs[0]!), rim = Math.abs(total) * Math.PI / 180 * size / 2;
      if (!dirs.some(d => d !== dirs[0])) slipped = Math.max(slipped, Math.abs(rim - ground) / Math.max(ground, 1));
    }
    console.log(`big roll, size ${size}: turns at least ${turned.toFixed(2)}, ${off.toFixed(1)} deg off whole, slip ${(slipped * 100).toFixed(1)}%`);
    assert.ok(turned >= .9, `she turned ${turned.toFixed(2)} times`);
    assert.ok(off <= 10, `her roll ends ${off.toFixed(1)} degrees off a whole turn`);
    assert.ok(slipped <= .02, `her turn and the ground she covers differ by ${(slipped * 100).toFixed(1)}%`);
  });
}

test('a roll that walls keep turning round still ends, within a turn of time past its own', () => {
  const size = 512, base = { src: 'data:image/png;base64,big', bb: { x0: .25, y0: 0, x1: .75, y1: 1 } };
  const w = world([screen('s', 0, 0, 800, 900)], { seed: 1 }), pet = w.add(BUDDY('a', { size, base }));
  assert.ok(w.until(() => pet.P.surf === 'floor' && pet.P.state !== 'land', 2000));
  pet.P.chatT = 1e9; pet.go('roll');
  /* her own time, and then a turn's worth at her pace at most */
  const limit = 130 + Math.PI * size / (2.8 * pet.P.sp) + 2;
  let t = 0;
  while (pet.P.state === 'roll' && t < 5000) { w.frame(); t++; }
  console.log(`roll between walls: ended after ${t} ticks (limit ${limit.toFixed(0)}), duration ${pet.P.dur.toFixed(0)}`);
  assert.ok(t <= limit, `still rolling after ${t} ticks, duration ${pet.P.dur.toFixed(0)}`);
});

test('a main image off the middle of its picture is drawn where she is, and her bubble with it', () => {
  const MAIN: Box = { x0: .65, y0: 0, x1: .95, y1: 1 };
  const { w, pet } = onFloor(BUDDY('a', { base: { src: 'data:image/png;base64,main', bb: MAIN } }));
  rest(pet); pet.say('Hello there'); w.run(2);
  const d = look(pet, MAIN), mid = (d.x0 + d.x1) / 2, at = pet.frame(VP).bubble.at!;
  console.log(`off-centre main image: drawn ${(mid - pet.P.x).toFixed(1)} px from where she is, bubble ${(at.her - mid).toFixed(1)} px from her art`);
  assert.ok(Math.abs(mid - pet.P.x) <= .5, `drawn ${(mid - pet.P.x).toFixed(1)} px from where she is`);
  assert.ok(Math.abs(at.her - mid) <= .5, `her bubble is ${(at.her - mid).toFixed(1)} px from her art`);
  /* walked to the right edge, her feet stay on the screen while she's on its floor (her walk's sway tips her top a little past) */
  pet.go('walk', { dir: 1 }); pet.P.dur = 1e9;
  let right = 0;
  for (let i = 0; i < 1500; i++) { w.frame(); if (pet.P.surf === 'floor') right = Math.max(right, look(pet, { ...MAIN, y0: 1 }).x1); }
  assert.ok(right <= 1600.5, `her feet reached ${right.toFixed(1)} on a 1600 px screen`);
});

test('brought somewhere, she is drawn as she is there, not as she was', () => {
  const { w, pet } = plain();
  rest(pet); w.run(4); pet.go('trip'); w.run(12);
  assert.ok(Math.abs(look(pet).rot) > 80, 'flat on her face');
  pet.bring({ x: 800, y: 100 });
  const d = look(pet);
  console.log(`brought mid-trip: drawn turned ${d.rot.toFixed(1)} deg`);
  assert.ok(Math.abs(d.rot) <= .5, `still drawn turned ${d.rot.toFixed(1)} degrees`);
});

test('a fallback trip into her own Sit art draws the sitting picture upright at once', () => {
  const { w, pet } = onFloor(BUDDY('a', { poses: { sit: art('sit', 1, 3, { x0: .2, y0: .3, x1: .8, y1: 1 }) } as BuddyData['poses'] }));
  rest(pet); w.run(4); pet.go('trip'); w.run(12);
  pet.go('sit'); pet.P.dur = 1e9; w.frame();
  const d = look(pet);
  console.log(`trip into Sit art: drawn turned ${d.rot.toFixed(1)} deg`);
  assert.ok(Math.abs(d.rot) <= .5, `her Sit picture is drawn turned ${d.rot.toFixed(1)} degrees`);
});

test('turning round flat on her face mirrors her, and never puts her under the floor', () => {
  const { w, pet } = plain();
  rest(pet); w.run(4); pet.go('trip'); pet.P.dur = 1e9; w.run(12);
  const floor = look(pet).y1;
  pet.P.dir = -pet.P.dir;
  let below = 0, deg = 0, a = look(pet);
  for (let i = 0; i < 12; i++) { w.frame(); const b = look(pet); below = Math.max(below, b.y1 - floor); deg = Math.max(deg, turnPastMirror(a, b)); a = b; }
  console.log(`turning round mid-trip: ${below.toFixed(1)} px under the floor, ${deg.toFixed(1)} deg past the mirror`);
  assert.ok(below <= 1, `drawn ${below.toFixed(1)} px under the floor`);
  assert.ok(deg <= 1, `turned ${deg.toFixed(1)} degrees past the mirror in one tick`);
});

test('starting a spin again mid-spin hands on too', () => {
  const { w, pet } = plain();
  rest(pet); w.run(4); pet.go('spin'); pet.P.dur = 46; w.run(23);
  const seq = [look(pet)];
  pet.go('spin');
  for (let i = 0; i < 12; i++) { w.frame(); seq.push(look(pet)); }
  const at = worst(seq);
  console.log(`spin started again: worst turn ${at.deg.toFixed(1)} deg`);
  assert.ok(at.deg <= 25, `turned ${at.deg.toFixed(1)} degrees in one tick`);
});

/* ---------- With eased moves: a hand-on and an eased move in the same frames ---------- */

/* her art in its picture */
const ART: Box = { x0: .2, y0: 0, x1: .8, y1: 1 };
/* how far her art is drawn past a 1600 x 900 screen's walls and floor */
const past = (b: Drawn) => Math.max(-b.x0, b.x1 - 1600, b.y1 - 900);
/* Getting up from a trip near the screen's right end: the hand-on is under way when `then` runs. */
function gettingUp(seed = 1) {
  const { w, pet } = plain(seed);
  pet.go('walk', { dir: 1 }); pet.P.dur = 1e9;
  assert.ok(w.until(() => pet.P.x > 1600 - 90, 3000), 'walked to the right end');
  pet.go('trip'); pet.P.dur = 20;
  assert.ok(w.until(() => pet.P.state === 'idle', 400), 'got up');
  pet.P.dur = 1e9;
  return { w, pet };
}

test('a corner turn that starts while she gets up from a trip: one turn, and no deeper into the wall', () => {
  let deg = 0, deeper = -Infinity;
  for (let seed = 1; seed <= 3; seed++) {
    const { w, pet } = gettingUp(seed);
    w.frame();
    const before = past(look(pet, ART));
    pet.go('climbGo');
    let a = look(pet), worst = 0, turned = -1;
    /* up to 30 ticks on the wall, while she's on it */
    for (let i = 0; i < 120 && (turned < 0 || i <= turned + 30); i++) {
      w.frame(); const b = look(pet), c = look(pet, ART);
      if (turned >= 0 && pet.P.surf !== 'right') break;
      deg = Math.max(deg, turnPastMirror(a, b)); a = b;
      if (pet.P.surf === 'right' && turned < 0) turned = i;
      worst = Math.max(worst, past(c));
    }
    assert.ok(turned >= 0, `seed ${seed}: she got onto the wall`);
    /* once on the wall, as the wall draws her */
    const after = past(look(pet, ART));
    deeper = Math.max(deeper, worst - Math.max(before, after, 0));
  }
  console.log(`getting up into a corner: worst turn ${deg.toFixed(1)} deg a tick, ${deeper.toFixed(1)} px deeper than before or after`);
  assert.ok(deg <= 15, `turned ${deg.toFixed(1)} degrees in one tick`);
  assert.ok(deeper <= .5, `drawn ${deeper.toFixed(1)} px deeper into the wall than before or after`);
});

test('picked up while she gets up from a trip: one turn, upright once held, never under the floor', () => {
  const { w, pet } = gettingUp();
  w.frame();
  /* pressed near her top and lifted, so she's held clear of the floor */
  const p = { x: pet.P.x, y: pet.P.y - 100 };
  let a = look(pet), deg = 0, under = 0;
  w.sim.input.down(pet.id, p.x, p.y);
  for (let i = 0; i < 24; i++) {
    w.sim.input.move(pet.id, p.x, p.y - 10 - i * 5); w.frame();
    const b = look(pet), c = look(pet, ART); deg = Math.max(deg, turnPastMirror(a, b)); a = b; under = Math.max(under, c.y1 - 900);
  }
  assert.strictEqual(pet.P.state, 'held');
  console.log(`picked up getting up: worst turn ${deg.toFixed(1)} deg a tick, now ${a.rot.toFixed(1)}, ${under.toFixed(1)} px under the floor`);
  assert.ok(deg <= 15, `turned ${deg.toFixed(1)} degrees in one tick`);
  assert.ok(Math.abs(a.rot) <= 2, `still turned ${a.rot.toFixed(1)} degrees once held`);
  assert.ok(under <= .5, `drawn ${under.toFixed(1)} px under the floor`);
});

test('turning round in the middle of an eased pickup mirrors her, and turns her no further', () => {
  let deg = 0;
  for (const at of [2, 5, 8]) {
    const { w, pet } = plain();
    pet.go('walk', { dir: 1 }); pet.P.dur = 1e9; w.run(40);
    const p = { x: pet.P.x, y: pet.P.y - 40 };
    w.sim.input.down(pet.id, p.x, p.y);
    let a = look(pet);
    for (let i = 0; i < 20; i++) {
      w.sim.input.move(pet.id, p.x, p.y - 10 - i * 2);
      if (i === at) pet.P.dir = -pet.P.dir;
      w.frame(); const b = look(pet); deg = Math.max(deg, turnPastMirror(a, b)); a = b;
    }
    assert.strictEqual(pet.P.state, 'held');
  }
  console.log(`turning round mid-pickup: worst turn past the mirror ${deg.toFixed(1)} deg a tick`);
  /* The eased pickup alone, with no hand-on, turns her 4.4 degrees past the mirror here: the hand-on adds nothing. */
  assert.ok(deg <= 4.5, `turned ${deg.toFixed(1)} degrees past the mirror in one tick`);
});

test('up a wall from a dash, the eased corner and the hand-on turn her once, and no deeper into the wall', () => {
  let deg = 0, deeper = -Infinity;
  for (let seed = 1; seed <= 4; seed++) {
    const { w, pet } = plain(seed);
    pet.go('climbGo');
    let a = look(pet), on = 0, worst = 0, before = 0;
    for (let i = 0; i < 1500 && on < 30; i++) {
      w.frame(); const b = look(pet), c = look(pet, ART);
      deg = Math.max(deg, turnPastMirror(a, b)); a = b;
      if (pet.P.surf === 'left' || pet.P.surf === 'right') { on++; worst = Math.max(worst, past(c)); } else before = past(c);
    }
    assert.ok(on >= 30, `seed ${seed}: she got up a wall`);
    deeper = Math.max(deeper, worst - Math.max(before, past(look(pet, ART)), 0));
  }
  console.log(`dash up a wall: worst turn ${deg.toFixed(1)} deg a tick, ${deeper.toFixed(1)} px deeper than before or after`);
  assert.ok(deg <= 13, `turned ${deg.toFixed(1)} degrees in one tick`);
  assert.ok(deeper <= .5, `drawn ${deeper.toFixed(1)} px deeper into the wall than before or after`);
});
