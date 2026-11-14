/* Saving from the Maker: what goes to the hub, when, and what a failure leaves. The real hub, the
   real page logic and real maker-core on the fake exe. */
import assert from 'node:assert';
import { LIMIT, read, write } from '@buddies/buddy-file';
import { test } from 'vitest';
import { QUIET_MS } from '../src/maker-store';
import { changes, createDisk, frame, holding, hubOn, importing, makerOn, pageOn, pickedFile, png, saved, small, lands, tick, revOf } from './maker-harness';

const failedTitle = (s: { kind: string; title?: string }) => s.kind === 'failed' ? s.title : s.kind;
const action = (s: { kind: string; actions?: { label: string; run(): void }[] }, label: string) => {
  const a = s.actions?.find(x => x.label === label);
  assert.ok(a, `no action ${label}: ${JSON.stringify(s)}`);
  return a!;
};

/* opening and closing */

test('opening and closing with no edit writes nothing, and never says Saving', async () => {
  const { exe, r, page } = await holding(small('c1'));
  exe.calls.length = 0;
  await page.pass(5000);
  assert.deepStrictEqual(page.states.map(s => s.kind), ['saved']);
  await page.close();
  await r.done();
  assert.deepStrictEqual(changes(exe), []);
  assert.ok(!exe.windows.has(page.label));
});

test('she opens as what\'s on disk, and only she\'s in the state', async () => {
  const { page, id, m } = await holding(small('c1', 'One'), small('c2', 'Two'));
  assert.strictEqual(m.s().buddies.length, 2);
  assert.deepStrictEqual(page.maker.state.pets.map(p => p.character), [id]);
  assert.strictEqual(page.maker.current()?.character, id);
  assert.strictEqual(page.maker.current()!.name, 'One');
  assert.strictEqual(page.maker.state.started, true);
});

test('a new window with nobody seeds no sample, and holds nobody', async () => {
  const exe = createDisk(), r = await hubOn(exe), page = await makerOn(r);
  await r.done();
  assert.deepStrictEqual(page.maker.state.pets, []);
  assert.strictEqual(page.maker.selected, null);
  exe.calls.length = 0;
  await page.pass(5000);
  assert.deepStrictEqual(changes(exe), []);
});

test('a buddy who can\'t be opened seeds no sample: the status says so, and it offers again', async () => {
  const { exe, r } = await holding(small('c1'));
  exe.failNext('data_read', 'unreadable');
  const page = pageOn(r, { n: 0, id: 'c1', label: 'maker-test' }); /* a window on her, with her file unreadable */
  await r.done();
  assert.deepStrictEqual(page.maker.state.pets, []);
  assert.strictEqual(failedTitle(page.saveState), "c1 didn't open".replace('c1', 'Pip'));
  exe.calls.length = 0;
  await page.pass(5000);
  assert.deepStrictEqual(changes(exe), [], 'and writes nothing');
});

test('someone not in the library opens as a plain refusal, with no sample', async () => {
  const exe = createDisk(), r = await hubOn(exe), page = pageOn(r, { n: 0, id: 'nobody', label: 'maker-test' }); /* opened on her before she went */
  await r.done();
  assert.deepStrictEqual(page.maker.state.pets, []);
  assert.strictEqual(failedTitle(page.saveState), "That buddy isn't here");
});

test('a hub that never answers a load opens with nobody, seeds no sample, and says so', async () => {
  const r = await hubOn(createDisk());
  /* a wire nobody's on */
  const quiet = { ...r, bus: { wire: () => ({ post() {}, listen() {}, close() {} }) } as unknown as typeof r.bus };
  const page = pageOn(quiet, { n: 0, id: 'c1', label: 'maker-test' });
  await page.pass(30000);
  assert.deepStrictEqual(page.maker.state.pets, []);
  assert.strictEqual(failedTitle(page.saveState), 'Desktop Buddies: no answer');
});

/* autosave */

test('an edit reaches the disk a second after the last change, and the status follows', async () => {
  const { exe, page, id } = await holding(small('c1'));
  page.maker.setName('Bea');
  await page.pass(250);
  assert.strictEqual(page.saveState.kind, 'saving');
  await page.pass(QUIET_MS - 1);
  assert.strictEqual(saved(exe, id)!.name, 'Pip', 'not yet');
  await page.pass(1);
  assert.strictEqual(saved(exe, id)!.name, 'Bea');
  assert.strictEqual(page.saveState.kind, 'saved');
});

test('one slider drag writes the library once', async () => {
  const { exe, page, id } = await holding(small('c1'));
  exe.calls.length = 0;
  for (let size = 100; size < 220; size++) { page.maker.setSize(size); await page.pass(16); }
  await page.pass(3000);
  assert.strictEqual(lands(exe, id), 1);
  assert.strictEqual(saved(exe, id)!.size, 219);
});

