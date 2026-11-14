/* Frames on the display's beat: the real host ticking on its 16 ms timer, an overlay's frames drawn at
   60 and 144 Hz through the pacer, and what it must never blend across. */
import assert from 'node:assert';
import fs from 'node:fs';
import { read } from '@buddies/buddy-file';
import { bodyOf, type BodyParts, type BuddyData, type Frame, type PetFrame } from '@buddies/engine';
import { test } from 'vitest';
import { createHost, type Port } from '../src/host';
import { BEHIND_MS, PLACED, RELEARN, STALLED_MS, TICK_MS, blend, createDrawing, createPacer } from '../src/pacing';
import { measure, poseKey, verdict, watches, type Sample } from '../shell-check/pacing-measure';
import { lively } from '@buddies/engine';
import { screen, world as engineWorld } from '../../../packages/engine/tests/support';
import { whole } from './areas';

const SAMPLE: BuddyData = { ...read(fs.readFileSync(new URL('../../../packages/test-support/fixtures/sample.json', import.meta.url), 'utf8')), id: 'b0' };
const AREA = whole({ i: 0, x: 0, y: 0, w: 1920, h: 1040, scale: 1 });

/* The real host on its timer, with frames as an overlay gets them: each with its tick's time. */
function world(seed = 5, buddy = SAMPLE) {
  let r = seed;
  const random = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const clock = { t: 0 }, timers: { at: number; f: () => void }[] = [], every: { ms: number; f: () => void; next: number; stopped: boolean }[] = [];
  const host = createHost({
    random, now: () => clock.t, note() {},
    after: (ms, f) => { timers.push({ at: clock.t + ms, f }); return timers.length; }, cancel(id) { const t = timers[id - 1]; if (t) t.f = () => {}; },
    every: (ms, f) => { const e = { ms, f, next: clock.t + ms, stopped: false }; every.push(e); return () => { e.stopped = true; }; }
  });
  const got: { t: number; frame: Frame }[] = [], stills: { t: number; on: boolean }[] = [];
  const hub: Port = { postMessage() {} }, overlay: Port = { postMessage(m) {
    const x = m as { k: string; frame: Frame; t: number; on: boolean };
    if (x.k === 'frame') got.push({ t: x.t, frame: JSON.parse(JSON.stringify(x.frame)) });
    else if (x.k === 'still') stills.push({ t: clock.t, on: x.on });
  } };
  host.connect(hub); host.connect(overlay);
  host.message(hub, { k: 'start', all: [AREA], pets: [buddy] });
  host.message(overlay, { k: 'join', me: AREA, n: 0 });
  /* Runs the clock to `until`, ms by ms, firing timers and the world's interval as they fall due. */
  const run = (until: number) => {
    for (; clock.t < until; clock.t += .5) {
      for (const t of timers.filter(u => u.at <= clock.t)) { timers.splice(timers.indexOf(t), 1); t.f(); }
      for (const e of [...every]) if (!e.stopped && clock.t >= e.next) { e.next += e.ms; e.f(); }
    }
  };
  return { host, hub, got, stills, run, clock };
}

/* Draws the frames that arrive at the display's rate, as the overlay does: each display frame, the
   pacer's frame if it has one, else what was drawn last. Where she's drawn on each, while she falls,
   as the pacing check samples her. */
function drawn(hz: number, pace: boolean, jitter: number | ((k: number) => number) = 0, from = 8000) {
  const w = world();
  w.run(3000);
  w.host.message(w.hub, { k: 'act-all', a: 'drop' });
  w.run(4500);
  w.host.message(w.hub, { k: 'act-all', a: 'drop' });
  w.run(6000);
  w.host.message(w.hub, { k: 'act-all', a: 'drop' });
  w.run(7500);
  const pacer = createPacer(), out: Sample[] = [];
  let last: Frame | null = null, i = 0, n = 0;
  /* Each arrival up to `jitter` ms late, as on a busy page: a loaded headless one held some a tick. The
     page's clock is 5000 ms on from the world's. */
  const late = typeof jitter === 'function' ? jitter : (k: number) => jitter ? (((k * 7919) % 101) / 100) * jitter : 0;
  const arrivals = w.got.map(g => ({ ...g, at: g.t + 5000 + late(++n) }));
  for (let t = 8000; t < 12500; t += 1000 / hz) {
    for (; i < arrivals.length && arrivals[i]!.at <= t; i++) { pacer.receive(arrivals[i]!.frame, arrivals[i]!.t, arrivals[i]!.at); if (!pace) last = arrivals[i]!.frame; }
    if (pace) { const f = pacer.frame(t); if (f) last = f; }
    const p = last && last.pets[0];
    if (p && t >= from) out.push([t, p.box.l + p.box.ox, p.box.t + p.box.oy, p.grab ? 1 : 0, poseKey(p.size, p.origin, p.body)]);
  }
  /* told to drop at 3000, 4500 and 6000 on the world's clock */
  return measure(out, [8000, 9500, 11000], 12500);
}

