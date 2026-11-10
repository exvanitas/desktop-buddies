/* Everything that can happen while a save is out. Each holds a real save partway on the fake exe,
   does the other thing for real, lets go, and looks at the disk. */
import assert from 'node:assert';
import { pack, read, write } from '@buddies/buddy-file';
import { test } from 'vitest';
import { CLOSE_ASK_MS } from '../src/maker-page';
import { changes, createDisk, frame, holding, hubOn, importing, makerOn, manifestOf, saved, small, lands, tick, revOf } from './maker-harness';

/* A save held at its first file. */
async function saving(name = 'Mine') {
  const s = await holding(small('c1'));
  s.exe.calls.length = 0;
  const release = s.exe.hold('data_write');
  s.page.maker.setName(name);
  await s.page.pass(1300);
  assert.strictEqual(s.page.saveState.kind, 'saving');
  assert.strictEqual(s.exe.calls.filter(c => c.cmd === 'data_write').length, 1, 'it really is partway');
  return { ...s, release };
}
const failures = (m: { s(): { failures: { title: string }[] } }) => m.s().failures.map(f => f.title);
const row = (m: { s(): { buddies: { id: string; copies: number; status: string; name: string }[] } }, id: string) => m.s().buddies.find(b => b.id === id);
/* She's whole: her manifest reads, and every image it names is there, and nothing else is. */
function whole(exe: ReturnType<typeof createDisk>, id: string) {
  const inside = [...exe.files.keys()].filter(k => k.startsWith(`library/${id}/`)).map(k => k.slice(`library/${id}/`.length));
  const b = pack(manifestOf(exe, id), n => exe.files.get(`library/${id}/${n}`));
  const named = new Set(JSON.stringify(JSON.parse(manifestOf(exe, id))).match(/"src":"[^"]+"/g)!.map(x => x.slice(7, -1)));
  assert.deepStrictEqual(inside.sort(), ['buddy.json', ...named].sort());
  return b;
}

test('delete during a save: the save finishes, the delete confirmed before it is refused, and once she\'s deleted the next save is refused', async () => {
  const { exe, r, m, page, release, id } = await saving();
  const deleted = m.client.deleteBuddy(id, revOf(m.client, id));
  await r.done();
  assert.ok(row(m, id), 'still there: the delete waits its turn');
  release();
  const stale = await deleted;
  assert.ok(!stale.ok && /changed since you asked/.test(stale.failure.why), 'it named the her before the save');
  await r.done();
  assert.ok(saved(exe, id), 'the save stands');
  assert.ok((await m.client.deleteBuddy(id, revOf(m.client, id))).ok);
  await r.done();
  assert.strictEqual(saved(exe, id), null);
  assert.ok(!row(m, id));
  assert.ok(![...exe.files.keys()].some(k => k.includes('.outgoing') || k.includes('.incoming') || k.includes('.trash')), 'nothing left over');
  page.maker.setName('Later');
  await page.pass(1300);
  assert.strictEqual(saved(exe, id), null, 'she stays deleted');
  assert.ok(page.saveState.kind === 'failed' && /was deleted/.test(page.saveState.title));
});

test('delete first, with a save already asked for: the save is refused, and she stays deleted', async () => {
  const { exe, r, m, page, id } = await holding(small('c1'));
  const release = exe.hold('data_delete');
  const deleted = m.client.deleteBuddy(id, revOf(m.client, id));
  await r.done();
  page.maker.setName('Mine');
  await page.pass(1300);
  release();
  assert.ok((await deleted).ok);
  await r.done();
  assert.strictEqual(saved(exe, id), null);
  assert.ok(page.saveState.kind === 'failed' && /was deleted/.test(page.saveState.title));
});

test('an import of the same character during a save: the import lands last, and the next save is refused', async () => {
  const { exe, r, m, page, release, id } = await saving();
  const imported = importing(m, small('c1', 'Imported'));
  await r.done();
  release();
  assert.ok((await imported)[0]!.ok);
  await r.done();
  assert.strictEqual(saved(exe, id)!.name, 'Imported');
  whole(exe, id);
  page.maker.setName('Later');
  await page.pass(1300);
  assert.strictEqual(saved(exe, id)!.name, 'Imported');
  assert.ok(page.saveState.kind === 'failed' && /changed somewhere else/.test(page.saveState.title));
});

test('an import of the same character first: the save behind it is refused, and neither is lost', async () => {
  const { exe, r, m, page, id } = await holding(small('c1'));
  const release = exe.hold('data_write');
  const imported = importing(m, small('c1', 'Imported'));
  await r.done();
  page.maker.setName('Mine');
  await page.pass(1300);
  release();
  await imported;
  await r.done();
  assert.strictEqual(saved(exe, id)!.name, 'Imported');
  assert.strictEqual(page.maker.current()!.name, 'Mine', 'the edit is still in the window');
  assert.ok(page.saveState.kind === 'failed' && /changed somewhere else/.test(page.saveState.title));
});

test('an import of someone else during a save disturbs nobody', async () => {
  const { exe, r, m, page, release, id } = await saving();
  const imported = importing(m, small('c2', 'Other'));
  await r.done();
  release();
  await imported;
  await r.done();
  assert.strictEqual(saved(exe, id)!.name, 'Mine');
  assert.strictEqual(saved(exe, 'c2')!.name, 'Other');
  assert.strictEqual(page.saveState.kind, 'saved');
});

test('call and dismiss during a save: both happen, and the save lands', async () => {
  const { exe, r, m, page, release, id } = await saving();
  const before = row(m, id)!.copies;
  const called = m.client.callAnother(id);
  await r.done();
  release();
  await called;
  await r.done();
  assert.strictEqual(row(m, id)!.copies, before + 1);
  assert.strictEqual(saved(exe, id)!.name, 'Mine');
  const free = exe.hold('data_write');
  page.maker.setName('Again');
  await page.pass(1300);
  const dismissed = m.client.dismiss(id);
  await r.done();
  free();
  await dismissed;
  await r.done();
  assert.strictEqual(row(m, id)!.copies, 0);
  assert.strictEqual(saved(exe, id)!.name, 'Again');
  assert.strictEqual(page.saveState.kind, 'saved');
  assert.deepStrictEqual(failures(m), []);
});

test('a second save while one is in flight waits, and goes on what the first was numbered', async () => {
  const { exe, r, page, release, id, m } = await saving('First');
  page.maker.setName('Second');
  await page.pass(1300);
  assert.strictEqual(exe.calls.filter(c => c.cmd === 'data_write').length, 1, 'the second hasn\'t started');
  release();
  await r.done();
  assert.strictEqual(saved(exe, id)!.name, 'Second');
  assert.strictEqual(page.saveState.kind, 'saved');
  assert.deepStrictEqual(failures(m), [], 'no false conflict');
});

test('the title bar\'s Close during a save waits for it, then closes', async () => {
  const { exe, r, page, release, id } = await saving();
  page.host.window!.close();
  await r.done();
  assert.ok(exe.windows.has(page.label), 'not yet');
  release();
  await r.done();
  assert.ok(!exe.windows.has(page.label));
  assert.strictEqual(saved(exe, id)!.name, 'Mine');
});

test('Close with a newer edit waiting behind a save saves that too', async () => {
  const { exe, r, page, release, id } = await saving();
  page.maker.setName('Newest');
  page.host.window!.close();
  await r.done();
  release();
  await r.done();
  assert.ok(!exe.windows.has(page.label));
  assert.strictEqual(saved(exe, id)!.name, 'Newest');
});

test('the window going during a save: the hub finishes it with nobody there', async () => {
  const { exe, r, page, release, id, m } = await saving();
  await page.killed();
  release();
  await r.done();
  assert.strictEqual(saved(exe, id)!.name, 'Mine');
  assert.deepStrictEqual(failures(m), []);
  whole(exe, id);
});

test('quit during a save: cut off partway, she\'s whole at the next start, old or new', async () => {
  const { exe, r, page, release, id } = await saving();
  /* All the exe allows: 250 ms after `quitting`, the process ends. Nothing more gets through. */
  exe.emit('quitting', null);
  exe.faultAt(1, true);
  release();
  await r.done();
  page.crashed();
  const next = await hubOn(exe);
  assert.strictEqual(saved(exe, id)!.name, 'Pip', 'the old copy');
  whole(exe, id);
  assert.ok(![...exe.files.keys()].some(k => k.includes('.outgoing') || k.includes('.incoming')));
  const again = await makerOn(next, id);
  await next.done();
  assert.strictEqual(again.maker.current()!.name, 'Pip');
});

test('a hub that never answers: the status says so after the wait, the edit stays, and Close asks', async () => {
  const s = await holding(small('c1'));
  s.exe.calls.length = 0;
  const release = s.exe.hold('data_write');
  s.page.maker.setName('Mine');
  await s.page.pass(1300);
  assert.strictEqual(s.page.saveState.kind as string, 'saving');
  await s.page.pass(30000);
  assert.ok(s.page.saveState.kind === 'failed' && s.page.saveState.title === 'Saving: no answer', JSON.stringify(s.page.saveState));
  s.page.host.window!.close();
  await s.page.pass(CLOSE_ASK_MS);
  assert.ok(s.exe.windows.has(s.page.label), 'a close that can\'t be sure asks');
  assert.ok(s.page.closing.labels().includes('Close anyway'));
  /* It was only slow, and the close that was waiting for it goes through. */
  release();
  await s.r.done();
  await s.page.pass(1300);
  assert.strictEqual(saved(s.exe, s.id)!.name, 'Mine');
  assert.ok(!s.exe.windows.has(s.page.label));
  assert.deepStrictEqual(failures(s.m), [], 'no false conflict');
});

test('a close with a hub that never answers: asked within the limit, and Close anyway closes', async () => {
  const s = await holding(small('c1'));
  s.exe.hold('data_write');
  s.page.maker.setName('Mine');
  s.exe.closeFromOutside(s.page.label);
  await s.page.pass(CLOSE_ASK_MS - 1);
  assert.deepStrictEqual(s.page.closing.labels(), [], 'it gets a fair chance first');
  await s.page.pass(1);
  assert.strictEqual(s.page.closing.asked!.title, 'Still saving');
  assert.ok(s.exe.windows.has(s.page.label));
  s.page.closing.press('Close anyway');
  await s.r.done();
  assert.ok(!s.exe.windows.has(s.page.label), 'a working page always has a way out');
});

test('the title bar\'s Close has the same limit', async () => {
  const s = await holding(small('c1'));
  s.exe.hold('data_write');
  s.page.maker.setName('Mine');
  s.page.host.window!.close();
  await s.page.pass(CLOSE_ASK_MS);
  assert.deepStrictEqual(s.page.closing.labels(), ['Keep editing', 'Close anyway']);
});

test('the window itself sticking is asked about, with no way back', async () => {
  const s = await holding(small('c1'));
  s.exe.hold('window_close');
  s.page.host.window!.close();
  await s.page.pass(CLOSE_ASK_MS);
  assert.deepStrictEqual(s.page.closing.labels(), ['Close anyway'], 'once it\'s been asked to go, there\'s no way back');
});

test('a close nobody answers at all still offers Close anyway once the wait for an answer ends', async () => {
  const s = await holding(small('c1'));
  s.exe.hold('data_write');
  s.page.maker.setName('Mine');
  s.exe.closeFromOutside(s.page.label);
  await s.page.pass(31000);
  assert.ok(s.page.closing.labels().includes('Close anyway'), JSON.stringify(s.page.closing.asked));
  assert.ok(s.exe.windows.has(s.page.label));
});

test('slow, not stuck: past the limit it asks, and when the save lands the window closes by itself', async () => {
  const s = await holding(small('c1'));
  const release = s.exe.hold('data_write');
  s.page.maker.setName('Mine');
  s.exe.closeFromOutside(s.page.label);
  await s.page.pass(CLOSE_ASK_MS + 1);
  assert.ok(s.page.closing.labels().includes('Close anyway'));
  release();
  await s.r.done();
  assert.ok(!s.exe.windows.has(s.page.label));
  assert.strictEqual(saved(s.exe, s.id)!.name, 'Mine');
});

test('a quick close never sees the question, and asks nothing', async () => {
  const s = await holding(small('c1'));
  s.page.maker.setName('Mine');
  s.exe.closeFromOutside(s.page.label);
  await s.r.done();
  assert.ok(!s.exe.windows.has(s.page.label));
  await s.page.pass(CLOSE_ASK_MS * 2);
  assert.ok(!s.page.states.some(x => x.kind === 'failed'), JSON.stringify(s.page.states));
  assert.strictEqual(s.page.closing.asked, null);
});

test('a hub gone for good: a flush doesn\'t hang forever', async () => {
  const s = await holding(small('c1'));
  s.exe.hold('data_write');
  let answer: boolean | null = null;
  s.page.maker.setName('Mine');
  s.page.maker.saveNow();
  void s.page.store.flush().then(c => { answer = c; });
  await s.page.pass(29999);
  assert.strictEqual(answer, null);
  await s.page.pass(1);
  assert.strictEqual(answer, false);
});

test('Edit for another with a save in flight: the first lands, then the other opens', async () => {
  const s = await holding(small('c1', 'One'), small('c2', 'Two'));
  const release = s.exe.hold('data_write');
  s.page.maker.setName('Mine');
  await s.page.pass(1300);
  const opening = s.page.edit('c2');
  await s.r.done();
  assert.strictEqual(s.page.maker.current()?.character, 'c1', 'waits for the flush');
  release();
  await opening;
  await s.r.done();
  assert.strictEqual(s.page.maker.current()?.character, 'c2');
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'Mine');
  assert.deepStrictEqual(s.page.maker.state.pets.map(p => p.character), ['c1', 'c2']);
});

