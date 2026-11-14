/* Adding, removing and selecting buddies, and what can change about one. */
import assert from 'node:assert';
import { test } from 'vitest';
import { ACTS, ALL, MAX } from '../src';
import { REF, buddy, file, frame, png, started } from './harness';

const pets = (n: number) => Array.from({ length: n }, (_, i) => buddy({ id: 'p' + i, name: 'P' + i }));

test('a new buddy gets the defaults, and is selected and saved', async () => {
  const h = await started();
  const p = h.maker.addPet({ base: frame('new') })!;
  assert.deepStrictEqual({ name: p.name, size: p.size, faces: p.faces, poses: p.poses }, { name: 'Buddy 2', size: 120, faces: 'right', poses: {} });
  assert.ok(p.character); assert.ok(p.id);
  assert.strictEqual(h.maker.selected, p.id);
  assert.strictEqual(h.maker.state.pets.at(-1), p);
  assert.strictEqual(h.saves(), 1);
  assert.deepStrictEqual(h.changes, [{ scope: 'all' }]);
});

test('what is handed in wins over the defaults, except the id', async () => {
  const h = await started();
  const p = h.maker.addPet({ base: frame('new'), name: 'Mine', size: 90, character: 'cmine', ...{ id: 'theirs' } })!;
  assert.deepStrictEqual([p.name, p.size, p.character], ['Mine', 90, 'cmine']);
  assert.notStrictEqual(p.id, 'theirs');
});

test('a stored buddy keeps its fields in this order, because exported files follow it', async () => {
  const h = await started();
  const p = h.maker.addPet({ base: frame('new'), ref: REF })!;
  assert.deepStrictEqual(Object.keys(p), ['id', 'character', 'name', 'size', 'faces', 'poses', 'base', 'ref']);
});

test('a new buddy waves hello with hearts, unless told to be quiet', async () => {
  const h = await started();
  const p = h.maker.addPet({ base: frame('a') })!;
  h.maker.addPet({ base: frame('b') }, true);
  h.tick(1299); assert.deepStrictEqual(h.acts, []);
  h.tick(1); assert.deepStrictEqual(h.acts, [[p.id, 'love']]);
});

test('adding closes the open pose', async () => {
  const h = await started();
  h.maker.togglePose(h.maker.current()!, 'walk');
  h.maker.addPet({ base: frame('a') });
  assert.strictEqual(h.maker.openPose, null);
});

test('the ninth buddy is refused, and nothing changes', async () => {
  const h = await started(pets(MAX));
  assert.strictEqual(h.maker.addPet({ base: frame('a') }), null);
  assert.deepStrictEqual(h.toasts, ['Up to 8 buddies at once']);
  assert.strictEqual(h.maker.state.pets.length, MAX);
  assert.strictEqual(h.maker.selected, 'p0');
  assert.strictEqual(h.saves(), 0);
});

test('samples come in through the same door', async () => {
  const h = await started();
  const p = await h.maker.addSample('pip');
  assert.strictEqual(p!.name, 'pip');
  assert.strictEqual(h.maker.current(), p);
});

test('an image makes a buddy named for it', async () => {
  const h = await started();
  await h.maker.addFromSrc(png('a'), 'Mochi');
  assert.strictEqual(h.maker.current()!.name, 'Mochi');
  assert.strictEqual(h.maker.current()!.base.src, png('a'));
  assert.strictEqual(h.maker.current()!.size, 120);
});

test('a photo starts a little smaller', async () => {
  const h = await started([], { art: { processBase: async src => ({ frame: { src, bb: frame('x').bb }, ref: REF, photo: true }) } });
  await h.maker.addFromSrc(png('a'));
  assert.strictEqual(h.maker.current()!.size, 110);
});

test('an image that gives nothing back is refused with a word', async () => {
  const h = await started([], { art: { processBase: async () => null } });
  await h.maker.addFromSrc(png('a'));
  assert.deepStrictEqual(h.toasts, ["Couldn't open that image"]);
  assert.strictEqual(h.maker.state.pets.length, 0);
});

test('selecting moves on and closes the open pose', async () => {
  const h = await started(pets(2));
  h.maker.togglePose(h.maker.current()!, 'walk');
  h.maker.select('p1');
  assert.strictEqual(h.maker.current()!.name, 'P1');
  assert.strictEqual(h.maker.openPose, null);
  assert.strictEqual(h.saves(), 0);
});