for (const [hz, jitter] of [[60, 0], [144, 0], [60, 7], [144, 14], [75, 0]] as const) {
  test(`a fall drawn at ${hz} Hz${jitter ? `, frames arriving up to ${jitter} ms late,` : ''} moves her every display frame, evenly`, () => {
    const s = drawn(hz, true, jitter);
    assert.ok(s.counted > 60, `${s.counted} display frames of steady motion`);
    assert.deepStrictEqual({ still: s.still, doubled: s.doubled }, { still: 0, doubled: 0 }, `of ${s.counted}`);
    assert.deepStrictEqual({ issued: s.issued, judged: s.judged, failed: s.failed }, { issued: 3, judged: 3, failed: 0 }, 'each move she was told to make, judged and made');
    assert.ok(s.travel > 100, `the least travelled ${s.travel} px`);
    assert.strictEqual(verdict(s), s.counted >= 100 ? 'pass' : 'fail');
  });
}

/* The page got slower to hear from the world after a quick first frame: frames 48 to 55 ms late. */
test('when every frame for a while comes later than the clock says, the clock is set again, and she moves evenly', () => {
  const late = (k: number) => k === 1 ? 0 : 48 + (k * 7) % 8;
  const s = drawn(60, true, late, 8000 + RELEARN * 16 + 100);
  assert.ok(s.counted > 50, `${s.counted}`);
  assert.deepStrictEqual({ still: s.still, doubled: s.doubled }, { still: 0, doubled: 0 }, `of ${s.counted}`);
});

test('without it, the same fall at 60 Hz shows a tick twice or not at all, which is why it is here', () => {
  const s = drawn(60, false, 7);
  assert.ok(s.still + s.doubled > 0, JSON.stringify(s));
});

test('she is drawn where the world had her a little over a tick ago, between the two frames either side', () => {
  const p = createPacer(), w = world();
  w.run(3000); w.host.message(w.hub, { k: 'act-all', a: 'drop' }); w.run(4000);
  const g = w.got.filter(x => x.t > 3000);
  let j = 0, checked = 0;
  for (let now = g[0]!.t + 2; now < g[g.length - 1]!.t; now += 3) {
    for (; j < g.length && g[j]!.t <= now; j++) p.receive(g[j]!.frame, g[j]!.t, g[j]!.t);
    const f = p.frame(now), at = now - BEHIND_MS, k = g.findIndex(x => x.t > at);
    if (!f || k < 1 || k >= j) continue;
    const a = g[k - 1]!, b = g[k]!;
    if (blend(a.frame, b.frame, .5).pets[0] === a.frame.pets[0]) continue; /* a snap, tested below */
    const u = (at - Math.max(a.t, b.t - TICK_MS)) / (b.t - Math.max(a.t, b.t - TICK_MS)), A = a.frame.pets[0]!.box, B = b.frame.pets[0]!.box, box = f.pets[0]!.box;
    assert.ok(Math.abs(box.l - (A.l + (B.l - A.l) * u)) < 1e-6 && Math.abs(box.t - (A.t + (B.t - A.t) * u)) < 1e-6, `at ${now}`);
    assert.strictEqual(f.pets[0]!.tf, `translate(${box.l.toFixed(1)}px,${box.t.toFixed(1)}px)`, 'drawn and hit tested at one place');
    checked++;
  }
  assert.ok(checked > 100, `${checked}`);
});

/* two frames of her, the second a small move on */
function pair(change: (b: PetFrame) => void = () => {}) {
  const w = world(); w.run(3000);
  const a = w.got[w.got.length - 1]!.frame;
  const b = JSON.parse(JSON.stringify(a)) as Frame, p = b.pets[0]!;
  p.box.l += 6; p.box.t += 3; p.tf = `translate(${p.box.l.toFixed(1)}px,${p.box.t.toFixed(1)}px)`;
  change(p);
  return { a, b };
}
/* her body's numbers changed, and its string written from them, as the engine writes it */
const reshape = (p: PetFrame, change: Partial<BodyParts>) => { p.parts = { ...p.parts!, ...change }; p.body = bodyOf(p.parts); };
for (const [name, change] of [
  ['a new pose', p => { p.size = '140px'; }],
  ['the same size, but another art box', p => { p.origin = '61.0px 120.0px'; }],
  ['a surface turning her', p => reshape(p, { turn: 90 })],
  ['a flip', p => reshape(p, { sx: -p.parts!.sx })],
  ['held in the hand', p => { p.grab = true; }],
  ['out of view', p => { p.off = true; }],
  ['placed, not moved, and farther than a move goes', p => { p.box.l += PLACED; p.tf = `translate(${p.box.l.toFixed(1)}px,${p.box.t.toFixed(1)}px)`; }],
  ['placed, not moved, however near', p => { p.stage = p.stage.replace(/^\d+/, n => String(+n + 1)); }],
  ['the same art, doing something else, as a landing is', p => { p.stage = p.stage.replace(/ \S+ /, ' land '); }],
  ['a new line', p => { p.bubble = { ...p.bubble, text: p.bubble.text + '!' }; }],
  ['a line shown or hidden', p => { p.bubble = { ...p.bubble, hidden: !p.bubble.hidden }; }],
  ['her bubble moving to her other side', p => { p.bubble = { ...p.bubble, below: !p.bubble.below }; }],
  ['the same line said again', p => { p.bubble = { ...p.bubble, pop: p.bubble.pop + 1 }; }],
  ['a new name', p => { p.tag = { ...p.tag, text: p.tag.text + 'a' }; }]
] as [string, (p: PetFrame) => void][]) {
  test(`across ${name}, she's drawn as one frame or the other, never between, the later from the earlier one's tick on`, () => {
    const { a, b } = pair(change);
    assert.strictEqual(blend(a, b, 0).pets[0], a.pets[0]);
    assert.strictEqual(blend(a, b, .01).pets[0], b.pets[0]);
    /* and a move of the same size with nothing else changed is blended */
    const plain = pair();
    assert.notStrictEqual(blend(plain.a, plain.b, .5).pets[0], plain.b.pets[0]);
  });
}

