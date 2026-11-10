/* What the first review of the save path found, each reproduced. All of these failed before the fix
   that answers them. */
import assert from 'node:assert';
import { write } from '@buddies/buddy-file';
import { test } from 'vitest';
import type { Said } from '../src/manager-api';
import { MAKER } from '../src/maker-window';
import type { Wire } from '../src/wire';
import { createDisk, frame, holding, hubOn, importing, makerOn, pickedFile, saved, small } from './maker-harness';

const fileOf = (text: string) => ({ ...pickedFile('x.buddy'), text: async () => text });
const shelved = (exe: ReturnType<typeof createDisk>) => [...exe.files.keys()].filter(k => /^library\/[^/.]+\/buddy\.json$/.test(k)).map(k => k.split('/')[1]!);

/* 1 */
test('a final save can\'t put an imported copy over the buddy she claims to be', async () => {
  const { exe, r, page, id, m } = await holding(small('c1', 'Original'));
  await page.maker.importBuddy(fileOf(write(small('c1', 'Older', { base: frame('older') }))));
  exe.emit('quitting', null); /* before any autosave ran */
  await r.done();
  assert.strictEqual(saved(exe, id)!.name, 'Original', 'the original is untouched');
  const others = shelved(exe).filter(c => c !== id);
  assert.strictEqual(others.length, 1, 'the copy went in beside her');
  assert.strictEqual(saved(exe, others[0]!)!.name, 'Older');
  assert.ok(m.s().buddies.some(b => b.id === id));
});

test('a window killed outright treats that copy the same way', async () => {
  const { exe, page, id } = await holding(small('c1', 'Original'));
  await page.maker.importBuddy(fileOf(write(small('c1', 'Older', { base: frame('older') }))));
  await page.killed();
  assert.strictEqual(saved(exe, id)!.name, 'Original');
  assert.strictEqual(shelved(exe).filter(c => c !== id).length, 1);
});

/* 2 */
test('a first save checks the disk, not the shelf: someone unread at startup isn\'t replaced', async () => {
  const exe = createDisk();
  await hubOn(exe, write(small('c1', 'Original')));
  exe.failNext('data_read', 'locked', (a: { path: string }) => a.path === 'library/c1/buddy.json');
  const r = await hubOn(exe);
  const m = await r.manager();
  assert.ok(!m.s().buddies.some(b => b.id === 'c1'), 'not on the shelf');
  const page = await makerOn(r);
  await r.done();
  await page.maker.importBuddy(fileOf(write(small('c1', 'Older', { base: frame('older') }))));
  await page.pass(1300);
  assert.strictEqual(saved(exe, 'c1')!.name, 'Original', 'her real folder is still hers');
  assert.ok(page.saveState.kind === 'failed' && /changed somewhere else/.test(page.saveState.title), JSON.stringify(page.saveState));
});

test('a first save that can\'t tell what\'s on disk touches nothing, and says so', async () => {
  const { exe, page } = await holding(small('c1'));
  await page.maker.importBuddy(fileOf(write(small('c2', 'New'))));
  exe.failNext('data_list', 'unreadable', (a: { dir: string }) => a.dir === 'library');
  await page.pass(1300);
  assert.strictEqual(saved(exe, 'c2'), null);
  assert.ok(page.saveState.kind === 'failed' && page.saveState.title === "New wasn't saved", JSON.stringify(page.saveState));
});

test('someone waiting to go back counts as on disk too', async () => {
  const exe = createDisk();
  await hubOn(exe, write(small('c1', 'Original')));
  const r = await hubOn(exe), page = await makerOn(r);
  await r.done();
  await exe.shell.dataMove('library/c1', 'library/.outgoing/c1');
  await page.maker.importBuddy(fileOf(write(small('c1', 'Older', { base: frame('older') }))));
  await page.pass(1300);
  assert.strictEqual(saved(exe, 'c1'), null, 'nothing went into her home');
  assert.ok(exe.files.has('library/.outgoing/c1/buddy.json'), 'and she is still there');
  assert.ok(page.saveState.kind === 'failed' && /changed somewhere else/.test(page.saveState.title), JSON.stringify(page.saveState));
});

/* 3 */
test('what maker-core was still holding when Close started goes before the window does', async () => {
  const { exe, r, page, id } = await holding(small('c1'));
  const release = exe.hold('data_write');
  page.maker.setName('A'); /* still in maker-core's pause */
  page.host.window!.close();
  await r.done();
  assert.ok(exe.windows.has(page.label));
  release();
  await r.done();
  assert.strictEqual(saved(exe, id)!.name, 'A');
  assert.ok(!exe.windows.has(page.label));
});