test('Edit for another with a save that fails: she still opens, and the failed edit stays', async () => {
  const s = await holding(small('c1', 'One'), small('c2', 'Two'));
  const stop = s.exe.failUntil('data_write', 'disk full', () => true);
  s.page.maker.setName('Mine');
  await s.page.edit('c2');
  await s.r.done();
  assert.strictEqual(s.page.maker.current()?.character, 'c2');
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'One');
  assert.strictEqual(s.page.maker.state.pets.find(p => p.character === 'c1')!.name, 'Mine');
  assert.ok(s.page.saveState.kind === 'failed' && s.page.saveState.title === "Mine wasn't saved");
  stop();
  await s.page.store.flush();
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'Mine');
  assert.strictEqual(s.page.saveState.kind, 'saved');
});

test('Edit for two others in a row ends on the last, each flushed in turn', async () => {
  const s = await holding(small('c1', 'One'), small('c2', 'Two'), small('c3', 'Three'));
  s.page.maker.setName('Mine');
  void s.page.edit('c2');
  await s.page.edit('c3');
  await s.r.done();
  assert.strictEqual(s.page.maker.current()?.character, 'c3');
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'Mine');
  assert.strictEqual(s.page.maker.state.pets.length, 3);
});

test('Edit for someone just deleted says so, and the window keeps who it has', async () => {
  const s = await holding(small('c1', 'One'), small('c2', 'Two'));
  await s.m.client.deleteBuddy('c2', revOf(s.m.client, 'c2'));
  await s.page.edit('c2');
  await s.r.done();
  assert.strictEqual(s.page.maker.current()?.character, 'c1');
  assert.ok(s.page.saveState.kind === 'failed' && s.page.saveState.title === "That buddy isn't here");
});

