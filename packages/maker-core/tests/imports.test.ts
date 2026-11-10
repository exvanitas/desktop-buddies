/* Files in and out: images, buddy files, Shimeji folders and generated art. */
import assert from 'node:assert';
import { read, write } from '@buddies/buddy-file';
import { test } from 'vitest';
import type { MakerFile } from '../src';
import { REF, buddy, file, frame, png, started } from './harness';

const inFolder = (path: string): MakerFile => ({ ...file(path.split('/').pop()!), webkitRelativePath: path });
const textFile = (text: string, name = 'pip.buddy') => file(name, 'application/octet-stream', text);
const FILE = { character: 'cfile', name: 'Pip', size: 100, faces: 'left', base: frame('b'), ref: REF, poses: { walk: { frames: [frame('w')], fps: 6 } } };

test('images picked or dropped become buddies, named for the file', async () => {
  const h = await started([]);
  await h.maker.addFiles([file('mochi.png'), file('a-very-long-file-name-indeed.png')]);
  assert.deepStrictEqual(h.maker.state.pets.map(p => p.name), ['mochi', 'a-very-long-file']);
});

test('what is not an image is refused, and the rest still come in', async () => {
  const h = await started([]);
  await h.maker.addFiles([file('notes.txt', 'text/plain'), file('mochi.png')]);
  assert.deepStrictEqual(h.toasts, ['Only image files can be added']);
  assert.strictEqual(h.maker.state.pets.length, 1);
});

test('four Shimeji frames dropped are a Shimeji set, not four buddies', async () => {
  const h = await started([]);
  await h.maker.addFiles([1, 2, 3, 4].map(n => file(`shime${n}.png`)));
  assert.strictEqual(h.maker.state.pets.length, 1);
  assert.strictEqual(h.maker.current()!.name, 'Shimeji');
});

test('three Shimeji frames are three images', async () => {
  const h = await started([]);
  await h.maker.addFiles([1, 2, 3].map(n => file(`shime${n}.png`)));
  assert.strictEqual(h.maker.state.pets.length, 3);
});

for (const [path, name] of [
  ['Mochi/shime1.png', 'Mochi'], ['Packs/Mochi/art/shime1.png', 'art'], ['Some Very Long Folder Name/shime1.png', 'Some Very Long F'],
  ['img/shime1.png', 'Shimeji'], ['IMG/shime1.png', 'Shimeji'], ['Mochi/img/shime1.png', 'Mochi'], ['img/Mochi/shime1.png', 'Mochi'], ['shime1.png', 'Shimeji']
] as const) {
  test(`a Shimeji file at ${path} names the buddy ${name}`, async () => {
    const h = await started([]);
    await h.maker.importShimeji([inFolder(path)]);
    assert.strictEqual(h.maker.current()!.name, name);
  });
}

test('a Shimeji import says how many poses came in', async () => {
  const h = await started([]);
  await h.maker.importShimeji([inFolder('Mochi/shime1.png')]);
  assert.deepStrictEqual(h.toasts, ['Importing Shimeji frames…', 'Imported 2 poses — tweak any in Pose frames']);
  assert.strictEqual(h.maker.current()!.faces, 'left');
  assert.strictEqual(h.saves(), 1);
});

test('only the Shimeji frames in a folder are read', async () => {
  const seen: string[] = [];
  const h = await started([], { art: { fromShimeji: async list => { seen.push(...list.map(f => f.name)); return null; } } });
  await h.maker.importShimeji([file('shime1.png'), file('readme.png'), file('SHIME2.PNG')]);
  assert.deepStrictEqual(seen, ['shime1.png', 'SHIME2.PNG']);
});

test('a folder with no frames is refused with a word', async () => {
  const h = await started([]);
  await h.maker.importShimeji([file('readme.txt', 'text/plain')]);
  assert.deepStrictEqual(h.toasts, ['No shime1.png … files found in that folder']);
});

test('a set with no first frame is refused with a word', async () => {
  const h = await started([]);
  await h.maker.importShimeji([file('shime2.png')]);
  assert.deepStrictEqual(h.toasts.at(-1), 'A Shimeji set needs at least shime1.png');
  assert.strictEqual(h.maker.state.pets.length, 0);
});

test('a buddy file comes in whole, with its character', async () => {
  const h = await started([]);
  await h.maker.importBuddy(textFile(JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: FILE })));
  const p = h.maker.current()!;
  assert.strictEqual(p.character, 'cfile');
  assert.strictEqual(p.name, 'Pip');
  assert.strictEqual(p.poses.walk!.fps, 6);
  assert.strictEqual(h.saves(), 1);
});

test('a version 1 file upgrades on the way in, which only read() does', async () => {
  const h = await started([]);
  const { character, ...old } = FILE;
  await h.maker.importBuddy(textFile(JSON.stringify({ app: 'desktop-buddies', version: 1, buddy: old })));
  assert.match(h.maker.current()!.character!, /^c[a-z0-9]+$/);
  assert.notStrictEqual(h.maker.current()!.character, character);
});

