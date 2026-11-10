/* Moves that used to happen in one tick, drawn over a few: round a corner, a catch on a wall or the
   ceiling, a pickup and a drop below the floor. Each is measured on her drawn box, worked out from
   the frame a view gets, the way the DOM places it. */
import assert from 'node:assert';
import { test } from 'vitest';
import type { Surface } from '@buddies/terrain';
import { lively, type PetFrame, type Pet } from '../src/index';
import { eased } from '../src/ease';
import { BUDDY, screen, windowRect, world, type TestWorld } from './support';

type M = [number, number, number, number, number, number];
const mul = (p: M, q: M): M => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
function parse(tf: string): M {
  let m: M = [1, 0, 0, 1, 0, 0];
  for (const [, fn, args] of tf.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = args!.split(',').map(s => parseFloat(s)), a = v[0]! * Math.PI / 180;
    const q: M = fn === 'rotate' ? [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0] : fn === 'translate' ? [1, 0, 0, 1, v[0]!, v[1] ?? 0]
      : fn === 'translateY' ? [1, 0, 0, 1, 0, v[0]!] : fn === 'scale' ? [v[0]!, 0, 0, v[1] ?? v[0]!, 0, 0] : [1, 0, 0, 1, 0, 0];
    m = mul(m, q);
  }
  return m;
}
const BB = BUDDY().base.bb;
/* art whose content box isn't the plain buddy's, by its image */
const BBS = new Map<string, typeof BB>();
interface Box { x0: number; y0: number; x1: number; y1: number; rot: number }
/* her drawn content box in viewport px, and how far she's turned */
function drawn(f: PetFrame): Box {
  const S = f.box.size, [ox, oy] = f.origin!.split(' ').map(s => parseFloat(s)) as [number, number];
  const m = mul([1, 0, 0, 1, f.box.l + ox, f.box.t + oy], mul(parse(f.body!), [1, 0, 0, 1, -ox, -oy]));
  const bb = BBS.get(f.src!) ?? BB;
  const pts = [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x0, bb.y1], [bb.x1, bb.y1]].map(([u, v]) => [m[0] * u! * S + m[2] * v! * S + m[4], m[1] * u! * S + m[3] * v! * S + m[5]]);
  const xs = pts.map(p => p[0]!), ys = pts.map(p => p[1]!), flip = m[0] * m[3] - m[1] * m[2] < 0;
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), rot: (flip ? Math.atan2(-m[1], -m[0]) : Math.atan2(m[1], m[0])) * 180 / Math.PI };
}
const VP = { x: 0, y: 0, scale: 1 };
const box = (pet: Pet) => drawn(pet.frame(VP));
/* the largest move of any edge, and the turn, from one tick to the next; `by` takes out a move she was given */
const step = (a: Box, b: Box, by = { x: 0, y: 0 }) => ({
  move: Math.max(Math.abs(b.x0 - a.x0 - by.x), Math.abs(b.x1 - a.x1 - by.x), Math.abs(b.y0 - a.y0 - by.y), Math.abs(b.y1 - a.y1 - by.y)),
  turn: Math.abs(((b.rot - a.rot + 540) % 360) - 180)
});
/* Runs ticks while `go` holds and records the worst step, and how far she went in all. */
function watch(w: TestWorld, pet: Pet, ticks: number, each?: (i: number) => void) {
  let last = box(pet), move = 0, turn = 0;
  for (let i = 0; i < ticks; i++) {
    each?.(i); w.frame();
    const now = box(pet), s = step(last, now);
    move = Math.max(move, s.move); turn = Math.max(turn, s.turn); last = now;
  }
  return { move, turn };
}
const where = (s: Surface) => s.kind === 'wall' ? (s.normal.x > 0 ? 'left' : 'right') : s.kind;
function stand(w: TestWorld, pet: Pet, s: Surface, t: number) {
  pet.P.on = { surface: s, t }; const p = w.terrain.pointOn(s, t); pet.P.x = p.x; pet.P.y = p.y; pet.P.vx = pet.P.vy = 0;
}
const surface = (w: TestWorld, owner: string, kind: string, normal?: number) => w.terrain.surfaces().find(s => s.owner === owner && s.kind === kind && (normal === undefined || s.normal.x === normal))!;

/* The most she may move or turn in a tick going round, and the least a turn may take. */
const ROUND = { move: 45, turn: 20 };

/* ---------- 1. a window's outer corners ---------- */

test('over a window\'s corners she turns round the corner point, a little each tick', () => {
  const w = world([screen('s', 0, 0, 1600, 900), windowRect('w', 500, 400, 500, 300, 1)]), pet = w.add(BUDDY());
  w.run(5);
  const top = surface(w, 'w', 'floor');
  stand(w, pet, top, top.to - top.from - 70); pet.go('climbGo'); w.frame();
  const seen: string[] = [], worst = { move: 0, turn: 0 };
  let last = box(pet), at = pet.P.surf as string;
  for (let i = 0; i < 1500 && seen.length < 2; i++) {
    /* she keeps on going: no stopping to rest on the side */
    if (pet.P.state === 'climb' || pet.P.state === 'crawl') pet.P.dur = 1e9;
    if (pet.P.state === 'climb') pet.P.dir = 1;
    w.frame();
    const now = box(pet), s = step(last, now); last = now;
    worst.move = Math.max(worst.move, s.move); worst.turn = Math.max(worst.turn, s.turn);
    const on = pet.P.on && where(pet.P.on.surface);
    if (on && on !== at) { seen.push(`${at} -> ${on}`); at = on; }
  }
  assert.deepStrictEqual(seen, ['floor -> left', 'left -> ceil'], 'over the top corner and on round the bottom one');
  assert.ok(worst.move <= ROUND.move && worst.turn <= ROUND.turn, `worst tick: moved ${worst.move.toFixed(1)} px, turned ${worst.turn.toFixed(1)} degrees`);
});

