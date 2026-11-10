/* The samples on paper that only writes down what's drawn. */
import assert from 'node:assert';
import { POSE } from '@buddies/buddy-file';
import { test } from 'vitest';
import { SAMPLES, createSamples, type Paper, type Pen, type Sheet } from '../src';
import { fakeArt, png } from './harness';

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
  assert.deepStrictEqual(SAMPLES.map(s => s.name), ['Pip', 'Pudding', 'Sprout']);
  assert.deepStrictEqual(SAMPLES.filter(s => s.note).map(s => s.kind), ['pip']);
});

test('every sample draws on its own square of paper', () => {
  const { paper, sides } = recording(), s = createSamples(paper, fakeArt());
  const thumbs = SAMPLES.map(d => s.thumb(d.kind));
  assert.deepStrictEqual(sides, [300, 300, 300]);
  assert.strictEqual(new Set(thumbs).size, 3);
});

test('Pip comes with a full pose set, every pose a real slot', async () => {
  const { paper } = recording(), p = await createSamples(paper, fakeArt()).build('pip');
  const keys = Object.keys(p.poses);
  assert.strictEqual(keys.length, 18);
  for (const k of keys) assert.ok(POSE[k as keyof typeof POSE], k);
  assert.deepStrictEqual([p.name, p.faces, p.size], ['Pip', 'right', 120]);
  assert.deepStrictEqual([p.poses.run!.fps, p.poses.sleep!.fps, p.poses.stand!.frames.length], [11, 1, 16]);
});

test('Pip blinks: one frame in the idle loop differs', async () => {
  const { paper } = recording(), p = await createSamples(paper, fakeArt()).build('pip');
  const frames = p.poses.stand!.frames.map(f => f.src);
  assert.strictEqual(new Set(frames).size, 2);
  assert.strictEqual(frames.filter(f => f !== p.base.src).length, 1);
  assert.notStrictEqual(frames[7], p.base.src);
});

test('the others are one image each', async () => {
  const { paper } = recording(), s = createSamples(paper, fakeArt());
  for (const [kind, name] of [['pudding', 'Pudding'], ['sprout', 'Sprout']] as const) {
    const p = await s.build(kind);
    assert.deepStrictEqual([p.name, p.poses, p.size], [name, {}, 120]);
  }
});

test('samples go through the same art as uploads', async () => {
  const bases: string[] = [], { paper } = recording();
  const art = fakeArt(); const real = art.processBase;
  art.processBase = src => { bases.push(src); return real(src); };
  const s = createSamples(paper, art);
  await s.build('sprout');
  assert.deepStrictEqual(bases, [s.thumb('sprout')]);
});
