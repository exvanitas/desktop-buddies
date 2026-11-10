/* Close as one sequence, and the edges of revisions: what the second review found. Each of these
   failed before its fix. */
import assert from 'node:assert';
import { pack, write } from '@buddies/buddy-file';
import { test } from 'vitest';
import { CLOSE_ASK_MS } from '../src/maker-page';
import type { Said } from '../src/manager-api';
import { MAKER } from '../src/maker-window';
import type { Wire } from '../src/wire';
import { art, createDisk, frame, holding, hubOn, importing, makerOn, manifestOf, pickedFile, saved, small, revOf } from './maker-harness';

const fileOf = (text: string) => ({ ...pickedFile('x.buddy'), text: async () => text });
const shelved = (exe: ReturnType<typeof createDisk>) => [...exe.files.keys()].filter(k => /^library\/[^/.]+\/buddy\.json$/.test(k)).map(k => k.split('/')[1]!);
/* Her with her images in, so an image that changed shows, whatever its file is called. */
const whole = (exe: ReturnType<typeof createDisk>, id: string) => pack(manifestOf(exe, id), n => exe.files.get(`library/${id}/${n}`));
/* A wire that loses the answer to this window's first save. */
function losingFirst() {
  let lost: string | null = null;
  return (w: Wire<Said>): Wire<Said> => ({
    ...w,
    post(m) { if (m.k === 'do' && m.cmd.k === 'maker-save' && !lost) lost = m.id; w.post(m); },
    listen(f) { w.listen(m => { if (!(m.k === 'done' && m.id === lost)) f(m); }); }
  });
}

/* review 5: Close stops input first, and it stays stopped until the window has really gone */

test('Close stops input before it does anything else, until the window is really gone', async () => {
  const s = await holding(small('c1'));
  const hold = s.exe.hold('window_close');
  s.page.maker.setName('A');
  s.page.host.window!.close();
  assert.ok(s.page.closing.stopped, 'stopped at once');
  await s.r.done();
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'A', 'flushed');
  assert.ok(s.exe.windows.has(s.page.label), 'the window is still going');
  assert.ok(s.page.closing.stopped, 'and nothing can reach her meanwhile');
  hold();
  await s.r.done();
  assert.ok(!s.exe.windows.has(s.page.label));
});

test('a close from outside takes the same way', async () => {
  const s = await holding(small('c1'));
  const hold = s.exe.hold('window_close');
  s.exe.closeFromOutside(s.page.label);
  assert.ok(s.page.closing.stopped);
  hold();
  await s.r.done();
  assert.ok(!s.exe.windows.has(s.page.label));
});

test('a window that won\'t go comes back to life, says so, and saves again', async () => {
  const s = await holding(small('c1'));
  s.exe.failNext('window_close', 'denied');
  s.page.maker.setName('A');
  s.page.host.window!.close();
  await s.r.done();
  assert.ok(!s.page.closing.stopped, 'input is back');
  assert.ok(s.page.saveState.kind === 'failed' && s.page.saveState.title === "The Maker didn't close", JSON.stringify(s.page.saveState));
  s.page.maker.setName('B');
  await s.page.pass(1300);
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'B');
  s.page.host.window!.close();
  await s.r.done();
  assert.ok(!s.exe.windows.has(s.page.label), 'and it can close after all');
});

/* review 6: it waits for image work */

function slowArt() {
  let go = () => {};
  const gate = new Promise<void>(r => { go = r; });
  return { go: () => go(), art: { ...art, processFrames: async (srcs: string[]) => { await gate; return art.processFrames(srcs); } } };
}
const generated = () => [pickedFile('main.png'), pickedFile('walk_1.png')];

test('Close waits for image work, so half an import is never saved as finished', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1'))), slow = slowArt();
  const page = await makerOn(r, 'c1', { art: slow.art });
  await r.done();
  const before = whole(exe, 'c1');
  void page.track(() => page.maker.importGenerated(generated()));
  await r.done();
  assert.notStrictEqual(page.maker.current()!.base.src, before.base.src, 'the main image is in the state already');
  exe.calls.length = 0;
  page.host.window!.close();
  await page.pass(1300);
  assert.ok(exe.windows.has(page.label), 'not closed');
  assert.ok(!exe.calls.some(c => c.cmd === 'data_move'), 'and not half saved');
  slow.go();
  await r.done();
  assert.ok(!exe.windows.has(page.label), 'the work ended, so it saved and closed');
  const b = whole(exe, 'c1');
  assert.notStrictEqual(b.base.src, before.base.src);
  assert.notStrictEqual(b.poses.walk!.frames[0]!.src, before.poses.walk!.frames[0]!.src, 'with all of the import');
});