test('brought somewhere mid-turn, she\'s drawn there at once', () => {
  const w = world([screen('s', 0, 0, 1600, 900), windowRect('w', 500, 400, 500, 300, 1)]), pet = w.add(BUDDY());
  w.run(5);
  const top = surface(w, 'w', 'floor');
  stand(w, pet, top, top.to - top.from - 40); pet.go('climbGo');
  assert.ok(w.until(() => pet.P.surf === 'left', 200));
  w.run(3);
  pet.bring({ x: 200, y: 300 });
  const b = box(pet);
  assert.ok(Math.abs((b.x0 + b.x1) / 2 - pet.P.x) < 1 && Math.abs(b.y1 - pet.P.y) < 1, `drawn at ${((b.x0 + b.x1) / 2).toFixed(0)},${b.y1.toFixed(0)}, she's at ${pet.P.x.toFixed(0)},${pet.P.y.toFixed(0)}`);
});

test('her window going away mid-turn, she turns back to falling a little each tick', () => {
  const w = world([screen('s', 0, 0, 1600, 900), windowRect('w', 500, 400, 500, 300, 1)]), pet = w.add(BUDDY());
  w.run(5);
  const top = surface(w, 'w', 'floor');
  stand(w, pet, top, top.to - top.from - 40); pet.go('climbGo');
  assert.ok(w.until(() => pet.P.surf === 'left', 200));
  w.run(9);
  let last = box(pet), turn = 0;
  w.sim.setRects([screen('s', 0, 0, 1600, 900)]);
  for (let i = 0; i < 30; i++) { w.frame(); const now = box(pet); turn = Math.max(turn, step(last, now).turn); last = now; }
  assert.strictEqual(pet.P.surf, 'air');
  assert.ok(turn <= ROUND.turn, `worst tick turned ${turn.toFixed(1)} degrees`);
});

/* ---------- 10. inner corners and catches ---------- */

test('into a screen\'s corner she turns onto the wall a little each tick', () => {
  const w = world([screen('s', 0, 0, 1600, 900)]), pet = w.add(BUDDY());
  w.run(5);
  const floor = surface(w, 's', 'floor');
  stand(w, pet, floor, floor.to - floor.from - 90); pet.go('climbGo'); w.frame();
  const r = watch(w, pet, 200, () => { if (pet.P.state === 'climb') { pet.P.dur = 1e9; pet.P.dir = -1; } });
  assert.strictEqual(pet.P.surf, 'right');
  assert.ok(r.turn <= ROUND.turn && r.move <= ROUND.move, `worst tick: moved ${r.move.toFixed(1)} px, turned ${r.turn.toFixed(1)} degrees`);
});

test('up a screen\'s wall into its corner she turns onto the ceiling a little each tick, without going round', () => {
  const w = world([screen('s', 0, 0, 1600, 900)]), pet = w.add(BUDDY());
  w.run(5);
  const wall = surface(w, 's', 'wall', -1);
  stand(w, pet, wall, 200); pet.go('climb', { dir: -1 }); w.frame();
  const r = watch(w, pet, 400, () => { if (pet.P.state === 'climb') { pet.P.dur = 1e9; pet.P.dir = -1; } if (pet.P.state === 'crawl') pet.P.dur = 1e9; });
  assert.strictEqual(pet.P.surf, 'ceil');
  assert.ok(r.turn <= ROUND.turn && r.move <= ROUND.move, `worst tick: moved ${r.move.toFixed(1)} px, turned ${r.turn.toFixed(1)} degrees`);
});

test('caught on a wall or the ceiling, she turns onto it a little each tick', () => {
  for (const [name, aim] of [['wall', { vx: 12, vy: -2 }], ['ceiling', { vx: 1, vy: -16 }]] as const) {
    const w = world([screen('s', 0, 0, 1600, 900)]), pet = w.add(BUDDY());
    w.run(5);
    pet.go('air'); Object.assign(pet.P, aim, { catches: true, thrown: true, x: name === 'wall' ? 1350 : 800, y: name === 'wall' ? 500 : 300 });
    w.frame();
    const r = watch(w, pet, 60);
    assert.strictEqual(pet.P.surf, name === 'wall' ? 'right' : 'ceil', name);
    assert.ok(r.turn <= ROUND.turn, `${name}: worst tick turned ${r.turn.toFixed(1)} degrees`);
  }
});

/* ---------- 4. a pickup ---------- */

function onFloor() {
  const w = world([screen('s', 0, 0, 1600, 900)]), pet = w.add(BUDDY());
  assert.ok(w.until(() => pet.P.surf === 'floor' && pet.P.state !== 'land', 2000));
  pet.go('idle'); pet.P.dur = 1e9; w.frame();
  return { w, pet };
}
/* Pressed a share of the way down her drawn box, then carried along: how far she slid under the
   cursor in a tick. To be let go, she's lifted as she's picked up, and watched until she lands. */
