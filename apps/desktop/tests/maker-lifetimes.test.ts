/* Each Maker window is a lifetime the hub owns, with its own label: what the fourth review found
   when one label served them all. Each of these failed before its fix. */
import assert from 'node:assert';
import { write } from '@buddies/buddy-file';
import { test } from 'vitest';
import type { MakerBoot } from '../src/manager-api';
import { CLOSE_ASK_MS } from '../src/maker-page';
import { MAKER } from '../src/maker-window';
import { createDisk, holding, hubOn, pageOn, small, type HubRun } from './maker-harness';

type Exe = ReturnType<typeof createDisk>;
/* Every Maker window the hub asked for, oldest first. */
const opens = (exe: Exe) => exe.calls.filter(c => c.cmd === 'window_open' && (c.args as { spec: { page: string } }).spec.page === 'maker.html')
  .map(c => (c.args as { spec: { label: string; boot: MakerBoot } }).spec);
/* The page in the window the hub opened last. */
function pageInLast(r: HubRun) {
  const spec = opens(r.exe).at(-1)!;
  return { spec, page: pageOn(r, spec.boot) };
}
async function twoBuddies() {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1', 'One'))), m = await r.manager();
  await m.client.importFiles([{ name: 'x.buddy', path: 'x.buddy', size: 1, text: async () => write(small('c2', 'Two')), url: async () => '' }]);
  await r.done();
  return { exe, r, m };
}

test('every Maker window the hub opens is its own, with its own label, and knows it', async () => {
  const { exe, r, m } = await twoBuddies();
  assert.ok((await m.client.editBuddy('c1')).ok);
  const first = opens(exe).at(-1)!;
  assert.strictEqual(first.boot.label, first.label, 'its page is told which it is');
  await exe.shell.windowClose(first.label);
  assert.ok((await m.client.newBuddy()).ok);
  await r.done();
  const second = opens(exe).at(-1)!;
  assert.notStrictEqual(second.label, first.label, 'a new window is a new lifetime');
});

test('a close still out for an old window never reaches the new one', async () => {
  const { exe, r, m } = await twoBuddies();
  assert.ok((await m.client.editBuddy('c1')).ok);
  const { spec, page } = pageInLast(r);
  await r.done();
  await exe.shell.windowMinimize(spec.label);
  const hubs = exe.hold('window_close'); /* the hub's close of the minimized window, held before it runs */
  const asked = m.client.editBuddy('c2');
  await r.done();
  await page.pass(CLOSE_ASK_MS);
  page.closing.press('Close anyway'); /* the page closes its own window meanwhile */
  await r.done();
  assert.ok(!exe.windows.has(spec.label));
  const again = await m.client.newBuddy();
  await r.done();
  if (again.ok) {
    const next = opens(exe).at(-1)!, made = exe.windows.get(next.label);
    hubs();
    await r.done();
    assert.strictEqual(exe.windows.get(next.label), made, 'the old close found nothing of the new window to close');
  } else {
    assert.ok(/still closing/.test(again.failure.title), again.failure.title);
    hubs();
  }
  assert.ok((await asked).ok, 'and the hub\'s own Edit goes through once the old window has gone');
  await r.done();
  assert.ok(opens(exe).some(o => o.boot.id === 'c2' && exe.windows.has(o.label)), 'with Two in a window of her own');
});

test('a request refused while a window is closing changes nothing the next window is told', async () => {
  const { exe, r, m } = await twoBuddies();
  assert.ok((await m.client.editBuddy('c1')).ok);
  const { spec, page } = pageInLast(r);
  await r.done();
  await exe.shell.windowMinimize(spec.label);
  const hold = exe.hold('data_write');
  page.maker.setName('Mine');
  const fresh = m.client.newBuddy();
  await r.done();
  const refused = await m.client.editBuddy('c2');
  assert.ok(!refused.ok, 'Edit Two is refused, with New buddy under way');
  hold();
  assert.ok((await fresh).ok);
  await r.done();
  const next = pageInLast(r);
  assert.ok(!('id' in next.spec.boot), 'the new window opens empty');
  await r.done();
  await next.page.pass(1300);
  assert.strictEqual(next.page.maker.state.pets.length, 0, 'and saying hello doesn\'t bring the refused Edit back');
});