test('editing while Close waits can\'t happen: input is stopped until the window has gone or is back', async () => {
  /* The browser check types, clicks, drops and pastes at the real dialog. This is its other half: it
     stays stopped through every step, and only Keep editing lets anything in again. */
  const { exe, r, page, id } = await holding(small('c1'));
  const release = exe.hold('data_write');
  page.maker.setName('A');
  page.host.window!.close();
  assert.ok(page.closing.stopped);
  await page.pass(5000);
  assert.ok(page.closing.stopped);
  page.closing.press('Keep editing');
  assert.ok(!page.closing.stopped);
  page.maker.setName('B');
  release();
  await r.done();
  await page.pass(1300);
  assert.strictEqual(saved(exe, id)!.name, 'B', 'back in use, it saves as ever');
  assert.ok(exe.windows.has(page.label));
});

test('an edit during an ordinary flush goes with the next autosave', async () => {
  const { exe, r, page, id } = await holding(small('c1'));
  const release = exe.hold('data_write');
  page.maker.setName('A');
  const flushed = page.store.flush();
  await r.done();
  page.maker.setName('B');
  release();
  assert.strictEqual(await flushed, true, 'it answers for what it was asked');
  await page.pass(1300);
  assert.strictEqual(saved(exe, id)!.name, 'B');
  assert.strictEqual(page.saveState.kind, 'saved');
});

test('a flush ends maker-core\'s pause, so it doesn\'t start up again afterwards', async () => {
  const { r, page } = await holding(small('c1'));
  page.maker.setName('A');
  assert.strictEqual(await page.store.flush(), true);
  await r.done();
  page.states.length = 0;
  await page.pass(3000);
  assert.deepStrictEqual(page.states, []);
});

/* 4 */
test('leaving with a save queued behind a replacement: the edit is kept beside her, and the Manager told', async () => {
  const { exe, r, m, page, id } = await holding(small('c1'));
  const hold = exe.hold('data_write');
  const imported = importing(m, small('c1', 'Imported'));
  await r.done();
  page.maker.setName('Mine');
  await page.pass(1300); /* the edit is queued behind the import */
  await page.killed();
  hold();
  await imported;
  await r.done();
  assert.strictEqual(saved(exe, id)!.name, 'Imported');
  const made = shelved(exe).filter(c => c !== id);
  assert.strictEqual(made.length, 1, shelved(exe).join());
  assert.strictEqual(saved(exe, made[0]!)!.name, 'Mine');
  assert.deepStrictEqual(m.s().failures.map(f => f.title), ["Mine's last edit is a new buddy"]);
});

test('leaving with a save queued that then can\'t be written: the Manager is told', async () => {
  const { exe, r, m, page, id } = await holding(small('c1'));
  const hold = exe.hold('data_write');
  const imported = importing(m, small('c2', 'Other'));
  await r.done();
  page.maker.setName('Mine');
  await page.pass(1300);
  await page.killed();
  exe.failUntil('data_write', 'disk full', (a: unknown) => a instanceof Uint8Array);
  hold();
  await imported;
  await r.done();
  assert.strictEqual(saved(exe, id)!.name, 'Pip');
  assert.ok(m.s().failures.some(f => f.title === "Mine's last edit wasn't saved"), JSON.stringify(m.s().failures));
});

/* 5 */
test('a reply lost for good doesn\'t block saving: the next edit goes, with no false conflict', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1')));
  let lost: string | null = null;
  const losing = (w: Wire<Said>): Wire<Said> => ({
    ...w,
    post(m) { if (m.k === 'do' && m.cmd.k === 'maker-save' && !lost) lost = m.id; w.post(m); },
    listen(f) { w.listen(m => { if (!(m.k === 'done' && m.id === lost)) f(m); }); }
  });
  const page = await makerOn(r, 'c1', { wireOf: losing });
  await r.done();
  page.maker.setName('A');
  await page.pass(1300);
  assert.strictEqual(saved(exe, 'c1')!.name, 'A');
  await page.pass(30000);
  assert.strictEqual(page.saveState.kind as string, 'failed', 'it says it heard nothing');
  page.maker.setName('B');
  await page.pass(1300);
  assert.strictEqual(saved(exe, 'c1')!.name, 'B');
  assert.strictEqual(page.saveState.kind, 'saved');
  page.maker.setName('C');
  await page.pass(1300);
  assert.strictEqual(saved(exe, 'c1')!.name, 'C', 'and it carries on');
});

