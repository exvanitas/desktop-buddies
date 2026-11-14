/* The right-click menu's window, as the hub keeps it: opened on the first right-click and hidden
   after, placed beside her, shown and focused only once the page has drawn her menu. The hub runs
   every step on the window, one at a time, each for one showing, and a step that finishes for a
   showing nobody wants any more is undone. The real hub on the fake exe, with the overlays and the
   menu page as other ends of the menu's channel. */
import assert from 'node:assert';
import fs from 'node:fs';
import { read } from '@buddies/buddy-file';
import { test } from 'vitest';
import { DRAW_MS, FOCUS_MS, MENU, RETRY_MS, STEP_MS, UP_MS, WANT_MS, createBuddyMenu, isMenu } from '../src/buddy-menu';
import { createHub } from '../src/hub-core';
import type { Command, MenuToHub, Said } from '../src/manager-api';
import { text, type Monitor } from '../src/shell';
import { createFakeExe } from '../src/shell-fake';
import { createBus } from '../src/wire';

const SAMPLE = fs.readFileSync(new URL('../../../packages/test-support/fixtures/sample.json', import.meta.url), 'utf8');
const SAMPLE_ID = read(SAMPLE).character!;
const monitor = (i: number, x: number, scale = 1, h = 1040): Monitor => ({ i, name: 'M' + i, primary: x === 0, scale, x, y: 0, w: 1920, h, full: { x, y: 0, w: 1920, h: h + 40 } });

async function setup(monitors = [monitor(0, 0)]) {
  const exe = createFakeExe({ monitors, args: ['--no-manager'] });
  /* the menu has a channel of its own; the main one is the Manager's */
  const bus = createBus<Said>(), menuBus = createBus<Said>(), raw = menuBus.wire(), heard: Said[] = [];
  /* The page signs what it says with its window's label: the newest window's, unless a test says. */
  const label = () => (exe.calls.filter(c => c.cmd === 'window_open').at(-1)?.args as { spec: { label: string } } | undefined)?.spec.label ?? 'none';
  const SIGNED = new Set(['menu-up', 'menu-ready', 'menu-focused', 'menu-choose']);
  const page = { post: (m: Loose) => raw.post((SIGNED.has(m.k) && !('label' in m) ? { ...m, label: label() } : m) as Said), listen: raw.listen };
  const timers: { ms: number; f: () => void; fired?: boolean }[] = [];
  page.listen(m => heard.push(m));
  const manager = bus.wire(), main: Said[] = [];
  manager.listen(m => main.push(m));
  const hub = createHub({ shell: exe.shell, send: () => {}, seed: async () => SAMPLE, after: (ms, f) => { timers.push({ ms, f }); }, wire: bus.wire(), menuWire: menuBus.wire() });
  await hub.start();
  const done = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r)); await hub.settled; };
  const say = async (m: Loose) => { page.post(m); await done(); };
  const ask = (her = { x: 500, y: 400, w: 160, h: 160 }, at = { x: 580, y: 450 }, copy = SAMPLE_ID, t = 1000) => say({ k: 'menu-ask', copy, her, at, t });
  const shows = () => heard.filter((m): m is Extract<Said, { k: 'menu-show' }> => m.k === 'menu-show');
  const n = () => shows().at(-1)!.n;
  const labelOf = (a: unknown) => { const x = a as { label?: string; spec?: { label: string } }; return x.label ?? x.spec?.label; };
  const calls = (cmd?: string) => exe.calls.filter(c => c.cmd.startsWith('window_') && (!cmd || c.cmd === cmd) && isMenu(labelOf(c.args) ?? ''));
  const names = () => calls().map(c => c.cmd);
  /* the page loads, then draws each menu it's shown at this CSS size */
  const up = () => say({ k: 'menu-up' });
  const ready = (w = 180, h = 240) => say({ k: 'menu-ready', n: n(), w, h });
  const open = async () => { await ask(); await up(); await ready(); };
  /* the timers set for this long that haven't gone off, now gone off */
  const fire = async (ms: number) => { for (const t of timers.filter(x => x.ms === ms && !x.fired)) { t.fired = true; t.f(); } await done(); };
  /* the menu window there is: never more than one may be left */
  const win = () => {
    const all = [...exe.windows.keys()].filter(isMenu);
    assert.ok(all.length <= 1, `one menu window at most: ${all}`);
    return (all.length ? exe.windows.get(all[0]!) : undefined) as (typeof MENU & { hidden: boolean; x?: number; y?: number; w?: number; h?: number }) | undefined;
  };
  const copies = () => (main.filter(m => m.k === 'state').at(-1) as Extract<Said, { k: 'state' }> | undefined)?.state.buddies[0]?.copies;
  return { exe, hub, page, heard, main, manager, timers, done, say, ask, shows, n, calls, names, up, ready, open, fire, win, copies, label };
}
/* a page message, signed with the newest window's label if it doesn't name one */
type Loose = MenuToHub | { k: 'menu-up' } | { k: 'menu-ready'; n: number; w: number; h: number } | { k: 'menu-focused'; n: number; t: number } | { k: 'menu-choose'; n: number; cmd: Command };
const choose = (n: number, cmd: Command): Loose => ({ k: 'menu-choose', n, cmd });