test('image work that never ends: it asks within the limit, and Close anyway still closes', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1'))), slow = slowArt();
  const page = await makerOn(r, 'c1', { art: slow.art });
  await r.done();
  const before = whole(exe, 'c1');
  void page.track(() => page.maker.importGenerated(generated()));
  await r.done();
  page.host.window!.close();
  await page.pass(CLOSE_ASK_MS);
  page.closing.press('Close anyway');
  await r.done();
  assert.ok(!exe.windows.has(page.label));
  assert.strictEqual(whole(exe, 'c1').base.src, before.base.src, 'nothing half done was saved');
});

/* Keep editing */

test('Keep editing puts everything back: input, saving, and a later Close', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1'))), slow = slowArt();
  const page = await makerOn(r, 'c1', { art: slow.art });
  await r.done();
  void page.track(() => page.maker.importGenerated(generated()));
  await r.done();
  page.host.window!.close();
  await page.pass(CLOSE_ASK_MS);
  page.closing.press('Keep editing');
  await r.done();
  assert.ok(!page.closing.stopped);
  assert.ok(exe.windows.has(page.label));
  slow.go(); /* the work ending now doesn't finish a close nobody wants any more */
  await r.done();
  assert.ok(exe.windows.has(page.label));
  page.maker.setName('Later');
  await page.pass(1300);
  assert.strictEqual(saved(exe, 'c1')!.name, 'Later');
  page.host.window!.close();
  await r.done();
  assert.ok(!exe.windows.has(page.label));
});

test('a save that fails offers both ways out at once, with what it can do about it', async () => {
  const s = await conflicted();
  s.page.host.window!.close();
  await s.r.done();
  assert.deepStrictEqual(s.page.closing.labels(), ['Keep as a new buddy', 'Keep editing', 'Close anyway']);
  assert.strictEqual(s.page.closing.asked!.title, 'Mine changed somewhere else', 'it says what\'s really wrong');
  s.page.closing.press('Keep as a new buddy');
  await s.r.done();
  assert.ok(!s.exe.windows.has(s.page.label), 'kept, so the close goes through');
  assert.strictEqual(shelved(s.exe).filter(c => c !== 'c1').length, 1);
});

async function conflicted() {
  const s = await holding(small('c1'));
  await importing(s.m, small('c1', 'Imported'));
  await s.r.done();
  s.page.maker.setName('Mine');
  await s.page.pass(1300);
  return s;
}

/* review 8: Close anyway isn't final until the window has gone */

test('Close anyway on a window that won\'t go: saving comes back', async () => {
  const s = await holding(small('c1'));
  const full = s.exe.failUntil('data_write', 'disk full', () => true);
  s.page.maker.setName('Mine');
  s.page.host.window!.close();
  await s.r.done();
  s.exe.failNext('window_close', 'denied');
  s.page.closing.press('Close anyway');
  await s.r.done();
  assert.ok(s.exe.windows.has(s.page.label));
  assert.ok(!s.page.closing.stopped, 'it lives');
  full();
  s.page.maker.setName('Later');
  await s.page.pass(1300);
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'Later', 'saving works');
  assert.strictEqual(await s.page.store.flush(), true);
});

/* review 3: the false Saved */

test('a timed out save, then back to the old value: it\'s written, because nobody knows what\'s on disk', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1', 'Original')));
  const page = await makerOn(r, 'c1', { wireOf: losingFirst() });
  await r.done();
  page.maker.setName('Changed');
  await page.pass(31300);
  assert.strictEqual(saved(exe, 'c1')!.name, 'Changed');
  const hold = exe.hold('data_write');
  page.maker.setName('Original');
  await page.pass(1300);
  assert.notStrictEqual(page.saveState.kind, 'saved', 'it can\'t say saved until an answer says so');
  hold();
  await r.done();
  assert.strictEqual(saved(exe, 'c1')!.name, 'Original');
  assert.strictEqual(page.saveState.kind, 'saved');
});

test('after that, Close always has a way out, and goes through', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1', 'Original')));
  const page = await makerOn(r, 'c1', { wireOf: losingFirst() });
  await r.done();
  page.maker.setName('Changed');
  await page.pass(31300);
  page.maker.setName('Original');
  page.host.window!.close();
  await r.done();
  assert.ok(!exe.windows.has(page.label));
  assert.strictEqual(saved(exe, 'c1')!.name, 'Original');
});

