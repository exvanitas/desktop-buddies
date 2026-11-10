/* The user's windows on their way to the world: the real hub and client on the fake exe, with a
   recording world. What the world does with them is in host.test.ts. */
import assert from 'node:assert';
import fs from 'node:fs';
import { read, write } from '@buddies/buddy-file';
import { test } from 'vitest';
import { createHost, type Message, type Port } from '../src/host';
import { createHub, type HubIO } from '../src/hub-core';
import { createLibrary } from '../src/library';
import type { Said } from '../src/manager-api';
import { createManagerClient } from '../src/manager-client';
import { text, type Monitor, type WindowEntry } from '../src/shell';
import { createFakeExe, type FakeExe } from '../src/shell-fake';
import type { WindowSource } from '../src/window-source';
import { createBus } from '../src/wire';

const SAMPLE = fs.readFileSync(new URL('../../../packages/test-support/fixtures/sample.json', import.meta.url), 'utf8');
const SAMPLE_ID = read(SAMPLE).character!;
const monitor: Monitor = { i: 0, name: 'A', primary: true, scale: 1, x: 0, y: 0, w: 1920, h: 1040, full: { x: 0, y: 0, w: 1920, h: 1080 } };
const win = (id: number, x = 300, more: Partial<WindowEntry> = {}): WindowEntry => ({ id, x, y: 400, w: 800, h: 500, z: 0, max: false, topmost: false, tool: false, layered: false, class: 'Secret_Class', exe: 'Secret.exe', ...more });

async function setup(prepare: (e: FakeExe) => void | Promise<void> = () => {}, more: Partial<HubIO> = {}, args: string[] = []) {
  const exe = createFakeExe({ monitors: [monitor], args: [...args, '--no-manager'] }), /* a quiet start: these count window failures */ sent: Message[] = [], timers: (() => void)[] = [], bus = createBus<Said>(), posted: Said[] = [];
  await prepare(exe);
  const hub = createHub({ shell: exe.shell, send: m => sent.push(m), seed: async () => SAMPLE, after: (_, f) => { timers.push(f); }, wire: bus.wire(), ...more });
  const page = bus.wire();
  page.listen(m => posted.push(m));
  await hub.start();
  const done = async () => { for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r)); await hub.settled; } };
  await done();
  const client = createManagerClient({ wire: bus.wire(), session: 'w', after: () => () => {}, shimeji: async () => null, closeWindow: async () => {} });
  await done();
  const feeds = () => sent.flatMap(m => m.k === 'windows' ? [m] : []);
  const last = () => feeds().pop();
  const watches = () => exe.calls.filter(c => c.cmd === 'windows_watch').map(c => (c.args as { on: boolean }).on);
  const settings = () => JSON.parse(text(exe.files.get('settings.json')!)) as Record<string, unknown>;
  const retry = async () => { const f = timers.shift(); assert.ok(f, 'a retry is waiting'); f(); await done(); };
  return { exe, hub, sent, client, done, feeds, last, watches, settings, retry, posted, timers, state: () => client.state! };
}
const stored = (body: object) => (e: FakeExe) => e.shell.dataWrite('settings.json', JSON.stringify(body));

test('a buddy out on a normal run: the tracker is on, and what it sees reaches the world', async () => {
  const s = await setup(e => { e.setWindows([win(1)]); });
  assert.deepStrictEqual(s.watches(), [true]);
  assert.deepStrictEqual(s.last(), { k: 'windows', list: [win(1)], exclude: [] });
  s.exe.setWindows([win(1, 500)]);
  assert.deepStrictEqual(s.last()!.list, [win(1, 500)], 'straight away, with nothing awaited');
});

test('windows go past a queue that is busy', async () => {
  const s = await setup();
  const real = s.exe.shell.dataWrite;
  let free = () => {};
  s.exe.shell.dataWrite = (p, b) => new Promise<void>(go => { free = () => { void real(p, b).then(go); }; });
  const busy = s.client.setExcluded('held.exe', true);
  await new Promise(r => setTimeout(r, 5));
  s.exe.setWindows([win(1, 100)]);
  s.exe.setWindows([win(1, 200)]);
  assert.deepStrictEqual(s.feeds().slice(-2).map(m => m.list[0]!.x), [100, 200]);
  free();
  await busy;
});