test('a right-click opens the menu window hidden, and shows her menu beside her once it has drawn it', async () => {
  const s = await setup();
  assert.strictEqual(s.win(), undefined, 'no window before the first right-click');
  await s.ask();
  assert.deepStrictEqual(s.names(), ['window_open'], 'opened, nothing else yet');
  const spec = s.win()!;
  assert.deepStrictEqual([spec.kind, spec.page, spec.visible, spec.transparent, spec.decorations, spec.shadow, spec.alwaysOnTop, spec.skipTaskbar, spec.resizable], ['window', 'buddy-menu.html', false, true, false, false, true, true, false]);
  assert.strictEqual(s.win()!.hidden, true);
  assert.strictEqual(s.shows().length, 0, 'nothing to draw it in until the page is up');
  await s.up();
  const show = s.shows()[0]!;
  assert.deepStrictEqual([show.row.id, show.maker, show.max], [SAMPLE_ID, true, { w: 1920, h: 1040 }]);
  assert.deepStrictEqual(s.names(), ['window_open'], 'still hidden while it draws');
  await s.ready();
  assert.deepStrictEqual(s.names(), ['window_open', 'window_place', 'window_show', 'window_focus']);
  assert.deepStrictEqual([s.win()!.x, s.win()!.y, s.win()!.w, s.win()!.h], [660, 450, 180, 240]);
  assert.deepStrictEqual([s.win()!.hidden, s.exe.focused], [false, s.label()]);
  await s.say({ k: 'menu-focused', n: show.n, t: 1093 });
  assert.ok(s.exe.logs.some(l => /^menu \d+ focused 93 ms after the right-click, first open$/.test(l)), s.exe.logs.filter(l => l.startsWith('menu')).join('\n'));
});

test('the page coming up before the exe says the window is open still counts', async () => {
  const s = await setup();
  const release = s.exe.hold('window_open');
  await s.ask(); await s.up();
  release(); await s.done();
  assert.strictEqual(s.shows().length, 1);
});

test('the size it asks for is CSS pixels, so it grows with the scale of the monitor she\'s on', async () => {
  const s = await setup([monitor(0, 0), monitor(1, 1920, 1.5)]);
  await s.ask({ x: 2000, y: 300, w: 240, h: 240 }, { x: 2100, y: 320 });
  await s.up();
  assert.deepStrictEqual(s.shows()[0]!.max, { w: 1280, h: 693 }, 'the work area in CSS pixels, so the page can scroll a list too long for it');
  await s.ready(180, 240);
  assert.deepStrictEqual([s.win()!.x, s.win()!.y, s.win()!.w, s.win()!.h], [2240, 320, 270, 360]);
});

test('a menu taller than the work area is cut to it, and stays inside it', async () => {
  const s = await setup([monitor(0, 0, 3, 680)]);
  await s.ask({ x: 500, y: 300, w: 160, h: 160 }, { x: 580, y: 350 }); await s.up();
  await s.ready(188, 300);
  const w = s.win()!;
  assert.ok(w.y! >= 0 && w.y! + w.h! <= 680 && w.h === 680, JSON.stringify(w));
});

