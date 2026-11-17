/* Her bubble wraps, so it can be taller and wider than one line: it's placed by the size it will be. */
import assert from 'node:assert';
import { test } from 'vitest';
import type { Pet } from '../src/index';
import { BUBBLE, bubbleSize } from '../src/voice';
import { BUDDY, screen, world } from './support';

test('the size comes from the text, wrapped at spaces as the page wraps it', () => {
  assert.deepStrictEqual(bubbleSize('hi!'), { w: 3 * BUBBLE.letter + 2 * BUBBLE.pad, lines: 1, badge: false });
  /* an artist's longest, 38 letters: two lines, as wide as a bubble gets */
  assert.deepStrictEqual(bubbleSize('Have you been staring at that all day?'), { w: BUBBLE.max, lines: 2, badge: false });
  /* a line fills to the last word that fits, and the next starts the new one */
  const per = Math.floor((BUBBLE.max - 2 * BUBBLE.pad) / BUBBLE.letter);
  assert.strictEqual(bubbleSize('x'.repeat(per)).lines, 1);
  assert.strictEqual(bubbleSize(`${'x'.repeat(per - 2)} yy`).lines, 2);
  /* one word too long for a line is broken where it must be */
  assert.strictEqual(bubbleSize('x'.repeat(per * 2 + 1)).lines, 3);
  assert.strictEqual(bubbleSize(`a ${'x'.repeat(per + 1)}`).lines, 3);
  /* runs of spaces are one, as the page shows them */
  assert.deepStrictEqual(bubbleSize('  Hi   there  '), bubbleSize('Hi there'));
  assert.strictEqual(bubbleSize('', '').lines, 1);
  assert.strictEqual(bubbleSize('Build passed', 'An app').badge, true);
});

test('wide letters, full-width scripts and an app\'s badge make it bigger', () => {
  const per = Math.floor((BUBBLE.max - 2 * BUBBLE.pad) / BUBBLE.letter);
  /* a W is as wide as two letters: half as many fit a line */
  assert.strictEqual(bubbleSize('x'.repeat(per)).lines, 1);
  assert.strictEqual(bubbleSize('W'.repeat(per)).lines, 2);
  assert.strictEqual(bubbleSize('W'.repeat(108)).lines, 8);
  /* capitals and m and w a little wider than the rest */
  assert.ok(bubbleSize('MAMA').w > bubbleSize('nana').w);
  assert.ok(bubbleSize('Amwz').w > bubbleSize('anoz').w);
  /* CJK and the like count two each */
  assert.strictEqual(bubbleSize('\u4f60'.repeat(per / 2 | 0)).lines, 1);
  assert.strictEqual(bubbleSize('\u4f60'.repeat(per)).lines, 2);
  assert.strictEqual(bubbleSize('\ud55c'.repeat(per)).lines, 2);
  /* a short line from an app with a long name is as wide as its badge */
  const badge = bubbleSize('Hi', 'Very Wide App Name Here');
  assert.ok(badge.w >= 200 && badge.w <= BUBBLE.max, String(badge.w));
  assert.strictEqual(bubbleSize('the tests all passed', 'A').w, bubbleSize('the tests all passed').w, 'a short name is narrower than the line');
});

/* A screen this short has her head 80 px under its top while she stands on its floor. */
function standing(h = 200) {
  const w = world([screen('s', 0, 0, 1280, h)]), pet = w.add(BUDDY('a', { name: '' }));
  assert.ok(w.until(() => pet.P.surf === 'floor' && pet.P.state !== 'land', 2000));
  pet.go('sit'); pet.P.dur = 1e9; pet.P.chatT = 1e9;
  return { w, pet };
}
const said = (w: ReturnType<typeof world>, pet: Pet, text: string, from = '') => {
  if (from) w.sim.say(pet.id, text, from); else pet.say(text);
  w.frame();
  return pet.frame({ x: 0, y: 0, scale: 1 }).bubble;
};

test('near the top, a bubble too tall for the room above her head goes below her instead', () => {
  const { w, pet } = standing();
  assert.strictEqual(said(w, pet, 'Hi there!').below, false, 'one line fits above');
  assert.strictEqual(said(w, pet, 'Have you been staring at that all day?').below, false, 'two lines fit above');
  assert.strictEqual(said(w, pet, 'I think I will take a little nap here, right by the clock, if you do not mind.').below, true, 'three lines don\'t');
  /* an app's badge takes room too */
  const { w: v, pet: q } = standing(170);
  assert.strictEqual(said(v, q, 'Done').below, false);
  assert.strictEqual(said(v, q, 'Done', 'An app').below, true);
});