test('that reply lost, then someone else changes her: still refused', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1')));
  const m = await r.manager();
  let lost: string | null = null;
  const losing = (w: Wire<Said>): Wire<Said> => ({
    ...w,
    post(x) { if (x.k === 'do' && x.cmd.k === 'maker-save' && !lost) lost = x.id; w.post(x); },
    listen(f) { w.listen(x => { if (!(x.k === 'done' && x.id === lost)) f(x); }); }
  });
  const page = await makerOn(r, 'c1', { wireOf: losing });
  await r.done();
  page.maker.setName('A');
  await page.pass(31300);
  await importing(m, small('c1', 'Imported'));
  await r.done();
  page.maker.setName('B');
  await page.pass(1300);
  assert.strictEqual(saved(exe, 'c1')!.name, 'Imported');
  assert.ok(page.saveState.kind === 'failed' && /changed somewhere else/.test(page.saveState.title), JSON.stringify(page.saveState));
});

test('an older write\'s late answer doesn\'t clear the newer one\'s place in line', async () => {
  const { exe, r, page } = await holding(small('c1'));
  exe.logs.length = 0;
  const first = exe.hold('data_write');
  page.maker.setName('A');
  await page.pass(31300);
  /* B's own manifest, so A can finish and answer while B is still out */
  const second = exe.hold('data_write', (a: Uint8Array) => new TextDecoder().decode(a).includes('"name":"B"'));
  page.maker.setName('B');
  await page.pass(1300);
  page.maker.setName('C');
  await page.pass(1300);
  first();
  await r.done();
  assert.strictEqual(exe.logs.filter(l => l === 'manager maker-save c1').length, 2, 'A and B, with C still waiting');
  second();
  await r.done();
  await page.pass(1300);
  assert.strictEqual(saved(exe, 'c1')!.name, 'C');
});

/* 6 */
test('opening and closing panels can\'t put a saved edit off for ever', async () => {
  const { exe, page, id } = await holding(small('c1'));
  page.maker.setName('Bea');
  const p = page.maker.current()!;
  await page.pass(300); /* maker-core hands it over */
  for (let t = 0; t < 13000; t += 900) { page.maker.togglePose(p, 'walk'); await page.pass(900); }
  assert.strictEqual(saved(exe, id)!.name, 'Bea');
});

test('steady typing saves within the ceiling, with no pause long enough for either timer', async () => {
  const { exe, page, id } = await holding(small('c1'));
  exe.calls.length = 0;
  let typed = '';
  for (let t = 0; t < 11000; t += 100) { typed += 'x'; page.maker.setKitField('personality', typed); await page.pass(100); }
  assert.ok((saved(exe, id)!.kit?.personality ?? '').length > 50, 'something reached the disk while typing went on');
});

test('a panel isn\'t compared each time: at most once per ceiling, however many clicks', async () => {
  const { page } = await holding(small('c1'));
  const p = page.maker.current()!;
  let compares = 0;
  Object.defineProperty(p.base, 'toJSON', { enumerable: false, value(this: object) { compares++; return { ...this }; } });
  for (let t = 0; t < 22000; t += 1100) { page.maker.togglePose(p, 'walk'); await page.pass(1100); }
  assert.ok(compares <= 3, `${compares} compares in 20 clicks, each with time for the quiet timer`);
});

test('panels alone write nothing, however long they go on', async () => {
  const { exe, page } = await holding(small('c1'));
  const p = page.maker.current()!;
  exe.calls.length = 0;
  for (let t = 0; t < 25000; t += 900) { page.maker.togglePose(p, 'walk'); await page.pass(900); }
  assert.ok(!exe.calls.some(c => /^data_(write|move|delete)$/.test(c.cmd)));
  assert.ok(page.states.every(s => s.kind === 'saved'), JSON.stringify(page.states));
});

/* 2, and the Manager's way in: an import over her asks, on the shelf or not, and Replace says so. */
test('a Manager import over someone unread at startup asks, and Replace replaces her and says it did', async () => {
  const exe = createDisk();
  await hubOn(exe, write(small('c1', 'Original')));
  exe.failNext('data_read', 'locked', (a: { path: string }) => a.path === 'library/c1/buddy.json');
  const r = await hubOn(exe), m = await r.manager();
  assert.ok(!m.s().buddies.some(b => b.id === 'c1'));
  const [a] = await importing(m, small('c1', 'Imported'));
  assert.ok(a!.ok && a!.value!.replaced, 'the disk decides, not the shelf');
  assert.strictEqual(saved(exe, 'c1')!.name, 'Imported');
});