test('a second right-click while it opens opens no second window, and only the newest is shown', async () => {
  const s = await setup();
  await s.ask();
  await s.ask({ x: 1700, y: 100, w: 160, h: 160 }, { x: 1750, y: 150 });
  assert.deepStrictEqual(s.names(), ['window_open']);
  await s.up();
  assert.strictEqual(s.shows().length, 1, 'one menu drawn');
  await s.ready();
  assert.deepStrictEqual(s.names(), ['window_open', 'window_place', 'window_show', 'window_focus']);
  assert.deepStrictEqual([s.win()!.x, s.win()!.y], [1520, 150], 'to the left of the second, at the right edge');
});

test('it never shows before it has been drawn and placed, and an older showing\'s size is no answer', async () => {
  const s = await setup();
  await s.ask(); await s.up();
  await s.say({ k: 'menu-ready', n: s.n() - 1, w: 180, h: 240 });
  assert.deepStrictEqual(s.names(), ['window_open']);
  await s.ready();
  assert.deepStrictEqual(s.names(), ['window_open', 'window_place', 'window_show', 'window_focus']);
});

/* Presses and closes that race the menu's window */

test('a press while the window is still being made: once made, nobody wants it, so it\'s closed at once', async () => {
  const s = await setup();
  const release = s.exe.hold('window_open');
  await s.ask();
  await s.say({ k: 'menu-press' });
  assert.ok(s.heard.some(m => m.k === 'menu-hide'), 'heard at once, not after the window is made');
  release(); await s.done();
  await s.up();
  assert.deepStrictEqual(s.names(), ['window_open', 'window_close'], 'not left holding the keyboard, invisible');
  assert.strictEqual(s.win(), undefined);
  await s.open();
  assert.deepStrictEqual(s.names().slice(2), ['window_open', 'window_place', 'window_show', 'window_focus'], 'the next right-click starts clean');
});

test('a press after the window is made but before its page is up: closed too', async () => {
  const s = await setup();
  await s.ask();
  await s.say({ k: 'menu-press' });
  assert.deepStrictEqual(s.names(), ['window_open', 'window_close']);
});

test('a window that\'s made only after its time ran out is closed as soon as it is', async () => {
  const s = await setup();
  const release = s.exe.hold('window_open');
  await s.ask();
  await s.fire(UP_MS);
  assert.deepStrictEqual(s.names(), ['window_open', 'window_close'], 'owed a close the moment its open is given up on; there is nothing yet');
  release(); await s.done();
  assert.deepStrictEqual(s.names(), ['window_open', 'window_close', 'window_close'], 'and closed once it turns out to exist');
  assert.strictEqual(s.win(), undefined);
  assert.ok(s.exe.logs.some(l => /^menu: /.test(l)));
  await s.open();
  assert.strictEqual(s.win()!.hidden, false, 'and the next right-click works');
});

test('a page that never comes up: the window goes, and the next right-click tries again', async () => {
  const s = await setup();
  await s.ask();
  await s.fire(UP_MS);
  assert.deepStrictEqual(s.names(), ['window_open', 'window_close']);
  assert.ok(s.exe.logs.some(l => /menu: the page never came up/.test(l)));
  await s.open();
  assert.deepStrictEqual(s.names().slice(2), ['window_open', 'window_place', 'window_show', 'window_focus']);
});

test('a page that\'s up but never draws the menu: the window goes, and nothing shows', async () => {
  const s = await setup();
  await s.ask(); await s.up();
  await s.fire(DRAW_MS);
  assert.deepStrictEqual(s.names(), ['window_open', 'window_close']);
  await s.open();
  assert.strictEqual(s.calls('window_open').length, 2);
  assert.strictEqual(s.win()!.hidden, false);
});

test('a window or page that has gone since: the next showing goes unanswered, so it is closed and opened again', async () => {
  const s = await setup();
  await s.open();
  await s.say({ k: 'menu-closed', n: s.n(), why: 'esc' });
  s.exe.windows.delete(s.label());
  await s.ask();
  await s.ask();
  await s.fire(DRAW_MS);
  assert.strictEqual(s.calls('window_close').length, 1, 'the window it thought it had');
  await s.open();
  assert.strictEqual(s.calls('window_open').length, 2);
  assert.strictEqual(s.win()!.hidden, false);
});

