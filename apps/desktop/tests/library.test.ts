/* The library on disk, on the fake exe. */
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { read, unpack, write, type Buddy } from '@buddies/buddy-file';
import { test } from 'vitest';
import { createLibrary } from '../src/library';
import { createFakeExe } from '../src/shell-fake';

const SAMPLE = fs.readFileSync(new URL('../../../packages/test-support/fixtures/sample.json', import.meta.url), 'utf8');
const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
const small = (character: string, name = 'Pip'): Buddy => ({ character, name, base: { src: 'data:image/png;base64,iVBORw0KGgo=', bb: box }, poses: { walk: { frames: [{ src: 'data:image/webp;base64,UklGRgAAAABXRUJQ', bb: box }] } } });
/* The files a buddy is on disk: each image named by its bytes, and her manifest. */
const named = (bytes: Uint8Array, ext: string) => createHash('sha256').update(bytes).digest('hex').slice(0, 32) + ext;
const filesOf = (b: Buddy) => [...new Set(unpack(b).images.map(f => `library/${b.character}/${named(f.bytes, f.name.slice(f.name.lastIndexOf('.')))}`)), `library/${b.character}/buddy.json`].sort();
function setup() {
  const exe = createFakeExe(), notes: string[] = [];
  return { exe, notes, lib: createLibrary(exe.shell, l => notes.push(l)) };
}

test('an empty disk is an empty library', async () => {
  const { lib } = setup();
  assert.strictEqual(await lib.empty(), true);
  assert.deepStrictEqual(await lib.list(), []);
});

test('Olive goes on disk as a manifest and image files, and loads with URLs', async () => {
  const { lib, exe } = setup();
  const id = await lib.add(SAMPLE);
  assert.strictEqual(id, read(SAMPLE).character);
  assert.strictEqual(await lib.empty(), false);
  const names = [...exe.files.keys()];
  assert.ok(names.includes(`library/${id}/buddy.json`));
  assert.ok(names.filter(n => /\.webp$/.test(n)).length > 20);
  assert.ok(!names.some(n => n.includes('.incoming')), 'nothing left in staging');
  const [b] = await lib.list();
  assert.strictEqual(b!.name, 'Olive');
  assert.match(b!.buddy.base.src, new RegExp(`^library/${id}/[0-9a-f]{32}\\.webp$`));
  assert.deepStrictEqual(library(exe), filesOf(read(SAMPLE)), 'each image named by its bytes, with no cache-buster: a name never holds anything else');
  assert.ok(!JSON.stringify(b).includes('base64'), 'no data URLs held');
});

test('importing refuses what read refuses, and leaves the disk alone', async () => {
  const { lib, exe } = setup();
  await assert.rejects(lib.add('not json'));
  await assert.rejects(lib.add(JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: { base: { src: 'x', bb: box }, poses: {} } })));
  assert.strictEqual(exe.files.size, 0);
});

test('importing a character again replaces it, with nothing left of the old one', async () => {
  const { lib, exe } = setup();
  await lib.add(write(small('c1')));
  const b = small('c1', 'Pippin'); delete b.poses.walk;
  await lib.add(write(b));
  assert.deepStrictEqual([...exe.files.keys()].sort(), filesOf(b));
  assert.strictEqual((await lib.list())[0]!.name, 'Pippin');
});

test('a failed import leaves the old buddy whole', async () => {
  const { lib, exe } = setup();
  await lib.add(write(small('c1')));
  exe.failNext('data_write', 'disk full');
  await assert.rejects(lib.add(write(small('c1', 'New'))));
  assert.strictEqual((await lib.list())[0]!.name, 'Pip');
});

const OLDB = small('c1', 'Old');
const NEWB: Buddy = { ...small('c1', 'New'), base: { src: `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64')}`, bb: box }, poses: {} };
const OLD = filesOf(OLDB), NEW = filesOf(NEWB);
const newer = () => write(NEWB);
const library = (exe: ReturnType<typeof createFakeExe>) => [...exe.files.keys()].filter(k => k.startsWith('library/')).sort();
async function holding() {
  const s = setup();
  await s.lib.add(write(OLDB));
  return s;
}
const changes = (exe: ReturnType<typeof createFakeExe>) => exe.calls.filter(c => /^data_(write|move|delete)$/.test(c.cmd)).map(c => `${c.cmd} ${c.path ?? Object.values(c.args as object).join(' ')}`);
/* how many changes to the data folder replacing a buddy takes */
async function replaceSteps() {
  const { lib, exe } = await holding();
  exe.calls.length = 0;
  await lib.add(newer());
  return changes(exe).length;
}
/* One whole buddy, old or new: her manifest, every image it names, and field for field what was
   saved. A stop can leave the other copy's images, and only those. With `tidy`, nothing else. */
