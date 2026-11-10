/* Sorting what's handed to the Manager, with made-up files and a made-up drop. */
import assert from 'node:assert';
import { test } from 'vitest';
import { fromDrop, fromFile, sortHanded, type Handed, type Job } from '../src/handed';

const f = (path: string): Handed => ({ name: path.split('/').pop()!, path, size: 1, text: async () => '', url: async () => 'data:' });
const shapes = (jobs: Job[]) => jobs.map(j => j.k === 'file' ? `file ${j.file.path}` : j.k === 'shimeji' ? `shimeji ${j.folder} ${j.files.length}` : `refused ${j.problem.file}: ${j.problem.why}`);

test('.buddy and .buddy.json files, each on its own', () => {
  assert.deepStrictEqual(shapes(sortHanded([f('a.buddy'), f('b.buddy.json'), f('C.BUDDY')])), ['file a.buddy', 'file b.buddy.json', 'file C.BUDDY']);
});

test('a loose .json goes to read, which decides', () => {
  assert.deepStrictEqual(shapes(sortHanded([f('olive.json')])), ['file olive.json']);
});

test('a Shimeji folder is one buddy, named for its folder', () => {
  const files = ['Mochi/shime1.png', 'Mochi/shime2.png', 'Mochi/notes.txt'].map(f);
  assert.deepStrictEqual(shapes(sortHanded(files)), ['shimeji Mochi 2']);
});

test('art in an img folder takes the name from above it, and the rest of the pack is ignored', () => {
  const files = ['Mochi/img/shime1.png', 'Mochi/img/shime2.png', 'Mochi/conf/actions.xml', 'Mochi/Shimeji.exe'].map(f);
  assert.deepStrictEqual(shapes(sortHanded(files)), ['shimeji Mochi 2']);
});

test('an img folder picked by itself has no name to give', () => {
  assert.deepStrictEqual(shapes(sortHanded(['img/shime1.png'].map(f))), ['shimeji Shimeji 1']);
});

test('spare art under the real folder isn\'t a second buddy', () => {
  const files = ['Mochi/img/shime1.png', 'Mochi/img/unused/shime1.png', 'Mochi/img/unused/shime9.png'].map(f);
  assert.deepStrictEqual(shapes(sortHanded(files)), ['shimeji Mochi 1']);
});

test('a pack of characters is one buddy each', () => {
  const files = ['img/Mochi/shime1.png', 'img/Pip/shime1.png', 'img/Pip/shime2.png'].map(f);
  assert.deepStrictEqual(shapes(sortHanded(files)), ['shimeji Mochi 1', 'shimeji Pip 2']);
});

test('shime files with no folder are one buddy', () => {
  assert.deepStrictEqual(shapes(sortHanded(['shime1.png', 'shime2.png'].map(f))), ['shimeji Shimeji 2']);
});

test('a folder with nothing to use says so, by name', () => {
  assert.deepStrictEqual(shapes(sortHanded(['Mochi/a.png', 'Mochi/readme.txt'].map(f))), ['refused Mochi (folder): No shime1.png in that folder.']);
});

test('numbered art with no first image still goes to fromShimeji, which decides', () => {
  assert.deepStrictEqual(shapes(sortHanded(['Mochi/shime2.png'].map(f))), ['shimeji Mochi 1']);
});

test('buddy files in a folder come in, and a .json there is left alone', () => {
  assert.deepStrictEqual(shapes(sortHanded(['Saved/a.buddy', 'Saved/b.buddy.json', 'Saved/other.json'].map(f))), ['file Saved/a.buddy', 'file Saved/b.buddy.json']);
});

test('anything else is refused on its own, and doesn\'t stop the rest', () => {
  const out = shapes(sortHanded(['pic.png', 'a.buddy', 'report.pdf'].map(f)));
  assert.deepStrictEqual(out, ["refused pic.png: That's an image, not a buddy.", 'file a.buddy', "refused report.pdf: That isn't a buddy file or a Shimeji folder."]);
});

test('nothing handed is nothing to do', () => {
  assert.deepStrictEqual(sortHanded([]), []);
});

test('a real File keeps its name and folder', async () => {
  const file = new File(['hello'], 'a.buddy');
  const h = fromFile(file, 'Saved/a.buddy');
  assert.deepStrictEqual([h.name, h.path, h.size, await h.text()], ['a.buddy', 'Saved/a.buddy', 5, 'hello']);
  assert.strictEqual(fromFile(file).path, 'a.buddy');
});

/* Directory readers hand over a batch at a time, and only an empty batch means the end. */
function fakeEntry(path: string, kids?: unknown[]): FileSystemEntry {
  const name = path.split('/').pop()!;
  if (!kids) return { isFile: true, isDirectory: false, fullPath: '/' + path, file: (done: (f: File) => void) => done(new File(['x'], name)) } as unknown as FileSystemEntry;
  const batches = [...kids.map(k => [k]), []];
  return { isFile: false, isDirectory: true, fullPath: '/' + path, createReader: () => ({ readEntries: (done: (e: unknown[]) => void) => done(batches.shift()!) }) } as unknown as FileSystemEntry;
}
const drop = (entries: (FileSystemEntry | null)[], files: File[] = []) =>
  ({ items: entries.map(e => ({ webkitGetAsEntry: () => e })), files } as unknown as Pick<DataTransfer, 'items' | 'files'>);

test('a dropped folder is walked to the bottom, through every batch', async () => {
  const folder = fakeEntry('Mochi', [fakeEntry('Mochi/shime1.png'), fakeEntry('Mochi/img', [fakeEntry('Mochi/img/shime2.png')])]);
  const out = await fromDrop(drop([folder, fakeEntry('a.buddy')]));
  assert.deepStrictEqual(out.map(h => h.path), ['Mochi/shime1.png', 'Mochi/img/shime2.png', 'a.buddy']);
});

test('a drop with no entries falls back on its files, and something that isn\'t a file is skipped', async () => {
  assert.deepStrictEqual((await fromDrop(drop([null], [new File(['x'], 'a.buddy')]))).map(h => h.name), ['a.buddy']);
  assert.deepStrictEqual((await fromDrop(drop([null, fakeEntry('b.buddy')]))).map(h => h.name), ['b.buddy']);
});
