/* A pose's frames, speed and scale, and what an empty pose shows. */
import assert from 'node:assert';
import { test } from 'vitest';
import { shown } from '../src';
import { buddy, file, frame, png, started } from './harness';

const posed = (...names: string[]) => buddy({ poses: { walk: { frames: names.map(frame), fps: 6, scale: 1 } } });
const srcs = (p: ReturnType<typeof buddy>, key: 'walk' | 'dance' = 'walk') => p.poses[key]!.frames.map(f => f.src);

test('a pose with frames shows its own first frame', () => {
  const p = posed('a', 'b');
  assert.deepStrictEqual(shown(p, 'walk'), { key: 'walk', src: png('a'), own: true });
});

test('an empty pose borrows along its fallbacks', () => {
  const p = buddy({ poses: { sit: { frames: [frame('s')] } } });
  assert.deepStrictEqual(shown(p, 'cry'), { key: 'sit', src: png('s'), own: false });
});

test('a pose with empty frames counts as empty', () => {
  const p = buddy({ poses: { sit: { frames: [] } } });
  assert.strictEqual(shown(p, 'sit').own, false);
});

test('with nothing to borrow, the main image shows', () => {
  assert.deepStrictEqual(shown(buddy(), 'cry'), { key: null, src: png('base'), own: false, rot: null });
});

test('at the end of the fallbacks, a surface says how the main image turns', () => {
  assert.strictEqual(shown(buddy(), 'climb').rot, '@wall');
  assert.strictEqual(shown(buddy(), 'crawl').rot, '@ceil');
});

test('a pose opens, closes, and tells the view about that buddy', async () => {
  const h = await started(), p = h.maker.current()!;
  h.maker.togglePose(p, 'walk');
  assert.strictEqual(h.maker.openPose, 'walk');
  h.maker.togglePose(p, 'sit');
  assert.strictEqual(h.maker.openPose, 'sit');
  h.maker.togglePose(p, 'sit');
  assert.strictEqual(h.maker.openPose, null);
  h.maker.togglePose(p, 'walk'); h.maker.closePose(p);
  assert.strictEqual(h.maker.openPose, null);
  assert.deepStrictEqual(h.changes.at(-1), { scope: 'poses', pet: p });
  assert.strictEqual(h.saves(), 0);
});

test('frames go on the open pose in number order, and it plays', async () => {
  const h = await started(), p = h.maker.current()!;
  h.maker.togglePose(p, 'dance');
  await h.maker.addFrames(p, [file('a10.png'), file('a2.png'), file('readme.txt', 'text/plain')]);
  assert.deepStrictEqual(srcs(p, 'dance'), [png('a2.png'), png('a10.png')]);
  assert.strictEqual(h.saves(), 1);
  assert.deepStrictEqual(h.acts, [[p.id, 'dance']]);
});

test('a first upload gets its speed from how many frames the pose usually has', async () => {
  const h = await started(), p = h.maker.current()!;
  h.maker.togglePose(p, 'walk');
  await h.maker.addFrames(p, [file('a.png')]);
  h.maker.togglePose(p, 'dance');
  await h.maker.addFrames(p, [file('a.png')]);
  assert.strictEqual(p.poses.walk!.fps, 6);
  assert.strictEqual(p.poses.dance!.fps, 4);
});

test('more frames join the end, and leave speed and scale alone', async () => {
  const h = await started([posed('a')]), p = h.maker.current()!;
  p.poses.walk!.fps = 9; p.poses.walk!.scale = 1.4;
  h.maker.togglePose(p, 'walk');
  await h.maker.addFrames(p, [file('b.png')]);
  assert.deepStrictEqual(srcs(p), [png('a'), png('b.png')]);
  assert.deepStrictEqual([p.poses.walk!.fps, p.poses.walk!.scale], [9, 1.4]);
});

test('no images in what was picked: nothing happens', async () => {
  const h = await started(), p = h.maker.current()!;
  h.maker.togglePose(p, 'walk');
  await h.maker.addFrames(p, [file('a.txt', 'text/plain')]);
  assert.deepStrictEqual(p.poses, {});
  assert.deepStrictEqual(h.toasts, []);
  assert.strictEqual(h.saves(), 0);
});