function pickup(down: number, letGo?: number) {
  const { w, pet } = onFloor(), b = box(pet), x = (b.x0 + b.x1) / 2, y = b.y0 + (b.y1 - b.y0) * down;
  const hand = { x, y };
  w.sim.input.down(pet.id, x, y);
  let last = box(pet), worst = 0;
  for (let i = 0; i < (letGo === undefined ? 30 : 120); i++) {
    const by = { x: i < 12 ? 2 : 0, y: 0 };
    hand.x += by.x; hand.y += by.y; w.sim.input.move(pet.id, hand.x, hand.y);
    if (i === 0) { const up = letGo === undefined ? 0 : 150; hand.x += 6; hand.y -= up; w.sim.input.move(pet.id, hand.x, hand.y); by.x += 6; by.y -= up; }
    if (letGo === i) w.sim.input.up(pet.id);
    w.frame();
    if (letGo !== undefined && pet.P.surf === 'floor') break;
    const now = box(pet), s = step(last, now, letGo !== undefined && i >= letGo ? { x: 0, y: 0 } : by); last = now;
    worst = Math.max(worst, s.move);
    if (i === 0) assert.strictEqual(pet.P.state, 'held');
  }
  return { w, pet, worst };
}
const SLIDE = 20;

test('picked up, she keeps where on her she was pressed, and slides to the hold a little each tick', () => {
  for (const down of [.3, .5, .95]) {
    const { worst } = pickup(down);
    assert.ok(worst <= SLIDE, `pressed ${down * 100}% down: she slid ${worst.toFixed(1)} px under the cursor in one tick`);
  }
});

test('pressed while she\'s going round a corner, she stays under the cursor as she\'s picked up', () => {
  const w = world([screen('s', 0, 0, 1600, 900), windowRect('w', 500, 400, 500, 300, 1)]), pet = w.add(BUDDY());
  w.run(5);
  const top = surface(w, 'w', 'floor');
  stand(w, pet, top, top.to - top.from - 40); pet.go('climbGo');
  assert.ok(w.until(() => pet.P.surf === 'left', 200));
  w.run(3);
  const b = box(pet), at = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
  w.sim.input.down(pet.id, at.x, at.y); w.frame();
  let last = box(pet);
  w.sim.input.move(pet.id, at.x + 8, at.y); w.frame();
  assert.strictEqual(pet.P.state, 'held');
  const s = step(last, box(pet), { x: 8, y: 0 });
  assert.ok(s.move <= SLIDE, `she slid ${s.move.toFixed(1)} px under the cursor as she was picked up`);
});

test('let go before the slide is done, she falls from under the hold, drawn going on from where she was', () => {
  const { worst, pet } = pickup(.95, 3);
  assert.strictEqual(pet.P.surf, 'floor');
  assert.ok(worst <= SLIDE, `worst tick ${worst.toFixed(1)} px`);
});

/* ---------- 7. let go below the floor line ---------- */

test('let go with her feet below the floor, she rises to it over a few ticks', () => {
  const { w, pet } = onFloor(), floor = pet.P.y;
  const b = box(pet), x = (b.x0 + b.x1) / 2;
  w.sim.input.down(pet.id, x, b.y0 + 20);
  /* carried down till her feet are 100 px under the floor line, then held there */
  for (let i = 0; i < 20; i++) { w.sim.input.move(pet.id, x + 6, b.y0 + 20 + i * 5 + 5); w.frame(); }
  for (let i = 0; i < 30; i++) w.frame();
  const under = box(pet).y1 - floor;
  assert.ok(under > 80, `her feet are ${under.toFixed(0)} px under the floor`);
  pet.say('down I go'); w.sim.input.up(pet.id);
  let last = box(pet), worst = 0, bubble = 0;
  for (let i = 0; i < 20; i++) {
    w.frame();
    const now = box(pet), f = pet.frame(VP); worst = Math.max(worst, step(last, now).move); last = now;
    if (f.bubble.at && !f.bubble.hidden) bubble = Math.max(bubble, Math.abs(f.bubble.at.her - (now.x0 + now.x1) / 2));
    /* physics doesn't wait: she's on the floor at once, only drawn rising */
    if (i === 0) assert.strictEqual(pet.P.surf, 'floor');
  }
  assert.ok(Math.abs(box(pet).y1 - floor) < 1, 'and she ends standing on it');
  assert.ok(worst <= 30, `worst tick ${worst.toFixed(1)} px`);
  assert.ok(bubble < 1, `her bubble keeps to her: ${bubble.toFixed(1)} px off`);
});

/* ---------- the drawn path stays clear, and a few edges of it ---------- */

/* Her own wall and ceiling art, drawn upright and centred off the surface. */
const ownArt = (key: string) => ({ fps: 6, frames: [{ src: `data:image/png;base64,${key}`, bb: BB }] });
const CLIMBER = () => BUDDY('a', { poses: { climb: ownArt('Yw'), wall: ownArt('Ww'), crawl: ownArt('Cw'), hang: ownArt('SA') } });
/* How far her drawn box is into a rectangle, on its shallower axis: 0 when it's clear. */
const into = (b: Box, r: { x: number; y: number; w: number; h: number }) => Math.max(0, Math.min(Math.min(b.x1, r.x + r.w) - Math.max(b.x0, r.x), Math.min(b.y1, r.y + r.h) - Math.max(b.y0, r.y)));
const mid = (b: Box) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });

