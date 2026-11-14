/* Both exes: the frozen one (API 1) keeps its ways, and the next one (API 2) is used for what it
   adds. Each test runs on the fake exe as one or the other. */
import assert from 'node:assert';
import fs from 'node:fs';
import { test } from 'vitest';
import { createBuddyMenu, MENU } from '../src/buddy-menu';
import { argsSeen, createHub } from '../src/hub-core';
import type { Said } from '../src/manager-api';
import { MANAGER } from '../src/manager-window';
import type { Monitor, PlainWindowSpec } from '../src/shell';
import { createFakeExe, type FakeOptions } from '../src/shell-fake';
import { createBus } from '../src/wire';
import { art, createDisk, hubOn, makerOn, pickedFile, saved, small } from './maker-harness';

const SAMPLE = fs.readFileSync(new URL('../../../packages/test-support/fixtures/sample.json', import.meta.url), 'utf8');
const monitor: Monitor = { i: 0, name: 'A', primary: true, scale: 1, x: 0, y: 0, w: 1920, h: 1040, full: { x: 0, y: 0, w: 1920, h: 1080 } };
const tick = () => new Promise(r => setTimeout(r));

let holdRelease = () => {};
async function hubAt(api: number, o: FakeOptions = {}, prepare?: (e: ReturnType<typeof createFakeExe>) => () => void) {
  const exe = createFakeExe({ monitors: [monitor], api, ...o, args: [...o.args ?? [], '--no-manager'] }), bus = createBus<Said>();
  if (prepare) holdRelease = prepare(exe);
  const hub = createHub({ shell: exe.shell, send: () => {}, seed: async () => SAMPLE, after: () => {}, wire: bus.wire() });
  await hub.start();
  const done = async () => { for (let i = 0; i < 12; i++) { await tick(); await Promise.race([hub.settled, tick()]); } };
  await done();
  return { exe, hub, bus, done };
}
const raises = (exe: ReturnType<typeof createFakeExe>) => exe.calls.filter(c => c.cmd === 'raise').map(c => (c.args as { on: boolean }).on);

/* the fake, as each exe */

test('API 1 refuses what only API 2 knows, as its spec parsing does', async () => {
  const one = createFakeExe(), two = createFakeExe({ api: 2 });
  const spec: PlainWindowSpec = { kind: 'window', label: 'w', page: 'w.html', focused: false, focusable: true };
  await assert.rejects(one.shell.windowOpen(spec), /unknown field `focused`/);
  await assert.rejects(one.shell.raise(true), /unknown command raise/);
  await assert.rejects(one.shell.quitWait(), /unknown command quit_wait/);
  await assert.rejects(one.shell.saveAs({ name: 'a.buddy', owner: 'manager', content: 'x' }), /unknown field `owner`/);
  assert.deepStrictEqual((await one.shell.info()).can, undefined);
  await two.shell.windowOpen(spec);
  assert.strictEqual(two.focused, null, 'opened without the keyboard');
  assert.ok((await two.shell.info()).can!.includes('raise'));
});

test('API 2 says when a window goes, however it went; API 1 says nothing', async () => {
  for (const api of [1, 2]) {
    const exe = createFakeExe({ api }), closed: string[] = [];
    await exe.shell.on('window-closed', e => { closed.push(e.label); });
    await exe.shell.windowOpen({ kind: 'window', label: 'a', page: 'a.html' });
    await exe.shell.windowOpen({ kind: 'window', label: 'b', page: 'b.html' });
    await exe.shell.windowClose('a');
    exe.closeFromOutside('b');
    assert.deepStrictEqual(closed, api === 2 ? ['a', 'b'] : [], `api ${api}`);
  }
});

test('API 2\'s focus restores a minimized window; API 1\'s does nothing to one', async () => {
  for (const api of [1, 2]) {
    const exe = createFakeExe({ api });
    await exe.shell.windowOpen({ kind: 'window', label: 'w', page: 'w.html' });
    await exe.shell.windowMinimize('w'); exe.focused = null;
    await exe.shell.windowFocus('w');
    assert.strictEqual(await exe.shell.windowMinimized('w'), api === 1, `api ${api}`);
    assert.strictEqual(exe.focused, api === 2 ? 'w' : null);
  }
});

/* the hub */

test('API 1: the app starts as it did, and asks for nothing new', async () => {
  const { exe } = await hubAt(1);
  assert.ok(exe.windows.size > 0, 'overlays are up');
  assert.deepStrictEqual(raises(exe), []);
  assert.ok(!exe.calls.some(c => /^quit_|^raise$/.test(c.cmd)));
  assert.ok(exe.logs.some(l => l === 'exe api 1'));
});