test('a press while it\'s being placed: it never shows, and never takes the focus', async () => {
  const s = await setup();
  await s.ask(); await s.up();
  const release = s.exe.hold('window_place');
  s.page.post({ k: 'menu-ready', n: s.n(), w: 180, h: 240 }); await s.done();
  await s.say({ k: 'menu-press' });
  release(); await s.done();
  assert.deepStrictEqual(s.names(), ['window_open', 'window_place', 'window_close'], 'never shown, so it still holds the keyboard: closed');
});

test('a press while it\'s being shown: never focused, and closed, since it was never shown to anyone', async () => {
  const s = await setup();
  await s.ask(); await s.up();
  const release = s.exe.hold('window_show');
  s.page.post({ k: 'menu-ready', n: s.n(), w: 180, h: 240 }); await s.done();
  await s.say({ k: 'menu-press' });
  release(); await s.done();
  assert.deepStrictEqual(s.names(), ['window_open', 'window_place', 'window_show', 'window_close']);
});

test('a placing that fails: the window is closed, not left made and focused', async () => {
  const s = await setup();
  s.exe.failNext('window_place', 'placement failed');
  await s.open();
  assert.deepStrictEqual(s.names(), ['window_open', 'window_place', 'window_close']);
  assert.strictEqual(s.win(), undefined);
  await s.open();
  assert.strictEqual(s.win()!.hidden, false);
});

test('only the hub hides the window, in its turn: an old close can\'t hide the next menu', async () => {
  const s = await setup();
  await s.open();
  const release = s.exe.hold('window_hide');
  s.page.post({ k: 'menu-closed', n: s.n(), why: 'esc' }); await s.done();
  s.page.post({ k: 'menu-ask', copy: SAMPLE_ID, her: { x: 500, y: 400, w: 160, h: 160 }, at: { x: 580, y: 450 }, t: 0 }); await s.done();
  release(); await s.done();
  await s.ready();
  assert.deepStrictEqual(s.names().slice(-4), ['window_hide', 'window_place', 'window_show', 'window_focus']);
  assert.strictEqual(s.win()!.hidden, false);
});

test('a choice is done once, for the showing it was made in, and closes it', async () => {
  const s = await setup();
  await s.open();
  const n = s.n(), before = s.copies();
  await s.say(choose(n, { k: 'another', id: SAMPLE_ID }));
  await s.say(choose(n, { k: 'another', id: SAMPLE_ID }));
  assert.strictEqual(s.copies(), before! + 1, 'twice from one showing counts once');
  assert.strictEqual(s.win()!.hidden, true);
  await s.say(choose(n - 1, { k: 'another', id: SAMPLE_ID }));
  assert.strictEqual(s.copies(), before! + 1, 'an old showing\'s is refused');
  await s.open();
  await s.say({ k: 'menu-closed', n: s.n(), why: 'esc' });
  await s.say(choose(s.n(), { k: 'another', id: SAMPLE_ID }));
  assert.strictEqual(s.copies(), before! + 1, 'and one after it closed');
  await s.open();
  const old = s.n();
  await s.ask(); await s.ready();
  await s.say(choose(old, { k: 'another', id: SAMPLE_ID }));
  assert.strictEqual(s.copies(), before! + 1, 'and one from the menu before the one that\'s open');
  assert.strictEqual(s.win()!.hidden, false, 'which stays open');
});

test('a choice is only ever about her, and only what her menu offers', async () => {
  const s = await setup();
  await s.open();
  await s.say(choose(s.n(), { k: 'hide', on: true }));
  await s.say(choose(s.n(), { k: 'dismiss', id: 'someone-else' }));
  assert.strictEqual(s.copies(), 1);
  assert.ok(!s.exe.logs.some(l => /^manager hide/.test(l)));
  await s.say(choose(s.n(), { k: 'dismiss', id: SAMPLE_ID }));
  assert.strictEqual(s.copies(), 0);
});

test('Talks from her menu mutes her, and only her', async () => {
  const s = await setup();
  await s.open();
  await s.say(choose(s.n(), { k: 'talks', id: 'someone-else', on: false }));
  assert.ok(!s.exe.logs.some(l => /^manager talks/.test(l)));
  await s.say(choose(s.n(), { k: 'talks', id: SAMPLE_ID, on: false }));
  assert.ok(s.exe.logs.some(l => l === `manager talks ${SAMPLE_ID}`));
  assert.deepStrictEqual(JSON.parse(text(s.exe.files.get('settings.json')!)).quiet, [SAMPLE_ID]);
});