test('removing takes the selected buddy and selects the first left', async () => {
  const h = await started(pets(3));
  h.maker.select('p1');
  h.maker.togglePose(h.maker.current()!, 'walk');
  h.maker.remove();
  assert.deepStrictEqual(h.maker.state.pets.map(p => p.id), ['p0', 'p2']);
  assert.strictEqual(h.maker.selected, 'p0');
  assert.strictEqual(h.maker.openPose, null);
  assert.strictEqual(h.saves(), 1);
});

test('removing the last leaves nothing selected, and removing again does nothing', async () => {
  const h = await started();
  h.maker.remove(); h.maker.remove();
  assert.strictEqual(h.maker.selected, null);
  assert.strictEqual(h.maker.current(), undefined);
  assert.strictEqual(h.saves(), 1);
});

test('name and size change the selected buddy, on the slow save', async () => {
  const h = await started();
  h.maker.setName('Bo'); h.maker.setSize(200);
  const p = h.maker.current()!;
  assert.deepStrictEqual([p.name, p.size], ['Bo', 200]);
  assert.strictEqual(h.saves(), 0);
  h.tick(250);
  assert.strictEqual(h.saves(), 1);
  assert.deepStrictEqual(h.changes, [{ scope: 'field' }, { scope: 'field' }]);
});

test('a name or size the file format would refuse is refused here', async () => {
  const h = await started();
  h.maker.setName('x'.repeat(65));
  h.maker.setName(5 as unknown as string);
  for (const size of [15, 513, NaN]) h.maker.setSize(size);
  const p = h.maker.current()!;
  assert.deepStrictEqual([p.name, p.size], ['Ann', 120]);
  assert.deepStrictEqual(h.changes, []);
});

test('her lift for each surface changes on the slow save, kept short, in one order, and at 0 it leaves the file', async () => {
  const h = await started();
  const p = h.maker.current()!;
  h.maker.setLift('ceiling', 7 / 120);
  assert.deepStrictEqual(p.lift, { ceiling: .0583 });
  assert.strictEqual(h.saves(), 0);
  h.tick(250);
  assert.strictEqual(h.saves(), 1);
  assert.deepStrictEqual(h.changes, [{ scope: 'field' }]);
  h.maker.setLift('floor', -.5);
  h.maker.setLift('wall', .25);
  assert.strictEqual(JSON.stringify(p.lift), '{"floor":-0.5,"wall":0.25,"ceiling":0.0583}', 'floor, wall, ceiling, whatever order they were set in');
  h.maker.setLift('wall', .00001);
  assert.deepStrictEqual(p.lift, { floor: -.5, ceiling: .0583 }, 'a surface at 0 is gone, not 0');
  h.maker.setLift('floor', 0); h.maker.setLift('ceiling', 0);
  assert.ok(!('lift' in p), 'and with none left, so is lift');
  const keys = Object.keys(p).join(), n = h.changes.length;
  h.maker.setLift('wall', 0);
  assert.strictEqual(Object.keys(p).join(), keys);
  assert.strictEqual(h.changes.length, n, 'already none: nothing changed');
});

/* State an older Maker kept, which the file never checked: an entry that does nothing goes the
   first time anyone sets her lift, even to what it already does. */
test('a lift of 0 already there is cleared by setting it, and so is an empty one', async () => {
  for (const [lift, surface, share, left] of [
    [{ floor: 0 }, 'floor', 0, undefined], [{ wall: -0 }, 'wall', 0, undefined], [{}, 'ceiling', 0, undefined],
    [{ floor: 0, wall: 0, ceiling: 0 }, 'wall', 0, undefined], [{ floor: 0, wall: .1 }, 'wall', .1, '{"wall":0.1}'],
    [{ floor: 0, wall: .1 }, 'floor', -0, '{"wall":0.1}'], [{ ceiling: 0 }, 'wall', .2, '{"wall":0.2}']
  ] as const) {
    const h = await started([buddy({ lift: { ...lift } })]);
    h.maker.setLift(surface, share);
    const p = h.maker.current()!, what = JSON.stringify(lift) + ' ' + surface;
    if (left === undefined) assert.ok(!('lift' in p), what); else assert.strictEqual(JSON.stringify(p.lift), left, what);
    assert.deepStrictEqual(h.changes, [{ scope: 'field' }], what);
    h.maker.setLift(surface, share);
    assert.strictEqual(h.changes.length, 1, 'once: ' + what);
  }
});