test('API 2: overlays are kept on top while nothing is full screen', async () => {
  const { exe, done } = await hubAt(2);
  assert.deepStrictEqual(raises(exe), [true]);
  assert.strictEqual(exe.raising, true);
  for (const userState of ['fullscreen', 'presentation', 'busy', 'normal', 'normal', 'away'] as const) {
    exe.emit('system', { userState, onBattery: false, saver: false });
    await done();
  }
  assert.deepStrictEqual(raises(exe), [true, false, true, false]);
  assert.strictEqual(exe.raising, false);
});

test('API 2: a raise that fails is asked again at the next change', async () => {
  const exe0 = createFakeExe({ api: 2, monitors: [monitor] });
  exe0.failNext('raise', 'no');
  const bus = createBus<Said>();
  const hub = createHub({ shell: exe0.shell, send: () => {}, seed: async () => SAMPLE, after: () => {}, wire: bus.wire() });
  await hub.start(); await tick(); await tick();
  assert.strictEqual(exe0.raising, false);
  assert.ok(exe0.logs.some(l => /raise failed: no/.test(l)));
  exe0.emit('system', { userState: 'normal', onBattery: false, saver: false });
  await tick();
  assert.strictEqual(exe0.raising, true);
});

test('API 2: raise calls go one at a time, and the last one wanted is what the exe ends with', async () => {
  const { exe, done } = await hubAt(2, {}, e => e.hold('raise'));
  const state = (userState: 'normal' | 'fullscreen') => { exe.emit('system', { userState, onBattery: false, saver: false }); };
  assert.deepStrictEqual(raises(exe), [true], 'the first is held');
  state('fullscreen'); await done();
  assert.deepStrictEqual(raises(exe), [true], 'the next waits for it');
  holdRelease(); await done();
  assert.deepStrictEqual(raises(exe), [true, false]);
  assert.strictEqual(exe.raising, false, 'off, as the hub wants');
});

test('API 2: a change and back while a raise is out sends nothing more', async () => {
  const { exe, done } = await hubAt(2, {}, e => e.hold('raise'));
  exe.emit('system', { userState: 'fullscreen', onBattery: false, saver: false }); await done();
  exe.emit('system', { userState: 'normal', onBattery: false, saver: false }); await done();
  holdRelease(); await done();
  assert.deepStrictEqual(raises(exe), [true]);
  assert.strictEqual(exe.raising, true);
});

test('a second launch is logged as counts and flags, never values', async () => {
  for (const api of [1, 2]) {
    const { exe, done } = await hubAt(api);
    exe.emit('second-launch', { args: ['--mode', 'secret-mode', '--data-dir', 'C:\\Users\\someone\\private', 'D:\\x\\olive.buddy', '--log'] });
    await done();
    const line = exe.logs.find(l => /second launch/.test(l))!;
    assert.strictEqual(line, 'second launch: args 6, files 1, flags --data-dir --log --mode');
  }
  assert.strictEqual(argsSeen([]), 'args 0, files 0, flags none');
  assert.ok(!/secret|1234/.test(argsSeen(['--buddies', '1234', '--api', 'secret'])));
});

test('files from launch are logged as a count and an outcome, never names or what they hold', async () => {
  const { exe, done } = await hubAt(2);
  exe.emit('open-file', { name: 'private-client.buddy', content: '{"secret":"client notes"' });
  exe.emit('open-file', { name: 'other-private.buddy', content: '', error: 'The device is not ready. C:\\Users\\someone' });
  exe.emit('open-file', { name: 'ok.buddy', content: SAMPLE });
  await done();
  const lines = exe.logs.filter(l => /launch|import/.test(l));
  assert.deepStrictEqual(lines.filter(l => /^launch/.test(l)), ['launch: a file, failed', 'launch: a file, failed', 'launch: a file, imported']);
  assert.ok(lines.includes('import failed: not a buddy file') && lines.includes('import failed: unreadable'), lines.join(' | '));
  assert.ok(!exe.logs.some(l => /private|secret|client|Users|someone|ok\.buddy/.test(l)), exe.logs.join(' | '));
});

