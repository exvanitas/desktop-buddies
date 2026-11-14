/* The desktop host, driven by hand: a hub's and two overlays' worth of messages, no worker and no page. */
import assert from 'node:assert';
import fs from 'node:fs';
import { read } from '@buddies/buddy-file';
import type { BuddyData, Frame, Pet } from '@buddies/engine';
import type { Rectangle } from '@buddies/terrain';
import { test } from 'vitest';
import { createHold, createHost, same, viewport, type Area, type Message, type Port } from '../src/host';
import type { WindowEntry } from '../src/shell';
import { whole } from './areas';

const source = (f: string) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const BUDDY = (id: string): BuddyData => ({ id, name: 'Olive', size: 120, faces: 'right', poses: {}, base: { src: 'data:image/png;base64,AAAA', bb: { x0: .2, y0: 0, x1: .8, y1: 1 } } });
function mulberry32(a: number) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
interface FakePort extends Port { out: { k: string; frame: Frame; area?: Area }[] }

const AREAS: Area[] = [whole({ i: 0, x: 0, y: 0, w: 3440, h: 1392, scale: 1 }), whole({ i: 1, x: 720, y: 1440, w: 1920, h: 1008, scale: 1.5 })];

function desk(areas = AREAS) {
  const clock = { t: 0 }, timers: { at: number; f: () => void }[] = [], every: { ms: number; f: () => void; next: number; stopped?: boolean }[] = [], notes: string[] = [];
  const host = createHost({
    random: mulberry32(5), now: () => clock.t, note: t => { notes.push(t); },
    after: (ms, f) => { timers.push({ at: clock.t + ms, f }); return timers.length; }, cancel(id) { const t = timers[id - 1]; if (t) t.f = () => {}; },
    every: (ms, f) => { const e = { ms, f, next: clock.t + ms, stopped: false }; every.push(e); return () => { e.stopped = true; }; }
  });
  const port = () => { const p: FakePort = { out: [], postMessage(m) { this.out.push(JSON.parse(JSON.stringify(m))); } }; host.connect(p); return p; };
  const hub = port(), top = port(), low = port();
  host.message(hub, { k: 'start', all: areas, pets: [BUDDY('b0')] });
  host.message(top, { k: 'join', me: areas[0], n: 0 });
  host.message(low, { k: 'join', me: areas[1], n: 1 });
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { clock.t += 16; for (const e of [...every]) if (!e.stopped && clock.t >= e.next) { e.next += e.ms; e.f(); } } };
  const send = (p: FakePort, m: Message) => host.message(p, m);
  /* the world's 16 ms timers that are running */
  const running = () => every.filter(e => e.ms === 16 && !e.stopped).length;
  return { host, hub, top, low, tick, send, clock, notes, timers, running, pet: () => host.sim!.pets.get('b0')! };
}
/* a desk with the buddy carried down to the low monitor and standing there */
function onLow() {
  const d = desk(); d.tick(200);
  const pet = d.pet();
  d.send(d.low, { k: 'down', id: 'b0', x: pet.P.x, y: pet.P.y - 50, from: 1 });
  d.send(d.top, { k: 'cursor', x: 1500, y: 2000, down: true }); d.tick(2);
  d.send(d.top, { k: 'cursor', x: 1500, y: 2000, down: false }); d.tick(400);
  d.notes.length = 0;
  return d;
}
const lastFrame = (p: FakePort) => p.out.filter(m => m.k === 'frame').pop()!.frame;

/* Whoever a build seeds a first run with, if it ships anyone: a whole buddy, with her own id and a
   full set of poses. A build with no seed.json starts with an empty library. */
test('the buddy it ships, if any, is a valid buddy file', () => {
  assert.match(source('../src/hub.ts'), /fetch\('seed\.json'\)\.catch\(\(\) => null\); return r\?\.ok \? r\.text\(\) : null;/, 'the hub seeds from that file, or no one');
  if (!fs.existsSync(new URL('../public/seed.json', import.meta.url))) return;
  const b = read(source('../public/seed.json'));
  assert.ok(b.name && b.character);
  assert.ok(Object.keys(b.poses).length >= 15);
});