test('a right-click that arrives after Hide all is ignored', async () => {
  const s = await setup();
  s.exe.emit('tray', { id: 'hide' }); await s.done();
  await s.ask(); await s.up();
  assert.deepStrictEqual(s.names(), []);
  assert.deepStrictEqual(s.heard.filter(m => m.k !== 'menu-up'), [], 'not even begun');
});

test('buddies hidden or paused by any way at all, between the drawing and the showing: it never shows', async () => {
  const exe = createFakeExe({ monitors: [monitor(0, 0)] }), heard: Said[] = [];
  let quiet = false;
  const row = { id: 'ada', name: 'Ada', image: 'x.png', status: 'out' as const, copies: 1, can: [], rev: 1, talks: true };
  const menu = createBuddyMenu({ shell: exe.shell, post: m => heard.push(m), note: () => {}, after: () => {}, row: () => row, maker: () => true, monitors: () => [monitor(0, 0)], quiet: () => quiet, run: () => {} });
  const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r)); };
  menu.heard({ k: 'menu-ask', copy: 'ada', her: { x: 500, y: 400, w: 160, h: 160 }, at: { x: 580, y: 450 }, t: 0 }); await flush();
  const opened = (exe.calls.find(c => c.cmd === 'window_open')!.args as { spec: { label: string } }).spec.label;
  menu.heard({ k: 'menu-up', label: opened }); await flush();
  quiet = true;
  menu.heard({ k: 'menu-ready', n: (heard.find(m => m.k === 'menu-show') as Extract<Said, { k: 'menu-show' }>).n, label: opened, w: 180, h: 240 }); await flush();
  assert.ok(!exe.calls.some(c => c.cmd === 'window_show'));
});

test('Hide all, or Pause, while it opens: it never shows', async () => {
  for (const id of ['hide', 'pause']) {
    const s = await setup();
    await s.ask(); await s.up();
    s.exe.emit('tray', { id }); await s.done();
    await s.ready();
    assert.strictEqual(s.calls('window_show').length, 0, id);
  }
});

test('hiding buddies closes it', async () => {
  const s = await setup();
  await s.open();
  s.exe.emit('tray', { id: 'hide' }); await s.done();
  assert.strictEqual(s.win()!.hidden, true);
});

/* and the rest of what it does */

test('any press on a buddy closes it, and the page hears so', async () => {
  const s = await setup();
  await s.open();
  const n = s.n();
  await s.say({ k: 'menu-press' });
  assert.strictEqual(s.names().at(-1), 'window_hide');
  assert.strictEqual(s.win()!.hidden, true);
  assert.ok(s.heard.some(m => m.k === 'menu-hide' && m.n === n));
  await s.say({ k: 'menu-press' });
  assert.strictEqual(s.calls('window_hide').length, 1, 'once');
  assert.strictEqual(s.calls('window_close').length, 0, 'kept, hidden, for the next one');
});

test('right-clicking another buddy moves it to her: closed, then drawn, placed and shown beside her', async () => {
  const s = await setup();
  await s.open();
  const before = s.names().length;
  await s.ask({ x: 1700, y: 600, w: 160, h: 160 }, { x: 1720, y: 640 });
  assert.deepStrictEqual(s.names().slice(before), ['window_hide'], 'the old one goes first, so it never shows at her with the old buddy\'s menu');
  assert.strictEqual(s.shows().length, 2);
  await s.ready();
  assert.deepStrictEqual(s.names().slice(before), ['window_hide', 'window_place', 'window_show', 'window_focus']);
  assert.deepStrictEqual([s.win()!.x, s.win()!.y], [1520, 640]);
  assert.strictEqual(s.calls('window_open').length, 1, 'the same window');
  await s.say({ k: 'menu-focused', n: s.n(), t: 1040 });
  assert.ok(s.exe.logs.some(l => /^menu \d+ focused 40 ms after the right-click$/.test(l)), 'not the first open');
});

test('the page asking to close ends that showing: the hub hides it, and an old showing\'s close ends nothing', async () => {
  const s = await setup();
  await s.open();
  const first = s.n();
  await s.say({ k: 'menu-closed', n: first, why: 'esc' });
  assert.deepStrictEqual([s.win()!.hidden, s.calls('window_hide').length], [true, 1]);
  await s.ask(); await s.ready();
  await s.say({ k: 'menu-closed', n: first, why: 'blur' });
  assert.strictEqual(s.win()!.hidden, false);
});