/* review 1: a retry can't undo a delete */

test('a lost first reply, then a delete: the retry is refused, and she stays deleted', async () => {
  const exe = createDisk(), r = await hubOn(exe), m = await r.manager();
  const page = await makerOn(r, undefined, { wireOf: losingFirst() });
  await r.done();
  await page.maker.addFromSrc(frame('new').src, 'New');
  await page.pass(1300);
  const c = page.maker.current()!.character!;
  assert.strictEqual(saved(exe, c)!.name, 'New');
  assert.ok((await m.client.deleteBuddy(c, revOf(m.client, c))).ok);
  await r.done();
  await page.pass(30000);
  await page.store.flush();
  await r.done();
  assert.strictEqual(saved(exe, c), null, 'she stays deleted');
  assert.ok(page.saveState.kind === 'failed' && /was deleted/.test(page.saveState.title), JSON.stringify(page.saveState));
});

test('a lost first reply with no delete still lands', async () => {
  const exe = createDisk(), r = await hubOn(exe);
  const page = await makerOn(r, undefined, { wireOf: losingFirst() });
  await r.done();
  await page.maker.addFromSrc(frame('new').src, 'New');
  await page.pass(31300);
  page.maker.setName('Newer');
  await page.pass(1300);
  assert.strictEqual(saved(exe, page.maker.current()!.character!)!.name, 'Newer');
  assert.strictEqual(page.saveState.kind, 'saved');
});

test('a Maker import of a copy after a delete asks, rather than bringing her back', async () => {
  const s = await holding(small('c1'));
  assert.ok((await s.m.client.deleteBuddy('c1', revOf(s.m.client, 'c1'))).ok);
  await s.r.done();
  const page = await makerOn(s.r);
  await s.r.done();
  await page.maker.importBuddy(fileOf(write(small('c1', 'Copy'))));
  await page.pass(1300);
  assert.strictEqual(saved(s.exe, 'c1'), null);
  assert.ok(page.saveState.kind === 'failed' && /was deleted/.test(page.saveState.title), JSON.stringify(page.saveState));
});

/* review 2: a hub restart */

test('a window from before a hub restart is refused, even with the same place in the count', async () => {
  const exe = createDisk(), first = await hubOn(exe, write(small('c1', 'Original')));
  const page = await makerOn(first, 'c1');
  await first.done();
  first.stop();
  const next = await hubOn(exe, undefined, first.bus), m = await next.manager();
  assert.ok((await importing(m, small('c1', 'Replacement')))[0]!.ok);
  await next.done();
  page.maker.setName('Stale');
  await page.pass(1300);
  await next.done();
  assert.strictEqual(saved(exe, 'c1')!.name, 'Replacement');
  assert.ok(page.saveState.kind === 'failed' && /changed somewhere else/.test(page.saveState.title), JSON.stringify(page.saveState));
});

/* review 4: leaving is read when the hub decides */

test('the window leaving while the hub looks on disk: the refused edit is kept beside her', async () => {
  const s = await holding(small('c1'));
  await importing(s.m, small('c1', 'Replacement'));
  await s.r.done();
  s.page.maker.setName('Mine');
  const hold = s.exe.hold('data_list', (a: { dir: string }) => a.dir === 'library');
  await s.page.pass(1300);
  await s.page.killed();
  hold();
  await s.r.done();
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'Replacement');
  assert.deepStrictEqual(s.m.s().failures.map(f => f.title), ["Mine's last edit is a new buddy"]);
  assert.strictEqual(shelved(s.exe).filter(c => c !== 'c1').length, 1);
});

test('the window leaving while the disk is written: a failure there reaches the Manager', async () => {
  const s = await holding(small('c1'));
  s.page.maker.setName('Mine');
  const hold = s.exe.hold('data_write');
  await s.page.pass(1300);
  await s.page.killed();
  const full = s.exe.failUntil('data_write', 'disk full', () => true); /* and its repeat fails too */
  hold();
  await s.r.done();
  full();
  assert.deepStrictEqual(s.m.s().failures.map(f => f.title), ["Mine's last edit wasn't saved"], 'once, not once for each');
});

/* review 7: a window's handle isn't her character */