async function whole(s: ReturnType<typeof setup>, tidy = false) {
  const [b, ...rest] = await s.lib.list();
  assert.deepStrictEqual(rest, []);
  assert.ok(b, 'she survived');
  const mine = b.name === 'New' ? NEW : OLD, on = library(s.exe);
  assert.ok(mine.every(f => on.includes(f)), `${b.name}: nothing short`);
  assert.ok(on.every(f => mine.includes(f) || (!tidy && [...OLD, ...NEW].includes(f))), `${b.name}: ${on.join()}`);
  assert.strictEqual(JSON.stringify(read(await s.lib.packed('c1'))), JSON.stringify(read(write(b.name === 'New' ? NEWB : OLDB))), 'field for field');
  return b.name;
}

test('replacing a buddy who\'s home: what\'s new, then her manifest, then what she no longer uses', async () => {
  const { lib, exe } = await holding();
  exe.calls.length = 0;
  await lib.add(newer());
  const base = NEW.find(f => f.endsWith('.png'))!, gone = OLD.filter(f => !NEW.includes(f));
  assert.strictEqual(gone.length, 2, 'her old main image and her walk');
  assert.deepStrictEqual(changes(exe), [`data_write ${base}`, 'data_write library/c1/buddy.json', ...gone.map(f => `data_delete ${f}`)]);
  assert.deepStrictEqual(library(exe), NEW);
});

test('replacing takes the four steps these tests sweep: image, manifest, and two old images', async () => {
  assert.strictEqual(await replaceSteps(), 4);
});

for (const torn of [false, true]) {
  test(`a crash at any step of replacing${torn ? ', with deletes partway' : ''}: the next run finds one whole buddy, and her next save tidies`, async () => {
    const steps = await replaceSteps(), names = new Set<string>();
    for (let n = 1; n <= steps; n++) {
      const s = await holding();
      s.exe.faultAt(n, true, torn);
      await s.lib.add(newer()).catch(() => null);
      s.exe.revive();
      const next = { ...s, lib: createLibrary(s.exe.shell, () => {}) };
      await next.lib.recover();
      names.add(await whole(next));
      await next.lib.add(newer());
      assert.strictEqual(await whole(next, true), 'New', `step ${n}`);
    }
    assert.deepStrictEqual([...names].sort(), ['New', 'Old'], 'the sweep went past the swap');
  });
}

test('one failure at any step of replacing: a whole buddy straight away, and a retry works', async () => {
  const steps = await replaceSteps(), results = new Set<string>();
  for (let n = 1; n <= steps; n++) {
    const s = await holding();
    s.exe.faultAt(n);
    const failed = await s.lib.add(newer()).then(() => false, () => true);
    results.add(String(failed));
    assert.strictEqual(await whole(s), failed ? 'Old' : 'New', `step ${n}`);
    await s.lib.add(newer());
    assert.strictEqual(await whole(s, true), 'New', `step ${n}`);
  }
  assert.deepStrictEqual([...results].sort(), ['false', 'true'], 'a failed clear is still a save');
});

test('a manifest that fails to write leaves the old copy, and the new images beside her do no harm', async () => {
  const s = await holding();
  s.exe.failNext('data_write', 'disk full', () => s.exe.calls.at(-1)!.path === 'library/c1/buddy.json');
  await assert.rejects(s.lib.add(newer()), /disk full/);
  assert.strictEqual(await whole(s), 'Old');
  assert.ok(library(s.exe).includes(NEW.find(f => f.endsWith('.png'))!), 'her new image was written first');
});