/* How much deeper a turn draws her into what she's going round than she's drawn just before and
   just after it: her animations can tip her a little into a surface anyway, the turn must add nothing. */
function deeper(digs: number[], changes: number[]) {
  let worst = -Infinity;
  for (const c of changes) {
    const turn = Math.max(...digs.slice(c, c + 19)), bound = Math.max(digs[c - 1] ?? 0, digs[c + 19] ?? 0, 0);
    worst = Math.max(worst, turn - bound);
  }
  return worst;
}

test('into a screen\'s corners her drawing never goes into either wall', () => {
  const w = world([screen('s', 0, 0, 1600, 900)]), pet = w.add(BUDDY());
  w.run(5);
  const floor = surface(w, 's', 'floor');
  stand(w, pet, floor, floor.to - floor.from - 90); pet.go('climbGo'); w.frame();
  const digs: number[] = [], changes: number[] = [];
  let seen = pet.P.surf as string;
  for (let i = 0; i < 2500 && seen !== 'ceil'; i++) {
    if (pet.P.state === 'climb') { pet.P.dur = 1e9; pet.P.dir = -1; }
    w.frame();
    const b = box(pet); digs.push(Math.max(b.x1 - 1600, b.y1 - 900, -b.y0, -b.x0));
    if (pet.P.surf !== seen) { changes.push(i); seen = pet.P.surf; }
  }
  for (let i = 0; i < 20; i++) { w.frame(); const b = box(pet); digs.push(Math.max(b.x1 - 1600, b.y1 - 900, -b.y0, -b.x0)); }
  assert.strictEqual(changes.length, 2, 'up the wall and onto the ceiling');
  const d = deeper(digs, changes);
  assert.ok(d <= .5, `a turn drew her ${d.toFixed(1)} px deeper into a wall`);
});

/* as wide as she is tall, as the sample art is */
const WIDE = () => { const base = { src: 'data:image/png;base64,V0lERQ', bb: { x0: 0, y0: 0, x1: 1, y1: 1 } }; BBS.set(base.src, base.bb); return BUDDY('a', { base }); };
for (const [name, make] of [['her main image', () => BUDDY()], ['her own climbing art', CLIMBER], ['a main image as wide as she is tall', WIDE]] as const) {
  test(`over a window's corners her drawing stays out of the window: ${name}`, () => {
    const rect = { x: 500, y: 400, w: 500, h: 300 };
    const w = world([screen('s', 0, 0, 1600, 900), windowRect('w', rect.x, rect.y, rect.w, rect.h, 1)]), pet = w.add(make());
    w.run(5);
    const top = surface(w, 'w', 'floor');
    stand(w, pet, top, top.to - top.from - 70); pet.go('climbGo'); w.frame();
    const digs: number[] = [], changes: number[] = [];
    let seen = pet.P.surf as string, inside = 0, last = box(pet), move = 0, turn = 0;
    for (let i = 0; i < 1500 && seen !== 'ceil'; i++) {
      if (pet.P.state === 'climb' || pet.P.state === 'crawl') pet.P.dur = 1e9;
      if (pet.P.state === 'climb') pet.P.dir = 1;
      w.frame();
      const b = box(pet), m = mid(b), st = step(last, b); digs.push(into(b, rect)); last = b;
      move = Math.max(move, st.move); turn = Math.max(turn, st.turn);
      if (m.x > rect.x && m.x < rect.x + rect.w && m.y > rect.y && m.y < rect.y + rect.h) inside++;
      if (pet.P.surf !== seen) { changes.push(i); seen = pet.P.surf; }
    }
    for (let i = 0; i < 20; i++) { w.frame(); digs.push(into(box(pet), rect)); }
    assert.strictEqual(changes.length, 2, 'over the top corner and round the bottom one');
    assert.strictEqual(inside, 0, 'her middle is never drawn inside the window');
    const d = deeper(digs, changes);
    assert.ok(d <= .5, `a turn drew her ${d.toFixed(1)} px deeper into the window`);
    assert.ok(move <= ROUND.move && turn <= ROUND.turn, `worst tick: moved ${move.toFixed(1)} px, turned ${turn.toFixed(1)} degrees`);
  });
}

test('her window going away late in a turn, a long tick draws her where she is, not nowhere', () => {
  /* art for everything she does here, so nothing turns her: the turn left is exactly none */
  const still = BUDDY('a', { poses: { ...CLIMBER().poses, stand: ownArt('St'), walk: ownArt('Wk'), run: ownArt('Rn'), fall: ownArt('Fl'), jump: ownArt('Jp') } });
  const w = world([screen('s', 0, 0, 1600, 900), windowRect('w', 500, 400, 500, 300, 1)]), pet = w.add(still);
  w.run(5);
  const top = surface(w, 'w', 'floor');
  stand(w, pet, top, top.to - top.from - 40); pet.go('climbGo');
  assert.ok(w.until(() => pet.P.surf === 'left', 200));
  w.run(11);
  w.sim.setRects([screen('s', 0, 0, 1600, 900)]);
  w.now.t += 33.3; w.sim.advance(w.now.t);
  const f = pet.frame(VP);
  assert.ok(!/NaN/.test(f.body! + f.tf + f.origin), f.body!);
  const b = drawn(f);
  assert.ok([b.x0, b.y0, b.x1, b.y1].every(Number.isFinite), JSON.stringify(b));
});