test('a second size for the same showing places it again, as when Delete asks first', async () => {
  const s = await setup();
  await s.open();
  await s.ready(250, 140);
  assert.deepStrictEqual(s.names(), ['window_open', 'window_place', 'window_show', 'window_focus', 'window_place']);
  assert.deepStrictEqual([s.win()!.w, s.win()!.h], [250, 140]);
});

test('any copy of her is her, and someone not in the library gets no menu', async () => {
  const s = await setup();
  await s.ask(undefined, undefined, 'nobody');
  assert.deepStrictEqual(s.names(), []);
  await s.ask(undefined, undefined, `${SAMPLE_ID}~3`);
  await s.up();
  assert.strictEqual(s.shows()[0]!.row.id, SAMPLE_ID);
});

test('a window still open from before is asked whether its page is up, not opened twice', async () => {
  const s = await setup();
  const opening = s.exe.hold('window_open');
  await s.ask();
  s.exe.windows.set(s.label(), { ...MENU, label: s.label(), hidden: true });
  opening(); await s.done();
  assert.ok(s.heard.some(m => m.k === 'menu-ping' && m.label === s.label()));
  await s.up(); await s.ready();
  assert.strictEqual(s.win()!.hidden, false);
});

test('a window that wouldn\'t open is tried again on the next right-click', async () => {
  const s = await setup();
  s.exe.failNext('window_open', 'no webview');
  await s.ask();
  assert.strictEqual(s.win(), undefined);
  await s.open();
  assert.deepStrictEqual(s.names(), ['window_open', 'window_open', 'window_place', 'window_show', 'window_focus']);
});

test('the menu talks on a channel of its own, and nothing of it goes on the Manager\'s', async () => {
  const s = await setup();
  await s.open();
  await s.say(choose(s.n(), { k: 'dismiss', id: SAMPLE_ID }));
  await s.say({ k: 'menu-press' });
  assert.deepStrictEqual(s.main.filter(m => m.k.startsWith('menu-')), []);
  assert.ok(!s.heard.some(m => m.k === 'state' || m.k === 'done'), 'and none of the Manager\'s on the menu\'s');
});

/* Late and failing steps on the window */

test('an open given up on, then a right-click, then a press while the close runs: nothing opens again', async () => {
  const s = await setup();
  const made = s.exe.hold('window_open');
  await s.ask();
  await s.fire(UP_MS);
  /* the first open was given up on, so the newer right-click opens a window of its own */
  await s.ask();
  const closing = s.exe.hold('window_close');
  made(); await s.done();
  await s.say({ k: 'menu-press' });
  closing(); await s.done();
  assert.strictEqual(s.calls('window_open').length, 2, 'no window made after the press');
  assert.strictEqual(s.win(), undefined, 'both closed: the late one, and the newer one nobody wanted');
});

test('a close that fails stays owed: tried again later until the window has gone', async () => {
  const s = await setup();
  await s.ask();
  s.exe.failNext('window_close', 'busy');
  await s.say({ k: 'menu-press' });
  assert.ok(s.win(), 'still there after the failed close');
  assert.ok(s.timers.some(t => t.ms === RETRY_MS && !t.fired), 'a retry is waiting');
  await s.fire(RETRY_MS);
  assert.deepStrictEqual(s.names(), ['window_open', 'window_close', 'window_close']);
  assert.strictEqual(s.win(), undefined);
});

test('a close that fails is tried again at the next event too, before anything else', async () => {
  const s = await setup();
  await s.ask();
  s.exe.failNext('window_close', 'busy');
  await s.say({ k: 'menu-press' });
  await s.open();
  assert.deepStrictEqual(s.names(), ['window_open', 'window_close', 'window_close', 'window_open', 'window_place', 'window_show', 'window_focus']);
});

test('a window found already open, but only after its time ran out, is closed', async () => {
  const s = await setup();
  const answer = s.exe.hold('window_open');
  await s.ask();
  s.exe.windows.set(s.label(), { ...MENU, label: s.label(), hidden: true });
  await s.fire(UP_MS);
  answer(); await s.done();
  assert.strictEqual(s.win(), undefined);
  assert.strictEqual(s.calls('window_open').length, 1);
});