test('no buddy out: no tracker, until one comes, and it stops when the last one goes', async () => {
  const s = await setup(stored({ out: [] }));
  assert.strictEqual(s.exe.watching, false);
  await s.client.call(SAMPLE_ID);
  assert.strictEqual(s.exe.watching, true);
  await s.client.dismiss(SAMPLE_ID);
  assert.strictEqual(s.exe.watching, false);
});

test('no monitors yet: no world, so no tracker, until there is one', async () => {
  const s = await setup(e => { e.monitors = []; });
  assert.strictEqual(s.exe.watching, false);
  s.exe.emit('monitors', [monitor]); await s.done();
  assert.strictEqual(s.exe.watching, true);
});

test('hidden stops the tracker, and showing starts it', async () => {
  const s = await setup();
  await s.client.setHidden(true);
  assert.strictEqual(s.exe.watching, false);
  await s.client.setHidden(false);
  assert.strictEqual(s.exe.watching, true);
});

test('paused stops the tracker, and carrying on starts it', async () => {
  const s = await setup();
  await s.client.setPaused(true);
  assert.strictEqual(s.exe.watching, false);
  await s.client.setPaused(false);
  assert.strictEqual(s.exe.watching, true);
});

test('away stops the tracker, and coming back starts it, with no command to carry it', async () => {
  const s = await setup();
  s.exe.emit('system', { userState: 'away', onBattery: false, saver: false }); await s.done();
  assert.strictEqual(s.exe.watching, false);
  s.exe.emit('system', { userState: 'normal', onBattery: false, saver: false }); await s.done();
  assert.strictEqual(s.exe.watching, true);
});

test('hidden and paused together: it takes both ending to start again', async () => {
  const s = await setup();
  await s.client.setHidden(true); await s.client.setPaused(true);
  await s.client.setHidden(false);
  assert.strictEqual(s.exe.watching, false);
  await s.client.setPaused(false);
  assert.strictEqual(s.exe.watching, true);
});

test("pausing leaves the world's windows where they were, so nobody falls on waking", async () => {
  const s = await setup(e => { e.setWindows([win(1)]); });
  await s.client.setPaused(true);
  assert.deepStrictEqual(s.last()!.list, [win(1)]);
});

test('a new watch hears the desk as it is now', async () => {
  const s = await setup(e => { e.setWindows([win(1)]); });
  await s.client.setPaused(true);
  s.exe.setWindows([win(1, 900)]);
  assert.strictEqual(s.last()!.list[0]!.x, 300, 'nothing while it was off');
  await s.client.setPaused(false); await s.done();
  assert.strictEqual(s.last()!.list[0]!.x, 900);
});

test('a tracker that fails to start is tried again', async () => {
  const s = await setup(e => { e.failNext('windows_watch', 'no'); });
  assert.strictEqual(s.exe.watching, false);
  await s.retry();
  assert.strictEqual(s.exe.watching, true);
});

test('a tracker that fails to stop is tried again', async () => {
  const s = await setup();
  s.exe.failNext('windows_watch', 'no');
  await s.client.setHidden(true);
  assert.strictEqual(s.exe.watching, true);
  await s.retry();
  assert.strictEqual(s.exe.watching, false);
});

test('Walk on windows is on by default, and the file stays as it was', async () => {
  const s = await setup();
  assert.strictEqual(s.state().walk, true);
  await s.client.dismiss(SAMPLE_ID);
  assert.deepStrictEqual(s.settings(), { out: [] });
});

test('Walk off: the tracker stops, the world loses its windows, and the buddies stay out', async () => {
  const s = await setup(e => { e.setWindows([win(1)]); });
  await s.client.setWalk(false);
  assert.strictEqual(s.exe.watching, false);
  assert.deepStrictEqual(s.last()!.list, []);
  assert.strictEqual(s.state().walk, false);
  assert.strictEqual(s.settings().walk, false);
  assert.deepStrictEqual(s.settings().out, [SAMPLE_ID]);
});

test('Walk off: a snapshot already on its way changes nothing', async () => {
  const s = await setup(e => { e.setWindows([win(1)]); });
  await s.client.setWalk(false);
  const before = s.feeds().length;
  s.exe.emit('windows', { seq: 99, foreground: 0, list: [win(2)] });
  assert.strictEqual(s.feeds().length, before);
});

test('Walk back on: the tracker starts and the world gets the desk', async () => {
  const s = await setup(e => { e.setWindows([win(1)]); });
  await s.client.setWalk(false);
  await s.client.setWalk(true); await s.done();
  assert.strictEqual(s.exe.watching, true);
  assert.deepStrictEqual(s.last()!.list, [win(1)]);
  assert.ok(!('walk' in s.settings()));
});

