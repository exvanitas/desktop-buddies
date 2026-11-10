/* Bringing a buddy to a point: she drops in near the top of the screen under it, at its x. */
import assert from 'node:assert';
import { test } from 'vitest';
import type { Pet } from '../src/index';
import { BUDDY, screen, world, type TestWorld } from './support';

const TWO = () => [screen('a', 0, 0, 1600, 900), screen('b', 1600, 0, 1920, 1040, 1.5)];
const landed = (w: TestWorld, pet: Pet) => w.until(() => pet.P.surf === 'floor' && pet.P.state !== 'land', 2000);
function standing(w: TestWorld) {
  const pet = w.add(BUDDY());
  assert.ok(landed(w, pet));
  pet.go('sit'); pet.P.dur = 1e9; pet.P.chatT = 1e9;
  return pet;
}

test('brought: she drops in near the top of the screen under the point, at its x, and lands there', () => {
  const w = world(TWO()), pet = standing(w);
  assert.strictEqual(pet.P.home, 'a');
  w.sim.bring('a', { x: 2400, y: 700 });
  assert.strictEqual(pet.P.state, 'air');
  assert.deepStrictEqual([pet.P.home, pet.P.k, pet.P.x, pet.P.vx, pet.P.vy], ['b', 1.5, 2400, 0, 0]);
  assert.ok(pet.P.y <= 0 && pet.P.y > -pet.bw() * 2, `near the top: ${pet.P.y}`);
  assert.ok(landed(w, pet));
  assert.deepStrictEqual([pet.P.home, pet.P.on!.surface.owner, pet.P.x, pet.P.y], ['b', 'b', 2400, 1040]);
});

test('brought to an edge, she stays on the screen', () => {
  const w = world(TWO()), pet = standing(w);
  w.sim.bring('a', { x: 1599, y: 10 });
  assert.strictEqual(pet.P.home, 'a');
  assert.ok(pet.P.x < 1600 - pet.bw() / 2, String(pet.P.x));
});

test('brought while held, she leaves the hand: letting go after throws nothing', () => {
  const w = world(TWO()), pet = standing(w);
  w.sim.input.down('a', pet.P.x, pet.P.y);
  for (let i = 1; i <= 5; i++) { w.sim.input.move('a', 400 + i * 30, 300); w.frame(); }
  assert.strictEqual(pet.P.state, 'held');
  w.sim.bring('a', { x: 2400, y: 700 });
  assert.strictEqual(pet.P.state, 'air');
  w.sim.input.move('a', 900, 100); w.sim.input.up('a');
  assert.deepStrictEqual([pet.P.state, pet.P.x, pet.P.vx, pet.P.vy, pet.P.thrown], ['air', 2400, 0, 0, false]);
  assert.ok(landed(w, pet));
  assert.strictEqual(pet.P.x, 2400);
});

test('brought while thrown, she drops straight in, and nothing waits for her landing', () => {
  const w = world(TWO()), pet = standing(w);
  w.sim.input.down('a', pet.P.x, pet.P.y);
  for (let i = 1; i <= 5; i++) { w.sim.input.move('a', 400 + i * 40, 300 - i * 20); w.frame(); }
  w.sim.input.up('a');
  assert.ok(pet.P.thrown && pet.P.vx > 0);
  pet.P.next = 'dance';
  w.sim.bring('a', { x: 2400, y: 700 });
  assert.deepStrictEqual([pet.P.vx, pet.P.vy, pet.P.thrown, pet.P.hard, pet.P.next], [0, 0, false, false, null]);
  assert.ok(landed(w, pet));
  assert.notStrictEqual(pet.P.state, 'dizzy', 'a soft landing');
});

test('brought from a wall or the ceiling, she lets go', () => {
  const w = world(TWO()), pet = standing(w);
  pet.act('climbGo');
  assert.ok(w.until(() => pet.P.surf === 'left' || pet.P.surf === 'right', 3000));
  w.sim.bring('a', { x: 800, y: 400 });
  assert.deepStrictEqual([pet.P.state, pet.P.on, pet.P.x], ['air', null, 800]);
  assert.ok(landed(w, pet));
});

test('a point off every screen brings her to the nearest one', () => {
  const w = world(TWO()), pet = standing(w);
  w.sim.bring('a', { x: 4000, y: 300 });
  assert.strictEqual(pet.P.home, 'b');
  assert.ok(landed(w, pet));
});

test('bringing someone who isn\'t there does nothing', () => {
  const w = world(TWO()), pet = standing(w);
  const was = [pet.P.state, pet.P.home, pet.P.x, pet.P.y];
  w.sim.bring('nobody', { x: 2400, y: 700 });
  assert.deepStrictEqual([pet.P.state, pet.P.home, pet.P.x, pet.P.y], was);
});

test('brought while the world is paused, she is drawn where she was brought, and stays paused', () => {
  const w = world(TWO()), pet = standing(w);
  w.sim.world.paused = true;
  const before = pet.frame({ x: 0, y: 0, scale: 1 });
  w.sim.bring('a', { x: 2400, y: 700 });
  const after = pet.frame({ x: 0, y: 0, scale: 1 });
  assert.notDeepStrictEqual(after.box, before.box);
  assert.strictEqual(after.box.l + after.box.ox, 2400, 'drawn at the x she was brought to');
  const P = JSON.stringify([pet.P.x, pet.P.y, pet.P.state]);
  w.run(30);
  assert.strictEqual(JSON.stringify([pet.P.x, pet.P.y, pet.P.state]), P, 'nothing moved while paused');
});

test('acting for one buddy is for her alone, whatever she is called, and everyone is asked for by name', () => {
  const w = world(TWO());
  const all = w.add(BUDDY('all')), other = w.add(BUDDY('b'));
  assert.ok(w.until(() => all.P.surf === 'floor' && other.P.surf === 'floor' && all.P.state !== 'land' && other.P.state !== 'land', 2000));
  w.sim.act('all', 'love');
  assert.deepStrictEqual([all.P.state, other.P.state === 'love'], ['love', false]);
  w.sim.actAll('sit');
  assert.deepStrictEqual([all.P.state, other.P.state], ['sit', 'sit']);
});
