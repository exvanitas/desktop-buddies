/* The samples on paper that only writes down what's drawn. */
import assert from 'node:assert';
import { POSES, read, write, type PoseKey } from '@buddies/buddy-file';
import { test } from 'vitest';
import { SAMPLES, createSamples, type Paper, type Pen, type Sheet } from '../src';
import { fakeArt, png } from './harness';
import { measuringPaper } from './paper';

function recording() {
  const sides: number[] = [];
  const paper: Paper = side => {
    sides.push(side);
    const marks: string[] = [];
    const pen = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) => k in t ? t[k] : (...a: unknown[]) => { marks.push(`${k}(${a.join()})`); },
      set: (t, k: string, v) => { t[k] = v; marks.push(`${k}=${String(v)}`); return true; }
    }) as unknown as Pen;
    const sheet: Sheet = { pen, png: () => png(marks.join(';')) };
    return sheet;
  };
  return { paper, sides };
}

test('the list keeps its names', () => {
  assert.deepStrictEqual(SAMPLES.map(s => s.name), ['Pip']);
  assert.deepStrictEqual(SAMPLES.filter(s => s.note).map(s => s.kind), ['pip']);
});

test('the sample draws on its own square of paper', () => {
  const { paper, sides } = recording(), s = createSamples(paper, fakeArt());
  const thumbs = SAMPLES.map(d => s.thumb(d.kind));
  assert.deepStrictEqual(sides, [300]);
  assert.strictEqual(thumbs.length, 1);
});

test('Pip has her own art for every pose slot, and nothing that isn\'t one', async () => {
  const { paper } = recording(), p = await createSamples(paper, fakeArt()).build('pip');
  assert.deepStrictEqual(Object.keys(p.poses).sort(), POSES.map(s => s.key as string).sort());
  for (const [k, pose] of Object.entries(p.poses)) {
    assert.ok(pose!.frames.length >= 1 && pose!.frames.length <= 16, `${k}: ${pose!.frames.length} frames`);
    assert.ok(pose!.fps! >= 1 && pose!.fps! <= 12, `${k}: ${pose!.fps} fps`);
  }
  assert.deepStrictEqual([p.name, p.faces, p.size], ['Pip', 'right', 120]);
  assert.deepStrictEqual([p.poses.run!.fps, p.poses.sleep!.fps, p.poses.stand!.frames.length], [11, 1, 16]);
  assert.deepStrictEqual([p.poses.dragL!.frames.length, p.poses.dragR!.frames.length], [2, 2], 'mild, then strong');
  assert.deepStrictEqual(p.signature, { weight: .2, line: 'Peep!' });
});

test('Pip stays light to build: each picture is drawn once, however many poses show it', async () => {
  const { paper, sides } = recording(), p = await createSamples(paper, fakeArt()).build('pip');
  const distinct = new Set(Object.values(p.poses).flatMap(pose => pose!.frames.map(f => f.src)));
  assert.strictEqual(sides.length, distinct.size);
  assert.ok(distinct.size <= 160, `${distinct.size} pictures`);
});

test('Pip, saved, is a buddy file that reads back', async () => {
  const { paper } = recording(), p = await createSamples(paper, fakeArt()).build('pip');
  const back = read(write({ ...p, character: 'cpip' }));
  assert.deepStrictEqual(Object.keys(back.poses).sort(), Object.keys(p.poses).sort());
  assert.deepStrictEqual(back.signature, p.signature);
});

/* ---- where her art is, measured ---- */

async function measured() {
  const m = measuringPaper(), p = await createSamples(m.paper, m.art).build('pip');
  const px = (src: string) => m.boxes.get(src)!;
  /* a pose's box over all its frames, in paper px */
  const union = (k: PoseKey) => p.poses[k]!.frames.map(f => px(f.src)).reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
  const tall = (k: PoseKey) => { const b = union(k); return b.y1 - b.y0; };
  return { p, px, union, tall };
}

test('every picture of Pip stays on her paper', async () => {
  const { p, px } = await measured();
  for (const [k, pose] of Object.entries(p.poses)) for (const [i, f] of pose!.frames.entries()) {
    const b = px(f.src);
    assert.ok(b.x0 >= 0 && b.y0 >= 0 && b.x1 <= 300 && b.y1 <= 300, `${k} frame ${i}: ${JSON.stringify(b)}`);
  }
});