test('Edit that couldn\'t be read can be tried again from the status', async () => {
  const s = await holding(small('c1', 'One'), small('c2', 'Two'));
  s.exe.failNext('data_read', 'locked');
  await s.page.edit('c2');
  await s.r.done();
  assert.ok(s.page.saveState.kind === 'failed' && s.page.saveState.title === "Two didn't open", JSON.stringify(s.page.saveState));
  s.page.saveState.kind === 'failed' && s.page.saveState.actions![0]!.run();
  await s.r.done();
  assert.strictEqual(s.page.maker.current()?.character, 'c2');
  assert.strictEqual(s.page.saveState.kind, 'saved');
});

test('two windows can\'t both win: the older one\'s save is refused after a newer one saved', async () => {
  const s = await holding(small('c1'));
  const second = await makerOn(s.r, 'c1');
  await s.r.done();
  second.maker.setName('Second');
  await second.pass(1300);
  s.page.maker.setName('First');
  await s.page.pass(1300);
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'Second');
  assert.ok(s.page.saveState.kind === 'failed' && /changed somewhere else/.test(s.page.saveState.title));
});

test('an edit made while a save is out isn\'t in what was sent', async () => {
  const { exe, r, page, release, id } = await saving('Sent');
  page.maker.current()!.size = 200;
  release();
  await r.done();
  assert.strictEqual(saved(exe, id)!.name, 'Sent');
  assert.strictEqual(saved(exe, id)!.size, undefined);
  page.maker.saveNow();
  await page.pass(1300);
  assert.strictEqual(saved(exe, id)!.size, 200, 'it goes next');
});