test('one typed sentence, with pauses between words, writes the library once', async () => {
  const { exe, page, id } = await holding(small('c1'));
  exe.calls.length = 0;
  let typed = '';
  for (const c of 'She likes warm windows and hates the rain.') {
    typed += c; page.maker.setKitField('personality', typed);
    await page.pass(c === ' ' ? 400 : 120);
  }
  await page.pass(3000);
  assert.strictEqual(lands(exe, id), 1);
  assert.strictEqual(saved(exe, id)!.kit!.personality, typed);
});

test('changing a value and changing it back writes nothing', async () => {
  const { exe, page } = await holding(small('c1'));
  exe.calls.length = 0;
  const was = page.maker.current()!.name!;
  page.maker.setName('Bea'); page.maker.setName(was);
  await page.pass(3000);
  assert.deepStrictEqual(changes(exe), []);
  assert.strictEqual(page.saveState.kind, 'saved');
});

test('reading a kit fills it in on the buddy, and that isn\'t an edit', async () => {
  const { exe, page } = await holding(small('c1'), small('c2'));
  exe.calls.length = 0;
  page.maker.kitOf(page.maker.current()!);
  page.maker.saveNow();
  await page.pass(3000);
  assert.deepStrictEqual(changes(exe), []);
});

test('only the one that changed is written', async () => {
  const { exe, r, page } = await holding(small('c1', 'One'), small('c2', 'Two'));
  void r;
  await page.edit('c2');
  exe.calls.length = 0;
  page.maker.setName('Bea');
  await page.pass(3000);
  assert.strictEqual(lands(exe, 'c2'), 1);
  assert.strictEqual(lands(exe, 'c1'), 0);
});

test('a new buddy has no library entry until she has an image', async () => {
  const exe = createDisk(), r = await hubOn(exe), page = await makerOn(r);
  await r.done();
  const before = [...exe.files.keys()].filter(k => k.startsWith('library/')).length;
  await page.pass(3000);
  assert.strictEqual([...exe.files.keys()].filter(k => k.startsWith('library/')).length, before);
  await page.maker.addFromSrc(png('new'), 'New');
  await page.pass(1500);
  const c = page.maker.current()!.character!;
  assert.strictEqual(saved(exe, c)!.name, 'New');
  assert.ok(c !== page.maker.current()!.id, 'she goes by her character in the library');
});

/* one at a time, the newest waiting */

test('one write in flight per buddy, and the newest goes when it\'s answered, with nothing dropped', async () => {
  const { exe, r, page, id } = await holding(small('c1'));
  exe.calls.length = 0;
  const release = exe.hold('data_write');
  page.maker.setName('First');
  await page.pass(1300);
  assert.strictEqual(page.saveState.kind, 'saving');
  page.maker.setName('Second'); await page.pass(1300);
  page.maker.setName('Third'); await page.pass(1300);
  assert.strictEqual(exe.calls.filter(c => c.cmd === 'data_write').length, 1, 'still only the first');
  release();
  await r.done();
  await page.pass(1300);
  assert.strictEqual(saved(exe, id)!.name, 'Third');
  assert.strictEqual(lands(exe, id), 2, 'First, then Third: Second never had to be written');
  assert.strictEqual(page.saveState.kind, 'saved');
});

test('during a long drag a save that comes back sends nothing until the drag stops', async () => {
  const { exe, r, page, id } = await holding(small('c1'));
  page.maker.setSize(100);
  await page.pass(1300);
  exe.calls.length = 0;
  for (let size = 101; size < 160; size++) { page.maker.setSize(size); await page.pass(16); }
  assert.strictEqual(lands(exe, id), 0);
  await r.done();
  await page.pass(1300);
  assert.strictEqual(lands(exe, id), 1);
});

/* a failed save */

test('a full disk: the old copy stays, the edit stays, the status says so, and it never toasts', async () => {
  const { exe, r, page, id } = await holding(small('c1'));
  const before = exe.files.get(`library/${id}/buddy.json`);
  const stop = exe.failUntil('data_write', 'disk full', () => true);
  page.maker.setName('Bea');
  await page.pass(1300);
  assert.strictEqual(failedTitle(page.saveState), "Bea wasn't saved");
  assert.strictEqual(exe.files.get(`library/${id}/buddy.json`), before);
  assert.strictEqual(page.maker.current()!.name, 'Bea');
  assert.deepStrictEqual(page.toasts, []);
  /* The next change tries again, and works. */
  stop();
  page.maker.setName('Cea');
  await page.pass(1300);
  await r.done();
  assert.strictEqual(saved(exe, id)!.name, 'Cea');
  assert.strictEqual(page.saveState.kind, 'saved');
});