test('an overlay draws, hit tests and renews its lease, and leaves the rest to the hub', () => {
  const page = source('../src/overlay.ts');
  assert.deepStrictEqual([...new Set([...page.matchAll(/shell\.(\w+)\(/g)].map(m => m[1]))].sort(), ['capture', 'log', 'on']);
  assert.deepStrictEqual([...page.matchAll(/on\('(\w+)'/g)].map(m => m[1]), ['cursor']);
  assert.ok(!/k: 'cursor'/.test(page), 'the hub feeds the world the cursor');
});

test('one world, started by the hub; a second start changes nothing', () => {
  const d = desk();
  assert.strictEqual(d.host.sim!.pets.size, 1);
  const sim = d.host.sim;
  d.send(d.hub, { k: 'start', all: AREAS, pets: [] });
  assert.strictEqual(d.host.sim, sim);
  assert.strictEqual(sim!.pets.size, 1);
  d.tick(3);
  assert.ok(d.top.out.length && d.low.out.length);
});

test('the hub, which has no viewport, gets no frames', () => {
  const d = desk(); d.tick(5);
  assert.strictEqual(d.hub.out.length, 0);
});

test('each overlay gets a frame in its own CSS pixels', () => {
  const d = onLow();
  const pet = d.pet();
  assert.strictEqual(pet.P.on!.surface.owner, 'monitor1');
  const low = lastFrame(d.low).pets[0], top = lastFrame(d.top).pets[0];
  assert.strictEqual(low.off, false); assert.strictEqual(top.off, true);
  assert.strictEqual(low.size, '120px');
  assert.ok(low.box.t < 672 && low.box.t > 0);
});

test('an image goes to an overlay once, when it comes into view', () => {
  const d = desk(); d.tick(150);
  const frames = d.top.out.filter(m => m.k === 'frame').flatMap(m => m.frame.pets);
  const before = frames.filter(f => f.src).map(f => f.src);
  assert.strictEqual(new Set(before).size, before.length, 'never the same image twice in a row');
  assert.strictEqual(d.top.out.filter(m => m.k === 'frame').flatMap(m => m.frame.pets).filter(f => f.src && f.off).length, 0, 'none sent while off screen');
});

test('a still world sends nothing', () => {
  const d = onLow();
  d.host.sim!.world.paused = true; d.tick(3);
  const n = d.low.out.length; d.tick(30);
  assert.strictEqual(d.low.out.length, n);
});

test('a press and release with no move is a click', () => {
  const d = onLow();
  const pet: Pet = d.pet(); pet.go('sit'); pet.P.dur = 1e9;
  d.send(d.low, { k: 'down', id: 'b0', x: pet.P.x, y: pet.P.y - 50, from: 1 });
  d.send(d.low, { k: 'up', id: 'b0' }); d.tick(1);
  assert.match(pet.P.state, /wave|spin/);
});

test('a drag follows the global cursor across monitors, and ends when the button comes up', () => {
  const d = onLow();
  const pet = d.pet();
  d.send(d.low, { k: 'down', id: 'b0', x: pet.P.x, y: pet.P.y - 50, from: 1 });
  d.send(d.top, { k: 'cursor', x: pet.P.x, y: pet.P.y - 50, down: true }); d.tick(2);
  for (let i = 0; i < 40; i++) { d.send(d.top, { k: 'cursor', x: 1500, y: 2200 - i * 40, down: true }); d.tick(1); }
  assert.strictEqual(pet.P.state, 'held'); assert.strictEqual(pet.P.hy, 2200 - 39 * 40);
  assert.strictEqual(pet.P.k, 1, 'over the top monitor now');
  assert.strictEqual(lastFrame(d.top).pets[0].off, false, 'the top overlay draws it');
  assert.strictEqual(lastFrame(d.low).pets[0].off, true, 'and the low one has let it go');
  d.send(d.top, { k: 'cursor', x: 1500, y: 640, down: false });
  assert.strictEqual(pet.P.state, 'air');
  assert.ok(pet.P.vy < -10, 'thrown upward by the drag');
  assert.ok(d.notes.some(n => /^press/.test(n)) && d.notes.some(n => /^release/.test(n)));
});

test('dragging ignores the page\'s own moves, which stop at the overlay\'s edge', () => {
  const d = onLow();
  const pet = d.pet();
  d.send(d.low, { k: 'down', id: 'b0', x: pet.P.x, y: pet.P.y - 50, from: 1 });
  d.send(d.top, { k: 'cursor', x: 1000, y: 2000, down: true }); d.send(d.low, { k: 'move', id: 'b0', x: 9, y: 9 }); d.tick(1);
  assert.strictEqual(pet.P.hx, 1000);
});

test('a press the cursor stream never confirms ends by itself', () => {
  const d = onLow();
  const pet: Pet = d.pet(); pet.go('sit'); pet.P.dur = 1e9;
  d.send(d.low, { k: 'down', id: 'b0', x: pet.P.x, y: pet.P.y, from: 1 });
  d.tick(40);
  assert.ok(d.notes.some(n => /^release/.test(n)));
});

test('a button-down the stream reported before the press still counts', () => {
  const d = onLow(), pet = d.pet(); pet.go('sit'); pet.P.dur = 1e9;
  d.send(d.top, { k: 'cursor', x: pet.P.x, y: pet.P.y, down: true });
  d.send(d.low, { k: 'down', id: 'b0', x: pet.P.x, y: pet.P.y, from: 1 });
  d.tick(100); /* held still: no more cursor events come */
  assert.ok(!d.notes.some(n => /^release/.test(n)), 'still in hand after the fallback time');
  d.send(d.top, { k: 'cursor', x: pet.P.x, y: pet.P.y, down: false });
  assert.ok(d.notes.some(n => /^release/.test(n)));
});

test('a hold: confirmed by the button, whichever arrives first', () => {
  const clock = { t: 0 }, now = () => clock.t;
  const before = createHold(1000, now);
  before.cursor(true); before.press(); clock.t = 5000;
  assert.strictEqual(before.expired(), false, 'the button was already down');
  assert.strictEqual(before.cursor(false), true, 'and coming up ends it');
  assert.strictEqual(before.active, false);
  const after = createHold(1000, now);
  after.press(); after.cursor(true); clock.t += 5000;
  assert.strictEqual(after.expired(), false);
  const never = createHold(1000, now);
  never.press(); assert.strictEqual(never.cursor(false), false, 'a stale up is not an end'); clock.t += 1001;
  assert.strictEqual(never.expired(), true, 'unconfirmed, it gives up');
  assert.strictEqual(never.active, false);
});

test('the overlay traces the hit test only when asked, and says when a mask couldn\'t load', () => {
  const page = source('../src/overlay.ts');
  assert.match(page, /if \(boot\.trace\) trace\(x, y, inside\)/);
  assert.match(page, /inside \? explain\(/, 'the cursor is explained only on this overlay; where she is, always');
  assert.match(page, /const line = huntLine\(f, me\); if \(line\) log\(line\)/, 'and only by an overlay that shows her');
  assert.match(page, /noteWith\(log\)/);
  assert.doesNotMatch(page.slice(page.indexOf('function trace')), /\bfailed\b|\berror\b|\.name\b/, 'nothing the smoke run reads as trouble, and no names');
});

test('the overlay holds the mouse by the same rule', () => {
  const page = source('../src/overlay.ts');
  assert.match(page, /createHold\(/);
  assert.match(page, /hold\.cursor\(cursor\.down\)/);
});

test('a stale button-up before the press registers is ignored', () => {
  const d = onLow();
  const pet = d.pet();
  d.send(d.low, { k: 'down', id: 'b0', x: pet.P.x, y: pet.P.y, from: 1 });
  d.send(d.top, { k: 'cursor', x: pet.P.x + 1, y: pet.P.y, down: false });
  assert.ok(!d.notes.some(n => /^release/.test(n)));
});

test('hover is the union of what the overlays report', () => {
  const d = onLow();
  const pet = d.pet();
  d.send(d.low, { k: 'over', id: 'b0' }); assert.strictEqual(pet.P.hover, true);
  d.send(d.top, { k: 'over', id: 'b0' }); d.send(d.low, { k: 'over', id: null }); assert.strictEqual(pet.P.hover, true);
  d.send(d.top, { k: 'over', id: null }); assert.strictEqual(pet.P.hover, false);
});

test('petting works through page moves while the mouse is captured', () => {
  const d = onLow();
  const pet: Pet = d.pet(); pet.go('sit'); pet.P.dur = 1e9;
  let x = pet.P.x;
  for (let i = 0; i < 8; i++) { x += i % 2 ? 60 : -60; d.send(d.low, { k: 'move', id: 'b0', x, y: pet.P.y - 40 }); d.clock.t += 40; }
  assert.strictEqual(pet.P.state, 'love');
});

test('the log says when a buddy crosses between monitors', () => {
  const d = onLow();
  const pet = d.pet();
  d.send(d.low, { k: 'down', id: 'b0', x: pet.P.x, y: pet.P.y, from: 1 });
  d.send(d.top, { k: 'cursor', x: 1500, y: 2000, down: true }); d.tick(2);
  d.send(d.top, { k: 'cursor', x: 1500, y: 500, down: true }); d.tick(2);
  assert.ok(d.notes.some(n => /^crossed b0 monitor1 to monitor0/.test(n)), d.notes.join('; '));
});

test('viewport maths match what the exe reports', () => {
  /* no taskbar to tell, so its window leaves out the screen's top line */
  assert.deepStrictEqual(viewport(AREAS[1]), { x: 720, y: 1441, scale: 1.5, w: 1280, h: 1007 / 1.5 });
});

/* a new list of monitors while it runs */
const SMALLER: Area[] = [whole({ i: 0, x: 0, y: 0, w: 3440, h: 1350, scale: 1 }), AREAS[1]!];

test('a work area that shrinks keeps the buddy on its floor, at the new height', () => {
  const d = desk(); d.tick(200);
  const pet = d.pet(); pet.go('sit'); pet.P.dur = 1e9;
  assert.strictEqual(pet.P.y, 1392);
  d.send(d.hub, { k: 'monitors', all: SMALLER }); d.tick(1);
  assert.strictEqual(pet.P.state, 'sit');
  assert.strictEqual(pet.P.y, 1350);
});

test('an overlay that stays hears its new place, and frames follow it', () => {
  const d = desk(); d.tick(3);
  const moved: Area[] = [AREAS[0]!, whole({ i: 1, x: 3440, y: 0, w: 1920, h: 1008, scale: 2 })];
  d.send(d.hub, { k: 'monitors', all: moved });
  assert.deepStrictEqual(d.low.out.filter(m => m.k === 'area').pop(), { k: 'area', area: moved[1] });
  assert.strictEqual(d.hub.out.length, 0);
});

test('a monitor can go with a buddy on it: it falls to one that is left and carries on', () => {
  const d = onLow(), pet = d.pet();
  pet.go('walk', { dir: 1 }); pet.P.dur = 1e9;
  d.send(d.hub, { k: 'leave', i: 1, n: 1 });
  d.send(d.hub, { k: 'monitors', all: [AREAS[0]!] });
  d.tick(600);
  assert.ok(pet.P.on, 'stands on something');
  assert.strictEqual(pet.P.on!.surface.owner, 'monitor0');
  assert.strictEqual(pet.P.home, 'monitor0');
  assert.strictEqual(lastFrame(d.top).pets[0].off, false);
});

test('the primary monitor can go too, with the buddy on it', () => {
  const d = desk(); d.tick(200);
  const pet = d.pet();
  assert.strictEqual(pet.P.on!.surface.owner, 'monitor0');
  d.send(d.hub, { k: 'leave', i: 0, n: 0 });
  d.send(d.hub, { k: 'monitors', all: [AREAS[1]!] });
  d.tick(600);
  assert.strictEqual(pet.P.on!.surface.owner, 'monitor1');
  assert.strictEqual(lastFrame(d.low).pets[0].off, false);
});

test('a monitor that comes back is a place to go again', () => {
  const d = desk(); d.tick(100);
  d.send(d.hub, { k: 'monitors', all: [AREAS[0]!] }); d.tick(5);
  d.send(d.hub, { k: 'monitors', all: AREAS }); d.tick(5);
  const pet = d.pet();
  d.send(d.low, { k: 'down', id: 'b0', x: pet.P.x, y: pet.P.y - 50, from: 1 });
  d.send(d.top, { k: 'cursor', x: 1500, y: 2000, down: true }); d.tick(2);
  d.send(d.top, { k: 'cursor', x: 1500, y: 2000, down: false }); d.tick(300);
  assert.strictEqual(pet.P.on!.surface.owner, 'monitor1');
});

test('an overlay that left gets no more frames, and whatever it hovered lets go', () => {
  const d = onLow(), pet = d.pet();
  d.send(d.low, { k: 'over', id: 'b0' }); assert.strictEqual(pet.P.hover, true);
  d.send(d.hub, { k: 'leave', i: 1, n: 1 });
  assert.strictEqual(pet.P.hover, false);
  const n = d.low.out.length;
  d.tick(30);
  assert.strictEqual(d.low.out.length, n);
});

test('pets can change while it runs, and a held one that goes lets go of the mouse', () => {
  const d = onLow(), pet = d.pet();
  d.send(d.low, { k: 'down', id: 'b0', x: pet.P.x, y: pet.P.y, from: 1 });
  d.send(d.top, { k: 'cursor', x: 100, y: 100, down: true });
  d.send(d.hub, { k: 'pets', pets: [BUDDY('b1')] });
  assert.deepStrictEqual([...d.host.sim!.pets.keys()], ['b1']);
  d.send(d.top, { k: 'cursor', x: 100, y: 100, down: false }); d.tick(3);
  assert.ok(!d.notes.some(n => /^release/.test(n)), 'nothing left to release');
});

test('bring: she drops in on the monitor under the cursor, at its x', () => {
  const d = onLow(), pet = d.pet();
  assert.strictEqual(pet.P.home, 'monitor1');
  d.send(d.top, { k: 'cursor', x: 1500, y: 300, down: false });
  d.send(d.hub, { k: 'bring', id: 'b0' });
  assert.deepStrictEqual([pet.P.state, pet.P.home, pet.P.x], ['air', 'monitor0', 1500]);
  assert.ok(d.notes.includes('brought b0'), d.notes.join());
  d.tick(300);
  assert.deepStrictEqual([pet.P.surf, pet.P.home, pet.P.x, pet.P.y], ['floor', 'monitor0', 1500, 1392]);
});

test('bring ends a hold on her, so the hand that held her throws nothing', () => {
  const d = onLow(), pet = d.pet();
  d.send(d.low, { k: 'down', id: 'b0', x: pet.P.x, y: pet.P.y - 50, from: 1 });
  for (let i = 1; i <= 5; i++) { d.send(d.top, { k: 'cursor', x: 1500 + i * 40, y: 1900 - i * 30, down: true }); d.tick(1); }
  assert.strictEqual(pet.P.state, 'held');
  d.send(d.hub, { k: 'bring', id: 'b0' });
  d.send(d.top, { k: 'cursor', x: 2000, y: 1500, down: true });
  d.send(d.low, { k: 'up', id: 'b0' });
  d.send(d.top, { k: 'cursor', x: 2000, y: 1500, down: false });
  assert.deepStrictEqual([pet.P.state, pet.P.x, pet.P.vx, pet.P.vy], ['air', 1700, 0, 0]);
  assert.ok(!d.notes.some(n => /^release/.test(n)), 'nothing left to release');
});

test('bring for someone who isn\'t in the world says so', () => {
  const d = onLow();
  d.send(d.hub, { k: 'bring', id: 'b9' });
  assert.ok(d.notes.includes("bring: b9 isn't here"), d.notes.join());
});

test('a dismissed buddy says goodbye, then goes', () => {
  const d = onLow();
  d.send(d.hub, { k: 'dismiss', id: 'b0' });
  d.send(d.hub, { k: 'dismiss', id: 'b0' });
  assert.strictEqual(d.host.sim!.pets.size, 1, 'still here to wave');
  assert.strictEqual(d.timers.length > 0, true);
  const t = d.timers.filter(x => x.at === d.clock.t + 900);
  assert.strictEqual(t.length, 1, 'once, however often it was asked');
  t[0]!.f();
  assert.strictEqual(d.host.sim!.pets.size, 0);
  assert.ok(d.host.sim!.world.fx.some(f => f.kind === 'star'));
});

test('a dismissed buddy called back in time stays, and the goodbye doesn\'t take it away later', () => {
  const d = onLow();
  d.send(d.hub, { k: 'dismiss', id: 'b0' });
  const goodbye = d.timers.filter(x => x.at === d.clock.t + 900);
  d.send(d.hub, { k: 'pets', pets: [BUDDY('b0')] });
  for (const t of goodbye) t.f();
  assert.ok(d.host.sim!.pets.has('b0'));
  assert.ok(!d.host.sim!.world.fx.some(f => f.kind === 'star'), 'no burst of stars either');
  d.send(d.hub, { k: 'dismiss', id: 'b0' });
  assert.strictEqual(d.timers.filter(x => x.at === d.clock.t + 900).length, 2, 'and it can be dismissed again');
  d.timers.at(-1)!.f();
  assert.ok(!d.host.sim!.pets.has('b0'));
});

test('someone else being called doesn\'t cut a goodbye short', () => {
  const d = onLow();
  d.send(d.hub, { k: 'dismiss', id: 'b0' });
  const goodbye = d.timers.filter(x => x.at === d.clock.t + 900);
  d.send(d.hub, { k: 'pets', pets: [BUDDY('b1')] });
  assert.ok(d.host.sim!.pets.has('b0'), 'still here to wave');
  assert.ok(d.host.sim!.pets.has('b1'));
  for (const t of goodbye) t.f();
  assert.deepStrictEqual([...d.host.sim!.pets.keys()], ['b1']);
  assert.ok(d.host.sim!.world.fx.some(f => f.kind === 'star'));
});

test('copies are told apart: dismissing one leaves the other', () => {
  const d = onLow();
  d.send(d.hub, { k: 'pets', pets: [BUDDY('b0'), BUDDY('b0~1')] });
  d.send(d.hub, { k: 'dismiss', id: 'b0~1' });
  d.timers.filter(x => x.at === d.clock.t + 900).at(-1)!.f();
  assert.deepStrictEqual([...d.host.sim!.pets.keys()], ['b0']);
});

test('a still world runs no timer, and takes up again by one tick, not the whole pause', () => {
  const d = desk(); d.tick(100);
  const pet = d.pet(); pet.go('walk', { dir: 1 }); pet.P.dur = 1e9; d.tick(2);
  assert.strictEqual(d.running(), 1, 'ticking while it runs');
  let x = pet.P.x; d.tick(); const step = pet.P.x - x;
  assert.ok(step > 0);
  d.send(d.hub, { k: 'pause', on: true });
  assert.strictEqual(d.running(), 0, 'no timer while it\'s still');
  const frames = d.top.out.length + d.low.out.length;
  d.tick(1000);
  assert.strictEqual(d.top.out.length + d.low.out.length, frames, 'and nothing sent');
  d.send(d.hub, { k: 'pause', on: false });
  assert.strictEqual(d.running(), 1);
  x = pet.P.x; d.tick();
  assert.ok(Math.abs(pet.P.x - x - step) < 1e-9, `one tick's walk, ${pet.P.x - x}, not the pause's: ${step}`);
});

test('overlays are told when the world goes still and when it runs again, and one that joins meanwhile is told too', () => {
  const d = desk(); d.tick(50);
  const told = (p: FakePort) => p.out.filter(m => m.k === 'still').map(m => (m as unknown as { on: boolean }).on);
  assert.deepStrictEqual(told(d.top), [], 'nothing while it runs from the start');
  d.send(d.hub, { k: 'pause', on: true });
  assert.deepStrictEqual([told(d.top), told(d.low), told(d.hub)], [[true], [true], []], 'every overlay, and not the hub');
  const late: FakePort = { out: [], postMessage(m) { this.out.push(JSON.parse(JSON.stringify(m))); } };
  d.host.connect(late);
  d.send(late, { k: 'join', me: AREAS[0]!, n: 9 });
  assert.deepStrictEqual(told(late), [true]);
  assert.ok(late.out.some(m => m.k === 'frame'), 'and given a frame at once');
  d.send(d.hub, { k: 'pause', on: false });
  assert.deepStrictEqual([told(d.top), told(late)], [[true, false], [true, false]]);
});

test('still, Show names off is drawn at once, without a tick', () => {
  const d = desk(); d.tick(200);
  const frames = () => [d.top, d.low].flatMap(p => p.out.filter(m => m.k === 'frame'));
  const tagHidden = () => (frames().pop()! as unknown as { frame: Frame }).frame.pets[0]!.tag.hidden;
  assert.strictEqual(tagHidden(), false);
  d.send(d.hub, { k: 'pause', on: true });
  const n = frames().length;
  d.send(d.hub, { k: 'look', names: false, talk: true, quiet: [] });
  assert.ok(frames().length > n, 'drawn');
  assert.strictEqual(tagHidden(), true);
  d.send(d.hub, { k: 'look', names: true, talk: true, quiet: [] });
  assert.strictEqual(tagHidden(), false, 'and back, as she was placed');
  assert.strictEqual(d.running(), 0, 'and still nothing ticks');
});

test('still, a change is drawn at once by one step, and the cursor alone draws nothing', () => {
  const d = desk(); d.tick(200);
  d.send(d.hub, { k: 'pause', on: true });
  const n = d.top.out.length;
  d.send(d.top, { k: 'cursor', x: 1000, y: 500, down: false });
  assert.strictEqual(d.top.out.length, n, 'the cursor moves nothing');
  d.send(d.hub, { k: 'say', id: 'b0', text: 'Still here', from: 'Test' });
  assert.strictEqual(d.top.out.length, n + 1, 'a line shows without a tick');
  assert.strictEqual(lastFrame(d.top).pets[0]!.bubble.text, 'Still here');
  assert.strictEqual(d.running(), 0);
});

test('a hand holding someone keeps a paused world ticking until it lets go', () => {
  const d = onLow(), pet = d.pet();
  d.send(d.hub, { k: 'pause', on: true });
  assert.strictEqual(d.running(), 0);
  d.send(d.low, { k: 'down', id: 'b0', x: pet.P.x, y: pet.P.y - 50, from: 1 });
  assert.strictEqual(d.running(), 1, 'held');
  d.send(d.top, { k: 'cursor', x: 1500, y: 2000, down: true }); d.tick(2);
  d.send(d.top, { k: 'cursor', x: 1500, y: 2000, down: false }); d.tick(2);
  assert.ok(d.notes.some(n => /^release b0/.test(n)));
  assert.strictEqual(d.running(), 0, 'let go, it\'s still again');
});

test('a press the cursor never confirms still ends in a paused world', () => {
  const d = onLow(), pet = d.pet();
  d.send(d.hub, { k: 'pause', on: true });
  d.send(d.low, { k: 'down', id: 'b0', x: pet.P.x, y: pet.P.y - 50, from: 1 });
  d.tick(40);
  assert.ok(d.notes.some(n => /^release b0/.test(n)));
  assert.strictEqual(d.running(), 0);
});

test('frames are compared as JSON writes them, without writing them', () => {
  const d = desk(); d.tick(300);
  const frames: unknown[] = [];
  for (let i = 0; i < 400; i++) { d.tick(); frames.push(d.host.sim!.frame(viewport(AREAS[0]!))); }
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    assert.strictEqual(same(a, b), JSON.stringify(a) === JSON.stringify(b), `frames ${i - 1} and ${i}`);
    assert.ok(same(a, JSON.parse(JSON.stringify(a))), 'a copy is the same');
  }
  const cases: [unknown, unknown, boolean][] = [
    [{ a: 1, b: undefined }, { a: 1 }, true], [{ a: 1 }, { a: 1, b: null }, false], [[undefined], [null], true], [NaN, null, true], [Infinity, NaN, true],
    [{ a: [1, 2] }, { a: [1, 2, 3] }, false], [{ a: '1' }, { a: 1 }, false], [[], {}, false], [{ a: { b: 'x' } }, { a: { b: 'y' } }, false], [-0, 0, true]
  ];
  for (const [a, b, want] of cases) {
    assert.strictEqual(same(a, b), want, `${JSON.stringify(a)} ${JSON.stringify(b)}`);
    assert.strictEqual(same(a, b), JSON.stringify(a) === JSON.stringify(b), 'as JSON has it');
  }
});

test('pausing stops the world and resuming starts it', () => {
  const d = desk(); d.tick(100);
  const pet = d.pet(); pet.go('walk', { dir: 1 }); pet.P.dur = 1e9; d.tick(2);
  d.send(d.hub, { k: 'pause', on: true });
  const x = pet.P.x; d.tick(30);
  assert.strictEqual(pet.P.x, x);
  d.send(d.hub, { k: 'pause', on: false }); d.tick(30);
  assert.notStrictEqual(pet.P.x, x);
});

test('an overlay that joins after the layout changed gets the current area, whatever its boot data said', () => {
  const d = desk();
  const late: FakePort = { out: [], postMessage(m) { this.out.push(JSON.parse(JSON.stringify(m))); } };
  d.host.connect(late);
  const moved: Area = whole({ ...AREAS[1]!, x: 3440, y: 0, w: 1600, h: 900 });
  d.send(d.hub, { k: 'monitors', all: [AREAS[0]!, moved] });
  d.send(late, { k: 'join', me: AREAS[1]!, n: 1 });
  assert.deepStrictEqual(late.out.find(m => m.k === 'area')!.area, moved);
  d.tick(3);
  const seen = lastFrame(late).pets[0]!, sim = d.host.sim!;
  assert.deepStrictEqual(seen.box, sim.frame(viewport(moved)).pets[0]!.box, 'frames are for the current place');
  assert.notDeepStrictEqual(seen.box, sim.frame(viewport(AREAS[1]!)).pets[0]!.box, 'not the boot place');
});

test('an overlay that joins after its monitor went gets no frames', () => {
  const d = desk();
  const late: FakePort = { out: [], postMessage(m) { this.out.push(JSON.parse(JSON.stringify(m))); } };
  d.host.connect(late);
  d.send(d.hub, { k: 'monitors', all: [AREAS[0]!] });
  d.send(d.hub, { k: 'leave', i: 1, n: 1 });
  d.send(late, { k: 'join', me: AREAS[1]!, n: 1 });
  d.tick(3);
  assert.deepStrictEqual(late.out, []);
});

test('a monitor that goes and comes back before its overlay closed: the overlay carries on', () => {
  const d = desk(); d.tick(3);
  d.send(d.hub, { k: 'monitors', all: [AREAS[0]!] });
  d.low.out.length = 0; d.tick(3);
  assert.strictEqual(d.low.out.length, 0, 'no frames while its monitor is gone');
  d.send(d.hub, { k: 'monitors', all: AREAS });
  assert.deepStrictEqual(d.low.out[0], { k: 'area', area: AREAS[1] });
  d.tick(3);
  assert.ok(d.low.out.some(m => m.k === 'frame'), 'frames again');
  d.send(d.low, { k: 'over', id: 'b0' });
  d.send(d.low, { k: 'over', id: null });
});

test('messages from an overlay that left are ignored', () => {
  const d = desk(); d.tick(3);
  d.send(d.low, { k: 'over', id: 'b0' });
  d.send(d.hub, { k: 'leave', i: 1, n: 1 });
  d.low.out.length = 0;
  const pet = d.pet(), was = pet.P.state;
  for (const m of [
    { k: 'over', id: 'b0' }, { k: 'over', id: null }, { k: 'down', id: 'b0', x: 1, y: 1, from: 1 }, { k: 'move', id: 'b0', x: 1, y: 1 },
    { k: 'up', id: 'b0' }, { k: 'act', id: 'b0', a: 'wave' }, { k: 'join', me: AREAS[1]!, n: 1 }
  ] as Message[]) d.send(d.low, m);
  assert.strictEqual(pet.P.state, was, 'nothing reached the world');
  d.tick(3);
  assert.deepStrictEqual(d.low.out, [], 'and it stays gone');
});

test('an overlay that joins before the world starts gets its place when it does', () => {
  const host = createHost({ random: mulberry32(5), now: () => 0, note() {}, after: () => 0, cancel() {}, every() {} });
  const p: FakePort = { out: [], postMessage(m) { this.out.push(JSON.parse(JSON.stringify(m))); } };
  const hub: Port = { postMessage() {} };
  host.connect(p); host.connect(hub);
  host.message(p, { k: 'join', me: { ...AREAS[0]!, x: 999 }, n: 0 });
  assert.deepStrictEqual(p.out, []);
  host.message(hub, { k: 'start', all: AREAS, pets: [] });
  assert.deepStrictEqual((p.out as { area?: Area }[])[0]!.area, AREAS[0]);
});

test('nothing is lost when an overlay joins before the hub has started the world', () => {
  const d = desk();
  const late: FakePort = { out: [], postMessage(m) { this.out.push(JSON.parse(JSON.stringify(m))); } };
  d.host.connect(late);
  d.send(late, { k: 'join', me: AREAS[1]!, n: 1 });
  d.tick(3);
  assert.ok(late.out.length > 0);
});

/* the user's windows */

const entry = (id: number, x: number, y: number, w: number, h: number, more: Partial<WindowEntry> = {}): WindowEntry => ({ id, x, y, w, h, z: 0, max: false, topmost: false, tool: false, layered: false, class: 'Notepad', exe: 'notepad.exe', ...more });
/* every setRects the host makes from here on */
function watched(d: ReturnType<typeof desk>) {
  const sim = d.host.sim!, real = sim.setRects, calls: Rectangle[][] = [];
  sim.setRects = r => { calls.push(r); real(r); };
  return calls;
}
const windowsOn = (d: ReturnType<typeof desk>, list: WindowEntry[], exclude: string[] = []) => d.send(d.hub, { k: 'windows', list, exclude });
/* All of her has to be on a monitor. With no art for it she's the main image turned round her feet,
   so she stands out from a wall or a ceiling by her height. The engine doesn't hand out bh(), so
   this is its sum. */
function wholeBody(pet: Pet, where: string) {
  const { P } = pet, s = P.on!.surface, w = pet.bw(), h = 120 * P.k, n = s.to - s.from, t = P.on!.t;
  const r = s.kind === 'floor' ? { x: P.x - w / 2, y: P.y - h, w, h }
    : s.kind === 'ceil' ? { x: P.x - w / 2, y: P.y, w, h }
      : { x: s.normal.x > 0 ? P.x : P.x - h, y: P.y - h / 2, w: h, h };
  assert.ok(AREAS.some(a => r.x >= a.x - .01 && r.y >= a.y - .01 && r.x + r.w <= a.x + a.w + .01 && r.y + r.h <= a.y + a.h + .01), `${where}: on ${s.id} at ${t} of ${n}, body ${JSON.stringify(r)}`);
}
/* Lets her go above a point, and holds her still once she lands. */
function standOn(d: ReturnType<typeof desk>, x: number, y: number, owner: string) {
  const pet = d.pet();
  d.send(d.top, { k: 'down', id: 'b0', x: pet.P.x, y: pet.P.y - 50, from: 0 });
  d.send(d.top, { k: 'cursor', x, y, down: true }); d.tick(2);
  d.send(d.top, { k: 'cursor', x, y, down: false });
  for (let i = 0; i < 400 && pet.P.on?.surface.owner !== owner; i++) d.tick();
  assert.strictEqual(pet.P.on?.surface.owner, owner, 'she landed on it');
  pet.go('sit'); pet.P.dur = 1e9; pet.P.chatT = 1e9;
  return pet;
}

test('windows and screens reach the world as one list, on the next tick', () => {
  const d = desk(), calls = watched(d);
  windowsOn(d, [entry(1, 300, 400, 800, 500)]);
  assert.strictEqual(calls.length, 0, 'not before the tick');
  d.tick();
  assert.deepStrictEqual(calls.map(c => c.map(r => r.id)), [['monitor0', 'monitor1', 'window1']]);
});

test('a burst between two ticks: one change, and the latest wins', () => {
  const d = desk(), calls = watched(d);
  for (let x = 0; x < 500; x++) windowsOn(d, [entry(1, x, 400, 800, 500)]);
  d.tick();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0]!.find(r => r.id === 'window1')!.rect.x, 499);
});

test('nothing new, nothing to do', () => {
  const d = desk(), calls = watched(d);
  windowsOn(d, [entry(1, 300, 400, 800, 500)]);
  d.tick(50);
  assert.strictEqual(calls.length, 1);
});

test('the exclude list comes with the list', () => {
  const d = desk(), calls = watched(d);
  windowsOn(d, [entry(1, 300, 400, 800, 500)], ['notepad.exe']);
  d.tick();
  assert.deepStrictEqual(calls[0]!.map(r => r.id), ['monitor0', 'monitor1']);
});

test('monitors changing keeps the windows, cut to the new monitors', () => {
  const d = desk();
  windowsOn(d, [entry(1, 300, 400, 3000, 500)]); d.tick();
  const calls = watched(d);
  d.send(d.hub, { k: 'monitors', all: [{ ...AREAS[0]!, w: 1920 }, AREAS[1]!] });
  assert.deepStrictEqual(calls.at(-1)!.map(r => r.id), ['monitor0', 'monitor1', 'window1', 'window1 rest']);
  assert.strictEqual(calls.at(-1)![2]!.rect.w, 1620);
});

test('windows changing keeps the monitors the world was last told', () => {
  const d = desk();
  d.send(d.hub, { k: 'monitors', all: [AREAS[0]!] });
  const calls = watched(d);
  windowsOn(d, [entry(1, 300, 400, 800, 500)]); d.tick();
  assert.deepStrictEqual(calls[0]!.map(r => r.id), ['monitor0', 'window1']);
});

test('a snapshot waiting for its tick when the monitors change is not lost, and not applied twice', () => {
  const d = desk(), calls = watched(d);
  windowsOn(d, [entry(1, 300, 400, 800, 500)]);
  d.send(d.hub, { k: 'monitors', all: [AREAS[0]!] });
  assert.deepStrictEqual(calls[0]!.map(r => r.id), ['monitor0', 'window1']);
  d.tick(3);
  assert.strictEqual(calls.length, 1);
});

test('the world paused still follows the windows', () => {
  const d = desk(), calls = watched(d);
  d.send(d.hub, { k: 'pause', on: true });
  windowsOn(d, [entry(1, 300, 400, 800, 500)]); d.tick();
  assert.strictEqual(calls.length, 1);
});

test('she rides a real window by its id, wherever it goes', () => {
  const d = desk();
  windowsOn(d, [entry(1, 300, 400, 800, 500)]); d.tick();
  const pet = standOn(d, 700, 200, 'window1'), t = pet.P.on!.t;
  for (let i = 1; i <= 40; i++) { windowsOn(d, [entry(1, 300 + i * 4, 400 + i, 800, 500, { z: i % 2 })]); d.tick(); }
  assert.strictEqual(pet.P.on?.surface.owner, 'window1');
  assert.strictEqual(pet.P.on!.t, t);
  assert.strictEqual(pet.P.x, 460 + t);
  assert.strictEqual(pet.P.y, 440);
});

test('she falls when her window closes, maximizes, or goes behind another', () => {
  for (const next of [[], [entry(1, 300, 400, 800, 500, { max: true })], [entry(2, 200, 300, 1000, 800), entry(1, 300, 400, 800, 500, { z: 1 })]]) {
    const d = desk();
    windowsOn(d, [entry(1, 300, 400, 800, 500)]); d.tick();
    const pet = standOn(d, 700, 200, 'window1');
    windowsOn(d, next); d.tick(2);
    assert.strictEqual(pet.P.state, 'air', JSON.stringify(next));
  }
});

test('she stays on when a shell window or an overlay comes up over her', () => {
  const d = desk();
  windowsOn(d, [entry(1, 300, 400, 800, 500)]); d.tick();
  const pet = standOn(d, 700, 200, 'window1');
  windowsOn(d, [entry(2, 0, 0, 3440, 1392, { layered: true, topmost: true }), entry(3, 0, 0, 3440, 1392, { class: 'Windows.UI.Core.CoreWindow' }), entry(1, 300, 400, 800, 500, { z: 2 })]); d.tick(5);
  assert.strictEqual(pet.P.on?.surface.owner, 'window1');
});

test("dragged off the desk, she never goes with it: she's left on the monitor, or she falls", () => {
  const d = desk();
  windowsOn(d, [entry(1, 300, 400, 800, 500)]); d.tick();
  const pet = standOn(d, 700, 200, 'window1');
  for (let x = 300; x > -1200; x -= 10) {
    windowsOn(d, [entry(1, x, 400, 800, 500)]); d.tick();
    assert.ok(pet.P.x >= 0, `x ${pet.P.x}`);
  }
});

/* Hanging into the corners with no monitor in them: left and right of the low one, and past the
   top one's floor. She's left to walk, for a long time, with a push now and then. */
for (const seed of [[100, 1000, 500, 1000], [300, 1700, 800, 500], [2300, 1700, 900, 600], [3200, 900, 900, 900], [-200, 300, 700, 600], [1000, 1000, 800, 1000], [-300, 400, 800, 500], [3000, 500, 800, 500]]) {
  test(`the owner's desk: on a window at ${seed}, her whole body is only ever where an overlay can draw it`, () => {
    const d = desk(), [x, y, w, h] = seed as [number, number, number, number];
    windowsOn(d, [entry(1, x, y, w, h)]); d.tick();
    const rect = d.host.sim!.world.terrain.rectById('window1')!.rect, pet = d.pet();
    const put = () => { standOn(d, rect.x + rect.w / 2, rect.y - 190, 'window1'); pet.P.dur = 0; pet.P.chatT = 0; };
    put();
    let onIt = 0;
    for (let i = 0; i < 12000; i++) {
      d.tick();
      if (pet.P.on?.surface.owner === 'window1') {
        onIt++;
        wholeBody(pet, `tick ${i} as ${pet.P.state}`);
      }
      else if (!pet.P.on && i % 1500 === 1499) put();
    }
    assert.ok(onIt > 100, `on the window for ${onIt} ticks`);
  });
}

test('side by side: a two pixel drag across the join keeps her riding, at scales 1 and 1.5', () => {
  const pair: Area[] = [whole({ i: 0, x: 0, y: 0, w: 1920, h: 1040, scale: 1 }), whole({ i: 1, x: 1920, y: 0, w: 1920, h: 1040, scale: 1.5 })];
  const d = desk(pair), at = (x: number) => [entry(1, x, 400, 800, 500)];
  windowsOn(d, at(1519)); d.tick();
  const pet = standOn(d, 1719, 200, 'window1'), t = pet.P.on!.t;
  assert.ok(Math.abs(pet.P.x - 1719) < 1, `at ${pet.P.x}`);
  for (const x of [1520, 1521]) { windowsOn(d, at(x)); d.tick(); }
  assert.strictEqual(pet.P.on?.surface.owner, 'window1');
  assert.strictEqual(pet.P.state, 'sit');
  assert.strictEqual(pet.P.on!.t, t);
  assert.strictEqual(pet.P.x, 1521 + t);
});

test('side by side: she rides right across, onto the other monitor', () => {
  const pair: Area[] = [whole({ i: 0, x: 0, y: 0, w: 1920, h: 1040, scale: 1 }), whole({ i: 1, x: 1920, y: 0, w: 1920, h: 1040, scale: 1 })];
  const d = desk(pair), at = (x: number) => [entry(1, x, 400, 800, 500)];
  windowsOn(d, at(1000)); d.tick();
  const pet = standOn(d, 1300, 200, 'window1'), t = pet.P.on!.t;
  for (let x = 1000; x <= 2200; x += 10) { windowsOn(d, at(x)); d.tick(); }
  assert.strictEqual(pet.P.on?.surface.owner, 'window1');
  assert.strictEqual(pet.P.x, 2200 + t);
  assert.strictEqual(pet.P.home, 'monitor1');
});

/* Bring everyone here closes each overlay and opens a new one. The hub's leave and the new window's
   join come on different ports, in either order. Each window has its own n. */
test('a leave for the closed overlay that arrives after its replacement joined leaves the replacement joined', () => {
  const d = desk(); d.tick(3);
  const fresh: FakePort = { out: [], postMessage(m) { this.out.push(JSON.parse(JSON.stringify(m))); } };
  d.host.connect(fresh);
  d.send(fresh, { k: 'join', me: AREAS[0]!, n: 7 });
  d.send(d.hub, { k: 'leave', i: 0, n: 0 });
  d.top.out.length = 0;
  d.tick(3);
  assert.ok(fresh.out.some(m => m.k === 'frame'), 'the new window draws');
  assert.deepStrictEqual(d.top.out, [], 'the old one gets nothing');
  const pet = d.pet();
  d.send(fresh, { k: 'down', id: 'b0', x: pet.P.x, y: pet.P.y - 50, from: 0 });
  assert.ok(d.notes.includes('press b0 from overlay 0'), 'and the world hears it');
});

test('a leave that comes first, then the replacement joins, and a late join from the closed one is ignored', () => {
  const d = desk(); d.tick(3);
  const fresh: FakePort = { out: [], postMessage(m) { this.out.push(JSON.parse(JSON.stringify(m))); } };
  d.host.connect(fresh);
  d.send(d.hub, { k: 'leave', i: 0, n: 0 });
  d.send(fresh, { k: 'join', me: AREAS[0]!, n: 7 });
  d.send(d.top, { k: 'join', me: AREAS[0]!, n: 0 });
  d.top.out.length = 0;
  d.tick(3);
  assert.ok(fresh.out.some(m => m.k === 'frame'));
  assert.deepStrictEqual(d.top.out, [], 'the closed window stays gone');
});

test('brought while paused, every overlay is shown where she landed', () => {
  const d = onLow(), pet = d.pet();
  d.send(d.hub, { k: 'pause', on: true });
  d.send(d.top, { k: 'cursor', x: 1500, y: 300, down: false });
  d.send(d.hub, { k: 'bring', id: 'b0' });
  d.tick(2);
  const seen = lastFrame(d.top).pets[0]!;
  assert.strictEqual(seen.off, false, 'on the monitor she was brought to');
  assert.strictEqual(seen.box.l + seen.box.ox, 1500);
  assert.strictEqual(lastFrame(d.low).pets[0]!.off, true, 'and gone from the one she left');
  const P = JSON.stringify([pet.P.x, pet.P.y]);
  d.tick(30);
  assert.strictEqual(JSON.stringify([pet.P.x, pet.P.y]), P, 'still paused');
});

test('an act for a buddy whose id is all is hers alone; everyone has its own message', () => {
  const d = desk();
  d.send(d.hub, { k: 'pets', pets: [BUDDY('all'), BUDDY('b1')] });
  d.tick(200);
  const sim = d.host.sim!, one = sim.pets.get('all')!, other = sim.pets.get('b1')!;
  d.send(d.hub, { k: 'act', id: 'all', a: 'love' });
  assert.deepStrictEqual([one.P.state, other.P.state === 'love'], ['love', false]);
  d.send(d.hub, { k: 'act-all', a: 'sit' });
  assert.deepStrictEqual([one.P.state, other.P.state], ['sit', 'sit']);
});