test('a save for a character that isn\'t hers is refused, and writes nothing', async () => {
  const s = await holding(small('c1'));
  const ask = s.page.store.ask;
  s.exe.calls.length = 0;
  const a = await ask({ k: 'maker-save', id: 'c1', name: 'x', file: write(small('c2', 'Other')), rev: null, session: 'w' });
  assert.ok(a.ok && a.value && 'conflict' in (a.value as object), 'c1 is there, and it\'s based on nothing');
  assert.deepStrictEqual(changes(s.exe), []);
  const b = await ask({ k: 'maker-save', id: 'c9', name: 'x', file: write(small('c2', 'Other')), rev: null, session: 'w' });
  assert.ok(!b.ok);
  assert.deepStrictEqual(changes(s.exe), []);
  assert.strictEqual(saved(s.exe, 'c2'), null);
});

test('a file that isn\'t a buddy is refused before the disk, whatever a page sends', async () => {
  const s = await holding(small('c1'));
  s.exe.calls.length = 0;
  const a = await s.page.store.ask({ k: 'maker-save', id: 'c9', name: 'x', file: '{"app":"nope"}', rev: null, session: 'w' });
  assert.ok(!a.ok);
  assert.deepStrictEqual(changes(s.exe), []);
});

test('saves before the library is ready are refused, not treated as new', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1')));
  void r;
  /* A library that can't be read, on a later run. */
  const stop = exe.failUntil('data_list', 'unreadable', () => true);
  const next = await hubOn(exe);
  stop();
  const a = await (await makerOn(next)).store.ask({ k: 'maker-save', id: 'c1', name: 'x', file: write(small('c1', 'Over')), rev: null, session: 'w' });
  assert.ok(!a.ok, 'refused');
  assert.strictEqual(a.failure.title, 'Still getting ready');
  assert.notStrictEqual(saved(exe, 'c1')!.name, 'Over');
});