test('images that will not process are refused with a word', async () => {
  const h = await started([buddy()], { art: { processFrames: async () => null } }), p = h.maker.current()!;
  h.maker.togglePose(p, 'walk');
  await h.maker.addFrames(p, [file('a.png')]);
  assert.deepStrictEqual(h.toasts, ["Couldn't read those images"]);
  assert.deepStrictEqual(p.poses, {});
});

test('frames move one place either way', async () => {
  const h = await started([posed('a', 'b', 'c')]), p = h.maker.current()!;
  h.maker.moveFrame(p, 'walk', 1, 1);
  assert.deepStrictEqual(srcs(p), ['a', 'c', 'b'].map(png));
  h.maker.moveFrame(p, 'walk', 1, -1);
  assert.deepStrictEqual(srcs(p), ['c', 'a', 'b'].map(png));
  assert.strictEqual(h.saves(), 2);
});

test('a frame moved off either end stays, and nothing is saved', async () => {
  const h = await started([posed('a', 'b')]), p = h.maker.current()!;
  h.maker.moveFrame(p, 'walk', 0, -1);
  h.maker.moveFrame(p, 'walk', 1, 1);
  h.maker.moveFrame(p, 'walk', 9, 1);
  h.maker.moveFrame(p, 'dance', 0, 1);
  assert.deepStrictEqual(srcs(p), ['a', 'b'].map(png));
  assert.strictEqual(h.saves(), 0);
});

test('removing a frame closes the gap, and the last one takes the pose with it', async () => {
  const h = await started([posed('a', 'b')]), p = h.maker.current()!;
  h.maker.removeFrame(p, 'walk', 0);
  assert.deepStrictEqual(srcs(p), [png('b')]);
  h.maker.removeFrame(p, 'walk', 0);
  assert.strictEqual(p.poses.walk, undefined);
  assert.strictEqual(h.saves(), 2);
});

test('a frame that is not there cannot be removed', async () => {
  const h = await started([posed('a')]), p = h.maker.current()!;
  h.maker.removeFrame(p, 'walk', 4);
  h.maker.removeFrame(p, 'dance', 0);
  assert.deepStrictEqual(srcs(p), [png('a')]);
  assert.strictEqual(h.saves(), 0);
});

test('clearing a pose takes all of it', async () => {
  const h = await started([posed('a', 'b')]), p = h.maker.current()!;
  h.maker.clearPose(p, 'walk');
  assert.deepStrictEqual(p.poses, {});
  assert.strictEqual(h.saves(), 1);
});

test('speed and scale change on the slow save', async () => {
  const h = await started([posed('a')]), p = h.maker.current()!;
  h.maker.setSpeed(p, 'walk', 12); h.maker.setScale(p, 'walk', 1.5);
  assert.deepStrictEqual([p.poses.walk!.fps, p.poses.walk!.scale], [12, 1.5]);
  assert.strictEqual(h.saves(), 0);
  h.tick(250);
  assert.strictEqual(h.saves(), 1);
});

test('a speed or scale the file format would refuse is refused here', async () => {
  const h = await started([posed('a')]), p = h.maker.current()!;
  for (const v of [0, 61, NaN]) h.maker.setSpeed(p, 'walk', v);
  for (const v of [0, 11, NaN]) h.maker.setScale(p, 'walk', v);
  h.maker.setSpeed(p, 'dance', 5);
  assert.deepStrictEqual([p.poses.walk!.fps, p.poses.walk!.scale], [6, 1]);
  assert.deepStrictEqual(h.changes, []);
});

test('matching sizes rescales every pose, with the nudge for sitting ones', async () => {
  const p = buddy({ poses: { walk: { frames: [frame('w')] }, sit: { frames: [frame('s')] } } });
  const h = await started([p]);
  await h.maker.matchSizes();
  const q = h.maker.current()!;
  assert.deepStrictEqual([q.poses.walk!.scale, q.poses.sit!.scale], [1.5, 1.425]);
  assert.deepStrictEqual(h.toasts, ['Measuring…', 'Matched 2 poses to the main image · fine-tune any with its Scale slider']);
  assert.strictEqual(h.saves(), 1);
});