test('windows outlive a hub that restarts, so the next hub\'s labels are new ones', async () => {
  const exe = createDisk(), first = await hubOn(exe, write(small('c1'))), m1 = await first.manager();
  assert.ok((await m1.client.editBuddy('c1')).ok);
  const old = opens(exe).at(-1)!;
  await exe.shell.windowMinimize(old.label);
  first.stop();
  const next = await hubOn(exe, undefined, first.bus), m2 = await next.manager();
  assert.ok((await m2.client.newBuddy()).ok, 'it opens one of its own');
  assert.notStrictEqual(opens(exe).at(-1)!.label, old.label);
  assert.ok(exe.windows.has(old.label), 'and leaves the old one alone');
});

test('a minimized window whose page wasn\'t listening yet: the refused Edit isn\'t what it hears at hello', async () => {
  const { exe, r, m } = await twoBuddies();
  assert.ok((await m.client.editBuddy('c1')).ok);
  const spec = opens(exe).at(-1)!;
  await exe.shell.windowMinimize(spec.label);
  const asked = m.client.editBuddy('c2'); /* nobody's there yet to flush */
  await r.done();
  r.fire(40000);
  assert.ok(!(await asked).ok);
  const late = pageOn(r, spec.boot);
  await r.done();
  assert.strictEqual(late.maker.current()?.character, 'c1', 'it opens on what it was opened for');
});

test('a refused replacement ends: the next request is decided, not refused as still closing', async () => {
  const { exe, r, m } = await twoBuddies();
  assert.ok((await m.client.editBuddy('c1')).ok);
  const { spec, page } = pageInLast(r);
  await r.done();
  await exe.shell.windowMinimize(spec.label);
  const full = exe.failUntil('data_write', 'disk full', () => true);
  page.maker.setName('Mine');
  const a = await m.client.editBuddy('c2');
  assert.ok(!a.ok && a.failure.title === "The Maker has an edit it couldn't save", JSON.stringify(a));
  full();
  assert.ok((await m.client.editBuddy('c2')).ok, 'saved now, so it goes through');
});

test('a page acts only on what\'s said to its own window', async () => {
  const s = await holding(small('c1', 'One'), small('c2', 'Two'));
  const other = pageOn(s.r, { n: 0, id: 'c1', label: 'maker-other' }); /* one the hub doesn't know of */
  await s.r.done();
  assert.ok((await s.m.client.editBuddy('c2')).ok);
  await s.r.done();
  assert.strictEqual(s.page.maker.current()?.character, 'c2', 'its own heard');
  assert.strictEqual(other.maker.current()?.character, 'c1', 'the other didn\'t');
});

test('the page\'s own buttons and Alt+F4 are for its own window', async () => {
  const s = await holding(small('c1'));
  s.page.host.window!.minimize();
  await s.r.done();
  assert.ok((s.exe.windows.get(s.page.label) as { minimized?: boolean }).minimized, 'minimize');
  s.exe.closeFromOutside(s.page.label);
  assert.ok(s.page.closing.stopped, 'Alt+F4 takes Close\'s way');
  await s.r.done();
  assert.ok(!s.exe.windows.has(s.page.label));
});

/* review 5: windows that outlive a hub restart */

/* Work the page counts, which ends when the test says. */
function gate() { let go = () => {}; const p = new Promise<void>(r => { go = r; }); return { p, go: () => go() }; }