test('undoing a failed edit clears the failure, with nothing written', async () => {
  const { exe, page } = await holding(small('c1'));
  exe.failUntil('data_write', 'disk full', () => true);
  page.maker.setName('Bea');
  await page.pass(1300);
  assert.strictEqual(page.saveState.kind, 'failed');
  page.maker.setName('Pip');
  await page.pass(1300);
  assert.strictEqual(page.saveState.kind as string, 'saved');
});

test('selecting someone isn\'t a change, so nothing says Saving', async () => {
  const { page, r } = await holding(small('c1', 'One'), small('c2', 'Two'));
  await page.edit('c2');
  await r.done();
  page.states.length = 0;
  page.maker.select(page.maker.state.pets.find(p => p.character === 'c1')!.id);
  await page.pass(3000);
  assert.deepStrictEqual(page.states, []);
});

test('a flush clears what was only being said', async () => {
  const { page, r } = await holding(small('c1'));
  await page.edit('nobody');
  await r.done();
  assert.strictEqual(page.saveState.kind, 'failed');
  assert.strictEqual(await page.store.flush(), true);
  assert.strictEqual(page.saveState.kind as string, 'saved');
});

test('an Edit that fails after an edit keeps saying why: the pause ended with its flush', async () => {
  const { page, r } = await holding(small('c1'));
  page.maker.setName('Bea');
  await page.edit('nobody');
  await r.done();
  await page.pass(3000);
  assert.ok(page.saveState.kind === 'failed' && page.saveState.title === "That buddy isn't here", JSON.stringify(page.saveState));
});

test('after a failure it doesn\'t try the same thing over and over', async () => {
  const { exe, page } = await holding(small('c1'));
  exe.failUntil('data_write', 'disk full', () => true);
  page.maker.setName('Bea');
  await page.pass(1300);
  exe.calls.length = 0;
  await page.pass(60000);
  assert.deepStrictEqual(changes(exe), []);
});

test('a refused edit isn\'t sent again because someone else in the window changed', async () => {
  const { exe, r, page } = await holding(small('c1', 'One'), small('c2', 'Two'));
  await page.edit('c2');
  await r.done();
  page.maker.select(page.maker.state.pets.find(p => p.character === 'c1')!.id);
  page.maker.setKitField('personality', 'x'.repeat(LIMIT.kit + 1));
  await page.pass(1300);
  assert.strictEqual(page.saveState.kind, 'failed');
  page.maker.select(page.maker.state.pets.find(p => p.character === 'c2')!.id);
  page.maker.setName('Bea');
  await page.pass(1300);
  assert.strictEqual(saved(exe, 'c2')!.name, 'Bea', 'she saves');
  assert.strictEqual(exe.logs.filter(l => l === 'manager maker-save c1').length, 1, 'and that one isn\'t resent');
});

test('Try again tries again', async () => {
  const { exe, r, page, id } = await holding(small('c1'));
  const stop = exe.failUntil('data_write', 'disk full', () => true);
  page.maker.setName('Bea');
  await page.pass(1300);
  stop();
  action(page.saveState as never, 'Try again').run();
  await r.done();
  assert.strictEqual(saved(exe, id)!.name, 'Bea');
  assert.strictEqual(page.saveState.kind, 'saved');
});

test('over the size limit: refused before the disk is touched, in plain words, and fine once it fits', async () => {
  const { exe, r, page, id } = await holding(small('c1'));
  exe.calls.length = 0;
  /* one over the limit, with real image bytes */
  const huge = 'A'.repeat(LIMIT.image - 100), big = (i: number) => ({ src: `data:image/png;base64,iVBORw0KGgo${String.fromCharCode(65 + i)}${huge}`.slice(0, LIMIT.image), bb: frame('x').bb });
  const p = page.maker.current()!;
  p.poses.walk = { frames: Array.from({ length: 9 }, (_, i) => big(i)) };
  page.maker.saveNow();
  await page.pass(1300);
  assert.strictEqual(failedTitle(page.saveState), `${p.name} wasn't saved`);
  assert.ok(page.saveState.kind === 'failed' && /over the 64 MB limit/.test(page.saveState.why), JSON.stringify(page.saveState).slice(0, 300));
  assert.deepStrictEqual(changes(exe), [], 'nothing touched');
  assert.ok(p.poses.walk.frames.length === 9, 'the edit stays');
  p.poses.walk.frames.length = 1;
  page.maker.saveNow();
  await page.pass(1300);
  await r.done();
  assert.strictEqual(page.saveState.kind, 'saved');
  assert.strictEqual(saved(exe, id)!.poses.walk!.frames.length, 1);
}, 120000);