for (const [name, text] of [
  ['not JSON', 'hello'],
  ['another app', JSON.stringify({ app: 'nope', version: 2, buddy: FILE })],
  ['an unknown field', JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: { ...FILE, extra: 1 } })],
  ['a hostile image', JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: { ...FILE, base: { ...FILE.base, src: 'x" onerror="alert(1)' } } })],
  ['an unknown pose', JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: { ...FILE, poses: { flying: { frames: [] } } } })],
  ['a version 2 file with no character', JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: { ...FILE, character: undefined } })]
] as const) {
  test(`a file with ${name} is refused, and adds nobody`, async () => {
    const h = await started([]);
    await h.maker.importBuddy(textFile(text));
    assert.deepStrictEqual(h.toasts, ["That isn't a Desktop Buddies file"]);
    assert.strictEqual(h.maker.state.pets.length, 0);
    assert.strictEqual(h.saves(), 0);
  });
}

test('no file picked: nothing happens', async () => {
  const h = await started([]);
  await h.maker.importBuddy(undefined);
  assert.deepStrictEqual(h.toasts, []);
});

test('saving a buddy gives the file format\'s text and name', async () => {
  const h = await started([buddy({ name: 'A/n: n' })]);
  const f = h.maker.buddyFile()!, p = h.maker.current()!;
  assert.strictEqual(f.name, 'An n.buddy');
  assert.strictEqual(f.text, write(p));
});

test('with nobody selected there is nothing to save', async () => {
  const h = await started([]);
  assert.strictEqual(h.maker.buddyFile(), null);
});

test('a saved buddy reads back the same, without its id', async () => {
  const h = await started([buddy({ kit: { personality: 'shy' }, lines: { chat: ['hi'] }, poses: { walk: { frames: [frame('w')], fps: 6, scale: 1.2 } } })]);
  const { id, ...rest } = h.maker.current()!;
  assert.deepStrictEqual(read(h.maker.buddyFile()!.text), rest);
  assert.ok(id);
});

test('a saved buddy comes back through import with a new id and the same character', async () => {
  const h = await started();
  const first = h.maker.current()!, text = h.maker.buddyFile()!.text;
  await h.maker.importBuddy(textFile(text));
  const second = h.maker.current()!;
  assert.notStrictEqual(second.id, first.id);
  assert.strictEqual(second.character, first.character);
});

test('generated art lands on poses named by the files', async () => {
  const h = await started(), p = h.maker.current()!;
  await h.maker.importGenerated([file('walk_2.png'), file('walk_1.png'), file('cry.png')]);
  assert.deepStrictEqual(p.poses.walk!.frames.map(f => f.src), [png('walk_1.png'), png('walk_2.png')]);
  assert.deepStrictEqual([p.poses.walk!.fps, p.poses.cry!.fps], [5, 4]);
  assert.strictEqual(h.saves(), 1);
  assert.deepStrictEqual(h.toasts, ['Processing images…', 'Updated 2 poses']);
  h.tick(400);
  assert.deepStrictEqual(h.acts, [[p.id, 'love']]);
});

test('a generated pose replaces what the pose had', async () => {
  const h = await started([buddy({ poses: { cry: { frames: [frame('old'), frame('older')], fps: 9, scale: 2 } } })]), p = h.maker.current()!;
  await h.maker.importGenerated([file('cry.png')]);
  assert.strictEqual(p.poses.cry!.frames.length, 1);
  assert.strictEqual(p.poses.cry!.fps, 4);
});

test('run frames play fast', async () => {
  const h = await started(), p = h.maker.current()!;
  await h.maker.importGenerated([file('run_1.png')]);
  assert.strictEqual(p.poses.run!.fps, 10);
});

test('each pose is processed on its own, and matched to the main image', async () => {
  const opts: unknown[] = [];
  const h = await started([buddy()], { art: { processFrames: async (srcs, _ref, o) => { opts.push(o); return { frames: srcs.map(src => ({ src, bb: frame('x').bb })), scale: 1 }; } } }), p = h.maker.current()!;
  await h.maker.importGenerated([file('walk.png'), file('sit.png')]);
  assert.deepStrictEqual(opts, [{ independent: true }, { independent: true }]);
  assert.deepStrictEqual([p.poses.walk!.scale, p.poses.sit!.scale], [1.5, 1.425]);
});

test('a pose that cannot be measured starts at its usual scale', async () => {
  const h = await started([buddy()], { art: { matchScale: async () => null } }), p = h.maker.current()!;
  await h.maker.importGenerated([file('sit.png'), file('walk.png')]);
  assert.deepStrictEqual([p.poses.sit!.scale, p.poses.walk!.scale], [.85, 1]);
});