test('Walk off is remembered: the next run never starts the tracker', async () => {
  const s = await setup(stored({ out: [SAMPLE_ID], walk: false }));
  assert.strictEqual(s.state().walk, false);
  assert.ok(!s.watches().includes(true));
});

test('the exclude list reaches the world at once, with the desk it has', async () => {
  const s = await setup(e => { e.setWindows([win(1)]); });
  await s.client.setExcluded('Secret.exe', true);
  assert.deepStrictEqual(s.last(), { k: 'windows', list: [win(1)], exclude: ['secret.exe'] });
  assert.deepStrictEqual(s.state().exclude, ['secret.exe']);
  await s.client.setExcluded('SECRET.EXE', false);
  assert.deepStrictEqual(s.last()!.exclude, []);
});

test('the exclude list is kept with the settings, sorted, and once each', async () => {
  const s = await setup();
  await s.client.setExcluded('zed.exe', true);
  await s.client.setExcluded('alpha.exe', true);
  await s.client.setExcluded('Zed.exe', true);
  await s.client.setExcluded('beta.exe', true);
  assert.deepStrictEqual(s.settings(), { out: [SAMPLE_ID], exclude: ['alpha.exe', 'beta.exe', 'zed.exe'] });
  for (const app of ['zed.exe', 'alpha.exe', 'beta.exe']) await s.client.setExcluded(app, false);
  assert.ok(!('exclude' in s.settings()));
});

test('the next run brings the exclude list back, and sends it with the first snapshot', async () => {
  const s = await setup(async e => { await stored({ out: [SAMPLE_ID], exclude: ['discord.exe'] })(e); e.setWindows([win(1)]); });
  assert.deepStrictEqual(s.state().exclude, ['discord.exe']);
  assert.deepStrictEqual(s.last()!.exclude, ['discord.exe']);
});

test('a bad exclude list costs that list, not who is out', async () => {
  for (const exclude of ['oops', 7, null, { a: 1 }]) {
    const s = await setup(stored({ out: [SAMPLE_ID], exclude }));
    assert.deepStrictEqual(s.state().exclude, []);
    assert.deepStrictEqual(s.watches(), [true], 'she is out, so the tracker runs');
  }
  const s = await setup(stored({ out: [SAMPLE_ID], exclude: ['Good.exe', 3] }));
  assert.deepStrictEqual(s.state().exclude, ['good.exe']);
});

test("a change that can't be saved is kept and tried again", async () => {
  const s = await setup();
  s.exe.failNext('data_write', 'disk');
  await s.client.setWalk(false);
  await s.retry();
  assert.strictEqual(s.settings().walk, false);
});

test("before who's out is restored, neither setting can be changed, so nothing is saved over the list", async () => {
  const unstick: (() => void)[] = [];
  const s = await setup(async e => { await stored({ out: [SAMPLE_ID] })(e); unstick.push(e.failUntil('data_list', 'busy', () => true)); });
  for (const a of [await s.client.setWalk(false), await s.client.setExcluded('a.exe', true)]) assert.strictEqual(a.ok, false);
  assert.deepStrictEqual(s.settings(), { out: [SAMPLE_ID] });
  assert.strictEqual(s.state().walk, true);
  unstick[0]!();
});

test('the tracker waits for the settings, which might say no', async () => {
  const unstick: (() => void)[] = [];
  const s = await setup(async e => { await stored({ out: [SAMPLE_ID], walk: false })(e); unstick.push(e.failUntil('data_list', 'busy', () => true)); });
  assert.ok(!s.watches().includes(true));
  unstick[0]!(); await s.retry();
  assert.ok(!s.watches().includes(true));
});

test('buddies out with the settings still unread: the tracker waits, because they might say no', async () => {
  const s = await setup(async e => {
    await createLibrary(e.shell, () => {}).add(SAMPLE);
    await stored({ walk: false })(e);
    e.failUntil('data_read', 'busy', (a: { path: string }) => a.path === 'settings.json');
  }, {}, ['--buddies', '2']);
  assert.strictEqual(s.sent.flatMap(m => m.k === 'start' ? m.pets : []).length + s.sent.flatMap(m => m.k === 'pets' ? m.pets : []).length > 0, true, 'they are out');
  assert.ok(!s.watches().includes(true));
});