test('a pose that cannot be measured keeps its scale, and is not counted', async () => {
  const p = buddy({ poses: { walk: { frames: [frame('w')], scale: 1.1 } } });
  const h = await started([p], { art: { matchScale: async () => null } });
  await h.maker.matchSizes();
  assert.strictEqual(h.maker.current()!.poses.walk!.scale, 1.1);
  assert.match(h.toasts.at(-1)!, /^Matched 0 poses/);
});

test('matching with no frames says so', async () => {
  const h = await started();
  await h.maker.matchSizes();
  assert.deepStrictEqual(h.toasts, ['No pose frames yet']);
  assert.strictEqual(h.saves(), 0);
});

test('frames go to the pose they were picked for, even if it closes while they read', async () => {
  const h = await started(), p = h.maker.current()!;
  h.maker.togglePose(p, 'walk');
  const going = h.maker.addFrames(p, [file('a.png')]);
  h.maker.closePose(p);
  await going;
  assert.deepStrictEqual(Object.keys(p.poses), ['walk']);
  assert.deepStrictEqual(srcs(p), [png('a.png')]);
});

test('frames with no pose open go nowhere', async () => {
  const h = await started(), p = h.maker.current()!;
  await h.maker.addFrames(p, [file('a.png')]);
  assert.deepStrictEqual(Object.keys(p.poses), []);
  assert.strictEqual(h.saves(), 0);
});

test('picking a pose makes it the one frames land on, and announces nothing', async () => {
  const h = await started([posed('a')]), p = h.maker.current()!;
  h.maker.pickPose('dance');
  assert.strictEqual(h.maker.openPose, 'dance');
  assert.strictEqual(h.changes.length, 0);
  await h.maker.addFrames(p, [file('d.png')]);
  assert.deepStrictEqual(srcs(p, 'dance'), [png('d.png')]);
});