test('her screen resized mid-turn, she\'s drawn where she is on it', () => {
  const w = world([screen('s', 0, 0, 1600, 900)]), pet = w.add(BUDDY());
  w.run(5);
  const floor = surface(w, 's', 'floor');
  stand(w, pet, floor, floor.to - floor.from - 70); pet.go('climbGo');
  assert.ok(w.until(() => pet.P.surf === 'right', 200));
  w.run(3);
  w.sim.setRects([screen('s', 0, 0, 900, 500)]); w.frame();
  /* her climbing scrabble can tip her a few px past the wall; the old corner was 500 px away */
  const b = box(pet);
  assert.ok(b.x1 <= 905 && b.y1 <= 505, `drawn at ${JSON.stringify(b)}, off a 900 by 500 screen`);
});

test('the cursor moving during the slide carries her all the way, from the first move on', () => {
  {
    const { w, pet } = onFloor(), at = mid(box(pet));
    w.sim.input.down(pet.id, at.x, at.y); w.sim.input.move(pet.id, at.x + 6, at.y); w.frame();
    const one = mid(box(pet));
    w.sim.input.move(pet.id, at.x + 106, at.y); w.frame();
    const two = mid(box(pet));
    assert.ok(two.x - one.x > 90, `the cursor went 100 px, her middle ${(two.x - one.x).toFixed(1)}`);
  }
  {
    const { w, pet } = onFloor(), at = mid(box(pet));
    w.sim.input.down(pet.id, at.x, at.y);
    for (const dx of [6, 50, 100]) w.sim.input.move(pet.id, at.x + dx, at.y);
    w.frame();
    const now = mid(box(pet));
    assert.ok(Math.abs(now.x - at.x - 100) < 2 && Math.abs(now.y - at.y) < 2, `three moves to +100 before a tick: her middle went ${(now.x - at.x).toFixed(1)}, ${(now.y - at.y).toFixed(1)}`);
  }
});

test('picked up mid-animation, the spot pressed is where her drawing was, turn and all', () => {
  const { w, pet } = onFloor();
  pet.go('trip'); pet.P.dur = 1e9; w.run(3);
  const at = mid(box(pet));
  w.sim.input.down(pet.id, at.x, at.y); w.sim.input.move(pet.id, at.x + 6, at.y); w.frame();
  assert.strictEqual(pet.P.state, 'held');
  const now = mid(box(pet));
  assert.ok(Math.hypot(now.x - at.x - 6, now.y - at.y) < 2, `her middle went ${(now.x - at.x).toFixed(1)}, ${(now.y - at.y).toFixed(1)} for a 6 px move`);
});

test('let go off a window during the slide, she falls beside it, never through it', () => {
  const rect = { x: 500, y: 400, w: 500, h: 300 };
  const w = world([screen('s', 0, 0, 1600, 900), windowRect('w', rect.x, rect.y, rect.w, rect.h, 1)]), pet = w.add(BUDDY());
  w.run(5);
  const top = surface(w, 'w', 'floor');
  stand(w, pet, top, 400); pet.go('idle'); pet.P.dur = 1e9; w.frame();
  const at = mid(box(pet));
  w.sim.input.down(pet.id, at.x, at.y); w.sim.input.move(pet.id, at.x + 6, at.y); w.frame();
  w.sim.input.move(pet.id, 1036, at.y); w.frame();
  /* long enough that the let-go throws nothing, short enough that she's still sliding */
  w.run(4);
  w.sim.input.up(pet.id);
  /* from under the hold, as she always fell: not from where she's drawn mid-slide */
  assert.ok(Math.abs(pet.P.x - 1036) < .01 && Math.abs(pet.P.y - (at.y + .88 * 120)) < .01, `let go at ${pet.P.x.toFixed(1)},${pet.P.y.toFixed(1)}`);
  let through = 0;
  for (let i = 0; i < 200 && pet.P.surf !== 'floor'; i++) {
    w.frame();
    if (pet.P.x > rect.x && pet.P.x < rect.x + rect.w && pet.P.y > rect.y && pet.P.y < rect.y + rect.h) through++;
  }
  assert.strictEqual(through, 0, 'she was inside the window');
});

test('round each of a screen\'s corners, her middle takes the short way', () => {
  /* onto the right wall, up it onto the ceiling, along that onto the left wall, down that onto the floor */
  for (const make of [() => BUDDY(), CLIMBER]) for (const [kind, normal, at, go, dir] of [['floor', undefined, 1500, 'climbGo', 1], ['wall', -1, 150, 'climb', -1], ['ceil', undefined, 150, 'crawl', -1], ['wall', 1, 750, 'climb', 1]] as const) {
    const w = world([screen('s', 0, 0, 1600, 900)]), pet = w.add(make());
    w.run(5);
    const from = surface(w, 's', kind, normal);
    stand(w, pet, from, at); pet.go(go, { dir }); w.frame();
    const was = pet.P.surf, mids = [mid(box(pet))];
    let at0 = -1;
    const r = watch(w, pet, 300, i => {
      if (pet.P.state === go && go !== 'climbGo') { pet.P.dur = 1e9; pet.P.dir = dir; }
      mids.push(mid(box(pet))); if (at0 < 0 && pet.P.surf !== was) at0 = i;
    });
    assert.ok(at0 > 0, `round the corner from ${was}`);
    /* into an inner corner her middle hardly moves: it never strays far from the line between
       where it was before the turn and where it is after */
    const a0 = mids[at0 - 1]!, a1 = mids[at0 + 22]!, len = Math.hypot(a1.x - a0.x, a1.y - a0.y) || 1;
    const off = Math.max(...mids.slice(at0, at0 + 20).map(m => Math.abs((m.x - a0.x) * (a1.y - a0.y) - (m.y - a0.y) * (a1.x - a0.x)) / len));
    assert.ok(off <= 15, `from ${was}, her middle strayed ${off.toFixed(1)} px off its way`);
    assert.ok(r.move <= ROUND.move && r.turn <= ROUND.turn, `from ${was}, worst tick: moved ${r.move.toFixed(1)} px, turned ${r.turn.toFixed(1)} degrees`);
  }
});