/* Getting up from a trip with no art of her own, the engine turns her 90, 78.75, 67.5 degrees over its
   ticks: each tick between two frames draws every number between, the first step included. */
test('her animation\'s own turn, move and scale go between frames too, from each end exactly', () => {
  /* surface turns of 0.1 and 0.3 degrees: 0.1 + (0.3 - 0.1) isn't 0.3 in floating point */
  const up = (rot: number, dy: number, sy: number, turn: number) => (p: PetFrame) => reshape(p, { rot, dy, sy, pivot: 60, turn });
  const one = pair(up(90, -40, .9, .1)), two = pair(up(78.75, -35, .95, .3));
  one.b.pets[0]!.box = { ...one.a.pets[0]!.box }; one.b.pets[0]!.tf = one.a.pets[0]!.tf;
  up(90, -40, .9, .1)(one.a.pets[0]!);
  const a = one.a, b = two.b;
  b.pets[0]!.box = { ...a.pets[0]!.box, l: a.pets[0]!.box.l + 2 }; b.pets[0]!.tf = `translate(${b.pets[0]!.box.l.toFixed(1)}px,${b.pets[0]!.box.t.toFixed(1)}px)`;
  const at = (u: number) => blend(a, b, u).pets[0]!;
  assert.strictEqual(at(0).body, a.pets[0]!.body, 'the earlier frame exactly');
  assert.strictEqual(at(1).body, b.pets[0]!.body, 'the later frame exactly');
  const m = at(.5).parts!;
  assert.deepStrictEqual({ rot: m.rot, dy: m.dy, sy: +m.sy.toFixed(3) }, { rot: 84.375, dy: -37.5, sy: .925 });
  assert.strictEqual(at(.5).body, bodyOf(m));
  /* the first step of the turn is drawn: a quarter of the way on, a quarter of the turn */
  assert.ok(Math.abs(at(.25).parts!.rot - 87.1875) < 1e-9, `${at(.25).parts!.rot}`);
});

/* Rounding a corner or catching a wall, the engine draws her turning over a few ticks in one stage. */
test('a turn drawn over a few ticks goes on between frames, the short way; a quarter turn in one tick snaps', () => {
  const at = (deg: number) => pair(p => reshape(p, { turn: deg }));
  const ten = at(10), m = blend(ten.a, ten.b, .5).pets[0]!;
  assert.match(m.body!, /^rotate\(5deg\) /);
  assert.strictEqual(m.body!.slice(m.body!.indexOf(')')), ten.b.pets[0]!.body!.slice(ten.b.pets[0]!.body!.indexOf(')')), 'the rest is the later frame\'s');
  const round = at(-175);
  reshape(round.a.pets[0]!, { turn: 170 });
  assert.match(blend(round.a, round.b, .5).pets[0]!.body!, /^rotate\(177\.5deg\) /, 'from 170 to -175 the short way, past 180');
  const quarter = at(90);
  assert.strictEqual(blend(quarter.a, quarter.b, .5).pets[0], quarter.b.pets[0]);
});

test('her bubble and name move with her', () => {
  const { a, b } = pair(p => { p.bubble = { ...p.bubble, hidden: false, text: 'hi', tf: 'translate(106px,20px) translate(-50%,-100%)', at: { x: 106, up: 20, down: 140, her: 106, mid: 80 } }; p.tag = { ...p.tag, tf: 'translate(106px,150px) translate(-50%,0)' }; });
  a.pets[0]!.bubble = { ...b.pets[0]!.bubble };
  a.pets[0]!.bubble = { ...b.pets[0]!.bubble, tf: 'translate(100px,17px) translate(-50%,-100%)', at: { x: 100, up: 17, down: 137, her: 100, mid: 77 } };
  a.pets[0]!.tag = { ...b.pets[0]!.tag, tf: 'translate(100px,147px) translate(-50%,0)' };
  const m = blend(a, b, .5).pets[0]!;
  assert.strictEqual(m.bubble.tf, 'translate(103.0px,18.5px) translate(-50%,-100%)');
  assert.strictEqual(m.bubble.at!.x, 103); assert.strictEqual(m.bubble.at!.mid, 78.5);
  assert.strictEqual(m.tag.tf, 'translate(103.0px,148.5px) translate(-50%,0)');
});