test('a lift the file format would refuse is refused here', async () => {
  const h = await started([buddy({ lift: { wall: .1 } })]);
  for (const lift of [.51, -.51, NaN, Infinity, '0.2' as unknown as number]) h.maker.setLift('wall', lift);
  h.maker.setLift('window' as 'wall', .2);
  h.maker.setLift('__proto__' as 'wall', .2);
  assert.deepStrictEqual(h.maker.current()!.lift, { wall: .1 });
  assert.deepStrictEqual(h.changes, []);
});

test('facing saves now, and only takes left or right', async () => {
  const h = await started();
  h.maker.setFaces('up');
  assert.strictEqual(h.maker.current()!.faces, 'right');
  assert.strictEqual(h.saves(), 0);
  h.maker.setFaces('left');
  assert.strictEqual(h.maker.current()!.faces, 'left');
  assert.strictEqual(h.saves(), 1);
});

test('with nothing selected, changes to a buddy do nothing', async () => {
  const h = await started([]);
  h.maker.setName('x'); h.maker.setSize(100); h.maker.setFaces('left'); h.maker.setLift('floor', .1);
  assert.deepStrictEqual(h.changes, []);
});

test('a new main image goes to the selected buddy and shows off', async () => {
  const h = await started();
  await h.maker.setMainImage(file('new.png'));
  const p = h.maker.current()!;
  assert.strictEqual(p.base.src, png('new.png'));
  assert.strictEqual(h.saves(), 1);
  assert.deepStrictEqual(h.acts, [[p.id, 'love']]);
});

test('a main image that is not an image changes nothing', async () => {
  const h = await started();
  await h.maker.setMainImage(file('notes.txt', 'text/plain'));
  await h.maker.setMainImage(null);
  assert.strictEqual(h.maker.current()!.base.src, png('base'));
  assert.strictEqual(h.saves(), 0);
});

test('a paste swaps the selected main image, with no show', async () => {
  const h = await started();
  await h.maker.pasteImage(file('clip.png'));
  assert.strictEqual(h.maker.current()!.base.src, png('clip.png'));
  assert.strictEqual(h.saves(), 1);
  assert.deepStrictEqual(h.acts, []);
});

test('a paste with nobody selected is a new buddy', async () => {
  const h = await started([]);
  await h.maker.pasteImage(file('clip.png'));
  assert.strictEqual(h.maker.state.pets.length, 1);
  assert.strictEqual(h.maker.current()!.base.src, png('clip.png'));
});

test('the settings for everyone flip and save', async () => {
  const h = await started();
  h.maker.toggleBubbles(); assert.strictEqual(h.maker.state.bubbles, false);
  h.maker.toggleBubbles(); assert.strictEqual(h.maker.state.bubbles, true);
  h.maker.toggleNames(); assert.strictEqual(h.maker.state.names, false);
  h.maker.setChatter('off'); assert.strictEqual(h.maker.state.chatter, 'off');
  assert.strictEqual(h.saves(), 4);
});

test('a chattiness that does not exist is refused', async () => {
  const h = await started();
  h.maker.setChatter('loud');
  assert.strictEqual(h.maker.state.chatter, 'normal');
  assert.strictEqual(h.saves(), 0);
});

test('what is on offer follows the art, for one buddy and for everyone', async () => {
  const dancer = buddy({ id: 'd', poses: { dance: { frames: [frame('d')] } } }), still = buddy({ id: 's' });
  const h = await started([still, dancer]);
  assert.strictEqual(h.maker.canAct(still, 'dance'), false);
  assert.strictEqual(h.maker.canAct(dancer, 'dance'), true);
  assert.strictEqual(h.maker.canAnyAct('dance'), true);
  h.maker.select('d'); h.maker.remove();
  assert.strictEqual(h.maker.canAnyAct('dance'), false);
});

test('actions reach the world as they are, one buddy or everyone, and an id called all is just an id', async () => {
  const h = await started();
  h.maker.act('all', 'dance');
  h.maker.actAll('love');
  assert.deepStrictEqual(h.acts, [['all', 'dance'], ['*everyone*', 'love']]);
});