test('an old window\'s answer to its flush never closes a newer window', async () => {
  const exe = createDisk(), first = await hubOn(exe, write(small('c1'))), m1 = await first.manager();
  assert.ok((await m1.client.editBuddy('c1')).ok);
  const spec1 = opens(exe).at(-1)!, page1 = pageOn(first, spec1.boot), work1 = gate();
  await first.done();
  void page1.track(() => work1.p);
  await exe.shell.windowMinimize(spec1.label);
  void m1.client.editBuddy('c1'); /* the old hub asks it to flush, and the work holds that up */
  await first.done();
  first.stop();
  const next = await hubOn(exe, undefined, first.bus), m2 = await next.manager();
  assert.ok((await m2.client.editBuddy('c1')).ok);
  const spec2 = opens(exe).at(-1)!, page2 = pageOn(next, spec2.boot), work2 = gate();
  await next.done();
  void page2.track(() => work2.p);
  page2.maker.setName('Mine');
  await exe.shell.windowMinimize(spec2.label);
  void m2.client.editBuddy('c1'); /* the new hub asks the new window, which its own work holds up */
  await next.done();
  work1.go(); /* the old window answers: clean, and ready to go */
  await next.done();
  assert.ok(exe.windows.has(spec2.label), 'the new window is still there');
  assert.strictEqual(page2.closer.phase, 'waiting', 'still waiting on its own work');
  work2.go();
  await next.done();
});

test('a window from before a hub restart is never made current: New opens a fresh one', async () => {
  const exe = createDisk(), first = await hubOn(exe, write(small('c1'))), m1 = await first.manager();
  assert.ok((await m1.client.editBuddy('c1')).ok);
  const spec1 = opens(exe).at(-1)!;
  first.stop();
  const next = await hubOn(exe, undefined, first.bus), m2 = await next.manager();
  const old = pageOn(next, spec1.boot); /* its page finishes starting after the restart, and says hello */
  await next.done();
  const before = opens(exe).length;
  assert.ok((await m2.client.newBuddy()).ok);
  assert.strictEqual(opens(exe).length, before + 1, 'a fresh window of the new hub\'s own');
  assert.notStrictEqual(opens(exe).at(-1)!.label, spec1.label);
  assert.strictEqual(old.maker.current()?.character, 'c1', 'and the old one is left as it was');
});

async function restartedUnder() {
  const exe = createDisk(), first = await hubOn(exe, write(small('c1'))), m1 = await first.manager();
  assert.ok((await m1.client.editBuddy('c1')).ok);
  const spec1 = opens(exe).at(-1)!, old = pageOn(first, spec1.boot);
  await first.done();
  first.stop();
  const next = await hubOn(exe, undefined, first.bus), m2 = await next.manager();
  old.maker.setName('Old window');
  await old.pass(1300);
  assert.ok(old.saveState.kind === 'failed', 'its save isn\'t taken over what the new hub knows');
  return { exe, next, m2, spec1, old };
}

test('a window from before a hub restart: the person can still close it', async () => {
  const { exe, next, spec1, old } = await restartedUnder();
  old.host.window!.close();
  await next.done();
  await old.pass(CLOSE_ASK_MS);
  old.closing.press('Close anyway');
  await next.done();
  assert.ok(!exe.windows.has(spec1.label));
});

test('a window from before a hub restart: its edit, when it goes, is kept beside her', async () => {
  const { exe, m2, old } = await restartedUnder();
  await old.killed();
  const names = [...exe.files.keys()].filter(k => /^library\/[^/.]+\/buddy\.json$/.test(k)).map(k => JSON.parse(new TextDecoder().decode(exe.files.get(k))).buddy.name);
  assert.ok(names.includes('Old window') && names.includes('Pip'), JSON.stringify(names));
  assert.deepStrictEqual(m2.s().failures.map(f => f.title), ["Old window's last edit is a new buddy"]);
});

test('a flush answered, then a slow close: the limit passing doesn\'t take the window back', async () => {
  const { exe, r, m } = await twoBuddies();
  assert.ok((await m.client.editBuddy('c1')).ok);
  const { spec, page } = pageInLast(r);
  await r.done();
  await exe.shell.windowMinimize(spec.label);
  const closing = exe.hold('window_close'); /* the hub's close, slow to happen */
  const asked = m.client.editBuddy('c2');
  await r.done();
  assert.strictEqual(page.closer.phase, 'closing', 'it said it can go');
  r.fire(40000);
  await r.done();
  assert.strictEqual(page.closer.phase, 'closing', 'and nothing tells it to stay');
  closing();
  assert.ok((await asked).ok);
});