test('an image only the skipped frame brought is still drawn', () => {
  const p = createPacer(), { a, b } = pair();
  a.pets[0]!.src = 'new.webp';
  const c = JSON.parse(JSON.stringify(b)) as Frame; delete c.pets[0]!.src;
  p.receive(a, 0, 0); p.receive(c, 16, 16);
  assert.strictEqual(p.frame(100)!.pets[0]!.src, 'new.webp');
});

test('a moved viewport draws nothing from before, takes the next frame whole; a settled one asks for no drawing', () => {
  const p = createPacer(), { a, b } = pair();
  p.receive(a, 0, 0); p.receive(b, 16, 16);
  assert.notStrictEqual(p.frame(30)!.pets[0], b.pets[0], 'between them');
  p.reset();
  assert.strictEqual(p.frame(31), null, 'nothing from the old viewport');
  p.receive(b, 32, 32);
  assert.strictEqual(p.frame(33)!.pets[0], b.pets[0], 'the first new frame whole');
  assert.strictEqual(p.frame(32 + BEHIND_MS)!.pets[0], b.pets[0]);
  assert.strictEqual(p.frame(32 + BEHIND_MS + 1), null, 'nothing new to draw');
  p.receive(a, 200, 200);
  assert.strictEqual(p.frame(200 + BEHIND_MS)!.pets[0], a.pets[0], 'the newest, once its time comes');
  assert.strictEqual(p.frame(201 + BEHIND_MS), null);
});

/* The drag is drawn as it comes. Let go, she's never drawn back where the hand had her a moment ago. */
test('held, she is drawn as the newest frame has her; let go, never going back', () => {
  const p = createPacer(), { a } = pair();
  const at = (x: number, grab: boolean) => { const f = JSON.parse(JSON.stringify(a)) as Frame, q = f.pets[0]!; q.box.l = x; q.tf = `translate(${x.toFixed(1)}px,${q.box.t.toFixed(1)}px)`; q.grab = grab; return f; };
  const xs: number[] = [];
  const frames = [at(0, true), at(10, true), at(20, true), at(30, false), at(40, false), at(50, false), at(60, false)];
  frames.forEach((f, k) => {
    p.receive(f, k * 16, k * 16);
    for (const dt of [1, 6, 11]) {
      const d = p.frame(k * 16 + dt);
      if (k < 3) assert.strictEqual(d && d.pets[0]!.box.l, k * 10, 'held: the newest, no lag');
      if (d) xs.push(d.pets[0]!.box.l);
    }
  });
  for (let now = 7 * 16; now < 7 * 16 + 60; now += 4) { const d = p.frame(now); if (d) xs.push(d.pets[0]!.box.l); }
  for (let k = 1; k < xs.length; k++) assert.ok(xs[k]! >= xs[k - 1]!, xs.join(' '));
  assert.strictEqual(xs[xs.length - 1], 60);
});

/* A frame the same as the last isn't sent, so a long gap means she stood still until the tick before. */
test('after a gap in the frames she stays put until a tick before the next, then moves', () => {
  const p = createPacer(), { a, b } = pair();
  p.receive(a, 0, 0); p.receive(b, 1000, 1000);
  const x = (now: number) => p.frame(now)!.pets[0]!.box.l;
  assert.strictEqual(x(500 + BEHIND_MS), a.pets[0]!.box.l, 'still standing');
  assert.strictEqual(x(1000 - TICK_MS / 2 + BEHIND_MS), (a.pets[0]!.box.l + b.pets[0]!.box.l) / 2, 'halfway through the last tick');
});

/* The check's own arithmetic: a steady 60 Hz display, her moving 3 px a frame. */
test('the pacing check counts a doubled step and a still one, and judges only a display it can time', () => {
  const run = (n: number, edit: (s: Sample[]) => void = () => {}) => {
    const s: Sample[] = Array.from({ length: n }, (_, k) => [k * 1000 / 60, k * 3, 500, 0, 'p']);
    edit(s);
    return measure(s, [0, 1600, 3200, 4800], s[s.length - 1]![0]);
  };
  const even = run(400);
  assert.deepStrictEqual({ still: even.still, doubled: even.doubled, hz: Math.round(even.hz) }, { still: 0, doubled: 0, hz: 60 });
  assert.strictEqual(verdict(even), 'pass');
  /* from frame 100 on a step ahead: one double step; from frame 300 back again: one still one */
  const rough = run(400, s => { for (let k = 100; k < 300; k++) s[k]![1] += 3; });
  assert.deepStrictEqual({ still: rough.still, doubled: rough.doubled }, { still: 1, doubled: 1 });
  const worse = run(400, s => { for (let k = 20; k < 400; k += 20) s[k]![1] = s[k - 1]![1]; });
  assert.ok(worse.still >= 15 && verdict(worse) === 'fail', JSON.stringify(worse));
  assert.strictEqual(verdict(run(60)), 'fail', 'too little motion');
  assert.strictEqual(verdict(run(400, s => { for (let k = 0; k < 400; k++) s[k]![0] = k * k / 20; })), 'no verdict', 'no steady display');
  assert.ok(run(400, s => { for (let k = 150; k < 160; k++) s[k]![4] = 'q'; }).counted <= even.counted - 8, 'nothing near a new pose');
  assert.ok(run(400, s => { s[150]![3] = 1; }).counted <= even.counted - 4, 'nothing just after a hand');
});