test('an open that never answers leaves the newer right-click to go on, not waiting behind it', async () => {
  const s = await setup();
  s.exe.hold('window_open'); /* never let go */
  await s.ask();
  await s.fire(UP_MS);
  await s.ask();
  assert.strictEqual(s.calls('window_open').length, 2, 'opened again for the newer one');
  await s.up(); await s.ready();
  assert.strictEqual(s.win()!.hidden, false);
});

test('a step that fails on a window shown before: it\'s closed all the same, and the next right-click opens one afresh', async () => {
  const s = await setup();
  await s.open();
  await s.say({ k: 'menu-press' });
  s.exe.failNext('window_place', 'placement failed');
  await s.ask(); await s.ready();
  assert.deepStrictEqual(s.names().slice(-2), ['window_place', 'window_close']);
  assert.strictEqual(s.win(), undefined);
  await s.open();
  assert.strictEqual(s.calls('window_open').length, 2);
  assert.strictEqual(s.win()!.hidden, false);
});

test('a step that never ends: past its time the showing is given up, and when it does end the window goes', async () => {
  const s = await setup();
  await s.ask(); await s.up();
  const shown = s.exe.hold('window_show');
  await s.ready();
  await s.fire(STEP_MS);
  assert.ok(s.heard.some(m => m.k === 'menu-hide'), 'given up');
  shown(); await s.done();
  assert.strictEqual(s.calls('window_focus').length, 0, 'never focused');
  assert.strictEqual(s.win(), undefined, 'closed once the step ended');
});

test('a right-click behind a step that never ends is given up in time too', async () => {
  const s = await setup();
  const made = s.exe.hold('window_open');
  await s.ask();
  await s.fire(UP_MS);
  await s.ask();
  const n = s.heard.filter(m => m.k === 'menu-hide').length;
  await s.fire(WANT_MS);
  assert.strictEqual(s.heard.filter(m => m.k === 'menu-hide').length, n + 1, 'the newer one dropped');
  made(); await s.done();
  assert.strictEqual(s.win(), undefined, 'and the window made for nobody, closed');
});

/* Steps that never answer, and a page that died */

test('a step that never answers is given up at its deadline, so the owed close still goes out', async () => {
  const s = await setup();
  await s.ask(); await s.up();
  s.exe.hold('window_place'); /* never let go */
  await s.ready();
  await s.say({ k: 'menu-press' });
  await s.fire(STEP_MS);
  assert.deepStrictEqual(s.names(), ['window_open', 'window_place', 'window_close']);
  assert.strictEqual(s.win(), undefined);
  assert.ok(s.exe.logs.some(l => /^menu: gave up on place/.test(l)), s.exe.logs.filter(l => l.startsWith('menu')).join('\n'));
  await s.open();
  await s.say({ k: 'menu-focused', n: s.n(), t: 0 });
  assert.strictEqual(s.win()!.hidden, false, 'and the next right-click works, the old call still unanswered');
});

test('a close that never answers is given up at its deadline and tried again, still owed', async () => {
  const s = await setup();
  await s.ask();
  s.exe.hold('window_close'); /* only the first */
  await s.say({ k: 'menu-press' });
  await s.fire(STEP_MS);
  assert.ok(s.win(), 'not closed yet');
  await s.fire(RETRY_MS);
  assert.deepStrictEqual(s.names(), ['window_open', 'window_close', 'window_close']);
  assert.strictEqual(s.win(), undefined);
});

test('shown means the page says it has the keyboard: one that never says so is closed', async () => {
  const s = await setup();
  await s.open();
  const n = s.n();
  assert.ok(s.heard.some(m => m.k === 'menu-check' && m.n === n && m.label === s.label()), 'the page is asked');
  await s.fire(FOCUS_MS);
  assert.strictEqual(s.names().at(-1), 'window_close');
  assert.strictEqual(s.win(), undefined);
  assert.ok(s.heard.some(m => m.k === 'menu-hide' && m.n === n));
});