test('text that\'s too long: told what, in plain words, and the old copy stays', async () => {
  const { exe, page, id } = await holding(small('c1'));
  page.maker.setKitField('personality', 'x'.repeat(LIMIT.kit + 1));
  await page.pass(1300);
  assert.ok(page.saveState.kind === 'failed' && page.saveState.why === 'Its kit personality is too long.', JSON.stringify(page.saveState));
  assert.strictEqual(saved(exe, id)!.kit, undefined);
});

test('a failed save isn\'t added to the Manager\'s list: the window is showing it', async () => {
  const { exe, m, page } = await holding(small('c1'));
  exe.failUntil('data_write', 'disk full', () => true);
  page.maker.setName('Bea');
  await page.pass(1300);
  assert.deepStrictEqual(m.s().failures, []);
});

test('saved but not read back: it\'s saved, the Manager says it isn\'t showing yet, and it comes right', async () => {
  const { exe, r, m, page, id } = await holding(small('c1'));
  const stop = exe.failUntil('data_read', 'locked', (a: { path: string }) => a.path === `library/${id}/buddy.json`);
  page.maker.setName('Bea');
  await page.pass(1300);
  assert.strictEqual(saved(exe, id)!.name, 'Bea');
  assert.strictEqual(page.saveState.kind, 'saved');
  assert.ok(m.s().failures.some(f => /isn't showing yet/.test(f.title)), JSON.stringify(m.s().failures));
  stop();
  r.fire(2000); /* the hub's retry, not a slow save's watch */
  await r.done();
  assert.deepStrictEqual(m.s().failures, []);
  assert.strictEqual(m.s().buddies.find(b => b.id === id)!.name, 'Bea');
});

/* closing with something unsaved */

test('Close flushes first, then closes', async () => {
  const { exe, r, page, id } = await holding(small('c1'));
  page.maker.setName('Bea');
  page.host.window!.close();
  await r.done();
  assert.strictEqual(saved(exe, id)!.name, 'Bea');
  assert.ok(!exe.windows.has(page.label));
});

test('Close with a failed edit asks first, and only Close anyway closes', async () => {
  const { exe, r, page, id } = await holding(small('c1'));
  exe.failUntil('data_write', 'disk full', () => true);
  page.maker.setName('Bea');
  page.host.window!.close();
  await r.done();
  assert.ok(exe.windows.has(page.label), 'still open');
  assert.strictEqual(failedTitle(page.saveState), "Bea wasn't saved");
  page.closing.press('Close anyway');
  await r.done();
  assert.ok(!exe.windows.has(page.label));
  assert.strictEqual(saved(exe, id)!.name, 'Pip', 'and the old copy is whole');
});

test('Close anyway means it: a conflicted edit doesn\'t turn up as a new buddy afterwards', async () => {
  const { exe, r, page, id, m } = await conflicted('replaced');
  page.host.window!.close();
  await r.done();
  page.closing.press('Close anyway');
  await page.killed();
  assert.ok(!exe.windows.has(page.label));
  assert.deepStrictEqual(m.s().buddies.map(b => b.id), [id]);
  assert.deepStrictEqual(m.s().failures, []);
});

test('two clicks on Close close once, and neither complains', async () => {
  const { exe, r, page } = await holding(small('c1'));
  await Promise.all([page.close(), page.close()]);
  await r.done();
  assert.ok(!exe.windows.has(page.label));
});

test('Keep editing leaves nothing about closing behind in the status', async () => {
  const { exe, r, page } = await holding(small('c1'));
  exe.failUntil('data_write', 'disk full', () => true);
  page.maker.setName('Bea');
  page.host.window!.close();
  await r.done();
  page.closing.press('Keep editing');
  await r.done();
  assert.ok(page.saveState.kind === 'failed' && !page.saveState.actions?.some(a => a.label === 'Close anyway'), JSON.stringify(page.saveState));
  assert.strictEqual(failedTitle(page.saveState), "Bea wasn't saved", 'what failed stays said');
});

test('Alt+F4 with an edit waiting: the window waits for it, then closes', async () => {
  const { exe, r, page, id } = await holding(small('c1'));
  const release = exe.hold('data_write');
  page.maker.setName('Bea');
  exe.closeFromOutside(page.label);
  await r.done();
  assert.ok(exe.windows.has(page.label), 'held until it\'s on disk');
  release();
  await r.done();
  assert.ok(!exe.windows.has(page.label));
  assert.strictEqual(saved(exe, id)!.name, 'Bea');
});

test('Alt+F4 with nothing to save just closes', async () => {
  const { exe, r, page } = await holding(small('c1'));
  exe.closeFromOutside(page.label);
  await r.done();
  assert.ok(!exe.windows.has(page.label));
});

test('Alt+F4 with a failed edit asks first', async () => {
  const { exe, r, page } = await holding(small('c1'));
  exe.failUntil('data_write', 'disk full', () => true);
  page.maker.setName('Bea');
  exe.closeFromOutside(page.label);
  await r.done();
  assert.ok(exe.windows.has(page.label));
  page.closing.press('Close anyway');
  await r.done();
  assert.ok(!exe.windows.has(page.label));
});

test('the exe\'s quitting sends what\'s waiting, as all that can be tried', async () => {
  const { exe, r, page, id } = await holding(small('c1'));
  page.maker.setName('Bea');
  exe.emit('quitting', null);
  await r.done();
  assert.strictEqual(saved(exe, id)!.name, 'Bea');
});

test('pagehide sends what\'s waiting, and the hub finishes it with nobody listening', async () => {
  const { exe, page, id } = await holding(small('c1'));
  page.maker.setName('Bea');
  await page.killed();
  assert.strictEqual(saved(exe, id)!.name, 'Bea');
});

test('pagehide with no edit sends nothing', async () => {
  const { exe, page } = await holding(small('c1'));
  exe.calls.length = 0;
  await page.killed();
  assert.deepStrictEqual(changes(exe), []);
});

test('a hard close with a save in flight: both land, in order, with no false conflict', async () => {
  const { exe, r, page, id, m } = await holding(small('c1'));
  const release = exe.hold('data_write');
  page.maker.setName('First');
  await page.pass(1300);
  page.maker.setName('Last');
  await page.killed();
  release();
  await r.done();
  assert.strictEqual(saved(exe, id)!.name, 'Last');
  assert.deepStrictEqual(m.s().failures, []);
});

test('a hard close of a new buddy with her first save in flight: one buddy, not two', async () => {
  const exe = createDisk(), r = await hubOn(exe), m = await r.manager(), page = await makerOn(r);
  await r.done();
  await page.maker.addFromSrc(png('new'), 'New');
  const release = exe.hold('data_write');
  await page.pass(1300);
  const c = page.maker.current()!.character!;
  page.maker.setName('Newer');
  await page.killed();
  release();
  await r.done();
  assert.strictEqual(saved(exe, c)!.name, 'Newer');
  assert.deepStrictEqual(m.s().failures, []);
  assert.strictEqual(m.s().buddies.filter(b => b.name.startsWith('New')).length, 1);
});

test('a hard close with that very edit on its way writes it once', async () => {
  const { exe, r, page, id } = await holding(small('c1'));
  exe.calls.length = 0;
  const release = exe.hold('data_write');
  page.maker.setName('Mine');
  await page.pass(1300);
  await page.killed();
  release();
  await r.done();
  assert.strictEqual(saved(exe, id)!.name, 'Mine');
  assert.strictEqual(lands(exe, id), 1);
});

test('Close anyway drops what was waiting behind a save, even when that save then lands', async () => {
  const { exe, r, page, id } = await holding(small('c1'));
  const release = exe.hold('data_write');
  page.maker.setName('Sent');
  await page.pass(1300);
  page.maker.setName('Dropped');
  page.host.window!.close();
  await page.pass(5000);
  page.closing.press('Close anyway');
  await r.done();
  release();
  await r.done();
  assert.strictEqual(saved(exe, id)!.name, 'Sent');
});

test('Edit again can\'t launder a conflict: she stays refused, and the import stays', async () => {
  const { exe, r, m, page, id } = await holding(small('c1'));
  await importing(m, small('c1', 'Imported'));
  await r.done();
  page.maker.setName('Mine');
  await page.edit(id);
  await r.done();
  page.maker.setName('Mine again');
  await page.pass(1300);
  assert.strictEqual(saved(exe, id)!.name, 'Imported');
  assert.ok(page.saveState.kind === 'failed' && /changed somewhere else/.test(page.saveState.title));
});

test('a hard close with the disk failing: the old copy stays, and the Manager is told', async () => {
  const { exe, m, page, id } = await holding(small('c1'));
  exe.failUntil('data_write', 'disk full', () => true);
  page.maker.setName('Bea');
  await page.killed();
  assert.strictEqual(saved(exe, id)!.name, 'Pip');
  assert.deepStrictEqual(m.s().failures.map(f => f.title), ["Bea's last edit wasn't saved"]);
});

/* someone else's change */

async function conflicted(how: 'deleted' | 'replaced') {
  const s = await holding(small('c1'));
  if (how === 'deleted') assert.ok((await s.m.client.deleteBuddy(s.id, revOf(s.m.client, s.id))).ok);
  else assert.ok((await importing(s.m, small('c1', 'Imported')))[0]!.ok);
  await s.r.done();
  s.page.maker.setName('Mine');
  await s.page.pass(1300);
  return s;
}

test('deleted in the Manager while open: refused, nothing written, and it offers a new buddy', async () => {
  const { exe, page, id } = await conflicted('deleted');
  assert.strictEqual(failedTitle(page.saveState), 'Mine was deleted');
  assert.strictEqual(saved(exe, id), null, 'she stays deleted');
  assert.ok(page.saveState.kind === 'failed');
  action(page.saveState as never, 'Keep as a new buddy');
});

test('replaced by an import while open: refused, and the import is what stays', async () => {
  const { exe, page, id } = await conflicted('replaced');
  assert.strictEqual(failedTitle(page.saveState), 'Mine changed somewhere else');
  assert.strictEqual(saved(exe, id)!.name, 'Imported');
});

for (const how of ['deleted', 'replaced'] as const) {
  test(`${how}: keeping it as a new buddy loses neither copy, and goes by a new character`, async () => {
    const { exe, r, m, page, id } = await conflicted(how);
    action(page.saveState as never, 'Keep as a new buddy').run();
    await r.done();
    const c = page.maker.current()!.character!;
    assert.notStrictEqual(c, id);
    assert.strictEqual(saved(exe, c)!.name, 'Mine');
    assert.strictEqual(saved(exe, id)?.name, how === 'deleted' ? undefined : 'Imported');
    assert.strictEqual(page.saveState.kind, 'saved');
    page.maker.setName('Mine again');
    await page.pass(1300);
    assert.strictEqual(saved(exe, c)!.name, 'Mine again', 'and saves as herself from then on');
    assert.ok(m.s().buddies.some(b => b.id === c));
  });

  test(`${how}: further edits don't try to save over it`, async () => {
    const { exe, page } = await conflicted(how);
    exe.calls.length = 0;
    exe.logs.length = 0;
    page.maker.setName('Still mine');
    await page.pass(3000);
    assert.deepStrictEqual(changes(exe), []);
    assert.deepStrictEqual(exe.logs.filter(l => /maker-save/.test(l)), [], 'it isn\'t even sent');
    assert.strictEqual(page.saveState.kind, 'failed');
  });

  test(`${how}: closing asks first`, async () => {
    const { exe, r, page } = await conflicted(how);
    page.host.window!.close();
    await r.done();
    assert.ok(exe.windows.has(page.label));
    assert.deepStrictEqual(page.closing.labels(), ['Keep as a new buddy', 'Keep editing', 'Close anyway']);
  });

  test(`${how}: a hard close keeps the edit beside her and tells the Manager`, async () => {
    const { exe, m, page, id } = await conflicted(how);
    await page.killed();
    const made = [...exe.files.keys()].filter(k => /^library\/[^/.]+\/buddy\.json$/.test(k)).map(k => k.split('/')[1]!).filter(c => c !== id && c !== 'cseed');
    assert.strictEqual(made.length, 1, made.join());
    assert.strictEqual(saved(exe, made[0]!)!.name, 'Mine');
    assert.deepStrictEqual(m.s().failures.map(f => f.title), ["Mine's last edit is a new buddy"]);
    assert.ok(m.s().buddies.some(b => b.id === made[0]));
  });
}

test('a file brought in twice is two buddies, not one folder fought over', async () => {
  const { exe, page, r } = await holding(small('c1'));
  const file = (text: string) => ({ ...pickedFile('x.buddy'), text: async () => text });
  await page.maker.importBuddy(file(write(small('c9', 'Twin'))));
  await page.maker.importBuddy(file(write(small('c9', 'Twin'))));
  await page.pass(1300);
  await r.done();
  const twins = page.maker.state.pets.filter(p => p.name === 'Twin');
  assert.strictEqual(twins.length, 2);
  assert.notStrictEqual(twins[0]!.character, twins[1]!.character);
  for (const t of twins) assert.strictEqual(saved(exe, t.character!)!.name, 'Twin');
  assert.strictEqual(page.saveState.kind, 'saved');
});

test('a file for someone already in the library doesn\'t land on her', async () => {
  const { exe, page, id } = await holding(small('c1', 'Pip'));
  await page.maker.importBuddy({ ...pickedFile('x.buddy'), text: async () => write(small('c1', 'Other')) });
  await page.pass(1300);
  assert.strictEqual(saved(exe, id)!.name, 'Pip');
  const copy = page.maker.state.pets.find(p => p.name === 'Other')!;
  assert.notStrictEqual(copy.character, id, 'she has her own character now');
  assert.strictEqual(saved(exe, copy.character!)!.name, 'Other');
});

test('dropped from the window: a buddy stays in the library, and nothing else happens to her', async () => {
  const { exe, page, id } = await holding(small('c1'));
  page.maker.remove();
  await page.pass(3000);
  assert.strictEqual(saved(exe, id)!.name, 'Pip');
  assert.deepStrictEqual(page.maker.state.pets, []);
});

/* the toast's wording */

test('the browser\'s wording never appears in the app, even with a store that fails on every save', async () => {
  const { exe, page } = await holding(small('c1'));
  exe.failUntil('data_write', 'disk full', () => true);
  for (const name of ['A', 'B', 'C']) { page.maker.setName(name); await page.pass(1300); }
  assert.deepStrictEqual(page.toasts, []);
});

/* Save buddy file and Export desktop page */

test('Save buddy file flushes first, and the file has the edit', async () => {
  const { exe, r, page } = await holding(small('c1'));
  page.maker.setName('Bea');
  page.host.saveBuddyFile(page.maker.current()!.id);
  await r.done();
  assert.strictEqual(read(exe.saved[0]!.content).name, 'Bea');
  assert.strictEqual(exe.saved[0]!.name, 'Bea.buddy');
});

test('Save buddy file with a failed flush doesn\'t hand out an old copy', async () => {
  const { exe, r, page } = await holding(small('c1'));
  exe.failUntil('data_write', 'disk full', () => true);
  page.maker.setName('Bea');
  page.host.saveBuddyFile(page.maker.current()!.id);
  await r.done();
  assert.deepStrictEqual(exe.saved, []);
  assert.strictEqual(failedTitle(page.saveState), "Bea wasn't saved");
});

test('a save window\'s failure goes away with the next edit', async () => {
  const { exe, r, page } = await holding(small('c1'));
  exe.failNext('save_as', 'denied');
  page.host.saveBuddyFile(page.maker.current()!.id);
  await r.done();
  assert.strictEqual(page.saveState.kind, 'failed');
  page.maker.setName('Bea');
  await page.pass(1300);
  assert.strictEqual(page.saveState.kind as string, 'saved');
});

test('a save window that fails says so in the status, and offers again', async () => {
  const { exe, r, page } = await holding(small('c1'));
  exe.failNext('save_as', 'denied');
  page.host.saveBuddyFile(page.maker.current()!.id);
  await r.done();
  assert.strictEqual(failedTitle(page.saveState), "Pip wasn't exported");
  action(page.saveState as never, 'Try again').run();
  await r.done();
  assert.strictEqual(exe.saved.length, 1);
  assert.strictEqual(page.saveState.kind, 'saved');
});

test('Export desktop page flushes, then goes through the same dialog as html', async () => {
  const { exe, r, page } = await holding(small('c1'));
  page.maker.setName('Bea');
  page.host.exportPage!();
  await r.done();
  assert.strictEqual(saved(exe, 'c1')!.name, 'Bea');
  assert.deepStrictEqual(exe.saved.map(s => [s.name, s.filters, s.content]), [['Bea.html', [{ name: 'Web page', extensions: ['html'] }], '<html>Bea</html>']]);
});

test('Export desktop page with a failed flush saves no page', async () => {
  const { exe, r, page } = await holding(small('c1'));
  exe.failUntil('data_write', 'disk full', () => true);
  page.maker.setName('Bea');
  page.host.exportPage!();
  await r.done();
  assert.deepStrictEqual(exe.saved, []);
});

test('a page that won\'t build says so, and nothing is saved', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1')));
  const page = await makerOn(r, 'c1', { buildPage: () => Promise.reject(new Error('no canvas')) });
  await r.done();
  page.host.exportPage!();
  await r.done();
  assert.deepStrictEqual(exe.saved, []);
  assert.ok(page.saveState.kind === 'failed' && page.saveState.why === "The page couldn't be built.");
});

test('one save window at a time, across a buddy file and a page', async () => {
  const { exe, r, page } = await holding(small('c1'));
  let close = (_: boolean) => {};
  exe.dialog = new Promise<boolean>(d => { close = d; });
  page.host.saveBuddyFile(page.maker.current()!.id);
  await r.done();
  exe.dialog = false;
  page.host.exportPage!();
  await r.done();
  assert.strictEqual(exe.saved.length, 1);
  assert.strictEqual(failedTitle(page.saveState), "Pip wasn't exported");
  close(true);
  await tick();
});

test('one save window at a time, with the page\'s first', async () => {
  const { exe, r, page } = await holding(small('c1'));
  let close = (_: boolean) => {};
  exe.dialog = new Promise<boolean>(d => { close = d; });
  page.host.exportPage!();
  await r.done();
  exe.dialog = false;
  page.host.saveBuddyFile(page.maker.current()!.id);
  await r.done();
  assert.strictEqual(exe.saved.length, 1);
  assert.strictEqual(failedTitle(page.saveState), "Pip wasn't exported");
  close(true);
  await tick();
});

/* Try on my screen */

test('Try on my screen: she comes out once, saved first, then acts', async () => {
  const { exe, r, m, page, id } = await holding(small('c1'));
  await m.client.dismiss(id);
  r.sent.length = 0;
  page.maker.setName('Bea');
  page.host.tryOnScreen!(page.maker.current()!.id, 'dance');
  await r.done();
  assert.strictEqual(saved(exe, id)!.name, 'Bea', 'the real buddy, with the edit');
  assert.strictEqual(m.s().buddies.find(b => b.id === id)!.copies, 1);
  const kinds = r.sent.filter(x => x.k === 'pets' || x.k === 'act').map(x => x.k);
  assert.strictEqual(kinds.at(-1), 'act');
  assert.deepStrictEqual(r.sent.at(-1), { k: 'act', id, a: 'dance' });
  const pets = r.sent.filter(x => x.k === 'pets').at(-1) as { pets: { id: string }[] };
  assert.ok(pets.pets.some(p => p.id === id));
  page.host.tryOnScreen!(page.maker.current()!.id, 'wave');
  await r.done();
  assert.strictEqual(m.s().buddies.find(b => b.id === id)!.copies, 1, 'no second copy');
});

test('Try with someone already out, and two copies, changes nobody', async () => {
  const { r, m, page, id } = await holding(small('c1'));
  await m.client.call(id); await m.client.callAnother(id);
  const before = m.s().buddies.find(b => b.id === id)!.copies;
  page.host.tryOnScreen!(page.maker.current()!.id, 'dance');
  await r.done();
  assert.strictEqual(m.s().buddies.find(b => b.id === id)!.copies, before);
});

test('what an edit does on its own never brings her out', async () => {
  const { r, m, page, id } = await holding(small('c1'));
  await m.client.dismiss(id);
  r.sent.length = 0;
  page.maker.act(page.maker.current()!.id, 'wave');
  await page.maker.setMainImage(pickedFile('new.png'));
  await page.pass(3000);
  assert.strictEqual(m.s().buddies.find(b => b.id === id)!.status, 'home');
  assert.ok(!r.sent.some(x => x.k === 'act'));
});

test('a reaction for someone deleted while open adds nothing to the Manager\'s list', async () => {
  const { r, m, page, id } = await holding(small('c1'));
  await m.client.deleteBuddy(id, revOf(m.client, id));
  await r.done();
  page.maker.act(page.maker.current()!.id, 'wave');
  await r.done();
  assert.deepStrictEqual(m.s().failures, []);
  assert.ok(!r.sent.some(x => x.k === 'act'));
});

test('Try for someone deleted while open says she isn\'t here', async () => {
  const { r, m, page, id } = await holding(small('c1'));
  await m.client.deleteBuddy(id, revOf(m.client, id));
  await r.done();
  page.host.tryOnScreen!(page.maker.current()!.id, 'dance');
  await r.done();
  assert.strictEqual(failedTitle(page.saveState), "That buddy isn't here");
  assert.ok(!r.sent.some(x => x.k === 'act'));
});

test('with her out, the same reaction does reach her', async () => {
  const { r, m, page, id } = await holding(small('c1'));
  await m.client.call(id);
  r.sent.length = 0;
  page.maker.act(page.maker.current()!.id, 'wave');
  await r.done();
  assert.deepStrictEqual(r.sent.filter(x => x.k === 'act'), [{ k: 'act', id, a: 'wave' }]);
});

test('Try for a new buddy whose save failed brings nobody out and adds no failure to the Manager', async () => {
  const exe = createDisk(), r = await hubOn(exe), m = await r.manager(), page = await makerOn(r);
  await r.done();
  await page.maker.addFromSrc(png('new'), 'New');
  exe.failUntil('data_write', 'disk full', () => true);
  page.host.tryOnScreen!(page.maker.current()!.id, 'dance');
  await r.done();
  assert.ok(!r.sent.some(x => x.k === 'act'));
  assert.deepStrictEqual(m.s().failures, []);
});

test('toasts reach whoever\'s listening', async () => {
  const { page } = await holding(small('c1'));
  await page.maker.addFromSrc('nope');
  page.maker.applyReply('not json');
  assert.ok(page.toasts.some(t => /Couldn't read that/.test(t)), page.toasts.join());
});