/* The real host: her monitor's work area shrinks under her, the overlay is told its new place, and
   every frame after that is in the new viewport's pixels. */
test('after the viewport moves she is drawn only where frames for the new one have her', () => {
  const w = world(); w.run(3000);
  const p = createPacer(), before = w.got.length;
  for (const g of w.got) p.receive(g.frame, g.t, g.t);
  p.frame(3000);
  w.host.message(w.hub, { k: 'monitors', all: [whole({ i: 0, x: 0, y: 80, w: 1920, h: 960, scale: 1 })] });
  p.reset();
  w.run(3200);
  const fresh = w.got.slice(before), ys = new Set(fresh.map(g => g.frame.pets[0]!.box.t));
  assert.ok(fresh.length && !ys.has(w.got[before - 1]!.frame.pets[0]!.box.t), 'the viewport did move');
  let j = 0;
  for (let now = fresh[0]!.t; now < 3200; now += 4) {
    for (; j < fresh.length && fresh[j]!.t <= now; j++) p.receive(fresh[j]!.frame, fresh[j]!.t, fresh[j]!.t);
    const f = p.frame(now);
    if (f) assert.ok(ys.has(f.pets[0]!.box.t) || fresh.some((g, k) => k && Math.min(g.frame.pets[0]!.box.t, fresh[k - 1]!.frame.pets[0]!.box.t) <= f.pets[0]!.box.t && f.pets[0]!.box.t <= Math.max(g.frame.pets[0]!.box.t, fresh[k - 1]!.frame.pets[0]!.box.t)), `at ${now}: ${f.pets[0]!.box.t}`);
  }
});

/* The real host: brought to the cursor a little way off while she falls. */
test('brought mid-fall, however near, she is drawn where she was or where she was brought, never between', () => {
  const w = world(); w.run(3000);
  w.host.message(w.hub, { k: 'act-all', a: 'drop' }); w.run(3100);
  const her = w.got[w.got.length - 1]!.frame.pets[0]!;
  w.host.message(w.hub, { k: 'cursor', x: her.box.l + her.box.ox + 40, y: 300, down: false });
  const at = w.got.length;
  w.host.message(w.hub, { k: 'bring', id: 'b0' }); w.run(3300);
  const before = w.got[at - 1]!, after = w.got[at]!;
  assert.notStrictEqual(before.frame.pets[0]!.stage, after.frame.pets[0]!.stage, 'a bring is a placing');
  const xs = [before, after].map(g => g.frame.pets[0]!.box.l);
  assert.ok(Math.abs(xs[1]! - xs[0]!) > 20 && Math.abs(xs[1]! - xs[0]!) < PLACED, `brought ${xs[1]! - xs[0]!} px across`);
  const p = createPacer();
  for (const g of w.got.slice(0, at)) p.receive(g.frame, g.t, g.t);
  p.receive(after.frame, after.t, after.t);
  for (let now = before.t + BEHIND_MS; now <= after.t + BEHIND_MS; now += 2) {
    const x = p.frame(now)?.pets[0]!.box.l;
    if (x !== undefined) assert.ok(xs.includes(x), `at ${now}: ${x}, not ${xs.join(' or ')}`);
  }
});

test('a landing is a new stage, so the fall is never blended into it', () => {
  const w = world(); w.run(3000);
  w.host.message(w.hub, { k: 'act-all', a: 'drop' }); w.run(5000);
  const stages = w.got.map(g => g.frame.pets[0]!.stage.split(' ').slice(1, 2)[0]);
  const k = stages.findIndex((s, i) => i && stages[i - 1] === 'air' && s === 'land');
  assert.ok(k > 0, stages.join(','));
});

/* The page's animation frames stop, as a hidden or busy page's do. */
test('with no animation frames, each frame is drawn whole as it comes, and they pick up from there', () => {
  const w = world(); w.run(3000); w.host.message(w.hub, { k: 'act-all', a: 'drop' }); w.run(3600);
  const g = w.got.filter(x => x.t > 3000), clock = { t: 0 }, drew: Frame[] = [];
  const d = createDrawing(f => drew.push(f), () => clock.t, () => {});
  d.beat(0);
  for (const x of g.slice(0, 20)) { clock.t = x.t; d.arrive(x.frame, x.t); }
  assert.strictEqual(drew.length, 20, 'every frame, as it came');
  assert.ok(g.slice(0, 20).every((x, k) => drew[k]!.pets[0] === x.frame.pets[0]), 'each one whole');
  /* animation frames come back: she never goes back from the last one drawn */
  const y = drew[drew.length - 1]!.pets[0]!.box.t;
  clock.t = g[19]!.t + 1; d.beat(clock.t);
  for (const x of g.slice(20, 30)) { clock.t = x.t; d.arrive(x.frame, x.t); d.beat(x.t); d.beat(x.t + 8); }
  assert.ok(drew.slice(20).every(f => f.pets[0]!.box.t >= y), 'never back up');
  assert.ok(STALLED_MS <= 100);
});