/* 7 */
test('New with the Maker minimized opens empty, not on the last buddy', async () => {
  const s = await holding(small('c1'));
  await s.exe.shell.windowMinimize(s.page.label);
  s.page.maker.setName('Mine');
  assert.ok((await s.m.client.newBuddy()).ok);
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'Mine');
  const boot = ([...s.exe.windows.values()].filter(w => w.page === 'maker.html').at(-1) as unknown as { boot: { id?: string } }).boot;
  assert.ok(!('id' in boot), JSON.stringify(boot));
});

test('a new buddy, once saved, can be tried on the screen', async () => {
  const exe = createDisk(), r = await hubOn(exe), m = await r.manager(), page = await makerOn(r);
  await r.done();
  await page.maker.addFromSrc(frame('new').src, 'New');
  await page.pass(1300);
  const c = page.maker.current()!.character!;
  page.host.tryOnScreen!(page.maker.current()!.id, 'dance');
  await r.done();
  assert.strictEqual(m.s().buddies.find(b => b.id === c)!.status, 'out');
});

test('someone dropped while her save fails leaves no failure behind', async () => {
  const { exe, r, page } = await holding(small('c1'));
  const release = exe.hold('data_write');
  page.maker.setName('Mine');
  await page.pass(1300);
  page.maker.remove();
  await page.pass(1300); /* a send that can't let go of her slot, with a write of hers out */
  exe.failNext('data_write', 'disk full');
  release();
  await r.done();
  assert.strictEqual(page.saveState.kind, 'saved', JSON.stringify(page.saveState));
});

test('a window that has said its last word sends nothing more', async () => {
  const { exe, r, page } = await holding(small('c1'));
  page.maker.setName('Last');
  exe.emit('quitting', null);
  await r.done();
  exe.logs.length = 0;
  page.maker.setName('Too late');
  await page.pass(3000);
  assert.deepStrictEqual(exe.logs.filter(l => /maker-save/.test(l)), []);
  assert.strictEqual(await page.store.flush(), false, 'and a flush says so, and doesn\'t hang');
});

/* 8 */
test('one dialog at a time, with an export still reading her files when the page asks', async () => {
  const { exe, r, m, page } = await holding(small('c1'));
  exe.dialog = new Promise<boolean>(() => {});
  const hold = exe.hold('data_read');
  void m.client.exportBuddy('c1');
  await r.done();
  page.host.exportPage!();
  await r.done();
  hold();
  await r.done();
  assert.strictEqual(exe.saved.length, 1, exe.saved.map(s => s.name).join());
});

test('a refused dialog doesn\'t free the one still open', async () => {
  const { exe, r, m, page } = await holding(small('c1'));
  let close = (_: boolean) => {};
  exe.dialog = new Promise<boolean>(d => { close = d; });
  page.host.exportPage!();
  await r.done();
  await m.client.exportBuddy('c1'); /* refused */
  await r.done();
  await m.client.exportBuddy('c1'); /* refused again: the first is still open */
  assert.strictEqual(exe.saved.length, 1);
  close(true);
  await r.done();
});

/* 9 and 10: the switches are gone from the app, so a bad value has nowhere to go. */
test('the Maker\'s switches aren\'t saved in the app, and nothing says they were', async () => {
  const { exe, page } = await holding(small('c1'));
  exe.calls.length = 0;
  page.maker.setChatter('high'); page.maker.toggleNames();
  await page.pass(3000);
  assert.ok(!exe.calls.some(c => /^data_(write|move|delete)$/.test(c.cmd)), 'nothing written');
  assert.strictEqual(page.saveState.kind, 'saved');
});

test('the hub has no settings command for a page to send nonsense to', async () => {
  const { exe, page, r } = await holding(small('c1'));
  exe.calls.length = 0;
  const a = await page.store.ask({ k: 'maker-settings', settings: { bubbles: 'oops', chatter: 'bogus', names: 9, extra: 1 } } as never);
  await r.done();
  assert.ok(!a.ok);
  assert.ok(!exe.calls.some(c => c.cmd === 'data_write'));
});