test('Edit on the original after Keep as a new buddy opens the original, and the copy stays editable', async () => {
  const s = await conflicted();
  const fail = s.page.saveState;
  assert.ok(fail.kind === 'failed');
  fail.actions!.find(a => a.label === 'Keep as a new buddy')!.run();
  await s.r.done();
  const copy = s.page.maker.current()!, c = copy.character!;
  assert.notStrictEqual(c, 'c1');
  await s.page.edit('c1');
  await s.r.done();
  assert.strictEqual(s.page.maker.current()!.character, 'c1', 'the original');
  assert.strictEqual(s.page.maker.current()!.name, 'Imported');
  s.page.maker.setName('Original edited');
  await s.page.pass(1300);
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'Original edited');
  s.page.maker.select(copy.id);
  s.page.maker.setName('Copy edited');
  await s.page.pass(1300);
  assert.strictEqual(saved(s.exe, c)!.name, 'Copy edited');
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'Original edited');
});

test('a window\'s handles are its own, so nothing can take one for a character', async () => {
  const s = await holding(small('c1', 'One'), small('c2', 'Two'));
  await s.page.edit('c2');
  await s.r.done();
  const ids = s.page.maker.state.pets.map(p => p.id);
  assert.strictEqual(new Set(ids).size, 2);
  assert.ok(!ids.includes('c1') && !ids.includes('c2'), ids.join());
});

/* what the mutation pass found these didn't yet see */

const countCloses = (exe: ReturnType<typeof createDisk>) => exe.calls.filter(c => c.cmd === 'window_close').length;
/* Art that holds each import's frames until its own gate opens, in the order they ask. */
function gatedArt() {
  const gates: (() => void)[] = [];
  return { gates, art: { ...art, processFrames: async (srcs: string[]) => { await new Promise<void>(r => { gates.push(r); }); return art.processFrames(srcs); } } };
}

test('a delete counts even for someone no window ever opened: a copy of her asks', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1'))), m = await r.manager();
  assert.ok((await m.client.deleteBuddy('c1', revOf(m.client, 'c1'))).ok);
  await r.done();
  const page = await makerOn(r);
  await r.done();
  await page.maker.importBuddy(fileOf(write(small('c1', 'Copy'))));
  await page.pass(1300);
  assert.strictEqual(saved(exe, 'c1'), null);
  assert.ok(page.saveState.kind === 'failed' && /was deleted/.test(page.saveState.title), JSON.stringify(page.saveState));
});

test('a timed out save isn\'t sent again because someone else in the window changed', async () => {
  const s = await holding(small('c1', 'One'), small('c2', 'Two'));
  await s.page.edit('c2');
  await s.r.done();
  s.page.maker.select(s.page.maker.state.pets.find(p => p.character === 'c1')!.id);
  s.exe.logs.length = 0;
  s.exe.hold('data_write');
  s.page.maker.setName('Held');
  await s.page.pass(31300);
  s.page.maker.select(s.page.maker.state.pets.find(p => p.character === 'c2')!.id);
  s.page.maker.setName('Other');
  await s.page.pass(1300);
  assert.strictEqual(s.exe.logs.filter(l => l === 'manager maker-save c1').length, 1);
});

test('a quit while Close waits on image work still gets its last word out', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1'))), slow = slowArt();
  const page = await makerOn(r, 'c1', { art: slow.art });
  await r.done();
  page.maker.setName('Mine');
  void page.track(() => page.maker.importGenerated(generated()));
  await r.done();
  page.host.window!.close();
  await page.pass(300);
  exe.emit('quitting', null);
  await r.done();
  assert.strictEqual(saved(exe, 'c1')!.name, 'Mine');
});

test('an edit that was waiting when Close paused saving goes when Keep editing lets it', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1'))), slow = slowArt();
  const page = await makerOn(r, 'c1', { art: slow.art });
  await r.done();
  page.maker.setName('Waiting');
  await page.pass(300); /* handed over, with the quiet timer running */
  void page.track(() => page.maker.importGenerated(generated()));
  await r.done();
  page.host.window!.close();
  await page.pass(CLOSE_ASK_MS); /* the quiet timer came and went */
  assert.strictEqual(saved(exe, 'c1')!.name, 'Pip', 'nothing half done went out meanwhile');
  page.closing.press('Keep editing');
  await r.done();
  assert.strictEqual(saved(exe, 'c1')!.name, 'Waiting');
});

test('Close anyway on a window that won\'t go: a later last word is heard again', async () => {
  const s = await holding(small('c1'));
  const full = s.exe.failUntil('data_write', 'disk full', () => true);
  s.page.maker.setName('Mine');
  s.page.host.window!.close();
  await s.r.done();
  s.exe.failNext('window_close', 'denied');
  s.page.closing.press('Close anyway');
  await s.r.done();
  full();
  s.page.maker.setName('Later');
  await s.page.killed();
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'Later');
});