test('a pose never holds more frames than its file would take back', async () => {
  const many = Array.from({ length: 119 }, (_, i) => `f${i}`);
  const h = await started([posed(...many)]), p = h.maker.current()!;
  h.maker.pickPose('walk');
  await h.maker.addFrames(p, [file('a.png'), file('b.png'), file('c.png')]);
  assert.strictEqual(srcs(p).length, 120);
  assert.match(h.toasts.at(-1)!, /120 frames, so 2 didn't fit/);
  await h.maker.addFrames(p, [file('d.png')]);
  assert.strictEqual(srcs(p).length, 120);
  assert.strictEqual(h.acts.length, 1);
});

/* Art that finishes when it's told to, in whatever order. */
function heldFrames() {
  const held: (() => void)[] = [];
  return { held, art: { processFrames: (srcs: string[]) => new Promise<{ frames: ReturnType<typeof frame>[]; scale: number }>(done => { held.push(() => done({ frames: srcs.map(src => ({ src, bb: { x0: 0, y0: 0, x1: 1, y1: 1 } })), scale: 1 })); }) } };
}
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test('two batches pending on an empty pose both land', async () => {
  const f = heldFrames(), h = await started([buddy()], { art: f.art }), p = h.maker.current()!;
  h.maker.pickPose('walk');
  const one = h.maker.addFrames(p, [file('a.png')]), two = h.maker.addFrames(p, [file('b.png'), file('c.png')]);
  await settle();
  assert.strictEqual(f.held.length, 2);
  f.held[0]!(); f.held[1]!();
  await one; await two;
  assert.deepStrictEqual(srcs(p), [png('a.png'), png('b.png'), png('c.png')]);
});

test('two batches pending share the room left, worked out as each lands', async () => {
  const f = heldFrames(), h = await started([posed(...Array.from({ length: 118 }, (_, i) => `f${i}`))], { art: f.art }), p = h.maker.current()!;
  h.maker.pickPose('walk');
  const one = h.maker.addFrames(p, [file('a.png'), file('b.png')]), two = h.maker.addFrames(p, [file('c.png'), file('d.png')]);
  await settle();
  f.held[0]!(); f.held[1]!();
  await one; await two;
  assert.strictEqual(srcs(p).length, 120);
  assert.deepStrictEqual(srcs(p).slice(-2), [png('a.png'), png('b.png')]);
  assert.match(h.toasts.at(-1)!, /120 frames, so 2 didn't fit/);
});

test('a pose cleared while a batch was pending starts again from that batch', async () => {
  const f = heldFrames(), h = await started([posed('old')], { art: f.art }), p = h.maker.current()!;
  h.maker.pickPose('walk');
  const one = h.maker.addFrames(p, [file('a.png')]);
  await settle();
  h.maker.clearPose(p, 'walk');
  f.held[0]!();
  await one;
  assert.deepStrictEqual(srcs(p), [png('a.png')]);
});

test('frames for a buddy who has gone land nowhere, and it says so', async () => {
  const f = heldFrames(), h = await started([posed('a'), buddy({ id: 'y', name: 'Bo' })], { art: f.art }), p = h.maker.current()!;
  h.maker.pickPose('walk');
  const going = h.maker.addFrames(p, [file('b.png')]);
  await settle();
  h.maker.remove();
  const saves = h.saves();
  f.held[0]!();
  await going;
  assert.strictEqual(h.saves(), saves);
  assert.deepStrictEqual(h.acts, []);
  assert.match(h.toasts.at(-1)!, /isn't here any more.*still on your disk/);
});

/* Lift: how far a pose's art stands off the floor. Zero is where the art really ends, measured. */
const boxed = (name: string, y0: number, y1: number) => ({ src: png(name), bb: { x0: .1, y0, x1: .9, y1 } });
const measuring = (bottoms: Record<string, number | null>, asked: string[] = []) => ({ bottomOf: async (src: string) => { asked.push(src); return src in bottoms ? bottoms[src]! : 1; } });
const sit = (...frames: ReturnType<typeof boxed>[]) => buddy({ size: 100, poses: { sit: { frames, scale: 2 } } });

test("a pose's lift is unknown until its art is measured, and measuring writes nothing", async () => {
  const asked: string[] = [];
  const h = await started([sit(boxed('a', .2, .9), boxed('b', .3, .9))], { art: measuring({ [png('a')]: .85, [png('b')]: .8 }, asked) }), p = h.maker.current()!;
  const before = JSON.stringify(p);
  assert.strictEqual(h.maker.poseLift(p, 'sit'), null);
  assert.strictEqual(h.maker.liftRange(p, 'sit'), null);
  await h.maker.measureLift(p, 'sit');
  /* the union ends at .9, the art at .85: .05 of a 200 px picture */
  assert.strictEqual(h.maker.poseLift(p, 'sit'), 10);
  await h.maker.measureLift(p, 'sit');
  assert.deepStrictEqual(asked, [png('a'), png('b')], 'each picture measured once');
  assert.strictEqual(JSON.stringify(p), before);
  assert.strictEqual(h.saves(), 0);
  assert.deepStrictEqual(h.changes, []);
});

test('setting a lift writes every frame its own bottom plus the lift, on new frame objects in file order', async () => {
  const shared = boxed('a', .2, .85);
  const pet = sit(shared, boxed('b', .3, .8));
  pet.base = shared;
  const h = await started([pet], { art: measuring({ [png('a')]: .85, [png('b')]: .8 }) }), p = h.maker.current()!;
  const base = p.base;
  await h.maker.measureLift(p, 'sit');
  assert.strictEqual(h.maker.poseLift(p, 'sit'), 0);
  h.maker.setPoseLift(p, 'sit', -20);
  const F = p.poses.sit!.frames;
  assert.deepStrictEqual(F.map(f => Object.keys(f).join() + '|' + Object.keys(f.bb).join()), ['src,bb|x0,y0,x1,y1', 'src,bb|x0,y0,x1,y1']);
  assert.ok(Math.abs(F[0]!.bb.y1 - .75) < 1e-9 && Math.abs(F[1]!.bb.y1 - .7) < 1e-9, JSON.stringify(F.map(f => f.bb.y1)));
  assert.deepStrictEqual(F.map(f => [f.bb.x0, f.bb.y0, f.bb.x1]), [[.1, .2, .9], [.1, .3, .9]]);
  assert.strictEqual(p.base.bb.y1, .85, 'a frame shared with the main image is not changed under it');
  assert.strictEqual(p.base, base);
  assert.strictEqual(h.maker.poseLift(p, 'sit'), -20);
  assert.deepStrictEqual(h.changes, [{ scope: 'field' }]);
  assert.strictEqual(h.saves(), 0);
  h.tick(250);
  assert.strictEqual(h.saves(), 1);
});

test('a lift stays in the file: art at the bottom of its picture can only go down, never under its own top, and never past 60 px', async () => {
  const h = await started([sit(boxed('a', .2, 1), boxed('b', .95, .97))], { art: measuring({ [png('a')]: 1, [png('b')]: .97 }) }), p = h.maker.current()!;
  await h.maker.measureLift(p, 'sit');
  /* b's top is .02 above its bottom: 4 px at 200 */
  assert.deepStrictEqual(h.maker.liftRange(p, 'sit'), { min: -4, max: 0 });
  h.maker.setPoseLift(p, 'sit', 30);
  assert.strictEqual(h.maker.poseLift(p, 'sit'), 0);
  assert.strictEqual(h.changes.length, 0, 'clamped to where it was, so nothing changed');
  h.maker.setPoseLift(p, 'sit', -30);
  assert.strictEqual(h.maker.poseLift(p, 'sit'), -4);
  for (const f of p.poses.sit!.frames) assert.ok(f.bb.y1 >= f.bb.y0 && f.bb.y1 <= 1, JSON.stringify(f.bb));
  const k = await started([sit(boxed('c', .1, .5))], { art: measuring({ [png('c')]: .5 }) }), q = k.maker.current()!;
  await k.maker.measureLift(q, 'sit');
  assert.deepStrictEqual(k.maker.liftRange(q, 'sit'), { min: -60, max: 60 });
});

test('a lift set to what it is already, or before measuring, or on a pose with no frames, writes nothing', async () => {
  const h = await started([sit(boxed('a', .2, .9))], { art: measuring({ [png('a')]: .85 }) }), p = h.maker.current()!;
  const before = JSON.stringify(p);
  h.maker.setPoseLift(p, 'sit', -5);
  h.maker.setPoseLift(p, 'walk', 5);
  await h.maker.measureLift(p, 'sit');
  h.maker.setPoseLift(p, 'sit', 10);
  h.maker.setPoseLift(p, 'sit', NaN);
  h.tick(1000);
  assert.strictEqual(JSON.stringify(p), before);
  assert.strictEqual(h.saves(), 0);
  assert.deepStrictEqual(h.changes, []);
});

test('a picture that cannot be measured leaves the pose with no lift to set', async () => {
  const h = await started([sit(boxed('a', .2, .9), boxed('b', .2, .9))], { art: measuring({ [png('b')]: null }) }), p = h.maker.current()!;
  await h.maker.measureLift(p, 'sit');
  assert.strictEqual(h.maker.poseLift(p, 'sit'), null);
  h.maker.setPoseLift(p, 'sit', -3);
  assert.strictEqual(h.saves(), 0);
});

test('frames added to a lifted pose keep its lift, measured from the new art too', async () => {
  const h = await started([sit(boxed('a', .2, .9))], { art: { ...measuring({ [png('a')]: .9 }), processFrames: async srcs => ({ frames: srcs.map(src => ({ src, bb: { x0: 0, y0: .4, x1: 1, y1: .95 } })), scale: 1 }) } }), p = h.maker.current()!;
  await h.maker.measureLift(p, 'sit');
  h.maker.setPoseLift(p, 'sit', -12);
  h.maker.pickPose('sit');
  await h.maker.addFrames(p, [file('n.png')]);
  assert.strictEqual(p.poses.sit!.frames.length, 2);
  assert.strictEqual(h.maker.poseLift(p, 'sit'), -12);
  assert.ok(Math.abs(p.poses.sit!.frames[1]!.bb.y1 - (.95 - .06)) < 1e-9, String(p.poses.sit!.frames[1]!.bb.y1));
});

test('frames added to a pose with no lift come in as they were cut', async () => {
  const cut = { x0: 0, y0: .4, x1: 1, y1: .95 };
  const h = await started([sit(boxed('a', .2, .9))], { art: { ...measuring({ [png('a')]: .9 }), processFrames: async srcs => ({ frames: srcs.map(src => ({ src, bb: { ...cut } })), scale: 1 }) } }), p = h.maker.current()!;
  h.maker.pickPose('sit');
  await h.maker.addFrames(p, [file('n.png')]);
  assert.deepStrictEqual(p.poses.sit!.frames.map(f => f.bb), [{ x0: .1, y0: .2, x1: .9, y1: .9 }, cut]);
});

test('a lift at the end of its range never turns a box inside out, whatever the float error', async () => {
  /* her top sits a hair under 3 px above her bottom */
  const h = await started([buddy({ size: 100, poses: { sit: { frames: [boxed('a', .9 - .03 + 1e-13, .9)], scale: 1 } } })], { art: measuring({ [png('a')]: .9 }) }), p = h.maker.current()!;
  await h.maker.measureLift(p, 'sit');
  const lo = h.maker.liftRange(p, 'sit')!.min;
  assert.ok(lo === -2 || lo === -3, String(lo));
  h.maker.setPoseLift(p, 'sit', -60);
  const bb = p.poses.sit!.frames[0]!.bb;
  assert.ok(bb.y1 >= bb.y0, JSON.stringify(bb));
});

test('frames added to a lifted pose nobody has measured yet keep its lift', async () => {
  const h = await started([sit(boxed('a', .2, .85))], { art: { ...measuring({ [png('a')]: .9 }), processFrames: async srcs => ({ frames: srcs.map(src => ({ src, bb: { x0: 0, y0: .4, x1: 1, y1: .95 } })), scale: 1 }) } }), p = h.maker.current()!;
  h.maker.pickPose('sit');
  await h.maker.addFrames(p, [file('n.png')]);
  assert.strictEqual(h.maker.poseLift(p, 'sit'), -10);
  assert.ok(Math.abs(p.poses.sit!.frames[1]!.bb.y1 - .9) < 1e-9, String(p.poses.sit!.frames[1]!.bb.y1));
});

/* Boxes set by hand, as an artist set his: a Lift edit moves them all by the same amount from where
   they were when it began, and coming back gives back exactly what was there. */
const handSet = () => buddy({ size: 100, poses: { sit: { frames: [boxed('a', .2, .87345), boxed('b', .3, .92)], scale: 1 } } });
const bytes = (p: ReturnType<typeof buddy>) => JSON.stringify(p.poses.sit!.frames);

test('Lift away and back leaves hand-set boxes exactly as they were', async () => {
  const h = await started([handSet()], { art: measuring({ [png('a')]: .85, [png('b')]: .8 }) }), p = h.maker.current()!;
  const before = bytes(p);
  await h.maker.measureLift(p, 'sit');
  assert.strictEqual(h.maker.poseLift(p, 'sit'), 7);
  h.maker.setPoseLift(p, 'sit', 6);
  assert.strictEqual(h.maker.poseLift(p, 'sit'), 6);
  assert.ok(Math.abs(p.poses.sit!.frames[0]!.bb.y1 - .86345) < 1e-12 && Math.abs(p.poses.sit!.frames[1]!.bb.y1 - .91) < 1e-12, 'each keeps its own offset from the others');
  h.maker.setPoseLift(p, 'sit', 7);
  assert.strictEqual(bytes(p), before);
});

test('a long drag down and back, a step at a time, leaves them exactly as they were', async () => {
  const h = await started([handSet()], { art: measuring({ [png('a')]: .85, [png('b')]: .8 }) }), p = h.maker.current()!;
  const before = bytes(p);
  await h.maker.measureLift(p, 'sit');
  for (let px = 6; px >= -40; px--) h.maker.setPoseLift(p, 'sit', px);
  assert.strictEqual(h.maker.poseLift(p, 'sit'), -40);
  for (let px = -39; px <= 7; px++) h.maker.setPoseLift(p, 'sit', px);
  assert.strictEqual(bytes(p), before);
  for (const px of [3, -12, 8, 0, -1, 7]) h.maker.setPoseLift(p, 'sit', px);
  assert.strictEqual(bytes(p), before, 'and in any order');
});

test('the range stops where any frame would leave its picture, not frame by frame', async () => {
  const h = await started([handSet()], { art: measuring({ [png('a')]: .85, [png('b')]: .8 }) }), p = h.maker.current()!;
  await h.maker.measureLift(p, 'sit');
  /* b sits at .92, 8 px from the bottom */
  assert.deepStrictEqual(h.maker.liftRange(p, 'sit'), { min: -55, max: 15 }, "down to where b's box would pass its own top");
  h.maker.setPoseLift(p, 'sit', 40);
  assert.strictEqual(h.maker.poseLift(p, 'sit'), 15);
  const F = p.poses.sit!.frames;
  assert.ok(Math.abs(F[1]!.bb.y1 - 1) < 1e-12 && Math.abs(F[0]!.bb.y1 - .95345) < 1e-12, JSON.stringify(F.map(f => f.bb.y1)));
});

test('a change to the frames starts the next Lift edit from where they are then', async () => {
  const h = await started([handSet()], { art: measuring({ [png('a')]: .85, [png('b')]: .8 }) }), p = h.maker.current()!;
  await h.maker.measureLift(p, 'sit');
  h.maker.setPoseLift(p, 'sit', 2);
  h.maker.moveFrame(p, 'sit', 0, 1);
  const after = bytes(p);
  h.maker.setPoseLift(p, 'sit', 1);
  h.maker.setPoseLift(p, 'sit', 2);
  assert.strictEqual(bytes(p), after);
});

test('a frame added to a lifted pose gets its own bottom plus the lift, so it keeps it alone', async () => {
  const h = await started([buddy({ size: 100, poses: { sit: { frames: [boxed('a', .2, .9)], scale: 1 } } })], { art: { ...measuring({ [png('a')]: .9 }), processFrames: async srcs => ({ frames: srcs.map(src => ({ src, bb: { x0: 0, y0: .3, x1: 1, y1: .7 } })), scale: 1 }) } }), p = h.maker.current()!;
  await h.maker.measureLift(p, 'sit');
  h.maker.setPoseLift(p, 'sit', -10);
  h.maker.pickPose('sit');
  await h.maker.addFrames(p, [file('n.png')]);
  assert.ok(Math.abs(p.poses.sit!.frames[1]!.bb.y1 - .6) < 1e-12, String(p.poses.sit!.frames[1]!.bb.y1));
  h.maker.removeFrame(p, 'sit', 0);
  assert.strictEqual(h.maker.poseLift(p, 'sit'), -10);
});

test('a scale change starts the next Lift edit at the new scale', async () => {
  const h = await started([handSet()], { art: measuring({ [png('a')]: .85, [png('b')]: .8 }) }), p = h.maker.current()!;
  await h.maker.measureLift(p, 'sit');
  h.maker.setPoseLift(p, 'sit', 6);
  h.maker.setScale(p, 'sit', 2);
  assert.strictEqual(h.maker.poseLift(p, 'sit'), 12, 'the same lift, in px at the new scale');
  h.maker.setPoseLift(p, 'sit', 10);
  assert.strictEqual(h.maker.poseLift(p, 'sit'), 10);
  assert.ok(Math.abs(p.poses.sit!.frames[1]!.bb.y1 - .9) < 1e-12, String(p.poses.sit!.frames[1]!.bb.y1));
});

test('the top of the range never puts a box past its picture, whatever the float error', async () => {
  /* a hair under 3 px of room below her box */
  const h = await started([buddy({ size: 100, poses: { sit: { frames: [boxed('a', .2, .97 + 1e-13)], scale: 1 } } })], { art: measuring({ [png('a')]: .97 + 1e-13 }) }), p = h.maker.current()!;
  await h.maker.measureLift(p, 'sit');
  h.maker.setPoseLift(p, 'sit', 60);
  assert.ok(p.poses.sit!.frames[0]!.bb.y1 <= 1, String(p.poses.sit!.frames[0]!.bb.y1));
});

test('a frame added to a lifted pose stops at the bottom of its picture', async () => {
  const h = await started([buddy({ size: 100, poses: { sit: { frames: [boxed('a', .2, .8)], scale: 1 } } })], { art: { ...measuring({ [png('a')]: .8 }), processFrames: async srcs => ({ frames: srcs.map(src => ({ src, bb: { x0: 0, y0: .3, x1: 1, y1: .95 } })), scale: 1 }) } }), p = h.maker.current()!;
  await h.maker.measureLift(p, 'sit');
  h.maker.setPoseLift(p, 'sit', 10);
  h.maker.pickPose('sit');
  await h.maker.addFrames(p, [file('n.png')]);
  assert.strictEqual(p.poses.sit!.frames[1]!.bb.y1, 1);
});

test("a 1 px step that rounding hides is still undone exactly", async () => {
  const h = await started([buddy({ size: 120, poses: { sit: { frames: [boxed('a', .2, .875)], scale: 1 } } })], { art: measuring({ [png('a')]: .6875 }) }), p = h.maker.current()!;
  const before = bytes(p);
  await h.maker.measureLift(p, 'sit');
  assert.strictEqual(h.maker.poseLift(p, 'sit'), 23);
  h.maker.setPoseLift(p, 'sit', 24);
  assert.notStrictEqual(bytes(p), before, 'the step was written');
  assert.strictEqual(h.maker.poseLift(p, 'sit'), 24, 'and the edit says where it is');
  h.maker.setPoseLift(p, 'sit', 23);
  assert.strictEqual(bytes(p), before);
});

test('across sizes, scales and hand-set offsets, one step either way and back restores every byte', async () => {
  let checked = 0;
  for (const size of [16, 33, 64, 97, 120, 150, 211, 333, 512]) for (const scale of [.37, 1, 1.03, 2.9]) for (const m of [.5, .6875, .71, .8]) for (const off of [.0125, .1875, 1 / 3, .0417]) {
    const y1 = Math.min(1, m + off);
    const h = await started([buddy({ size, poses: { sit: { frames: [boxed('a', .1, y1), boxed('b', .2, Math.min(1, y1 - .01))], scale } } })], { art: measuring({ [png('a')]: m, [png('b')]: m - .01 }) }), p = h.maker.current()!;
    const before = bytes(p);
    await h.maker.measureLift(p, 'sit');
    const px0 = h.maker.poseLift(p, 'sit')!, r = h.maker.liftRange(p, 'sit')!;
    for (const d of [1, -1, 2, -2]) {
      if (px0 + d > r.max || px0 + d < r.min) continue;
      h.maker.setPoseLift(p, 'sit', px0 + d);
      assert.notStrictEqual(bytes(p), before, `${size} ${scale} ${m} ${off} ${d}: the step was written`);
      h.maker.setPoseLift(p, 'sit', px0);
      assert.strictEqual(bytes(p), before, `${size} ${scale} ${m} ${off} ${d}`);
      checked++;
    }
  }
  assert.ok(checked > 400, String(checked));
});

test('restorePose puts a pose back as it was, or takes it away', async () => {
  const h = await started([buddy({ id: 'p0', poses: { walk: { frames: [frame('w1')], fps: 6, scale: 1 } } })]);
  const p = h.maker.current()!, was = p.poses.walk!, copy = { ...was, frames: [...was.frames] };
  was.frames.push(frame('w2'));
  h.maker.restorePose(p, 'walk', copy);
  assert.deepStrictEqual(p.poses.walk!.frames.map(f => f.src), [png('w1')]);
  p.poses.sit = { frames: [frame('s')], fps: 4, scale: 1 };
  h.maker.restorePose(p, 'sit', undefined);
  assert.ok(!('sit' in p.poses));
});