test('a page that answered, then died while hidden: its late answer gets the window shown, but never counted, so it goes', async () => {
  const s = await setup();
  await s.open();
  await s.say({ k: 'menu-focused', n: s.n(), t: 0 });
  await s.say({ k: 'menu-closed', n: s.n(), why: 'esc' });
  await s.ask();
  await s.ready(); /* sent just before it died */
  await s.fire(FOCUS_MS);
  assert.strictEqual(s.win(), undefined, 'the dead page\'s window closed, and the keyboard with it');
  await s.open();
  await s.say({ k: 'menu-focused', n: s.n(), t: 0 });
  await s.fire(FOCUS_MS);
  assert.strictEqual(s.win()!.hidden, false, 'a fresh window for the next right-click, kept once its page says so');
});

test('a page that says it has the keyboard before its window is even shown: that doesn\'t count', async () => {
  const s = await setup();
  await s.ask(); await s.up();
  const showing = s.exe.hold('window_show');
  s.page.post({ k: 'menu-ready', n: s.n(), w: 180, h: 240 }); await s.done();
  await s.say({ k: 'menu-focused', n: s.n(), t: 0 });
  showing(); await s.done();
  await s.fire(FOCUS_MS);
  assert.strictEqual(s.win(), undefined, 'never said so once shown: closed');
});

test('a hide that never answers: given up on, its window closed, and never tried again', async () => {
  const s = await setup();
  await s.open();
  await s.say({ k: 'menu-focused', n: s.n(), t: 0 });
  s.exe.hold('window_hide'); /* never let go */
  await s.say({ k: 'menu-press' });
  await s.fire(STEP_MS);
  await s.fire(STEP_MS);
  assert.deepStrictEqual(s.names().slice(-2), ['window_hide', 'window_close']);
  assert.strictEqual(s.calls('window_hide').length, 1, 'one hide, then the close');
  assert.strictEqual(s.win(), undefined);
});

test('a late answer about an old window never touches the one there is now', async () => {
  const s = await setup();
  await s.open();
  await s.say({ k: 'menu-focused', n: s.n(), t: 0 });
  const old = s.label(), hiding = s.exe.hold('window_hide');
  await s.say({ k: 'menu-press' });
  await s.fire(STEP_MS);
  await s.open();
  const n = s.n();
  assert.notStrictEqual(s.label(), old, 'a window of its own');
  await s.say({ k: 'menu-focused', n, t: 0 });
  hiding(); await s.done();
  assert.ok(!s.heard.some(m => m.k === 'menu-hide' && m.n === n), 'the new menu is still wanted');
  assert.strictEqual(s.win()!.hidden, false);
});

test('a show given up on, answering once another window waits hidden: the new one stays hidden', async () => {
  const s = await setup();
  await s.ask(); await s.up();
  const showing = s.exe.hold('window_show');
  await s.ready();
  await s.fire(STEP_MS);
  await s.ask(); await s.up();
  showing(); await s.done();
  assert.strictEqual(s.win()!.hidden, true, 'the old show was for the old window');
});

test('a close done, but answered only after a retry found no window and a new menu opened: the new one is left alone', async () => {
  const s = await setup();
  await s.ask();
  const answered = s.exe.holdAnswer('window_close');
  await s.say({ k: 'menu-press' });
  await s.fire(STEP_MS);
  await s.fire(RETRY_MS);
  assert.deepStrictEqual(s.names(), ['window_open', 'window_close', 'window_close'], 'the retry found nothing to close');
  await s.open();
  const n = s.n();
  await s.say({ k: 'menu-focused', n, t: 0 });
  answered(); await s.done();
  assert.ok(!s.heard.some(m => m.k === 'menu-hide' && m.n === n), 'the new menu is still wanted');
  assert.strictEqual(s.win()!.hidden, false);
  assert.strictEqual(s.calls('window_close').length, 2, 'and nothing more to close');
});

test('a size or a focus from any window but the current one counts for nothing', async () => {
  const s = await setup();
  await s.ask(); await s.up();
  await s.say({ k: 'menu-ready', n: s.n(), label: 'buddy-menu-1', w: 180, h: 240 });
  assert.deepStrictEqual(s.names(), ['window_open'], 'not drawn here');
  await s.ready();
  await s.say({ k: 'menu-focused', n: s.n(), label: 'buddy-menu-1', t: 0 });
  await s.fire(FOCUS_MS);
  assert.strictEqual(s.win(), undefined, 'and its page never said so itself');
});