test('it waits for all the image work, not just the first to finish', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1'))), gated = gatedArt();
  const page = await makerOn(r, 'c1', { art: gated.art });
  await r.done();
  void page.track(() => page.maker.importGenerated([pickedFile('walk_1.png')]));
  void page.track(() => page.maker.importGenerated([pickedFile('sit_1.png')]));
  await r.done();
  assert.strictEqual(gated.gates.length, 2);
  page.host.window!.close();
  gated.gates[0]!();
  await r.done();
  assert.ok(exe.windows.has(page.label), 'one is still running');
  gated.gates[1]!();
  await r.done();
  assert.ok(!exe.windows.has(page.label));
  assert.ok(saved(exe, 'c1')!.poses.sit && saved(exe, 'c1')!.poses.walk);
});

test('a minimized Maker already closing answers at once, with no 40 second wait', async () => {
  const s = await holding(small('c1', 'One'), small('c2', 'Two'));
  s.exe.hold('window_close');
  s.page.host.window!.close();
  await s.r.done();
  await s.exe.shell.windowMinimize(s.page.label);
  const a = await s.m.client.editBuddy('c2');
  assert.ok(!a.ok);
  assert.strictEqual(a.failure.title, "The Maker has an edit it couldn't save");
});

test('Close waiting on image work holds back an autosave that was due', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1'))), slow = slowArt();
  const page = await makerOn(r, 'c1', { art: slow.art });
  await r.done();
  page.maker.setName('Due');
  await page.pass(300);
  void page.track(() => page.maker.importGenerated(generated()));
  await r.done();
  exe.calls.length = 0;
  page.host.window!.close();
  await page.pass(1300);
  assert.ok(!exe.calls.some(c => c.cmd === 'data_write'), 'nothing half done is written');
  slow.go();
  await r.done();
  assert.strictEqual(saved(exe, 'c1')!.name, 'Due');
  assert.ok(!exe.windows.has(page.label));
});

test('Close anyway while image work runs: when it ends, nothing goes out', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1'))), slow = slowArt();
  const page = await makerOn(r, 'c1', { art: slow.art });
  await r.done();
  const hold = exe.hold('window_close');
  void page.track(() => page.maker.importGenerated(generated()));
  await r.done();
  page.host.window!.close();
  await page.pass(CLOSE_ASK_MS);
  page.closing.press('Close anyway');
  await r.done();
  exe.calls.length = 0;
  slow.go();
  await r.done();
  assert.ok(!exe.calls.some(c => c.cmd === 'data_write'));
  hold();
  await r.done();
  assert.ok(!exe.windows.has(page.label));
});

test('two clicks on Close ask the window to go once', async () => {
  const s = await holding(small('c1'));
  s.exe.calls.length = 0;
  const hold = s.exe.hold('data_write');
  s.page.maker.setName('Mine');
  s.page.host.window!.close();
  s.page.host.window!.close();
  await s.r.done();
  hold();
  await s.r.done();
  assert.strictEqual(countCloses(s.exe), 1);
  assert.ok(!s.exe.windows.has(s.page.label));
});

test('Try again while the close is already saving asks the window to go once', async () => {
  const s = await holding(small('c1'));
  s.exe.failNext('data_write', 'disk full');
  s.page.maker.setName('Mine');
  await s.page.pass(1300);
  assert.strictEqual(s.page.saveState.kind, 'failed');
  s.exe.calls.length = 0;
  const hold = s.exe.hold('data_write');
  s.page.host.window!.close();
  await s.page.pass(CLOSE_ASK_MS);
  s.page.closing.press('Try again');
  await s.r.done();
  hold();
  await s.r.done();
  assert.strictEqual(countCloses(s.exe), 1);
  assert.ok(!s.exe.windows.has(s.page.label));
});

test('Keep editing on a minimized Maker tells the hub at once', async () => {
  const s = await holding(small('c1', 'One'), small('c2', 'Two'));
  await s.exe.shell.windowMinimize(s.page.label);
  s.exe.hold('data_write');
  s.page.maker.setName('Mine');
  const asked = s.m.client.editBuddy('c2');
  await s.r.done();
  await s.page.pass(CLOSE_ASK_MS);
  s.page.closing.press('Keep editing');
  const a = await asked;
  assert.ok(!a.ok);
  assert.ok(s.exe.windows.has(s.page.label));
  assert.ok(!s.page.closing.stopped);
});