test('the apps on offer follow the latest snapshot, and the Manager only hears when they change', async () => {
  const s = await setup(e => { e.setWindows([win(1)]); });
  assert.deepStrictEqual(s.state().apps, ['secret.exe']);
  s.posted.length = 0;
  for (let x = 0; x < 50; x++) s.exe.setWindows([win(1, x)]);
  await s.done();
  assert.strictEqual(s.posted.filter(m => m.k === 'state').length, 0, 'a drag says nothing to the Manager');
  s.exe.setWindows([win(1), win(2, 300, { exe: 'other.exe' })]); await s.done();
  assert.deepStrictEqual(s.state().apps, ['other.exe', 'secret.exe']);
});

test('no exe or class name ever reaches the log', async () => {
  const s = await setup(e => { e.setWindows([win(1)]); });
  s.exe.setWindows([win(1, 500)]);
  await s.client.setExcluded('Secret.exe', true);
  await s.client.setExcluded('Secret.exe', false);
  await s.client.setWalk(false);
  await s.client.setWalk(true);
  assert.ok(s.exe.logs.some(l => /windows watch/.test(l)), 'it does log');
  assert.ok(s.exe.logs.some(l => /manager exclude/.test(l)), 'that the command came');
  assert.deepStrictEqual(s.exe.logs.filter(l => /secret/i.test(l)), []);
});

test("a tracker that isn't the exe's plugs in, and the exe's goes unused", async () => {
  const heard: boolean[] = [];
  let say: Parameters<WindowSource['listen']>[0] = () => {};
  const mac: WindowSource = { watch: async on => { heard.push(on); }, listen: async f => { say = f; } };
  const s = await setup(() => {}, { windows: mac });
  assert.deepStrictEqual(heard, [true]);
  assert.deepStrictEqual(s.watches(), []);
  say({ seq: 1, list: [win(7)] });
  assert.deepStrictEqual(s.last()!.list, [win(7)]);
});

/* Finding 1: what the tracker is doing isn't known until it's told */

test('a tracker left running is told to stop, by the first reconcile', async () => {
  const s = await setup(async e => { await stored({ out: [SAMPLE_ID], walk: false })(e); e.watching = true; });
  assert.deepStrictEqual(s.watches(), [false]);
  assert.strictEqual(s.exe.watching, false);
});

test('nobody out: off is said out loud too, once', async () => {
  const s = await setup(async e => { await stored({ out: [] })(e); e.watching = true; });
  assert.deepStrictEqual(s.watches(), [false]);
});

test('a first stop that fails is tried again', async () => {
  const s = await setup(async e => { await stored({ out: [SAMPLE_ID], walk: false })(e); e.watching = true; e.failNext('windows_watch', 'no'); });
  assert.strictEqual(s.exe.watching, true);
  await s.retry();
  assert.strictEqual(s.exe.watching, false);
});

/* Finding 2: everything that can change who's out */

test('a buddy called on import who only reads back on the second try still starts the tracker', async () => {
  const s = await setup(stored({ out: [], noSeed: true }));
  assert.strictEqual(s.exe.watching, false);
  const pip = write({ character: 'pip', name: 'Pip', base: { src: 'data:image/png;base64,iVBORw0KGgo=', bb: { x0: 0, y0: 0, x1: 1, y1: 1 } }, poses: {} });
  s.exe.failNext('data_read', 'busy', (a: { path: string }) => a.path.endsWith('/buddy.json'));
  await s.client.importFiles([{ name: 'pip.buddy', path: 'pip.buddy', size: pip.length, text: async () => pip, url: async () => '' }], { call: true });
  await s.done();
  assert.strictEqual(s.state().buddies[0]!.status, 'out');
  assert.strictEqual(s.exe.watching, true);
  assert.strictEqual(s.timers.length, 0, 'and nothing was left to a retry');
});

/* Finding 3: if we can't see windows, there are no windows */

test('a failed start tells the world there are no windows', async () => {
  const s = await setup(e => { e.setWindows([win(1)]); });
  await s.client.setPaused(true);
  s.exe.failNext('windows_watch', 'no');
  await s.client.setPaused(false);
  assert.strictEqual(s.exe.watching, false);
  assert.deepStrictEqual(s.last()!.list, []);
  await s.retry();
  assert.deepStrictEqual(s.last()!.list, [win(1)], 'and a fresh snapshot brings them back');
});