test('a wide buddy over a window\'s corner takes the time her wider swing needs', () => {
  const w = world([screen('s', 0, 0, 1600, 900), windowRect('w', 500, 300, 500, 400, 1)]), pet = w.add(WIDE());
  w.run(5);
  stand(w, pet, surface(w, 'w', 'wall', 1), 150); pet.go('climb', { dir: -1 }); w.frame();
  const r = watch(w, pet, 300, () => { if (pet.P.state === 'climb') { pet.P.dur = 1e9; pet.P.dir = -1; } });
  assert.strictEqual(pet.P.surf, 'floor');
  assert.ok(r.move <= ROUND.move && r.turn <= ROUND.turn, `worst tick: moved ${r.move.toFixed(1)} px, turned ${r.turn.toFixed(1)} degrees`);
});

test('over a window\'s corners, any size of buddy, square or tall, her middle never jumps', () => {
  const jumps: string[] = [];
  for (const size of [64, 128, 240, 512]) for (const [shape, bb] of [['square', { x0: 0, y0: 0, x1: 1, y1: 1 }], ['tall', { x0: .25, y0: 0, x1: .75, y1: 1 }]] as const) {
    const base = { src: `data:image/png;base64,${shape}${size}`, bb }; BBS.set(base.src, bb);
    /* room all round: a path that would leave the screen isn't drawn at all */
    const rect = { x: 1300, y: 1300, w: 1400, h: 1200 };
    const w = world([screen('s', 0, 0, 4000, 4000), windowRect('w', rect.x, rect.y, rect.w, rect.h, 1)]), pet = w.add(BUDDY('a', { size, base }));
    w.run(5);
    const top = surface(w, 'w', 'floor');
    stand(w, pet, top, top.to - top.from - size); pet.go('climbGo'); w.frame();
    let last = mid(box(pet)), worst = 0, seen = pet.P.surf as string, turns = 0;
    for (let i = 0; i < 6000 && turns < 2; i++) {
      if (pet.P.state === 'climb' || pet.P.state === 'crawl') pet.P.dur = 1e9;
      if (pet.P.state === 'climb') pet.P.dir = 1;
      w.frame();
      const m = mid(box(pet)); worst = Math.max(worst, Math.hypot(m.x - last.x, m.y - last.y)); last = m;
      if (pet.P.surf !== seen) { turns++; seen = pet.P.surf; }
    }
    for (let i = 0; i < 40; i++) { w.frame(); const m = mid(box(pet)); worst = Math.max(worst, Math.hypot(m.x - last.x, m.y - last.y)); last = m; }
    assert.strictEqual(turns, 2, `${shape} ${size}: over the top corner and round the bottom one`);
    if (worst > ROUND.move) jumps.push(`${shape} ${size}: her middle moved ${worst.toFixed(1)} px in one tick`);
  }
  assert.deepStrictEqual(jumps, []);
});

test('the same monitors listed in another order are no change: a turn under way goes on', () => {
  const win = windowRect('w', 500, 400, 500, 300, 1);
  const w = world([screen('a', 0, 0, 1600, 900), screen('b', 1600, 0, 1600, 900), win]), pet = w.add(BUDDY());
  w.run(5);
  const top = surface(w, 'w', 'floor');
  stand(w, pet, top, top.to - top.from - 40); pet.go('climbGo');
  assert.ok(w.until(() => pet.P.surf === 'left', 200));
  w.run(3);
  let last = box(pet);
  w.sim.setRects([screen('b', 1600, 0, 1600, 900), screen('a', 0, 0, 1600, 900), win]);
  let worst = 0;
  for (let i = 0; i < 20; i++) { w.frame(); const b = box(pet); worst = Math.max(worst, step(last, b).move); last = b; }
  assert.ok(worst <= ROUND.move, `she moved ${worst.toFixed(1)} px in one tick`);
});

/* ---------- combined review: asymmetric art, room, moving windows, scale, leaving a surface ---------- */

const LEFT = { x0: 0, y0: 0, x1: .6, y1: 1 };
const leftArt = (key: string) => { const src = `data:image/png;base64,${key}`; BBS.set(src, LEFT); return { fps: 6, frames: [{ src, bb: LEFT }] }; };