test('a library folder that can\'t be read is logged by its id and an error kind, never what it holds', async () => {
  const manifest = JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: { character: 'cprivate', name: 'X', base: { src: 'base.png', bb: { x0: 0, y0: 0, x1: 1, y1: 1 } }, poses: {}, 'private-client-notes': 'x' } });
  const { exe } = await hubAt(2, {}, e => { e.files.set('library/cprivate/buddy.json', new TextEncoder().encode(manifest)); return () => {}; });
  const line = exe.logs.find(l => /library: skipped cprivate/.test(l));
  assert.ok(line, exe.logs.join(' | '));
  assert.ok(!/private-client|notes|field/.test(line!), line);
});

test('the log gets a URL\'s origin, a known mode, and an error\'s kind, never more', async () => {
  const { originOf, modeSeen, errorSeen, rejectionSeen, cspSeen } = await import('../src/log-safe');
  assert.strictEqual(originOf('https://example.com/g/secret?token=x'), 'https://example.com');
  assert.strictEqual(originOf('http://tauri.localhost/overlay.js'), 'http://tauri.localhost');
  assert.strictEqual(originOf('data:text/html,<b>secret</b>'), 'data:');
  assert.strictEqual(originOf('inline'), 'inline');
  assert.strictEqual(originOf('C:\\Users\\someone\\x.js'), 'c:');
  assert.strictEqual(originOf('not a url at all'), 'unknown');
  assert.deepStrictEqual(['demo', 'empty', 'https://example.com/private?token=secret', 7].map(modeSeen), ['demo', 'empty', 'unknown', 'unknown']);
  const err = new TypeError('cannot read "client notes"');
  assert.strictEqual(errorSeen({ error: err, filename: 'http://tauri.localhost/hub.js?x=secret', lineno: 3 } as ErrorEvent), 'TypeError at http://tauri.localhost:3');
  assert.strictEqual(rejectionSeen({ reason: 'secret text' } as PromiseRejectionEvent), 'string');
  assert.strictEqual(rejectionSeen({ reason: err } as PromiseRejectionEvent), 'TypeError');
  assert.strictEqual(cspSeen({ violatedDirective: 'img-src', blockedURI: 'https://example.com/private.png' } as SecurityPolicyViolationEvent), 'img-src https://example.com');
});

/* the Manager's window */

async function managerMinimized(api: number) {
  const { exe, done } = await hubAt(api);
  exe.emit('tray-click', null); await done();
  await exe.shell.windowMinimize(MANAGER.label); exe.focused = 'elsewhere';
  const before = exe.calls.length;
  exe.emit('tray-click', null); await done();
  return { exe, after: exe.calls.slice(before).map(c => c.cmd) };
}

test('API 1: a minimized Manager comes back as a fresh window', async () => {
  const { exe, after } = await managerMinimized(1);
  assert.ok(after.includes('window_close'));
  assert.strictEqual(exe.focused, 'manager');
});

test('API 2: a minimized Manager is restored, not reopened', async () => {
  const { exe, after } = await managerMinimized(2);
  assert.ok(!after.includes('window_close'), after.join());
  assert.ok(!after.includes('plugin:window|is_minimized'), 'nothing to ask');
  assert.strictEqual(exe.focused, 'manager');
  assert.strictEqual(await exe.shell.windowMinimized('manager'), false);
});

/* the save dialog */

test('the Manager\'s export dialog belongs to the Manager on API 2, and to nobody on API 1', async () => {
  for (const api of [1, 2]) {
    const exe = createDisk(api), r = await hubOn(exe), m = await r.manager();
    exe.dialog = true;
    assert.ok((await m.client.exportBuddy('cseed')).ok);
    assert.strictEqual((exe.saved[0] as { owner?: string }).owner, api === 2 ? 'manager' : undefined, `api ${api}`);
  }
});

test('the Maker\'s dialogs belong to its window on API 2', async () => {
  const exe = createDisk(2), r = await hubOn(exe, undefined), page = await makerOn(r, 'cseed');
  exe.dialog = true;
  page.host.saveBuddyFile(page.maker.current()!.id);
  await r.done();
  page.host.exportPage!();
  await r.done();
  assert.deepStrictEqual(exe.saved.map(s => (s as { owner?: string }).owner), [page.label, page.label]);
});

/* the Maker's window */

test('API 2: Edit on a minimized Maker restores it, with nothing flushed or closed', async () => {
  const exe = createDisk(2), r = await hubOn(exe), m = await r.manager(), page = await makerOn(r, 'cseed');
  await exe.shell.windowMinimize(page.label); exe.focused = null;
  const before = exe.calls.length;
  assert.ok((await m.client.editBuddy('cseed')).ok);
  const after = exe.calls.slice(before).map(c => c.cmd);
  assert.ok(!after.includes('window_close') && !after.includes('window_open'), after.join());
  assert.strictEqual(exe.focused, page.label);
  assert.ok(!(exe.windows.get(page.label) as { minimized?: boolean }).minimized);
});