test('a snapshot that came in after the stop is no help: a failed start still empties the world', async () => {
  const s = await setup(e => { e.setWindows([win(1)]); });
  await s.client.setPaused(true);
  s.exe.emit('windows', { seq: 50, foreground: 0, list: [win(1, 500)] });
  s.exe.failNext('windows_watch', 'no');
  await s.client.setPaused(false);
  assert.deepStrictEqual(s.last()!.list, []);
});

test('a stop that fails takes nothing from the world', async () => {
  const s = await setup(e => { e.setWindows([win(1)]); });
  s.exe.failNext('windows_watch', 'no');
  await s.client.setPaused(true);
  assert.deepStrictEqual(s.last()!.list, [win(1)]);
});

test('Walk back on publishes nothing old: it waits for a fresh snapshot', async () => {
  const s = await setup(e => { e.setWindows([win(1, 300)]); });
  await s.client.setWalk(false);
  s.exe.setWindows([]);
  const stop = s.exe.failUntil('windows_watch', 'no', () => true);
  const before = s.feeds().length;
  await s.client.setWalk(true);
  assert.ok(s.feeds().slice(before).every(m => !m.list.length), 'nothing from before');
  stop();
});

test('Walk off with the tracker refusing to stop, then on: it restarts, so a first snapshot comes', async () => {
  const s = await setup(e => { e.setWindows([win(1)]); });
  s.exe.failNext('windows_watch', 'no');
  await s.client.setWalk(false);
  assert.strictEqual(s.exe.watching, true);
  s.exe.setWindows([win(1, 900)]);
  const before = s.feeds().length;
  await s.client.setWalk(true); await s.done();
  assert.ok(s.feeds().slice(before).every(m => m.list.every(e => e.x === 900)), 'nothing from before the switch');
  assert.deepStrictEqual(s.last()!.list, [win(1, 900)]);
});

test('the exclude list changing just after a restart, before the first snapshot, takes nothing away', async () => {
  let say: Parameters<WindowSource['listen']>[0] = () => {};
  const mac: WindowSource = { watch: async () => {}, listen: async f => { say = f; } };
  const s = await setup(() => {}, { windows: mac });
  say({ seq: 1, list: [win(1)] });
  await s.client.setPaused(true);
  await s.client.setPaused(false);
  await s.client.setExcluded('other.exe', true);
  assert.deepStrictEqual(s.last(), { k: 'windows', list: [win(1)], exclude: [] });
  say({ seq: 2, list: [win(1)] });
  assert.deepStrictEqual(s.last()!.exclude, ['other.exe']);
});

test('Walk asked for twice takes nothing away', async () => {
  const s = await setup(e => { e.setWindows([win(1)]); });
  await s.client.setWalk(true); await s.done();
  assert.deepStrictEqual(s.last()!.list, [win(1)]);
  assert.deepStrictEqual(s.watches(), [true]);
});

test('the exclude list changing during a pause leaves the world its windows, and goes with the next snapshot', async () => {
  const s = await setup(e => { e.setWindows([win(1)]); });
  await s.client.setPaused(true);
  await s.client.setExcluded('other.exe', true);
  assert.deepStrictEqual(s.last(), { k: 'windows', list: [win(1)], exclude: [] });
  await s.client.setPaused(false); await s.done();
  assert.deepStrictEqual(s.last(), { k: 'windows', list: [win(1)], exclude: ['other.exe'] });
});

/* The hub and the world together, for what she does about it. */
async function riding() {
  const clock = { t: 0 }, every: { ms: number; f: () => void; next: number }[] = [];
  const host = createHost({ random: () => .5, now: () => clock.t, note() {}, after: () => 0, cancel() {}, every: (ms, f) => { every.push({ ms, f, next: ms }); } });
  const port: Port = { postMessage() {} };
  host.connect(port);
  const s = await setup(e => { e.setWindows([win(1)]); }, { send: m => host.message(port, m) });
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { clock.t += 16; for (const e of every) if (clock.t >= e.next) { e.next += e.ms; e.f(); } } };
  tick(5);
  const pet = host.sim!.pets.get(SAMPLE_ID)!;
  host.message(port, { k: 'down', id: SAMPLE_ID, x: pet.P.x, y: pet.P.y - 50, from: 0 });
  host.message(port, { k: 'cursor', x: 700, y: 150, down: true }); tick(2);
  host.message(port, { k: 'cursor', x: 700, y: 150, down: false });
  for (let i = 0; i < 400 && pet.P.on?.surface.owner !== 'window1'; i++) tick();
  assert.strictEqual(pet.P.on?.surface.owner, 'window1', 'she landed on it');
  pet.go('sit'); pet.P.dur = 1e9; pet.P.chatT = 1e9;
  return { ...s, tick, pet };
}