test('art that reaches out to one side: onto a screen\'s wall her middle doesn\'t jump and she stays out of it', () => {
  const w = world([screen('s', 0, 0, 1600, 900)]), pet = w.add(BUDDY('a', { poses: { stand: leftArt('TGVmdFN0'), climb: leftArt('TGVmdENs') } }));
  w.run(5);
  const floor = surface(w, 's', 'floor');
  stand(w, pet, floor, floor.to - floor.from - 90); pet.go('climbGo'); w.frame();
  const digs: number[] = [], changes: number[] = [];
  let last = mid(box(pet)), worst = 0, seen = pet.P.surf as string;
  for (let i = 0; i < 200; i++) {
    if (pet.P.state === 'climb') { pet.P.dur = 1e9; pet.P.dir = -1; }
    w.frame();
    const b = box(pet), m = mid(b); worst = Math.max(worst, Math.hypot(m.x - last.x, m.y - last.y)); last = m;
    digs.push(Math.max(b.x1 - 1600, b.y1 - 900, 0));
    if (pet.P.surf !== seen) { changes.push(i); seen = pet.P.surf; }
  }
  assert.strictEqual(changes.length, 1, 'onto the wall');
  assert.ok(worst <= 15, `her middle moved ${worst.toFixed(1)} px in one tick`);
  const d = deeper(digs, changes);
  assert.ok(d <= .5, `a turn drew her ${d.toFixed(1)} px deeper into the wall`);
});

test('over a window\'s corner near the screen\'s edge, her drawing never leaves the screen', () => {
  const w = world([screen('s', 0, 0, 1600, 900), windowRect('w', 970, 300, 500, 400, 1)]), pet = w.add(WIDE());
  w.run(5);
  const top = surface(w, 'w', 'floor');
  stand(w, pet, top, top.to - top.from - 70); pet.go('climbGo'); w.frame();
  let right = 0, seen = pet.P.surf as string, last = mid(box(pet)), worst = 0;
  for (let i = 0; i < 200; i++) {
    if (pet.P.state === 'climb') { pet.P.dur = 1e9; pet.P.dir = 1; }
    w.frame();
    const b = box(pet), m = mid(b); right = Math.max(right, b.x1); worst = Math.max(worst, Math.hypot(m.x - last.x, m.y - last.y)); last = m;
    if (pet.P.surf !== seen) seen = pet.P.surf;
  }
  assert.strictEqual(seen, 'left', 'onto the window\'s side');
  assert.ok(right <= 1600.5, `drawn out to x ${right.toFixed(1)}, off a 1600 px screen`);
  /* and she still goes round: drawn in from the screen's edge, not snapped across */
  assert.ok(worst <= ROUND.move, `her middle moved ${worst.toFixed(1)} px in one tick`);
});

test('her window moving mid-turn, the turn goes round where the corner is now', () => {
  const rect = { x: 500, y: 400, w: 500, h: 300 };
  const w = world([screen('s', 0, 0, 1600, 900), windowRect('w', rect.x, rect.y, rect.w, rect.h, 1)]), pet = w.add(BUDDY());
  w.run(5);
  const top = surface(w, 'w', 'floor');
  stand(w, pet, top, top.to - top.from - 40); pet.go('climbGo');
  assert.ok(w.until(() => pet.P.surf === 'left', 200));
  const before = into(box(pet), rect);
  w.run(4);
  const moved = { ...rect, y: rect.y - 20 };
  w.sim.setRects([screen('s', 0, 0, 1600, 900), windowRect('w', moved.x, moved.y, moved.w, moved.h, 1)]);
  /* the rest of the turn, then her climbing after it, which tips her a little anyway */
  const digs: number[] = [];
  for (let i = 0; i < 40; i++) { if (pet.P.state === 'climb') { pet.P.dur = 1e9; pet.P.dir = 1; } w.frame(); digs.push(into(box(pet), moved)); }
  const turn = Math.max(...digs.slice(0, 12)), after = Math.max(...digs.slice(20));
  assert.strictEqual(pet.P.surf, 'left');
  assert.ok(turn <= Math.max(before, after) + .5, `drawn ${turn.toFixed(1)} px into the moved window`);
});

test('a corner takes as long at any monitor scale', () => {
  const at = (k: number) => {
    const corner = { pivot: { x: 1000 * k, y: 400 * k }, wind: 1, na: { x: 0, y: -1 }, nb: { x: 1, y: 0 }, inner: false };
    const c0 = { x: 940 * k, y: 340 * k }, c1 = { x: 1060 * k, y: 462 * k };
    const e = { from: 0, n: 12, rot: 0, c: c0, d: { x: 0, y: 0 }, corner, on: 'w' };
    eased(e, 0, c1, 90, { w: 120 * k, h: 120 * k, k });
    return e.n;
  };
  assert.ok(Math.abs(at(2) - at(1)) < .01, `${at(1).toFixed(2)} frames at scale 1, ${at(2).toFixed(2)} at scale 2`);
});