test('a wrapped bubble near a side keeps all of its width on her screen', () => {
  const w = world([screen('s', 0, 0, 1280, 720)]), pet = w.add(BUDDY('a', { name: '' }));
  assert.ok(w.until(() => pet.P.surf === 'floor' && pet.P.state !== 'land', 2000));
  for (const x of [5, 1275]) {
    const on = pet.P.on!; on.t = x - on.surface.from; pet.P.x = x;
    pet.go('sit'); pet.P.dur = 1e9; pet.P.chatT = 1e9;
    const b = said(w, pet, 'Mmm, that is the good spot right there');
    const [bx = 0] = b.tf!.match(/-?[\d.]+/g)!.map(Number);
    assert.ok(Math.abs(pet.P.x - x) < 1, `she's at ${pet.P.x}`);
    assert.ok(bx - BUBBLE.max / 2 >= 0 && bx + BUBBLE.max / 2 <= 1280, `at ${x}: ${b.tf}`);
    /* one short line keeps the 70 it always had */
    const [sx = 0] = said(w, pet, 'Hi!').tf!.match(/-?[\d.]+/g)!.map(Number);
    assert.strictEqual(Math.min(sx, 1280 - sx), 70, `at ${x}: ${sx}`);
  }
});

/* Mute: her own lines stay unsaid, alone or with everyone, and a line another app sent still shows. */
test('a muted buddy keeps her own lines to herself, and an app\'s line still shows', () => {
  const { w, pet } = standing(720);
  const other = BUDDY('b', { name: '' }), pets = [BUDDY('a', { name: '' }), other];
  const set = (more: { talk?: boolean; quiet?: string[] }) => w.sim.sync({ pets, ...more });
  set({ quiet: ['a'] });
  assert.strictEqual(said(w, pet, 'Hi there!').hidden, true, 'muted, her own line');
  assert.strictEqual(said(w, w.sim.pets.get('b')!, 'Hi there!').hidden, false, 'the other one talks');
  const app = said(w, pet, 'Build passed', 'An app');
  assert.strictEqual(app.hidden, false); assert.strictEqual(app.from, 'An app');
  set({ talk: false });
  assert.notStrictEqual(said(w, w.sim.pets.get('b')!, 'Hello again').text, 'Hello again', 'nobody talks');
  assert.strictEqual(said(w, w.sim.pets.get('b')!, 'Mine', 'An app').text, 'Mine');
  set({});
  /* the app's line is hers for its time first */
  w.run(160);
  assert.strictEqual(said(w, pet, 'Back again').text, 'Back again', 'talking is the default');
});

test('muted, she never chats on her own', () => {
  const w = world([screen('s', 0, 0, 1280, 720)]), pet = w.add(BUDDY('a', { name: '' }));
  w.sim.sync({ pets: [BUDDY('a', { name: '' })], quiet: ['a'] });
  let shown = 0;
  for (let i = 0; i < 20000; i++) { w.frame(); if (!pet.frame({ x: 0, y: 0, scale: 1 }).bubble.hidden) shown++; }
  assert.strictEqual(shown, 0);
  w.sim.sync({ pets: [BUDDY('a', { name: '' })] });
  assert.ok(w.until(() => !pet.frame({ x: 0, y: 0, scale: 1 }).bubble.hidden, 20000), 'and does once she talks again');
});

/* An app's line keeps her bubble for its time, as one a muted buddy still shows: the person allowed
   that app. A line of her own meanwhile is skipped, never kept for later, and leaves its time as it
   was. In run 44011961141 a wave asked for while she was in the air started as she landed, and its
   hello took the place of the app's line before anyone could read it. */
const bubbleOf = (pet: Pet) => pet.frame({ x: 0, y: 0, scale: 1 }).bubble;
const APP = { text: 'Hello from the MCP check', from: 'E2E MCP' };
/* the app's line, from the hub, for as long as it shows: how many ticks, and what showed after */
function lasts(w: ReturnType<typeof world>, pet: Pet, most = 600, each = () => {}) {
  let n = 0;
  for (; n < most; n++) { const b = bubbleOf(pet); if (b.hidden || b.text !== APP.text || b.from !== APP.from) break; w.frame(); each(); }
  return { ticks: n, then: bubbleOf(pet) };
}
/* ticks an app line of this length shows for, at 60 a second: 2.6 s, or 2 s and 40 ms a letter */
const appTicks = (text: string) => Math.max(2600, 2000 + text.length * 40) / 16.667;

test('a wave asked for in the air, then an app\'s line: her hello as she lands and waves doesn\'t cut the line off', () => {
  const w = world([screen('s', 0, 0, 1280, 720)]), pet = w.add(BUDDY('a', { name: '' }));
  w.run(5);
  pet.go('air'); Object.assign(pet.P, { y: 200, vy: 0 }); w.frame();
  w.sim.act('a', 'wave');
  assert.strictEqual(pet.P.next, 'wave', 'the wave waits for the floor');
  w.sim.say('a', APP.text, APP.from); w.frame();
  let waved = false;
  for (let i = 0; i < 120 && !waved; i++) { w.frame(); waved = pet.P.state === 'wave'; }
  assert.ok(waved, 'she landed and waved');
  const b = bubbleOf(pet);
  assert.deepStrictEqual([b.text, b.from, b.hidden], [APP.text, APP.from, false], 'the app\'s line, still');
  assert.ok(lasts(w, pet).ticks >= appTicks(APP.text) - 120 - 2, 'for its time');
});