test('API 2: a Maker window that went is replaced by a fresh one, told by the exe or found gone', async () => {
  for (const told of [true, false]) {
    const exe = createDisk(2), r = await hubOn(exe), m = await r.manager(), page = await makerOn(r, 'cseed');
    if (told) await exe.shell.windowClose(page.label);
    else exe.windows.delete(page.label); /* gone without a word yet */
    await r.done();
    assert.ok((await m.client.newBuddy()).ok);
    const open = [...exe.windows.values()].filter(w => w.page === 'maker.html');
    assert.strictEqual(open.length, 1);
    assert.notStrictEqual(open[0]!.label, page.label);
  }
});

/* quitting */

test('API 1: quitting sends what\'s waiting and asks nothing of the exe', async () => {
  const exe = createDisk(1), r = await hubOn(exe), page = await makerOn(r, 'cseed');
  page.maker.setName('Bea');
  await exe.shell.quit();
  await r.done();
  assert.strictEqual(saved(exe, 'cseed')!.name, 'Bea');
  assert.ok(!exe.calls.some(c => /^quit_/.test(c.cmd)));
});

test('API 2: quitting waits for the save to be answered, then says it\'s ready', async () => {
  const exe = createDisk(2), r = await hubOn(exe), page = await makerOn(r, 'cseed');
  page.maker.setName('Bea');
  const hold = exe.hold('data_write', (a: Uint8Array) => new TextDecoder().decode(a).includes('Bea'));
  await exe.shell.quit();
  await r.done();
  const order = () => exe.calls.map(c => c.cmd).filter(c => /^quit_/.test(c));
  assert.deepStrictEqual(order(), ['quit_wait'], 'waiting on the save');
  hold();
  await r.done();
  assert.deepStrictEqual(order(), ['quit_wait', 'quit_ready']);
  assert.strictEqual(saved(exe, 'cseed')!.name, 'Bea');
});

const readies = (exe: ReturnType<typeof createDisk>) => exe.calls.filter(c => c.cmd === 'quit_ready').length;
const bytesSay = (word: string) => (a: Uint8Array) => new TextDecoder().decode(a).includes(word);
function slowArt() {
  let go = () => {};
  const gate = new Promise<void>(r => { go = r; });
  return { go: () => go(), art: { ...art, processFrames: async (srcs: string[]) => { await gate; return art.processFrames(srcs); } } };
}

/* review: the 9 s timeout raced the save, and ready went with a write still out */
test('API 2: a save that never answers is never followed by ready: the exe\'s bound ends the run', async () => {
  const exe = createDisk(2), r = await hubOn(exe), page = await makerOn(r, 'cseed');
  page.maker.setName('Bea');
  const hold = exe.hold('data_write', bytesSay('Bea'));
  await exe.shell.quit();
  await r.done();
  await page.pass(20000);
  assert.strictEqual(readies(exe), 0, 'not while her write is out');
  hold();
  await r.done();
  assert.strictEqual(readies(exe), 1, 'once it landed');
  assert.strictEqual(saved(exe, 'cseed')!.name, 'Bea');
});

/* review: an edit while the first flush was out went as a last word, with ready right behind it */
test('API 2: an edit made while the quit\'s save is out lands before ready', async () => {
  const exe = createDisk(2), r = await hubOn(exe), page = await makerOn(r, 'cseed');
  page.maker.setName('First');
  const hold = exe.hold('data_write', bytesSay('First'));
  await exe.shell.quit();
  await r.done();
  page.maker.setName('Second');
  const second = exe.hold('data_write', bytesSay('Second'));
  hold();
  await r.done();
  await page.pass(1300);
  assert.strictEqual(readies(exe), 0, 'not while the newest edit is out');
  second();
  await r.done();
  await page.pass(1300);
  assert.strictEqual(readies(exe), 1);
  assert.strictEqual(saved(exe, 'cseed')!.name, 'Second');
});