test('Close anyway while a save is out asks the window to go once, when the save lands too', async () => {
  const s = await holding(small('c1'));
  s.exe.calls.length = 0;
  const closing = s.exe.hold('window_close'), write_ = s.exe.hold('data_write');
  s.page.maker.setName('Mine');
  s.page.host.window!.close();
  await s.page.pass(CLOSE_ASK_MS);
  s.page.closing.press('Close anyway');
  await s.r.done();
  write_();
  await s.r.done();
  closing();
  await s.r.done();
  assert.strictEqual(countCloses(s.exe), 1);
});

test('after Keep editing, nothing about closing comes back by itself', async () => {
  const s = await holding(small('c1'));
  const full = s.exe.failUntil('data_write', 'disk full', () => true);
  s.page.maker.setName('Mine');
  s.page.host.window!.close();
  await s.r.done();
  s.page.closing.press('Keep editing');
  await s.r.done();
  full();
  s.page.maker.setName('Still mine'); /* the status changes, as the question used to watch it do */
  await s.page.pass(1300);
  assert.strictEqual(s.page.saveState.kind, 'saved');
  assert.strictEqual(s.page.closing.asked, null);
});

/* review 3: the phases */

test('once the window has been asked to go, there\'s no way back: only Close anyway', async () => {
  const s = await holding(small('c1'));
  const hold = s.exe.hold('window_close');
  s.page.maker.setName('Mine');
  s.page.host.window!.close();
  await s.r.done();
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'Mine');
  await s.page.pass(CLOSE_ASK_MS);
  assert.deepStrictEqual(s.page.closing.labels(), ['Close anyway'], 'Keep editing can\'t take back a close already under way');
  s.page.closing.press('Close anyway');
  await s.r.done();
  assert.strictEqual(countCloses(s.exe), 2, 'it asks again');
  hold();
  await s.r.done();
  assert.ok(!s.exe.windows.has(s.page.label));
});

test('a second ask refused while the first is still out: still closing, since the first can still take the window', async () => {
  const s = await holding(small('c1'));
  const first = s.exe.hold('window_close');
  s.page.maker.setName('Mine');
  s.page.host.window!.close();
  await s.r.done();
  await s.page.pass(CLOSE_ASK_MS);
  s.exe.failNext('window_close', 'denied');
  s.page.closing.press('Close anyway');
  await s.r.done();
  assert.strictEqual(countCloses(s.exe), 2);
  assert.ok(s.page.closing.stopped, 'editing can\'t come back while a close is out');
  assert.deepStrictEqual(s.page.closing.labels(), ['Close anyway']);
  first();
  await s.r.done();
  assert.ok(!s.exe.windows.has(s.page.label));
});

test('the first ask refused while the second is still out: still closing', async () => {
  const s = await holding(small('c1'));
  const first = s.exe.hold('window_close');
  s.page.maker.setName('Mine');
  s.page.host.window!.close();
  await s.r.done();
  await s.page.pass(CLOSE_ASK_MS);
  const second = s.exe.hold('window_close');
  s.page.closing.press('Close anyway');
  await s.r.done();
  s.exe.failNext('window_close', 'denied');
  first();
  await s.r.done();
  assert.ok(s.page.closing.stopped, 'the second can still take the window');
  second();
  await s.r.done();
  assert.ok(!s.exe.windows.has(s.page.label));
});

test('every ask refused: editing comes back, once', async () => {
  const s = await holding(small('c1'));
  const first = s.exe.hold('window_close');
  s.page.host.window!.close();
  await s.r.done();
  await s.page.pass(CLOSE_ASK_MS);
  const second = s.exe.hold('window_close');
  s.page.closing.press('Close anyway');
  await s.r.done();
  s.exe.failUntil('window_close', 'denied', () => true);
  first();
  await s.r.done();
  assert.ok(s.page.closing.stopped);
  second();
  await s.r.done();
  assert.ok(!s.page.closing.stopped, 'nothing is out, so it\'s hers again');
  assert.ok(s.page.saveState.kind === 'failed' && s.page.saveState.title === "The Maker didn't close", JSON.stringify(s.page.saveState));
});

/* the hub's own close of a minimized Maker, which the window has to hear the end of */