test('leaving a wall or the ceiling for the air, she turns upright a little each tick, never into it', () => {
  const run = (name: string, set: (w: TestWorld, pet: Pet) => void, act: (pet: Pet) => void, line: (b: Box) => number) => {
    const w = world([screen('s', 0, 0, 1600, 900)], { pace: { ...lively, weights: { ...lively.weights, leap: 1e9 } } }), pet = w.add(BUDDY());
    w.run(5); set(w, pet); w.run(20);
    let last = box(pet), turn = 0, dig = 0;
    const was = line(last);
    act(pet);
    for (let i = 0; i < 30; i++) { w.frame(); const b = box(pet); turn = Math.max(turn, step(last, b).turn); dig = Math.max(dig, line(b)); last = b; }
    assert.strictEqual(pet.P.surf, 'air', name);
    assert.ok(turn <= ROUND.turn, `${name}: turned ${turn.toFixed(1)} degrees in a tick`);
    /* her flight stretches her a little taller than she was on it, so a pixel of give */
    assert.ok(dig <= Math.max(was, 0) + 1, `${name}: drawn ${dig.toFixed(1)} px into what she left`);
  };
  const onWall = (w: TestWorld, pet: Pet) => { stand(w, pet, surface(w, 's', 'wall', -1), 500); pet.go('wall'); pet.P.dur = 1e9; };
  run('dropped off a wall', onWall, pet => pet.act('drop'), b => b.x1 - 1600);
  run('dropped off the ceiling', (w, pet) => { stand(w, pet, surface(w, 's', 'ceil'), 800); pet.go('hang'); pet.P.dur = 1e9; }, pet => pet.act('drop'), b => -b.y0);
  run('leapt off a wall', onWall, pet => { pet.P.dur = 0; }, b => b.x1 - 1600);
});

test('a move with no time left, or less than none, ends at once', () => {
  for (const n of [0, -1]) {
    const e = { from: 10, n, rot: 0, c: { x: 0, y: 0 }, d: { x: 5, y: 5 }, corner: null, on: null };
    assert.strictEqual(eased(e, 10, { x: 1, y: 1 }, 0, { w: 10, h: 10, k: 1 }), null, `n ${n}`);
  }
});

/* ---------- landing ends a move; on the screen beats clear of the corner ---------- */

for (const ms of [16.667, 33.334, 50]) test(`let go of a wall low down, she lands and is drawn on what she lands on, not through it: ${ms} ms ticks`, () => {
  for (const [name, rects, floorY] of [['the screen\'s floor', [screen('s', 0, 0, 1600, 900)], 900], ['a window under her', [screen('s', 0, 0, 1600, 900), windowRect('u', 1400, 700, 200, 200, 1)], 700]] as const) {
    const w = world([...rects]), pet = w.add(BUDDY());
    w.run(5);
    stand(w, pet, surface(w, 's', 'wall', -1), floorY - 62); pet.go('wall'); pet.P.dur = 1e9; w.run(20);
    pet.act('drop');
    let low = 0, landed = -1;
    for (let i = 0; i < 40; i++) { w.now.t += ms; w.sim.advance(w.now.t); low = Math.max(low, box(pet).y1); if (landed < 0 && pet.P.surf === 'floor') landed = i; }
    assert.ok(landed >= 0, `${name}: landed`);
    assert.ok(low <= floorY + .5, `${name}: drawn down to ${low.toFixed(1)}, under ${floorY}`);
  }
});

/* How far her drawn box may go into the window whose corner she rounds near the screen's edge, as
   a share of her size: on the screen comes first, so with no room to swing clear she's drawn
   briefly over its corner. Measured 0.27 to 0.31 of her size from 64 to 512 px. */
const CORNER_OVERLAP = 1 / 3;

test('over a window\'s corner near the screen\'s edge, any size of buddy stays on the screen and goes round, over the corner a little', () => {
  const seen: string[] = [];
  for (const size of [64, 120, 240, 512]) {
    /* Codex's scene for a 120 px buddy, scaled with her */
    const f = size / 120, rect = { x: 970 * f, y: 300 * f, w: 500 * f, h: 400 * f };
    const base = { src: `data:image/png;base64,V0lERQ${size}`, bb: { x0: 0, y0: 0, x1: 1, y1: 1 } }; BBS.set(base.src, base.bb);
    const w = world([screen('s', 0, 0, 1600 * f, 900 * f), windowRect('w', rect.x, rect.y, rect.w, rect.h, 1)]), pet = w.add(BUDDY('a', { size, base }));
    w.run(5);
    const top = surface(w, 'w', 'floor');
    stand(w, pet, top, top.to - top.from - 70 * f); pet.go('climbGo'); w.frame();
    let right = 0, last = mid(box(pet)), worst = 0, over = 0, onto = -1;
    /* till she's onto the window's side and the turn is well over */
    for (let i = 0; i < 400 && (onto < 0 || i < onto + 60); i++) {
      if (pet.P.state === 'climb') { pet.P.dur = 1e9; pet.P.dir = 1; }
      w.frame();
      const b = box(pet), m = mid(b);
      right = Math.max(right, b.x1); worst = Math.max(worst, Math.hypot(m.x - last.x, m.y - last.y)); over = Math.max(over, into(b, rect)); last = m;
      if (onto < 0 && pet.P.surf === 'left') onto = i;
    }
    assert.ok(onto >= 0, `${size}: onto the window's side`);
    assert.ok(right <= 1600 * f + .5, `${size}: drawn out to x ${right.toFixed(1)}, off a ${1600 * f} px screen`);
    /* a 512 px buddy squeezed round that corner moves 51.5 px in her fastest tick, a tenth of her size */
    assert.ok(worst <= Math.max(ROUND.move, size / 9), `${size}: her middle moved ${worst.toFixed(1)} px in one tick`);
    if (over > CORNER_OVERLAP * size) seen.push(`${size}: drawn ${over.toFixed(1)} px over the window's corner, ${(over / size).toFixed(3)} of her size`);
  }
  assert.deepStrictEqual(seen, []);
});