test('a window that closes during a pause, with the tracker failing to restart: she falls', async () => {
  const s = await riding();
  await s.client.setPaused(true); s.tick();
  s.exe.setWindows([]);
  const stop = s.exe.failUntil('windows_watch', 'no', (a: { on: boolean }) => a.on);
  await s.client.setPaused(false);
  s.tick(5);
  assert.notStrictEqual(s.pet.P.on?.surface.owner, 'window1');
  stop();
});

test('a plain pause and carry on: nobody falls', async () => {
  const s = await riding();
  await s.client.setPaused(true); s.tick(3);
  await s.client.setPaused(false); await s.done();
  s.tick(5);
  assert.strictEqual(s.pet.P.on?.surface.owner, 'window1');
  assert.strictEqual(s.pet.P.state, 'sit');
});

test('hidden and shown: nobody falls', async () => {
  const s = await riding();
  await s.client.setHidden(true); s.tick(3);
  await s.client.setHidden(false); await s.done();
  s.tick(5);
  assert.strictEqual(s.pet.P.on?.surface.owner, 'window1');
});

/* Finding 4: latest by the tracker's count, not by arrival */

test('an older snapshot arriving late changes nothing', async () => {
  const s = await setup();
  s.exe.emit('windows', { seq: 100, foreground: 0, list: [win(1, 500)] });
  s.exe.emit('windows', { seq: 99, foreground: 0, list: [win(1, 100)] });
  assert.strictEqual(s.last()!.list[0]!.x, 500);
});

test('a repeat of the same number changes nothing', async () => {
  const s = await setup();
  s.exe.emit('windows', { seq: 100, foreground: 0, list: [win(1, 500)] });
  const before = s.feeds().length;
  s.exe.emit('windows', { seq: 100, foreground: 0, list: [win(1, 100)] });
  assert.strictEqual(s.feeds().length, before);
});

test('the count carries on across a restart of the watch', async () => {
  const s = await setup(e => { e.setWindows([win(1)]); });
  await s.client.setPaused(true);
  s.exe.setWindows([win(1, 900)]);
  await s.client.setPaused(false); await s.done();
  assert.strictEqual(s.last()!.list[0]!.x, 900);
});

test('a late old one can not take the apps on offer back either', async () => {
  const s = await setup();
  s.exe.emit('windows', { seq: 100, foreground: 0, list: [win(1, 500, { exe: 'new.exe' })] });
  s.exe.emit('windows', { seq: 99, foreground: 0, list: [win(1, 100, { exe: 'old.exe' })] });
  await s.done();
  assert.deepStrictEqual(s.state().apps, ['new.exe']);
});

/* Finding 7: nothing a source says reaches the log */

const LEAK = 'cannot track Secret.exe (Secret_Class)';
test('a failing start or stop logs a fixed message, not what the source said', async () => {
  const s = await setup(e => { e.failNext('windows_watch', LEAK); });
  await s.retry();
  s.exe.failNext('windows_watch', LEAK);
  await s.client.setHidden(true);
  assert.deepStrictEqual(s.exe.logs.filter(l => /windows watch \w+ failed/.test(l)).length, 2);
  assert.deepStrictEqual(s.exe.logs.filter(l => /secret/i.test(l)), []);
});

test('a source that fails to listen: a fixed message, and the hub still comes up', async () => {
  const mac: WindowSource = { watch: async () => {}, listen: async () => { throw new Error(LEAK); } };
  const s = await setup(() => {}, { windows: mac });
  assert.ok(s.exe.logs.some(l => l.includes('windows listen failed')));
  assert.ok(s.exe.logs.some(l => l.startsWith('hub up')));
  assert.deepStrictEqual(s.exe.logs.filter(l => /secret/i.test(l)), []);
});

test('a source that throws where it should reject is no different', async () => {
  const mac: WindowSource = { watch: () => { throw new Error(LEAK); }, listen: () => { throw new Error(LEAK); } };
  const s = await setup(() => {}, { windows: mac });
  assert.ok(s.exe.logs.some(l => l.startsWith('hub up')));
  assert.deepStrictEqual(s.exe.logs.filter(l => /secret/i.test(l)), []);
});