test('main.png becomes the main image, and the poses are matched to it', async () => {
  const h = await started(), p = h.maker.current()!;
  await h.maker.importGenerated([file('pip-main.png'), file('cry.png')]);
  assert.strictEqual(p.base.src, png('pip-main.png'));
  assert.strictEqual(h.toasts.at(-1), 'Updated main image + 1 pose');
  assert.ok(!('main' in p.poses));
});

test('main.png alone updates the main image and nothing plays', async () => {
  const h = await started();
  await h.maker.importGenerated([file('main.png')]);
  assert.strictEqual(h.toasts.at(-1), 'Updated main image + 0 poses');
  h.tick(1000);
  assert.deepStrictEqual(h.acts, []);
});

test('a lone stand image is a blink, mixed into the main image', async () => {
  const h = await started(), p = h.maker.current()!;
  await h.maker.importGenerated([file('stand.png')]);
  assert.deepStrictEqual(p.poses.stand!.frames.map(f => f.src), [...Array<string>(7).fill(png('base')), png('stand.png')]);
});

test('a blink uploaded with a new main image mixes into the upload, not the processed main image', async () => {
  const h = await started([buddy()], { art: { processBase: async () => ({ frame: frame('trimmed'), ref: REF, photo: false }) } }), p = h.maker.current()!;
  await h.maker.importGenerated([file('main.png'), file('stand.png')]);
  assert.strictEqual(p.base.src, png('trimmed'));
  assert.strictEqual(p.poses.stand!.frames[0]!.src, png('main.png'));
});

test('files with no pose in the name are counted and skipped', async () => {
  const h = await started();
  await h.maker.importGenerated([file('walk.png'), file('holiday.png')]);
  assert.strictEqual(h.toasts.at(-1), 'Updated 1 pose · skipped 1 unnamed file(s)');
});

test('nothing named after a pose is refused with a word', async () => {
  const h = await started();
  await h.maker.importGenerated([file('holiday.png'), file('walk.txt', 'text/plain')]);
  assert.deepStrictEqual(h.toasts, ['Name files after poses, e.g. walk_1.png']);
  assert.strictEqual(h.saves(), 0);
});

test('a pose that will not process is left out of the count', async () => {
  const h = await started([buddy()], { art: { processFrames: async () => null } }), p = h.maker.current()!;
  await h.maker.importGenerated([file('walk.png')]);
  assert.deepStrictEqual(p.poses, {});
  assert.strictEqual(h.toasts.at(-1), 'Updated 0 poses');
});

test('generated art needs someone selected', async () => {
  const h = await started([]);
  await h.maker.importGenerated([file('walk.png')]);
  assert.deepStrictEqual(h.toasts, []);
});

test('a Shimeji set with no room only says there is no room', async () => {
  const h = await started(Array.from({ length: 8 }, (_, i) => buddy({ id: 'b' + i })));
  await h.maker.importShimeji([inFolder('Mochi/shime1.png')]);
  assert.strictEqual(h.maker.state.pets.length, 8);
  assert.deepStrictEqual(h.toasts, ['Importing Shimeji frames…', 'Up to 8 buddies at once']);
});

test('a main image that fails keeps the old one, says so, and the rest still come in', async () => {
  const h = await started([buddy()], { art: { processBase: async () => null } }), p = h.maker.current()!, was = p.base;
  await h.maker.importGenerated([file('main.png'), file('walk_1.png')]);
  assert.strictEqual(p.base, was);
  assert.ok(p.poses.walk, 'walk came in');
  assert.deepStrictEqual(h.toasts, ['Processing images…', "Updated 1 pose · couldn't read the main image"]);
});

test('a buddy her own file would refuse is not handed out, and it says why', async () => {
  const h = await started([buddy({ kit: { appearance: 'x'.repeat(4001) } })]);
  assert.strictEqual(h.maker.buddyFile(), null);
  assert.strictEqual(h.toasts.length, 1);
  assert.match(h.toasts[0]!, /^Can't save Ann: .*appearance/);
});

test('a buddy within the limits comes back from her own file', async () => {
  const h = await started([buddy({ kit: { appearance: 'x'.repeat(4000) } })]);
  assert.strictEqual(read(h.maker.buddyFile()!.text).kit!.appearance!.length, 4000);
  assert.deepStrictEqual(h.toasts, []);
});

test('generated images for a buddy who has gone land nowhere, and it says so', async () => {
  let release: () => void = () => {};
  const held = new Promise<void>(r => { release = r; });
  const h = await started([buddy(), buddy({ id: 'y', name: 'Bo' })], { art: { matchScale: async () => { await held; return 1; } } });
  const going = h.maker.importGenerated([file('walk_1.png')]);
  await new Promise(r => setTimeout(r));
  h.maker.remove();
  const saves = h.saves();
  release();
  await going;
  assert.strictEqual(h.saves(), saves);
  assert.match(h.toasts.at(-1)!, /isn't here any more.*still on your disk/);
});