test('her sitting poses are drawn clearly lower than her standing, so the engine plays their transitions', async () => {
  const { tall } = await measured(), stand = tall('stand');
  /* the engine's DOWN: under 90% of her standing height is down */
  for (const k of ['sit', 'sleep', 'cry', 'dizzy', 'eat', 'watch_cursor', 'tired'] as const) assert.ok(tall(k) < .88 * stand, `${k}: ${(tall(k) / stand).toFixed(2)}`);
  for (const k of ['walk', 'think', 'happy', 'wave', 'angry', 'stare'] as const) assert.ok(tall(k) > .95 * stand, `${k}: ${(tall(k) / stand).toFixed(2)}`);
});

test('her floor poses stand on the floor her main image stands on', async () => {
  const { p, px, union } = await measured(), floor = px(p.base.src).y1;
  for (const k of ['stand', 'walk', 'sit', 'sleep', 'think', 'happy', 'wave', 'land', 'dance', 'excited', 'laugh', 'surprised', 'signature', 'sit_down', 'stand_from_sit', 'stand_up', 'fall_asleep', 'tap_screen', 'stare', 'face_away', 'turn_back'] as const)
    assert.ok(Math.abs(union(k).y1 - floor) < 9, `${k}: bottom ${union(k).y1.toFixed(1)} against ${floor.toFixed(1)}`);
});

test('on a wall she faces her "Art faces", reaching forward onto it', async () => {
  const { p, px } = await measured();
  for (const k of ['climb', 'wall'] as const) for (const f of p.poses[k]!.frames) {
    const b = px(f.src);
    /* her body is in the middle of the paper and her wings and feet reach right */
    assert.ok(b.x1 - 150 > 150 - b.x0 + 20, `${k}: ${JSON.stringify(b)}`);
    assert.ok(b.x1 > 280, `${k} reaches the wall: ${b.x1}`);
  }
});

test('her legs hang below her when she dangles them, is held or falls', async () => {
  const { tall } = await measured();
  assert.ok(tall('dangle_legs') > tall('sit') + 30, `${tall('dangle_legs')} vs ${tall('sit')}`);
  for (const k of ['drag', 'fall', 'jump'] as const) assert.ok(tall(k) > tall('stand') + 15, `${k}: ${tall(k)}`);
});

test('her transitions start and end on the poses they lead between', async () => {
  const { p } = await measured(), src = (k: PoseKey) => p.poses[k]!.frames.map(f => f.src);
  const first = (k: PoseKey) => src(k)[0], last = (k: PoseKey) => src(k).at(-1);
  for (const k of ['stand_up', 'stand_up_from_sleep', 'stand_up_from_sprawl', 'stand_up_from_dizzy', 'stand_up_from_knocked_out', 'stand_from_sit', 'turn_back'] as const) assert.strictEqual(last(k), p.base.src, `${k} ends on her main pose`);
  for (const k of ['sit_down', 'fall_asleep'] as const) assert.strictEqual(first(k), p.base.src, `${k} starts on her main pose`);
  assert.strictEqual(last('sit_down'), first('sit'));
  assert.strictEqual(last('fall_asleep'), first('sleep'));
  for (const [clip, from] of [['stand_up', 'sit'], ['stand_from_sit', 'sit'], ['stand_up_from_sleep', 'sleep'], ['stand_up_from_sprawl', 'sprawl'], ['stand_up_from_dizzy', 'dizzy'], ['stand_up_from_knocked_out', 'knocked_out'], ['turn_back', 'face_away']] as const)
    assert.ok(src(from).includes(first(clip)!), `${clip} starts on ${from}`);
  /* the play-once moves end where she goes back to */
  for (const k of ['laugh', 'surprised', 'tap_screen', 'signature'] as const) assert.ok(p.poses[k]!.frames.length >= 3, k);
  for (const k of ['tap_screen', 'signature'] as const) assert.strictEqual(last(k), p.base.src, k);
});

test('Pip blinks: one frame in the idle loop differs', async () => {
  const { paper } = recording(), p = await createSamples(paper, fakeArt()).build('pip');
  const frames = p.poses.stand!.frames.map(f => f.src);
  assert.strictEqual(new Set(frames).size, 2);
  assert.strictEqual(frames.filter(f => f !== p.base.src).length, 1);
  assert.notStrictEqual(frames[7], p.base.src);
});

test('samples go through the same art as uploads', async () => {
  const bases: string[] = [], { paper } = recording();
  const art = fakeArt(); const real = art.processBase;
  art.processBase = src => { bases.push(src); return real(src); };
  const s = createSamples(paper, art);
  await s.build('pip');
  assert.deepStrictEqual(bases, [s.thumb('pip')]);
});
