/* A leap for the ceiling is a jump: Jump going up, Fall coming down, and she still catches it. Only
   a real throw shows Thrown. */
import assert from 'node:assert';
import { test } from 'vitest';
import type { BuddyData, Pet } from '../src/index';
import { BUDDY, screen, windowRect, world } from './support';

const BB = { x0: 0, y0: 0, x1: 1, y1: 1 };
const frames = (key: string) => ({ fps: 6, frames: [{ src: `data:image/png;base64,${key}0`, bb: BB }] });
const ART: BuddyData['poses'] = { jump: frames('jump'), fall: frames('fall'), thrown: frames('tumble'), hang: frames('hang') };
const src = (k: string) => `data:image/png;base64,${k}0`;
const shown = (pet: Pet) => pet.frame({ x: 0, y: 0, scale: 1 }).src;

function onFloor(seed: number, poses = ART) {
  const w = world([screen('s', 0, 0, 1600, 900)], { seed }), pet = w.add(BUDDY('a', { poses }));
  assert.ok(w.until(() => pet.P.surf === 'floor' && pet.P.state !== 'land', 2000));
  pet.go('idle'); pet.P.dur = 1e9;
  return { w, pet };
}
/* every air frame till she's off the air: what showed and which way she was going */
function flight(w: ReturnType<typeof onFloor>['w'], pet: Pet) {
  const seen: { src: string; up: boolean }[] = [];
  for (let i = 0; i < 400 && pet.P.state === 'air'; i++) { w.frame(); if (pet.P.state === 'air') seen.push({ src: shown(pet)!, up: pet.P.vy < 0 }); }
  return seen;
}

for (const seed of [1, 2, 3, 4, 5]) {
  test(`a ceiling leap shows Jump up and Fall down, never Thrown, and still catches it (seed ${seed})`, () => {
    const { w, pet } = onFloor(seed);
    pet.act('ceilGo');
    assert.strictEqual(pet.P.state, 'air');
    const seen = flight(w, pet);
    assert.ok(seen.length > 5, 'she flew');
    for (const [i, f] of seen.entries()) assert.strictEqual(f.src, src(f.up ? 'jump' : 'fall'), `frame ${i}, going ${f.up ? 'up' : 'down'}`);
    assert.deepStrictEqual([pet.P.state, pet.P.surf], ['hang', 'ceil'], 'caught the ceiling');
  });
}

test('a throw up at the ceiling still shows Thrown and catches it', () => {
  const { w, pet } = onFloor(1);
  w.sim.input.down(pet.id, pet.P.x, pet.P.y); w.sim.input.move(pet.id, 800, 500); w.frame();
  let y = 500;
  for (let i = 0; i < 4; i++) { y -= 24; w.sim.input.move(pet.id, 800, y); w.frame(); }
  w.sim.input.up(pet.id);
  assert.ok(pet.P.thrown);
  const seen = flight(w, pet);
  assert.ok(seen.length > 2);
  for (const f of seen) assert.strictEqual(f.src, src('tumble'));
  assert.deepStrictEqual([pet.P.state, pet.P.surf], ['hang', 'ceil']);
});

test('a plain jump into the ceiling doesn\'t catch it, as before', () => {
  const w = world([screen('s', 0, 0, 1600, 180)], { seed: 1 }), pet = w.add(BUDDY('a', { poses: ART }));
  assert.ok(w.until(() => pet.P.surf === 'floor' && pet.P.state !== 'land', 2000));
  pet.go('idle'); pet.P.dur = 1e9;
  pet.act('jump');
  flight(w, pet);
  assert.strictEqual(pet.P.surf, 'floor');
});

/* A leap at 300% across into a monitor at 100%: her sideways speed there is past a throw's grab, and
   she takes the window side she meets, as she always has. */
test('a ceiling leap still grabs a wall it meets fast enough, as a throw would', () => {
  const w = world([screen('a', 0, 0, 1600, 1000, 3), screen('b', 1600, -1000, 1600, 2000, 1), windowRect('platform', 1200, 500, 450, 200), windowRect('obstacle', 1750, -900, 300, 1200, 2)], { seed: 5 });
  const pet = w.add(BUDDY()), s = w.terrain.surfaces().find(x => x.owner === 'platform' && x.kind === 'floor')!;
  Object.assign(pet.P, { x: 1599, y: 500, k: 3, home: 'a', on: { surface: s, t: 1599 - s.from }, bound: null });
  pet.go('idle'); pet.act('ceilGo');
  assert.ok(w.until(() => pet.P.on, 200));
  assert.deepStrictEqual([pet.P.state, pet.P.on!.surface.id, pet.P.thrown], ['wall', 'obstacle:left:0', false]);
});