test('the action lists keep their words', () => {
  assert.strictEqual(ACTS.length, 21);
  assert.deepStrictEqual(ACTS[10], ['eat', 'Snack']);
  assert.deepStrictEqual(ALL.map(a => a[1]), ['Everyone dance', 'Everyone hearts', 'Everyone nap', 'Everyone down']);
});

test('a pasted image with no name gets the next buddy name', async () => {
  const h = await started([]);
  await h.maker.pasteImage(file('clipboard.png'));
  assert.strictEqual(h.maker.current()!.name, 'Buddy 1');
});

/* The main image is cut out slowly, and a person can move on meanwhile. */
function heldBase() {
  const held: (() => void)[] = [];
  return { held, art: { processBase: (src: string) => new Promise<{ frame: ReturnType<typeof frame>; ref: typeof REF; photo: boolean }>(done => { held.push(() => done({ frame: { src, bb: { x0: 0, y0: 0, x1: 1, y1: 1 } }, ref: REF, photo: false })); }) } };
}
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

for (const way of ['setMainImage', 'pasteImage'] as const) {
  test(`${way}: a new main image lands on the buddy it started on, whoever is selected by then`, async () => {
    const b = heldBase(), h = await started(pets(2), { art: b.art }), [one, two] = h.maker.state.pets as [ReturnType<typeof buddy>, ReturnType<typeof buddy>];
    h.maker.select(one.id);
    const before = two.base.src, going = h.maker[way](file('new.png'));
    await settle();
    h.maker.select(two.id);
    b.held[0]!();
    await going;
    assert.strictEqual(two.base.src, before);
    assert.strictEqual(one.base.src, png('new.png'));
    assert.strictEqual(h.maker.selected, two.id);
  });

  test(`${way}: if that buddy has gone, it lands nowhere and says so`, async () => {
    const b = heldBase(), h = await started(pets(2), { art: b.art }), [one, two] = h.maker.state.pets as [ReturnType<typeof buddy>, ReturnType<typeof buddy>];
    h.maker.select(one.id);
    const before = two.base.src, going = h.maker[way](file('new.png'));
    await settle();
    h.maker.remove();
    b.held[0]!();
    await going;
    assert.strictEqual(two.base.src, before);
    assert.match(h.toasts.at(-1)!, way === 'setMainImage' ? /isn't here any more.*still on your disk/ : /isn't here any more.*Paste it again/);
  });
}

/* Undo, for what a picture did on its own. */
test('takeBack: the buddies just made go, and whoever was open is again', async () => {
  const h = await started(pets(2));
  h.maker.select('p1');
  const a = h.maker.addPet({ base: frame('a') })!, b = h.maker.addPet({ base: frame('b') })!;
  const saves = h.saves();
  h.maker.takeBack([a.id, b.id], 'p1');
  assert.deepStrictEqual(h.maker.state.pets.map(p => p.id), ['p0', 'p1']);
  assert.strictEqual(h.maker.selected, 'p1');
  assert.strictEqual(h.saves(), saves + 1);
  h.maker.takeBack([a.id], 'p1');
  assert.strictEqual(h.saves(), saves + 1, 'nobody to take back, nothing to save');
});

test('takeBack with the one who was open gone opens the first, or nobody', async () => {
  const h = await started(pets(1));
  const a = h.maker.addPet({ base: frame('a') })!;
  h.maker.takeBack([a.id], 'gone');
  assert.strictEqual(h.maker.selected, 'p0');
  const solo = await started([]);
  const b = solo.maker.addPet({ base: frame('b') })!;
  solo.maker.takeBack([b.id], null);
  assert.strictEqual(solo.maker.selected, null);
});

test('restoreMain puts her main image back, with or without its ref', async () => {
  const h = await started([buddy({ id: 'p0' })]);
  const p = h.maker.current()!, { base, ref } = p;
  p.base = frame('new'); p.ref = { ...REF, w: 1 };
  h.maker.restoreMain(p, base, ref);
  assert.strictEqual(p.base, base); assert.strictEqual(p.ref, ref);
  h.maker.restoreMain(p, base, undefined);
  assert.ok(!('ref' in p));
  const gone = buddy({ id: 'gone' }), saves = h.saves();
  h.maker.restoreMain(gone, frame('x'), undefined);
  assert.strictEqual(h.saves(), saves, 'not one of hers');
});