/* While the world runs the overlay asks for every animation frame, frames or not, as it always did:
   only a still world lets it rest. On a 60 Hz display, through a drop, a pause and back, it draws
   exactly what asking on every display frame drew, and asks for none while the world is paused. */
test('the overlay rests only while the world is still, and draws what it always drew', () => {
  const w = world(); w.run(3000);
  w.host.message(w.hub, { k: 'act-all', a: 'drop' }); w.run(4000);
  w.host.message(w.hub, { k: 'pause', on: true }); w.run(5000);
  w.host.message(w.hub, { k: 'pause', on: false }); w.run(6500);
  assert.deepStrictEqual(w.stills.map(x => x.on), [true, false], 'told when it stopped and when it started');
  const g = w.got.filter(x => x.t > 3000);
  const play = (every: boolean) => {
    const clock = { t: 0 }, drew: string[] = [];
    let pending: ((now: number) => void) | null = null, beats = 0, paused = 0, running = 0;
    const d = createDrawing(f => drew.push(`${clock.t.toFixed(2)} ${JSON.stringify(f)}`), () => clock.t, b => { pending = b; });
    let k = 0, s = 0;
    for (let v = 3000; v < 6500; v += 1000 / 60) {
      for (; k < g.length && g[k]!.t <= v; k++) {
        for (; !every && s < w.stills.length && w.stills[s]!.t <= g[k]!.t; s++) d.still(w.stills[s]!.on);
        clock.t = g[k]!.t; d.arrive(g[k]!.frame, g[k]!.t);
      }
      for (; !every && s < w.stills.length && w.stills[s]!.t <= v; s++) d.still(w.stills[s]!.on);
      clock.t = v;
      const b: ((now: number) => void) | null = every ? d.beat : pending;
      pending = null;
      if (!b) continue;
      beats++;
      if (v > 4100 && v < 5000) paused++;
      if ((v > 3000 && v < 4000) || v > 5100) running++;
      b(v);
    }
    return { drew, beats, paused, running };
  };
  const all = play(true), some = play(false);
  assert.ok(all.drew.length > 100);
  assert.deepStrictEqual(some.drew, all.drew);
  assert.strictEqual(some.paused, 0, 'no animation frame while paused');
  assert.strictEqual(some.running, all.running, 'every one while it runs');
});

test('one who leaves is forgotten: her image is sent again when she comes back, and kept for no one else', () => {
  /* one image only, so she comes back showing the very image she left with */
  const one = { ...SAMPLE, poses: {} }, w = world(5, one); w.run(2000);
  w.host.message(w.hub, { k: 'pets', pets: [] }); w.run(2100);
  const back = w.got.length;
  w.host.message(w.hub, { k: 'pets', pets: [one] }); w.run(4000);
  const first = w.got.slice(back).find(g => g.frame.pets[0] && !g.frame.pets[0].off);
  assert.ok(first && first.frame.pets[0]!.src, 'the first frame she shows in after she came back carries her image');
  const p = createPacer(), { a, b } = pair();
  a.pets[0]!.src = 'hers.webp';
  p.receive(a, 0, 0);
  p.receive({ pets: [], fx: [] }, 16, 16);
  const c = JSON.parse(JSON.stringify(b)) as Frame; delete c.pets[0]!.src;
  p.receive(c, 32, 32);
  assert.strictEqual(p.frame(200)!.pets[0]!.src, undefined, 'nothing kept for her while she was gone');
});

/* The check itself, on traces of overlays that don't move as told. The probe tells her to move every
   1.6 s for 16 s, and stops watching at 16 s. */