test('all the steps of one save run, one after the other, with no interleaving from another save', async () => {
  const s = await holding(small('c1', 'One'), small('c2', 'Two'));
  await s.page.edit('c2');
  s.page.maker.state.pets[0]!.name = 'A';
  s.page.maker.state.pets[1]!.name = 'B';
  s.exe.calls.length = 0;
  s.page.maker.saveNow();
  await s.page.pass(1300);
  const paths = changes(s.exe).map(c => c.path ?? JSON.stringify(c.args)).filter(a => /c1|c2/.test(a)).map(a => a.includes('c1') ? 'c1' : 'c2');
  assert.strictEqual(paths.join('').match(/c1/g)!.length + paths.join('').match(/c2/g)!.length, paths.length);
  const runs = paths.filter((p, i) => p !== paths[i - 1]).length;
  assert.strictEqual(runs, 2, paths.join());
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'A');
  assert.strictEqual(saved(s.exe, 'c2')!.name, 'B');
  assert.strictEqual(lands(s.exe, 'c1') + lands(s.exe, 'c2'), 2);
});

test('a frame edit and a kit edit go on the same save, read as one file', async () => {
  const { exe, page, id } = await holding(small('c1'));
  page.maker.current()!.poses.sit = { frames: [frame('sit')], fps: 4, scale: 1 };
  page.maker.setKitField('personality', 'kind');
  await page.pass(1300);
  const b = whole(exe, id);
  assert.strictEqual(b.kit!.personality, 'kind');
  assert.strictEqual(b.poses.sit!.frames[0]!.src, frame('sit').src);
  assert.strictEqual(read(write(b)).poses.sit!.fps, 4);
  await tick();
});