test('her line as she drops off a wall to come down for a wave, then her hello as she lands and waves, don\'t cut off an app\'s line', () => {
  /* every line's chance taken (under .6), and none of her rarer moves (well over .0012 a tick) */
  const w = world([screen('s', 0, 0, 1280, 720)], { random: () => .05 }), pet = w.add(BUDDY('a', { name: '' }));
  assert.ok(w.until(() => pet.P.surf === 'floor' && pet.P.state !== 'land', 2000));
  const wall = w.terrain.surfaces().find(s => s.kind === 'wall')!;
  pet.P.on = { surface: wall, t: (wall.to - wall.from) / 2 }; const at = w.terrain.pointOn(wall, pet.P.on.t); pet.P.x = at.x; pet.P.y = at.y;
  pet.go('climb'); pet.P.dur = 1e9; w.frame();
  assert.strictEqual(pet.here()?.kind, 'wall');
  w.sim.say('a', APP.text, APP.from); w.frame();
  w.sim.act('a', 'wave');
  assert.strictEqual(pet.P.next, 'wave', 'she drops for the wave');
  let waved = false;
  const { ticks, then } = lasts(w, pet, 600, () => { waved ||= pet.P.state === 'wave'; });
  assert.ok(ticks >= appTicks(APP.text) - 4, `shown ${ticks} ticks, then ${JSON.stringify(then.text)}`);
  assert.ok(waved, 'she came down and waved meanwhile');
});

test('a pair\'s greeting or bump doesn\'t cut off an app\'s line', () => {
  const out: string[] = [];
  for (const r of [.1, .9]) {
    /* .1: they wave and greet; .9: they bump and say so. The other comes along once the line shows. */
    const w = world([screen('s', 0, 0, 1280, 720)], { random: () => r }), a = w.add(BUDDY('a', { name: '' }));
    assert.ok(w.until(() => a.P.surf === 'floor' && a.P.state !== 'land', 2000));
    a.go('sit'); a.P.dur = 1e9; a.P.chatT = 1e9;
    w.sim.say('a', APP.text, APP.from); w.frame();
    const b = w.add(BUDDY('b', { name: '' })), on = a.P.on!;
    b.P.on = { surface: on.surface, t: on.t + 20 }; const at = w.terrain.pointOn(on.surface, on.t + 20); b.P.x = at.x; b.P.y = at.y; b.P.vx = b.P.vy = 0;
    b.go('sit'); b.P.dur = 1e9; b.P.chatT = 1e9;
    let met = false;
    const { ticks, then } = lasts(w, a, 600, () => { met ||= !bubbleOf(b).hidden; });
    if (ticks < appTicks(APP.text) - 4) out.push(`${r}: shown ${ticks} ticks, then ${JSON.stringify(then.text)}`);
    else if (!met) out.push(`${r}: they never met`);
  }
  assert.deepStrictEqual(out, []);
});

test('her goodbye as she\'s dismissed during an app\'s line is skipped: the app\'s line stays', () => {
  const { w, pet } = standing(720);
  w.sim.say('a', APP.text, APP.from); w.frame();
  pet.farewell();
  assert.strictEqual(pet.P.state, 'wave', 'she waves goodbye');
  const b = bubbleOf(pet);
  assert.deepStrictEqual([b.text, b.from, b.hidden], [APP.text, APP.from, false], 'no bye over it');
});

test('a newer app\'s line still takes an older one\'s place, and her own lines come back once it\'s over', () => {
  const { w, pet } = standing(720);
  assert.strictEqual(said(w, pet, 'Build passed', 'An app').text, 'Build passed');
  const newer = said(w, pet, 'Deploy done', 'Other app');
  assert.deepStrictEqual([newer.text, newer.from], ['Deploy done', 'Other app']);
  assert.strictEqual(said(w, pet, 'Mine meanwhile').text, 'Deploy done', 'skipped');
  /* the skipped line left its time alone: it hides when the newer line's time is up */
  w.run(Math.ceil(appTicks('Deploy done')) - 2);
  assert.strictEqual(bubbleOf(pet).text, 'Deploy done');
  w.run(4);
  assert.strictEqual(bubbleOf(pet).hidden, true);
  const mine = said(w, pet, 'Mine again');
  assert.deepStrictEqual([mine.text, mine.from, mine.hidden], ['Mine again', undefined, false]);
});