test('the pacing check judges every move the probe issued, by how far she went, before it looks at the display', () => {
  const told = Array.from({ length: 10 }, (_, k) => k * 1600), STOP = 16000;
  /* `hz` frames a second up to `until` ms, moving `step` px each while `moving` */
  const trace = (moving: (t: number) => boolean, o: { hz?: number; until?: number; step?: number; time?: (k: number) => number } = {}) => {
    const s: Sample[] = [], hz = o.hz ?? 60, until = o.until ?? STOP; let x = 0;
    for (let k = 0; ; k++) {
      const t = o.time ? o.time(k) : k * 1000 / hz;
      if (t > until) break;
      if (moving(t)) x += o.step ?? 3;
      s.push([t, x, 500, 0, 'p']);
    }
    return s;
  };
  const judge = (x: Sample[], orders = told) => { const p = measure(x, orders, STOP); return { p, v: verdict(p) }; };
  const fine = judge(trace(() => true));
  assert.deepStrictEqual({ v: fine.v, issued: fine.p.issued, judged: fine.p.judged, failed: fine.p.failed }, { v: 'pass', issued: 10, judged: 10, failed: 0 });
  assert.strictEqual(judge(trace(t => t < 3300)).v, 'fail', 'stops moving');
  assert.strictEqual(judge(trace(() => false)).v, 'fail', 'frozen through');
  assert.strictEqual(judge(trace(() => true), []).v, 'fail', 'never told to move');
  /* each move on its own: the last frozen */
  const last = judge(trace(t => t < told[9]!));
  assert.ok(last.p.failed === 1 && last.v === 'fail', JSON.stringify(last.p));
  /* samples that end at 5.983 s, though the probe watched to 16 s: every move after is judged unseen */
  const ends = judge(trace(() => true, { until: 5983 }));
  assert.ok(ends.p.judged === 10 && ends.p.failed === 6 && ends.v === 'fail', JSON.stringify(ends.p));
  /* a window with no frames in it */
  const gap = judge(trace(() => true).filter(x => x[0] < 4900 || x[0] > 5400));
  assert.ok(gap.p.failed === 1 && gap.v === 'fail', JSON.stringify(gap.p));
  /* at 25 Hz, moving a tenth of a pixel a frame: moving on every frame, going nowhere */
  const creep = judge(trace(() => true, { hz: 25, step: .1 }));
  assert.ok(creep.p.failed === 10 && creep.v === 'fail', JSON.stringify(creep.p));
  /* at 20 Hz a watch sees eight frames: too few to tell, however far she goes */
  const sparse = judge(trace(() => true, { hz: 20 }));
  assert.ok(sparse.p.failed === 10 && sparse.v === 'fail', JSON.stringify(sparse.p));
  assert.strictEqual(judge(trace(() => true), told.slice(0, 2)).v, 'fail', 'two moves are too few to judge by');
  /* frozen on a display with no steady timing: still a failure, not nothing to judge */
  const unsteady = (k: number) => Math.floor(k / 2) * 40 + (k % 2) * 10; /* gaps of 10 and 30 ms by turns */
  assert.strictEqual(judge(trace(() => false, { time: unsteady })).v, 'fail', 'frozen on an unsteady display');
  assert.strictEqual(judge(trace(() => true, { time: unsteady })).v, 'no verdict', 'moving on an unsteady display');
});

/* A window being dragged changes the world every tick; she's on the screen's floor, untouched by it. */
test('a refit that leaves her where she was is no placing', () => {
  const w = world(); w.run(3000);
  const pet = w.host.sim!.pets.get('b0')!, placed = pet.P.placed;
  for (let k = 0; k < 60; k++) {
    w.host.message(w.hub, { k: 'windows', exclude: [], list: [{ id: 1, x: 200 + k * 7, y: 200, w: 400, h: 300, z: 1, max: false, topmost: false, tool: false, layered: false, class: 'c', exe: 'e' }] });
    w.run(3000 + (k + 1) * 16);
  }
  assert.strictEqual(pet.P.placed, placed, 'never placed while the window moved');
  assert.ok(new Set(w.got.slice(-60).map(g => g.frame.pets[0]!.stage.split(' ')[0])).size === 1);
});

test('drawing as frames come, it forgets those who left', () => {
  const p = createPacer(), { a } = pair();
  for (let k = 0; k < 1000; k++) {
    const f = JSON.parse(JSON.stringify(a)) as Frame;
    f.pets[0]!.id = 'b' + k;
    p.receive(f, k * 16, k * 16);
    p.newest();
  }
  assert.strictEqual(p.remembered(), 1);
});

/* The engine's own get-up, as an overlay gets it: a trip with no art of her own hands on to standing
   a few degrees a tick. Drawn through the pacer, no display frame turns her more than a tick does. */
test('getting up from a trip with no art of her own, each display frame turns her a little, the first step too', () => {
  const w = world(5, { ...SAMPLE, poses: {} }); w.run(3000);
  w.host.message(w.hub, { k: 'act', id: 'b0', a: 'trip' }); w.run(7000);
  const g = w.got, k = g.findIndex((x, i) => i && g[i - 1]!.frame.pets[0]!.stage.split(' ')[1] === 'trip' && x.frame.pets[0]!.stage.split(' ')[1] !== 'trip');
  assert.ok(k > 0, 'she got up');
  const rot = (f: Frame) => f.pets[0]!.parts!.rot, ticks = g.slice(k - 1, k + 12);
  assert.ok(Math.abs(rot(ticks[0]!.frame)) > 80 && Math.abs(rot(ticks[2]!.frame)) < Math.abs(rot(ticks[1]!.frame)), ticks.map(x => rot(x.frame).toFixed(1)).join(' '));
  const tick = Math.max(...ticks.slice(1).map((x, i) => Math.abs(rot(x.frame) - rot(ticks[i]!.frame))));
  const p = createPacer(), drawn: number[] = [];
  let j = 0;
  for (let now = ticks[0]!.t + BEHIND_MS; now <= ticks[ticks.length - 1]!.t + BEHIND_MS; now += 1000 / 60) {
    for (; j < g.length && g[j]!.t <= now; j++) p.receive(g[j]!.frame, g[j]!.t, g[j]!.t);
    const f = p.frame(now); if (f) drawn.push(rot(f));
  }
  const most = Math.max(...drawn.slice(1).map((r, i) => Math.abs(r - drawn[i]!)));
  assert.ok(most <= tick * 16.67 / 16 + 1e-6, `a display frame turned her ${most.toFixed(2)} degrees, a tick ${tick.toFixed(2)}: ${drawn.map(r => r.toFixed(1)).join(' ')}`);
});