/* review: quit skipped the closer, so image work still running was lost and the page stayed editable */
test('API 2: a quit waits for image work, stops input, and saves all of it before ready', async () => {
  const exe = createDisk(2), r = await hubOn(exe), slow = slowArt();
  const page = await makerOn(r, 'cseed', { art: slow.art });
  await r.done();
  void page.track(() => page.maker.importGenerated([pickedFile('main.png'), pickedFile('walk_1.png')]));
  await r.done();
  const was = saved(exe, 'cseed')!;
  await exe.shell.quit();
  await page.pass(3000);
  assert.ok(page.closing.stopped, 'input stopped');
  assert.strictEqual(readies(exe), 0, 'not while image work runs');
  assert.strictEqual(saved(exe, 'cseed')!.base.src, was.base.src, 'and nothing half done went out');
  slow.go();
  await r.done();
  await page.pass(100);
  assert.strictEqual(readies(exe), 1);
  const now = saved(exe, 'cseed')!;
  assert.notStrictEqual(now.base.src, was.base.src);
  assert.ok(now.poses.walk?.frames.length, 'with all of the import');
  assert.ok(exe.windows.has(page.label), 'the window is left for the exe to end');
});

test('API 2: Close anyway on a quit still waits for the write that\'s out', async () => {
  const exe = createDisk(2), r = await hubOn(exe), page = await makerOn(r, 'cseed');
  page.maker.setName('Bea');
  const hold = exe.hold('data_write', bytesSay('Bea'));
  await exe.shell.quit();
  await r.done();
  await page.pass(5000);
  page.closing.press('Close anyway');
  await r.done();
  assert.strictEqual(readies(exe), 0, 'not while her write is out');
  hold();
  await r.done();
  assert.strictEqual(readies(exe), 1);
});

/* review 2: a write past its 30 s reply timeout was taken as finished */
test('API 2: a write past its reply timeout still holds ready back, Close anyway or not', async () => {
  const exe = createDisk(2), r = await hubOn(exe), page = await makerOn(r, 'cseed');
  page.maker.setName('Bea');
  const hold = exe.hold('data_write', bytesSay('Bea'));
  await page.pass(25000);
  await exe.shell.quit();
  await r.done();
  await page.pass(7000);
  page.closing.press('Close anyway');
  await r.done();
  assert.strictEqual(readies(exe), 0, 'not while her write is unanswered');
  hold();
  await r.done();
  assert.strictEqual(readies(exe), 1);
  assert.strictEqual(saved(exe, 'cseed')!.name, 'Bea');
});

test('API 2: a quit while Close already waits on image work leaves the close in charge, and still gets a last word out', async () => {
  const exe = createDisk(2), r = await hubOn(exe), slow = slowArt();
  const page = await makerOn(r, 'cseed', { art: slow.art });
  await r.done();
  page.maker.setName('Mine');
  void page.track(() => page.maker.importGenerated([pickedFile('main.png'), pickedFile('walk_1.png')]));
  await r.done();
  page.host.window!.close();
  await page.pass(300);
  await exe.shell.quit();
  await r.done();
  assert.strictEqual(saved(exe, 'cseed')!.name, 'Seed', 'the close holds it');
  await page.pass(9000);
  assert.strictEqual(saved(exe, 'cseed')!.name, 'Mine', 'the last word, a second before the bound');
  assert.strictEqual(readies(exe), 0, 'never ready: the window is still there');
});

/* the right-click menu */

test('the menu\'s window opens without the keyboard on API 2, and as before on API 1', async () => {
  for (const api of [1, 2]) {
    const exe = createFakeExe({ api, monitors: [monitor] });
    const row = { id: 'ada', name: 'Ada', image: 'x.png', status: 'out' as const, copies: 1, can: [], rev: 1, talks: true };
    const menu = createBuddyMenu({ shell: exe.shell, post: () => {}, note: () => {}, after: () => {}, row: () => row, maker: () => true, monitors: () => [monitor], quiet: () => false, run: () => {}, newer: () => api >= 2 });
    menu.heard({ k: 'menu-ask', copy: 'ada', her: { x: 500, y: 400, w: 160, h: 160 }, at: { x: 580, y: 450 }, t: 0 });
    for (let i = 0; i < 10; i++) await tick();
    const spec = (exe.calls.find(c => c.cmd === 'window_open')!.args as { spec: PlainWindowSpec }).spec;
    assert.strictEqual(spec.focused, api === 2 ? false : undefined, `api ${api}`);
    assert.deepStrictEqual({ ...spec, focused: undefined, label: MENU.label, boot: undefined }, { ...MENU, focused: undefined, boot: undefined });
  }
});

test('the client\'s newest contract is 2, and it still runs on 1', async () => {
  const { API, MIN_API } = await import('../src/shell');
  assert.deepStrictEqual([API, MIN_API], [2, 1]);
});