test('a clear that fails is said, the save stands, and the next save finishes it', async () => {
  const s = await holding();
  const locked = s.exe.failUntil('data_delete', 'in use', () => true);
  assert.strictEqual(await s.lib.store(s.lib.prepare(newer())), true);
  assert.strictEqual(await whole(s), 'New');
  assert.ok(s.notes.some(l => /2 old files of c1 left for the next save: Error: in use/.test(l)), s.notes.join('; '));
  assert.strictEqual(library(s.exe).length, NEW.length + 2);
  locked();
  await s.lib.add(newer());
  assert.strictEqual(await whole(s, true), 'New');
});

test('recovering: a half-deleted old copy beside a home that landed just goes', async () => {
  const s = await holding();
  await s.exe.shell.dataWrite('library/.outgoing/c1/buddy.json', 'scraps');
  await s.lib.recover();
  assert.strictEqual(await whole(s), 'Old');
});

test('recovering with nothing to do changes nothing', async () => {
  const s = await holding(), before = library(s.exe);
  await s.lib.recover();
  assert.deepStrictEqual(library(s.exe), before);
  const e = setup();
  await e.lib.recover();
  assert.strictEqual(e.exe.files.size, 0);
});

test('one thing it can\'t recover is said, and the rest are', async () => {
  const s = await holding();
  await s.exe.shell.dataMove('library/c1', 'library/.outgoing/c1');
  await s.exe.shell.dataWrite('library/.outgoing/c2/buddy.json', 'x');
  s.exe.failNext('data_move', 'locked');
  await assert.rejects(s.lib.recover(), /1 still waiting/);
  assert.ok(s.notes.some(n => /couldn't recover c1: Error: locked/.test(n)), s.notes.join('; '));
  assert.ok(s.exe.files.has('library/c2/buddy.json'));
  assert.ok(s.exe.files.has('library/.outgoing/c1/buddy.json'), 'still there for next time');
  await s.lib.recover();
  assert.ok(s.exe.files.has('library/c1/buddy.json'), 'recovering again finishes it');
  assert.ok(!s.exe.files.has('library/.outgoing/c1/buddy.json'));
});

test('a copy waiting to go back counts as a library, with nothing else on disk', async () => {
  const s = await holding();
  await s.exe.shell.dataMove('library/c1', 'library/.outgoing/c1');
  assert.strictEqual(await s.lib.empty(), false);
});

for (const dir of ['', 'library', 'library/.outgoing']) {
  test(`a listing of ${JSON.stringify(dir)} that fails isn't read as empty`, async () => {
    const s = await holding();
    await s.exe.shell.dataWrite('library/.outgoing/c2/buddy.json', 'x');
    const fails = () => s.exe.failNext('data_list', 'unreadable', (a: { dir: string }) => a.dir === dir);
    fails(); await assert.rejects(s.lib.recover(), /unreadable/);
    fails(); assert.notStrictEqual(await s.lib.empty().catch(() => 'threw'), true);
    assert.ok(s.exe.files.has('library/c1/buddy.json'));
    assert.ok(s.exe.files.has('library/.outgoing/c2/buddy.json'));
  });
}

test('an import stops if it can\'t tell what\'s on disk, and touches nothing', async () => {
  const s = await holding(), before = library(s.exe);
  s.exe.failNext('data_list', 'unreadable', (a: { dir: string }) => a.dir === 'library');
  await assert.rejects(s.lib.add(newer()), /unreadable/);
  assert.deepStrictEqual(library(s.exe), before);
  s.exe.failNext('data_list', 'unreadable', (a: { dir: string }) => a.dir === 'library');
  await assert.rejects(s.lib.list(), /unreadable/);
});

test('an image that isn\'t one is refused before anything touches the disk', async () => {
  const { lib, exe } = setup(), b = small('c1');
  b.base.src = `data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;
  await assert.rejects(lib.add(write(b)), /not a png/);
  assert.strictEqual(exe.files.size, 0);
});

test('one bad folder is skipped and said, and the rest load', async () => {
  const { lib, exe, notes } = setup();
  await lib.add(write(small('good')));
  await exe.shell.dataWrite('library/broken/buddy.json', '{');
  await exe.shell.dataWrite('library/empty/x.txt', 'x');
  await exe.shell.dataWrite('library/wrong/buddy.json', exe.files.get('library/good/buddy.json')!);
  assert.deepStrictEqual((await lib.list()).map(b => b.id), ['good']);
  assert.strictEqual(notes.filter(n => /skipped/.test(n)).length, 3);
});

test('a manifest that points outside its folder is refused', async () => {
  const { lib, exe } = setup();
  await exe.shell.dataWrite('library/evil/buddy.json', JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: { character: 'evil', base: { src: '../other/base.png', bb: box }, poses: {} } }));
  assert.deepStrictEqual(await lib.list(), []);
});

test('a staging folder left by a crash is not a buddy', async () => {
  const { lib, exe } = setup();
  await exe.shell.dataWrite('library/.incoming/c1/base.png', 'x');
  assert.strictEqual(await lib.empty(), true);
  assert.deepStrictEqual(await lib.list(), []);
});

test('a file is checked before anything touches the disk', () => {
  const { lib, exe } = setup();
  assert.throws(() => lib.prepare('{"app":"nope"}'), /not a buddy file/);
  assert.strictEqual(exe.calls.length, 0);
  const p = lib.prepare(write(small('c1', 'One')));
  assert.deepStrictEqual([p.id, p.name], ['c1', 'One']);
  assert.strictEqual(exe.files.size, 0);
});

test('store says whether it replaced a buddy', async () => {
  const { lib } = setup();
  assert.strictEqual(await lib.store(lib.prepare(write(small('c1')))), false);
  assert.strictEqual(await lib.store(lib.prepare(write(small('c1')))), true);
});

test('present looks on the disk, whether she can be read or not, or is waiting to go back', async () => {
  const s = await holding();
  assert.strictEqual(await s.lib.present('c1'), true);
  assert.strictEqual(await s.lib.present('nobody'), false);
  await s.exe.shell.dataWrite('library/c1/buddy.json', 'not a manifest');
  assert.strictEqual(await s.lib.present('c1'), true);
  await s.exe.shell.dataMove('library/c1', 'library/.outgoing/c1');
  assert.strictEqual(await s.lib.present('c1'), true);
  s.exe.failNext('data_list', 'unreadable', (a: { dir: string }) => a.dir === 'library');
  await assert.rejects(s.lib.present('c1'), /unreadable/);
});

test('get reads one buddy, and throws for one that isn\'t there', async () => {
  const { lib } = setup();
  await lib.add(write(small('c1', 'One')));
  assert.strictEqual((await lib.get('c1')).name, 'One');
  await assert.rejects(lib.get('c2'));
});

test('remove takes a buddy away whole, and leaves the rest', async () => {
  const { lib, exe } = setup();
  await lib.add(write(small('c1'))); await lib.add(write(small('c2')));
  await lib.remove('c1');
  assert.deepStrictEqual((await lib.list()).map(b => b.id), ['c2']);
  assert.ok(![...exe.files.keys()].some(k => k.includes('c1') || k.includes('.trash')));
});

test('a stop after the move leaves nothing on the shelf, and the next start clears it', async () => {
  const { lib, exe } = setup();
  await lib.add(write(small('c1')));
  exe.failNext('data_delete', 'locked', (a: { path: string }) => a.path === 'library/.trash/c1');
  await assert.rejects(lib.remove('c1'), /locked/, 'the first clear of the trash fails, before anything moved');
  assert.deepStrictEqual((await lib.list()).map(b => b.id), ['c1']);
  await lib.remove('c1');
  await lib.add(write(small('c2')));
  await exe.shell.dataWrite('library/.trash/c1/base.png', 'left over');
  assert.deepStrictEqual((await lib.list()).map(b => b.id), ['c2']);
  await lib.recover();
  assert.ok(![...exe.files.keys()].some(k => k.includes('.trash')));
});

test('a delete that can\'t finish still removed the buddy, and says where the rest is', async () => {
  const { lib, exe, notes } = setup();
  await lib.add(write(small('c1')));
  let n = 0;
  exe.failNext('data_delete', 'locked', (a: { path: string }) => a.path === 'library/.trash/c1' && ++n === 2);
  await lib.remove('c1');
  assert.deepStrictEqual(await lib.list(), []);
  assert.ok(notes.some(l => /left in \.trash/.test(l)));
});

test('a failed move leaves the buddy where it was', async () => {
  const { lib, exe } = setup();
  await lib.add(write(small('c1')));
  exe.failNext('data_move', 'locked');
  await assert.rejects(lib.remove('c1'), /locked/);
  assert.deepStrictEqual((await lib.list()).map(b => b.id), ['c1']);
});

test('packed makes one file that reads back as the same buddy', async () => {
  const { lib } = setup();
  const id = await lib.add(SAMPLE);
  const back = read(await lib.packed(id)), original = read(SAMPLE);
  assert.deepStrictEqual(back.lines, original.lines);
  assert.strictEqual(back.character, id);
  assert.deepStrictEqual(Object.keys(back.poses).sort(), Object.keys(original.poses).sort());
  assert.strictEqual(back.base.bb.x1, original.base.bb.x1);
});

test('a buddy with an image missing won\'t pack', async () => {
  const { lib, exe } = setup();
  await lib.add(write(small('c1')));
  exe.files.delete([...exe.files.keys()].find(k => /\.webp$/.test(k))!);
  await assert.rejects(lib.packed('c1'), /no such file/);
});

/* Every field the file can hold, with frames out of order, repeated, and shared with her main image. */
const pngOf = (seed: string) => `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.from(seed)]).toString('base64')}`;
const FULL: Buddy = {
  character: 'c1', name: 'Full', size: 222, faces: 'left', ref: { ow: -1, oh: -1, w: 300, h: 280, cx: 150.5, by: 270, side: 280 },
  base: { src: pngOf('base'), bb: { x0: .1, y0: .2, x1: .8, y1: .95 } },
  poses: {
    walk: { frames: [{ src: pngOf('w2'), bb: { x0: 0, y0: 0, x1: .5, y1: .5 } }, { src: pngOf('w1'), bb: box }, { src: pngOf('w2'), bb: { x0: .3, y0: .3, x1: .6, y1: .9 } }], fps: 7.5, scale: 1.25 },
    sit: { frames: [{ src: pngOf('base'), bb: box }], fps: .5 }
  },
  lines: { chat: ['hi', 'with "quotes"'], hello: ['ünïcödé'] }, kit: { mode: 'text', personality: 'calm' }, signature: { weight: 2.5, line: 'yours' }
};

test('a round trip through packed and back writes only her manifest, and every field survives', async () => {
  const { lib, exe } = setup();
  await lib.add(write(FULL));
  const once = await lib.packed('c1');
  assert.strictEqual(JSON.stringify(read(once)), JSON.stringify(read(write(FULL))), 'field for field, frames in order');
  exe.calls.length = 0;
  assert.strictEqual(await lib.store(lib.prepare(once)), true);
  assert.deepStrictEqual(changes(exe), ['data_write library/c1/buddy.json']);
  assert.strictEqual(await lib.packed('c1'), once);
  assert.deepStrictEqual(library(exe), filesOf(FULL), 'the repeated image is one file');
});

test('the same bytes declared as two types are one file', async () => {
  const { lib, exe } = setup(), b = small('c1');
  b.poses.walk!.frames = [{ src: pngOf('same'), bb: box }, { src: pngOf('same').replace('image/png', 'image/webp'), bb: box }];
  await lib.add(write(b));
  assert.strictEqual(library(exe).filter(f => /\.png$/.test(f)).length, 2, 'her main image and one more');
  const back = read(await lib.packed('c1'));
  assert.strictEqual(back.poses.walk!.frames[0]!.src, back.poses.walk!.frames[1]!.src);
});

test('packed reads her manifest and the files it names, and nothing else in her folder', async () => {
  const { lib, exe } = setup();
  await lib.add(write(FULL));
  await exe.shell.dataWrite(`library/c1/${'0'.repeat(32)}.png`, new Uint8Array(5000));
  await exe.shell.dataWrite('library/c1/stray.txt', 'x');
  exe.calls.length = 0;
  await lib.packed('c1');
  const reads = exe.calls.filter(c => c.cmd === 'data_read').map(c => (c.args as { path: string }).path).sort();
  assert.deepStrictEqual(reads, filesOf(FULL));
  assert.ok(!exe.calls.some(c => c.cmd === 'data_list'), 'no listing');
});

test('an image under her name for it, but the wrong size, is written again', async () => {
  const { lib, exe } = setup();
  await lib.add(write(FULL));
  const cut = filesOf(FULL).find(f => f.endsWith('.png'))!;
  exe.files.set(cut, exe.files.get(cut)!.slice(0, 3));
  exe.calls.length = 0;
  await lib.add(write(FULL));
  assert.deepStrictEqual(changes(exe), [`data_write ${cut}`, 'data_write library/c1/buddy.json']);
  assert.strictEqual(JSON.stringify(read(await lib.packed('c1'))), JSON.stringify(read(write(FULL))));
});

/* What an older build leaves: her images under the names unpack gives them. */
function legacy(exe: ReturnType<typeof createFakeExe>, b: Buddy, dir = `library/${b.character}`) {
  const { manifest, images } = unpack(b);
  for (const f of images) exe.files.set(`${dir}/${f.name}`, f.bytes);
  exe.files.set(`${dir}/buddy.json`, new TextEncoder().encode(manifest));
}

test('a folder an older build wrote loads as it is, and her first save here names it by bytes and clears the old names', async () => {
  const s = setup();
  legacy(s.exe, OLDB);
  assert.match((await s.lib.get('c1')).buddy.base.src, /^library\/c1\/base\.png$/);
  assert.strictEqual(JSON.stringify(read(await s.lib.packed('c1'))), JSON.stringify(read(write(OLDB))));
  await s.lib.add(newer());
  assert.strictEqual(await whole(s, true), 'New');
});

for (const home of [true, false]) {
  test(`an old copy an older build left in ${'.outgoing'}${home ? ' beside her home' : ', with no home'}, then a save`, async () => {
    const s = setup();
    legacy(s.exe, OLDB, 'library/.outgoing/c1');
    if (home) legacy(s.exe, OLDB);
    await s.lib.add(newer());
    assert.strictEqual(await whole(s, true), 'New');
    assert.ok(!library(s.exe).some(f => f.includes('.outgoing')), 'the old copy is done with');
  });
}

test('a home with no manifest is made whole in place, and what she doesn\'t use goes', async () => {
  const s = setup();
  await s.exe.shell.dataWrite('library/c1/base.png', new Uint8Array(9));
  await s.exe.shell.dataWrite('library/c1/notes.txt', 'x');
  assert.deepStrictEqual(await s.lib.list(), [], 'no buddy yet');
  s.exe.calls.length = 0;
  assert.strictEqual(await s.lib.store(s.lib.prepare(newer())), true);
  assert.ok(!changes(s.exe).some(c => c.startsWith('data_move')), 'in place');
  assert.strictEqual(await whole(s, true), 'New');
});

test('a new buddy whose first try failed partway lands with nothing of that try', async () => {
  const s = setup(), first = small('c1', 'First');
  first.poses.walk!.frames.push({ src: pngOf('only the first had this'), bb: box });
  s.exe.failNext('data_write', 'disk full', () => s.exe.calls.filter(c => c.cmd === 'data_write').length === 3);
  await assert.rejects(s.lib.add(write(first)), /disk full/);
  assert.ok(library(s.exe).some(f => f.includes('.incoming')), 'the try left something in staging');
  await s.lib.add(newer());
  assert.strictEqual(await whole(s, true), 'New');
});

test('a save stops if it can\'t list her folder, and touches nothing', async () => {
  const s = await holding(), before = library(s.exe);
  s.exe.failNext('data_list', 'unreadable', (a: { dir: string }) => a.dir === 'library/c1');
  s.exe.calls.length = 0;
  await assert.rejects(s.lib.add(newer()), /unreadable/);
  assert.deepStrictEqual(changes(s.exe), []);
  assert.deepStrictEqual(library(s.exe), before);
});

test('each image is named by the first 32 hex digits of its SHA-256', async () => {
  const { lib, exe } = setup();
  await lib.add(write(small('c1')));
  const bytes = Buffer.from('UklGRgAAAABXRUJQ', 'base64');
  assert.ok(exe.files.has(`library/c1/${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.webp`), library(exe).join());
});

test('a buddy too big to come back in isn\'t exported: an image used many times is one file on disk', async () => {
  const { lib, exe } = setup();
  const frames = Array.from({ length: 100 }, () => ({ src: 'base.png', bb: box }));
  await exe.shell.dataWrite('library/c1/buddy.json', JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: { character: 'c1', base: { src: 'base.png', bb: box }, poses: { walk: { frames } } } }));
  await exe.shell.dataWrite('library/c1/base.png', new Uint8Array(700000));
  await assert.rejects(lib.packed('c1'), /too big/);
}, 60000);