test('a failed pacing run says what each judged move looked like: when, the frames seen, how far, and where and in what pose', () => {
  const told = [0, 1600, 3200, 4800], s: Sample[] = [];
  let x = 0;
  for (let t = 0; t <= 6400; t += 1000 / 60) { if (t < 3200 || t > 3800) x += 3; s.push([t, x, 500, 0, 'run']); }
  const w = watches(s, told, 6400);
  assert.deepStrictEqual(w.map(m => m.moved), [true, true, false, true]);
  const frozen = w[2]!;
  assert.strictEqual(frozen.at, 3200);
  assert.ok(frozen.seen >= 20 && frozen.far === 0 && !frozen.posed, JSON.stringify(frozen));
  assert.deepStrictEqual([frozen.told!.pose, frozen.end!.pose], ['run', 'run'], 'gone nowhere in the pose she was told in: frozen');
  assert.strictEqual(frozen.told!.y, 500);
  assert.strictEqual(measure(s, told, 6400).failed, 1, 'the same rule as the result line');
});

/* `poses(t)`: her pose key at each frame; she moves 3 px a frame except while `still(t)`. */
function posing(still: (t: number) => boolean, poses: (t: number) => string, until = 16000) {
  const s: Sample[] = [];
  let x = 0;
  for (let t = 0; t <= until; t += 1000 / 60) { if (!still(t)) x += 3; s.push([t, x, 500, 0, poses(t)]); }
  return s;
}
const TOLD = Array.from({ length: 10 }, (_, k) => k * 1600);

test('one move a run that goes nowhere passes on a new pose, as a trip does; in the pose she was told in, it fails', () => {
  const tripped = posing(t => t >= 4800 && t < 5600, t => t >= 4810 && t < 5600 ? 'sprawl' : 'run');
  const p = measure(tripped, TOLD, 16000), w = watches(tripped, TOLD, 16000);
  assert.strictEqual(p.failed, 0, JSON.stringify(w[3]));
  assert.ok(w[3]!.posed && w[3]!.moved && w.filter(x => x.posed).length === 1);
  assert.strictEqual(verdict(p), 'pass');
  const frozen = posing(t => t >= 4800 && t < 5600, () => 'run');
  assert.strictEqual(measure(frozen, TOLD, 16000).failed, 1, 'no travel and the same pose');
});

test('an overlay that only swaps her pictures never passes: two or more moves that go nowhere all fail, new poses or not', () => {
  /* she never moves at all, and her pose changes on every watch */
  const swapping = posing(() => true, t => `pose${Math.floor((t + 300) / 400)}`);
  const all = measure(swapping, TOLD, 16000);
  assert.strictEqual(all.failed, all.judged, JSON.stringify(watches(swapping, TOLD, 16000).slice(0, 2)));
  /* two trips in one run, each with a new pose: both fail */
  const two = posing(t => (t >= 4800 && t < 5600) || (t >= 9600 && t < 10400), t => (t >= 4810 && t < 5600) || (t >= 9610 && t < 10400) ? 'sprawl' : 'run');
  assert.strictEqual(measure(two, TOLD, 16000).failed, 2);
  assert.ok(!watches(two, TOLD, 16000).some(x => x.posed));
});

/* The runner's one pacing failure, 43578913239: a judged move that went 0 px with the display steady
   and the world ticking. The engine does that on its own: told to run, she can trip on her first
   ticks (the run's chance of it each tick), and lies there for the whole watch. Main's engine is the
   same, so this is a hole in the check, not the overlay resting: her pose changes, her place doesn't. */
test('told to run, she can trip at once and lie still for the whole watch: a real 0 px move, with a new pose', () => {
  const w = engineWorld([screen('s', 0, 0, 1024, 720)], { seed: 47, pace: lively });
  const pet = w.add({ ...SAMPLE, id: 'olive' }), VP = { x: 0, y: 0, scale: 1 };
  const start = w.now.t;
  w.until(() => w.now.t - start > 4500);
  const orders = ['drop', 'jump', 'drop', 'run'], samples: Sample[] = [], told: number[] = [];
  const sample = () => { const p = pet.frame(VP); samples.push([w.now.t, p.box.l + p.box.ox, p.box.t + p.box.oy, 0, poseKey(p.size, p.origin, p.body)]); };
  for (let k = 0; k < 8; k++) {
    told.push(w.now.t); w.sim.actAll(orders[k % 4]!);
    for (const t0 = w.now.t; w.now.t - t0 < 1600;) { w.frame(); sample(); }
  }
  const all = watches(samples, told, w.now.t), last = all.at(-1)!;
  assert.strictEqual(pet.P.state, 'trip', 'she tripped');
  assert.ok(last.far === 0, JSON.stringify(last));
  assert.notStrictEqual(last.told!.pose, last.end!.pose, 'her pose changed, though her place did not');
  assert.ok(last.moved && last.posed, 'so it passes, on the new pose');
  assert.strictEqual(measure(samples, told, w.now.t).failed, 0, 'and so does the run');
});