test('a minimized Maker the hub stops waiting for is the person\'s again', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1'))), m = await r.manager(), slow = slowArt();
  const page = await makerOn(r, 'c1', { art: slow.art });
  await r.done();
  void page.track(() => page.maker.importGenerated(generated()));
  await r.done();
  await exe.shell.windowMinimize(page.label);
  const asked = m.client.editBuddy('c1');
  await r.done();
  assert.ok(page.closing.stopped, 'it waits on the image work');
  r.fire(40000);
  assert.ok(!(await asked).ok, 'the Manager hears it couldn\'t');
  await r.done();
  assert.ok(!page.closing.stopped, 'and nobody is closing the window now');
  slow.go();
  await r.done();
  assert.ok(exe.windows.has(page.label), 'so the work ending doesn\'t close it');
  page.maker.setName('Later');
  await page.pass(1300);
  assert.strictEqual(saved(exe, 'c1')!.name, 'Later');
});

test('a minimized Maker that said it can go, and the hub then gave up on: the person\'s again', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1'))), m = await r.manager();
  const page = await makerOn(r, 'c1');
  await r.done();
  await exe.shell.windowMinimize(page.label);
  const hold = exe.hold('data_write');
  page.maker.setName('Mine');
  const asked = m.client.editBuddy('c1');
  await r.done();
  r.fire(40000);
  assert.ok(!(await asked).ok);
  hold(); /* the flush lands after the hub stopped waiting, so it says it can go to nobody */
  await r.done();
  assert.ok(exe.windows.has(page.label));
  assert.ok(!page.closing.stopped, 'not stuck closing');
  assert.strictEqual(saved(exe, 'c1')!.name, 'Mine');
});

test('a minimized Maker the hub couldn\'t take away is the person\'s again, and says so', async () => {
  const s = await holding(small('c1', 'One'), small('c2', 'Two'));
  await s.exe.shell.windowMinimize(s.page.label);
  s.exe.failNext('window_close', 'denied');
  assert.ok(!(await s.m.client.editBuddy('c2')).ok);
  await s.r.done();
  assert.ok(s.exe.windows.has(s.page.label));
  assert.ok(!s.page.closing.stopped, 'not stuck closing');
  assert.ok(s.page.saveState.kind === 'failed' && s.page.saveState.title === "The Maker didn't close", JSON.stringify(s.page.saveState));
});

/* review 4: the last word resends what isn't confirmed */

test('a lost refusal, then the window goes: the edit is kept beside her, and the Manager is told', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1'))), m = await r.manager();
  const page = await makerOn(r, 'c1', { wireOf: losingFirst() });
  await r.done();
  assert.ok((await importing(m, small('c1', 'Replacement')))[0]!.ok);
  await r.done();
  page.maker.setName('Mine');
  await page.pass(1300);
  await page.pass(10000);
  exe.emit('quitting', null);
  await r.done();
  assert.strictEqual(saved(exe, 'c1')!.name, 'Replacement');
  assert.strictEqual(shelved(exe).filter(c => c !== 'c1').length, 1, shelved(exe).join());
  assert.deepStrictEqual(m.s().failures.map(f => f.title), ["Mine's last edit is a new buddy"]);
});

test('a lost write failure, then the window goes: the Manager is told', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1'))), m = await r.manager();
  const page = await makerOn(r, 'c1', { wireOf: losingFirst() });
  await r.done();
  const full = exe.failUntil('data_write', 'disk full', () => true);
  page.maker.setName('Mine');
  await page.pass(11300);
  exe.emit('quitting', null);
  await r.done();
  full();
  assert.strictEqual(saved(exe, 'c1')!.name, 'Pip');
  assert.deepStrictEqual(m.s().failures.map(f => f.title), ["Mine's last edit wasn't saved"]);
});

test('a last word for something already on its way is written once and kept once', async () => {
  const s = await holding(small('c1'));
  await importing(s.m, small('c1', 'Replacement'));
  await s.r.done();
  const hold = s.exe.hold('data_list', (a: { dir: string }) => a.dir === 'library');
  s.page.maker.setName('Mine');
  await s.page.pass(1300);
  await s.page.killed();
  hold();
  await s.r.done();
  assert.strictEqual(shelved(s.exe).filter(c => c !== 'c1').length, 1, 'one copy kept, not two');
  assert.deepStrictEqual(s.m.s().failures.map(f => f.title), ["Mine's last edit is a new buddy"]);
});

/* what the mutation pass found the phases' tests didn't yet see */

test('a minimized Maker\'s Close anyway asks the window itself to go', async () => {
  const s = await holding(small('c1', 'One'), small('c2', 'Two'));
  await s.exe.shell.windowMinimize(s.page.label);
  const hubs = s.exe.hold('window_close'); /* the hub's own close, held */
  const asked = s.m.client.editBuddy('c2');
  await s.r.done();
  s.exe.calls.length = 0;
  await s.page.pass(CLOSE_ASK_MS);
  s.page.closing.press('Close anyway');
  await s.r.done();
  assert.strictEqual(countCloses(s.exe), 1, 'the page asks, not just the hub');
  assert.ok(!s.exe.windows.has(s.page.label));
  hubs();
  await asked;
});

test('no work starts once Close has, and work that ends twice ends once', async () => {
  const s = await holding(small('c1'));
  s.page.maker.setName('A');
  const one = s.page.host.work!()!, two = s.page.host.work!()!;
  s.page.host.window!.close();
  assert.strictEqual(s.page.host.work!(), null, 'waiting takes no new work');
  s.exe.calls.length = 0;
  one(); one();
  await s.r.done();
  assert.ok(!s.exe.calls.some(c => c.cmd === 'data_write'), 'one piece is still running, so nothing has gone');
  assert.ok(s.exe.windows.has(s.page.label));
  two();
  await s.r.done();
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'A');
  assert.ok(!s.exe.windows.has(s.page.label));
  assert.strictEqual(s.page.host.work!(), null, 'nor does a window that went');
});

test('an ask that landed: a later refusal brings nothing back', async () => {
  const s = await holding(small('c1'));
  const first = s.exe.hold('window_close');
  s.page.host.window!.close();
  await s.r.done();
  await s.page.pass(CLOSE_ASK_MS);
  const second = s.exe.hold('window_close');
  s.page.closing.press('Close anyway');
  await s.r.done();
  first();
  await s.r.done();
  assert.strictEqual(s.page.closer.phase, 'gone');
  second(); /* refused, as there's no window left to close */
  await s.r.done();
  assert.ok(s.page.closing.stopped, 'gone stays gone');
  assert.strictEqual(s.page.closer.phase, 'gone');
});

test('Keep editing while the flush is out, an edit, Close again: the new Close flushes for itself', async () => {
  const s = await holding(small('c1'));
  const hold = s.exe.hold('data_write');
  s.page.maker.setName('A');
  s.page.host.window!.close();
  await s.r.done();
  await s.page.pass(CLOSE_ASK_MS);
  s.page.closing.press('Keep editing');
  s.page.maker.setName('B'); /* still held back by maker-core when Close comes */
  s.page.host.window!.close();
  hold();
  await s.r.done();
  await s.r.done();
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'B', 'the old flush didn\'t close it over the new edit');
  assert.ok(!s.exe.windows.has(s.page.label));
});

test('a refusal before the limit: a later Close waits its own limit before asking', async () => {
  const s = await holding(small('c1'));
  s.exe.failNext('window_close', 'denied');
  s.page.host.window!.close();
  await s.r.done();
  assert.ok(!s.page.closing.stopped);
  await s.page.pass(CLOSE_ASK_MS); /* the first close's limit, which went with it */
  const hold = s.exe.hold('window_close');
  s.page.host.window!.close();
  await s.r.done();
  assert.deepStrictEqual(s.page.closing.labels(), [], 'a close under way shows nothing at first');
  await s.page.pass(CLOSE_ASK_MS);
  assert.deepStrictEqual(s.page.closing.labels(), ['Close anyway']);
  hold();
});

test('after asking and Keep editing, a later Close waits its own limit before asking', async () => {
  const s = await holding(small('c1'));
  const full = s.exe.failUntil('data_write', 'disk full', () => true);
  s.page.maker.setName('Mine');
  s.page.host.window!.close();
  await s.r.done();
  assert.ok(s.page.closing.labels().length, 'it asked');
  s.page.closing.press('Keep editing');
  full();
  const hold = s.exe.hold('window_close');
  s.page.host.window!.close();
  await s.r.done();
  assert.deepStrictEqual(s.page.closing.labels(), []);
  hold();
});

test('a flush that fails after Keep editing leaves nothing behind for the next Close', async () => {
  const s = await holding(small('c1'));
  const hold = s.exe.hold('data_write');
  s.page.maker.setName('Mine');
  s.page.host.window!.close();
  await s.r.done();
  await s.page.pass(CLOSE_ASK_MS);
  s.page.closing.press('Keep editing');
  s.exe.failNext('data_write', 'disk full');
  hold(); /* the old close's flush comes back failed, to nobody */
  await s.r.done();
  s.page.maker.setName('Mine again');
  await s.page.pass(1300);
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'Mine again');
  const closing = s.exe.hold('window_close');
  s.page.host.window!.close();
  await s.r.done();
  assert.deepStrictEqual(s.page.closing.labels(), [], 'a close under way shows nothing at first');
  closing();
});
