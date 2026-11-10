/* The Manager's client and the hub together: the real hub on the fake exe, the real client on a
   memory wire. Nothing here knows about a page. */
import assert from 'node:assert';
import fs from 'node:fs';
import { read, write, type Buddy } from '@buddies/buddy-file';
import { test } from 'vitest';
import type { Handed } from '../src/handed';
import type { Message } from '../src/host';
import { createHub } from '../src/hub-core';
import type { HubState, Said } from '../src/manager-api';
import { createManagerClient, type ClientIO } from '../src/manager-client';
import { MANAGER } from '../src/manager-window';
import { MAX_COPIES } from '../src/roster';
import { text, type MenuItem, type Monitor } from '../src/shell';
import { createFakeExe, type FakeExe, type FakeOptions } from '../src/shell-fake';
const revOf = (c: { state: HubState | null | undefined }, id: string) => c.state?.buddies.find(b => b.id === id)?.rev ?? -1;
import { createBus, type Wire } from '../src/wire';

const SAMPLE = fs.readFileSync(new URL('../../../packages/test-support/fixtures/sample.json', import.meta.url), 'utf8');
const SAMPLE_ID = read(SAMPLE).character!;
const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const small = (character: string, name = 'Pip'): Buddy => ({ character, name, base: { src: PNG, bb: box }, poses: {} });
const monitor = (name: string, i: number, x: number): Monitor => ({ i, name, primary: x === 0, scale: 1, x, y: 0, w: 1920, h: 1040, full: { x, y: 0, w: 1920, h: 1080 } });
const ONE = () => [monitor('A', 0, 0)], TWO = () => [monitor('A', 0, 0), monitor('B', 1, 1920)];
const manifest = (id: string, name: string) => JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: { ...small(id, name), base: { src: 'base.png', bb: box } } });
const tick = () => new Promise(r => setTimeout(r));

const handed = (path: string, body = '', size = body.length): Handed => ({ name: path.split('/').pop()!, path, size, text: async () => body, url: async () => 'data:' + path });
const buddyFile = (id: string, name?: string) => handed(`${id}.buddy`, write(small(id, name)));
/* An import over someone asks first. This is the person saying Replace to each that asked. */
const replacing = async (client: ReturnType<typeof createManagerClient>, files: Handed[]) =>
  Promise.all((await client.importFiles(files)).map(a => a.ok && a.value?.asked ? client.answerReplace(a.value.asked, 'replace') : a));

/* A run of the hub. `open` is a Manager window, and any number can come and go. */
/* A quiet start, as before the Manager opened with the app: these count its opens. hub.test.ts has the start. */
async function setup(o: FakeOptions = {}, prepare: (e: FakeExe) => Promise<void> = async () => {}, shared?: FakeExe) {
  const exe = shared || createFakeExe({ monitors: ONE(), ...o, args: [...o.args ?? [], '--no-manager'] }), sent: Message[] = [], timers: { ms: number; f: () => void }[] = [], bus = createBus<Said>();
  await prepare(exe);
  const hub = createHub({ shell: exe.shell, send: m => sent.push(m), seed: async () => SAMPLE, after: (ms, f) => { timers.push({ ms, f }); }, wire: bus.wire() });
  await hub.start();
  const done = async () => { for (let i = 0; i < 5; i++) { await tick(); await hub.settled; } };
  const retry = async () => { const t = timers.shift(); assert.ok(t, 'a retry is waiting'); t.f(); await done(); return t.ms; };
  const clocks: { ms: number; f: () => void }[] = [];
  let windows = 0;
  async function open(more: Partial<ClientIO> = {}) {
    const wire = bus.wire();
    const client = createManagerClient({
      wire, session: `w${++windows}`,
      after: (ms, f) => { const c = { ms, f }; clocks.push(c); return () => { clocks.splice(clocks.indexOf(c), 1); }; },
      shimeji: async files => files.some(f => /shime1\.png$/.test(f.name)) ? small('ignored') : null,
      closeWindow: () => exe.shell.windowClose(MANAGER.label),
      ...more
    });
    await done();
    return { client, wire, s: () => client.state! };
  }
  const items = (): MenuItem[] => exe.tray!.items!;
  const item = (id: string) => items().flatMap(i => [i, ...(i.items || [])]).find(i => i.id === id)!;
  const clicked = async (id: string) => { exe.emit('tray', { id }); await done(); };
  const worldIds = () => (sent.filter(m => m.k === 'pets').pop() as Extract<Message, { k: 'pets' }> | undefined)?.pets.map(p => p.id);
  const dismissed = () => sent.flatMap(m => m.k === 'dismiss' ? [m.id] : []);
  return { exe, hub, sent, timers, clocks, bus, done, retry, open, item, clicked, worldIds, dismissed };
}
type Run = Awaited<ReturnType<typeof setup>>;
const settings = (exe: FakeExe) => JSON.parse(text(exe.files.get('settings.json')!)) as { out: string[]; noSeed?: boolean };
const row = (s: HubState, id: string) => s.buddies.find(b => b.id === id)!;
/* Tray and Manager tell one story: who's on the menu, who's ticked, and the three switches. */
function agree(r: Run, s: HubState) {
  const menu = r.exe.tray!.items!.find(i => i.label === 'Buddies')!.items!.filter(i => i.id !== 'none');
  assert.deepStrictEqual(menu.map(i => [i.id, i.label, i.checked]), s.buddies.map(b => ['buddy:' + b.id, b.name, b.status === 'out']));
  assert.deepStrictEqual(['hide', 'pause', 'autostart'].map(id => r.item(id).checked), [s.hidden, s.paused, s.autostart]);
}

/* the list, live */

test('a new window asks, and gets the list with name, image, status and copies', async () => {
  const r = await setup(), { s } = await r.open();
  assert.strictEqual(s().ready, true);
  assert.deepStrictEqual(s().buddies.map(b => [b.id, b.name, b.status, b.copies]), [[SAMPLE_ID, 'Olive', 'out', 1]]);
  assert.match(s().buddies[0]!.image, new RegExp(`^library/${SAMPLE_ID}/[0-9a-f]{32}\\.webp$`));
});

test('a window that speaks before the hub can hear keeps asking', async () => {
  const bus = createBus<Said>(), wire = bus.wire(), hub = bus.wire();
  const clocks: (() => void)[] = [], posted: Said[] = [];
  hub.listen(m => posted.push(m));
  const c = createManagerClient({ wire, session: 'w', after: (_, f) => { clocks.push(f); return () => {}; }, shimeji: async () => null, closeWindow: async () => {} });
  assert.strictEqual(c.state, null);
  await tick(); clocks.pop()!(); await tick();
  assert.deepStrictEqual(posted, [{ k: 'hello' }, { k: 'hello' }]);
});

test('a window stops asking once it has heard', async () => {
  const r = await setup(), { client } = await r.open();
  assert.ok(client.state);
  assert.strictEqual(r.clocks.length, 0, 'no hello waiting');
});

test('changes from the tray reach an open window by themselves', async () => {
  const r = await setup(), { client, s } = await r.open();
  const heard: HubState[] = [];
  client.subscribe(x => heard.push(x));
  await r.clicked('buddy:' + SAMPLE_ID);
  assert.strictEqual(row(s(), SAMPLE_ID).status, 'home');
  assert.strictEqual(row(s(), SAMPLE_ID).copies, 0);
  await r.clicked('pause');
  assert.strictEqual(s().paused, true);
  await r.clicked('hide');
  assert.strictEqual(s().hidden, true);
  await r.clicked('autostart');
  assert.strictEqual(s().autostart, true);
  assert.ok(heard.length >= 5);
  agree(r, s());
});

test('subscribing tells you now, and stopping stops it', async () => {
  const r = await setup(), { client } = await r.open();
  let n = 0;
  const stop = client.subscribe(() => n++);
  assert.strictEqual(n, 1);
  stop();
  await r.clicked('pause');
  assert.strictEqual(n, 1);
});

test('the list is sorted by name, in the Manager and on the tray', async () => {
  const r = await setup(), { client, s } = await r.open();
  await client.importFiles([buddyFile('c3', 'zed'), buddyFile('c2', 'Bea'), buddyFile('c1', 'ana')]);
  await r.done();
  assert.deepStrictEqual(s().buddies.map(b => b.name), ['ana', 'Bea', 'Olive', 'zed']);
  agree(r, s());
});

/* call and dismiss */

test('call, call another, dismiss one, dismiss: the world, the tray and the file all follow', async () => {
  const r = await setup({}, async e => { await e.shell.dataWrite('settings.json', '{"out":[]}'); }), { client, s } = await r.open();
  assert.ok((await client.call(SAMPLE_ID)).ok);
  assert.deepStrictEqual(r.worldIds(), [SAMPLE_ID]);
  assert.deepStrictEqual([row(s(), SAMPLE_ID).status, row(s(), SAMPLE_ID).copies], ['out', 1]);
  assert.ok((await client.callAnother(SAMPLE_ID)).ok);
  await client.callAnother(SAMPLE_ID);
  assert.deepStrictEqual(r.worldIds(), [SAMPLE_ID, `${SAMPLE_ID}~1`, `${SAMPLE_ID}~2`]);
  assert.strictEqual(row(s(), SAMPLE_ID).copies, 3);
  assert.deepStrictEqual(settings(r.exe).out, [SAMPLE_ID, SAMPLE_ID, SAMPLE_ID]);
  assert.ok((await client.dismissOne(SAMPLE_ID)).ok);
  assert.deepStrictEqual(r.dismissed(), [`${SAMPLE_ID}~2`]);
  assert.strictEqual(row(s(), SAMPLE_ID).copies, 2);
  assert.ok((await client.dismiss(SAMPLE_ID)).ok);
  assert.deepStrictEqual(r.dismissed(), [`${SAMPLE_ID}~2`, SAMPLE_ID, `${SAMPLE_ID}~1`]);
  assert.strictEqual(row(s(), SAMPLE_ID).status, 'home');
  assert.deepStrictEqual(settings(r.exe).out, []);
  agree(r, s());
});

test('calling a buddy that\'s out does nothing, and so does dismissing one that isn\'t', async () => {
  const r = await setup(), { client, s } = await r.open();
  r.sent.length = 0;
  await client.call(SAMPLE_ID);
  assert.strictEqual(row(s(), SAMPLE_ID).copies, 1);
  assert.deepStrictEqual(r.sent, []);
  await client.dismiss(SAMPLE_ID); await client.dismiss(SAMPLE_ID); await client.dismissOne(SAMPLE_ID);
  assert.deepStrictEqual(r.dismissed(), [SAMPLE_ID]);
});

test('the tray\'s item means every copy, the same as plain Dismiss', async () => {
  const r = await setup(), { client, s } = await r.open();
  await client.callAnother(SAMPLE_ID);
  assert.strictEqual(r.item('buddy:' + SAMPLE_ID).checked, true);
  await r.clicked('buddy:' + SAMPLE_ID);
  assert.deepStrictEqual(r.dismissed(), [SAMPLE_ID, `${SAMPLE_ID}~1`]);
  assert.strictEqual(row(s(), SAMPLE_ID).copies, 0);
});

test('copies come back next run', async () => {
  const r = await setup(), { client } = await r.open();
  await client.callAnother(SAMPLE_ID);
  const next = await setup({}, async () => {}, r.exe);
  const start = next.sent.find(m => m.k === 'start') as Extract<Message, { k: 'start' }>;
  assert.deepStrictEqual(start.pets.map(p => p.id), [SAMPLE_ID, `${SAMPLE_ID}~1`]);
});

test('copies stop at the limit, and it says so', async () => {
  const r = await setup(), { client, s } = await r.open();
  for (let i = 1; i < MAX_COPIES; i++) await client.callAnother(SAMPLE_ID);
  const a = await client.callAnother(SAMPLE_ID);
  assert.ok(!a.ok);
  assert.strictEqual(a.failure.title, 'No more copies of Olive');
  assert.strictEqual(row(s(), SAMPLE_ID).copies, MAX_COPIES);
});

test('a buddy deleted behind a window\'s back gets an answer, not a crash', async () => {
  const r = await setup(), { client } = await r.open();
  for (const a of [await client.call('nobody'), await client.dismiss('nobody'), await client.exportBuddy('nobody'), await client.deleteBuddy('nobody', revOf(client, 'nobody'))]) {
    assert.ok(!a.ok);
    assert.strictEqual(a.failure.title, "That buddy isn't here");
  }
});

/* bring here, a treat, a chase */

test('Bring here brings every copy of her to the cursor, and leaves the overlays alone', async () => {
  const r = await setup(), { client } = await r.open();
  await client.callAnother(SAMPLE_ID);
  r.sent.length = 0; r.exe.calls.length = 0;
  assert.ok((await client.bringHere(SAMPLE_ID)).ok);
  assert.deepStrictEqual(r.sent, [{ k: 'bring', id: SAMPLE_ID }, { k: 'bring', id: `${SAMPLE_ID}~1` }]);
  assert.deepStrictEqual(r.exe.calls.filter(c => c.cmd.startsWith('window')), []);
  assert.ok(r.exe.logs.includes('manager bring ' + SAMPLE_ID));
});

test('the global Bring is the tray\'s alone: a page asking for bring with no buddy is refused, and nothing moves', async () => {
  const r = await setup(), { wire } = await r.open(), answers: unknown[] = [];
  wire.listen(m => { if (m.k === 'done' && m.id === 'x') answers.push(m.answer); });
  r.sent.length = 0; r.exe.calls.length = 0;
  wire.post({ k: 'do', id: 'x', cmd: { k: 'bring' } as never });
  await r.done();
  assert.strictEqual((answers[0] as { ok: boolean }).ok, false, JSON.stringify(answers));
  assert.deepStrictEqual(r.exe.calls.filter(c => c.cmd.startsWith('window')), []);
  assert.deepStrictEqual(r.sent, []);
  await r.clicked('bring');
  assert.ok((r.sent as Message[]).some(m => m.k === 'bring'), 'the tray still can');
});

test('Give a treat and Chase my mouse play on every copy of her', async () => {
  const r = await setup(), { client } = await r.open();
  await client.callAnother(SAMPLE_ID);
  r.sent.length = 0;
  assert.ok((await client.giveTreat(SAMPLE_ID)).ok);
  assert.ok((await client.chaseMouse(SAMPLE_ID)).ok);
  assert.deepStrictEqual(r.sent, [
    { k: 'act', id: SAMPLE_ID, a: 'eat' }, { k: 'act', id: `${SAMPLE_ID}~1`, a: 'eat' },
    { k: 'act', id: SAMPLE_ID, a: 'chase' }, { k: 'act', id: `${SAMPLE_ID}~1`, a: 'chase' }
  ]);
});

test('a row says what she can do, by the engine\'s own check: a treat needs Eat art', async () => {
  const r = await setup(), { client, s } = await r.open();
  await client.importFiles([buddyFile('c1', 'Pip')]);
  await r.done();
  assert.deepStrictEqual(row(s(), SAMPLE_ID).can, ['eat', 'chase']);
  assert.deepStrictEqual(row(s(), 'c1').can, ['chase']);
});

test('for someone at home these do nothing, and for someone gone they say so', async () => {
  const r = await setup(), { client } = await r.open();
  await client.dismiss(SAMPLE_ID);
  r.sent.length = 0;
  for (const a of [await client.bringHere(SAMPLE_ID), await client.giveTreat(SAMPLE_ID), await client.chaseMouse(SAMPLE_ID)]) assert.ok(a.ok);
  assert.deepStrictEqual(r.sent, []);
  for (const a of [await client.bringHere('nobody'), await client.giveTreat('nobody'), await client.chaseMouse('nobody')]) {
    assert.ok(!a.ok);
    assert.strictEqual(a.failure.title, "That buddy isn't here");
  }
});

/* importing */

test('a .buddy and a .buddy.json come in, listed but not called', async () => {
  const r = await setup(), { client, s } = await r.open();
  const answers = await client.importFiles([buddyFile('c1', 'One'), handed('old.buddy.json', write(small('c2', 'Two')))]);
  assert.deepStrictEqual(answers.map(a => a.ok && a.value), [{ id: 'c1', name: 'One', replaced: false }, { id: 'c2', name: 'Two', replaced: false }]);
  assert.ok(r.exe.files.has('library/c1/buddy.json') && r.exe.files.has('library/c2/buddy.json'));
  assert.strictEqual(row(s(), 'c1').status, 'home');
  assert.deepStrictEqual(r.worldIds(), [SAMPLE_ID]);
  agree(r, s());
});

test('`call` brings each one out, and it stays out next run', async () => {
  const r = await setup(), { client, s } = await r.open();
  await client.importFiles([buddyFile('c1')], { call: true });
  assert.strictEqual(row(s(), 'c1').status, 'out');
  assert.ok(r.worldIds()!.includes('c1'));
  assert.ok(settings(r.exe).out.includes('c1'));
});

test('importing a buddy over itself asks, Replace says it replaced her, and copies that are out get the new art', async () => {
  const r = await setup(), { client } = await r.open();
  await client.importFiles([buddyFile('c1', 'Old')], { call: true });
  await client.callAnother('c1');
  const [a] = await replacing(client, [buddyFile('c1', 'New')]);
  assert.ok(a!.ok && (a!.value as { replaced: boolean }).replaced);
  const pets = (r.sent.filter(m => m.k === 'pets').pop() as Extract<Message, { k: 'pets' }>).pets.filter(p => p.id.startsWith('c1'));
  assert.deepStrictEqual(pets.map(p => [p.id, p.name]), [['c1', 'New'], ['c1~1', 'New']]);
});

test('a bad file: one failure saying which file, why and what next, and nothing changes', async () => {
  const r = await setup(), { client, s } = await r.open(), before = r.exe.files.size;
  r.sent.length = 0;
  const [a] = await client.importFiles([handed('mochi.buddy', '{"app":"nope"}')]);
  assert.ok(!a!.ok);
  assert.deepStrictEqual({ ...a!.failure, id: '' }, {
    id: '', kind: 'import', file: 'mochi.buddy', title: "mochi didn't come in", why: "That isn't a buddy file.",
    fix: 'Pick a .buddy file. If this is one, export it again.', again: 'Pick another file'
  });
  assert.deepStrictEqual(s().failures, [a!.failure]);
  assert.strictEqual(r.exe.files.size, before);
  assert.deepStrictEqual(r.sent, []);
  assert.ok(r.exe.logs.some(l => /import failed: not a buddy file/.test(l)));
  assert.ok(!r.exe.logs.some(l => /mochi|nope/.test(l)), `never its name or what it holds: ${r.exe.logs.filter(l => /mochi|nope/.test(l)).join(' | ')}`);
});

test('one bad file in a drop doesn\'t stop the others', async () => {
  const r = await setup(), { client, s } = await r.open();
  const answers = await client.importFiles([handed('bad.buddy', 'nope'), buddyFile('c1'), handed('pic.png')]);
  assert.strictEqual(answers.length, 3);
  assert.strictEqual(answers.filter(a => a.ok).length, 1);
  assert.ok(row(s(), 'c1'));
  assert.strictEqual(s().failures.length, 2);
});

test('a file too big never gets read', async () => {
  const r = await setup(), { client } = await r.open();
  let read_ = false;
  const big: Handed = { ...handed('big.buddy', '', 65e6), text: async () => { read_ = true; return ''; } };
  const [a] = await client.importFiles([big]);
  assert.ok(!a!.ok);
  assert.match(a!.failure.why, /64 MB/);
  assert.strictEqual(read_, false);
});

test('a file that won\'t read says which file', async () => {
  const r = await setup(), { client } = await r.open();
  const [a] = await client.importFiles([{ ...handed('gone.buddy'), text: () => Promise.reject(new Error('NotFoundError')) }]);
  assert.ok(!a!.ok);
  assert.strictEqual(a!.failure.file, 'gone.buddy');
});

test('a disk that fails is told apart from a bad file, and the library stays whole', async () => {
  const r = await setup(), { client, s } = await r.open();
  r.exe.failNext('data_write', 'disk full');
  const [a] = await client.importFiles([buddyFile('c1')]);
  assert.ok(!a!.ok);
  assert.strictEqual(a!.failure.why, "It couldn't be saved into your library.");
  assert.match(a!.failure.fix, /room/);
  assert.ok(!row(s(), 'c1'));
  assert.ok(!r.exe.files.has('library/c1/buddy.json'));
});

test('a Shimeji folder comes in with a new character, named for its folder', async () => {
  let got: string[] = [];
  const r = await setup(), { client, s } = await r.open({ shimeji: async f => { got = f.map(x => `${x.name} ${x.src}`); return small('ignored'); } });
  const [a] = await client.importFiles([handed('Mochi/img/shime1.png'), handed('Mochi/img/shime2.png'), handed('Mochi/conf/a.xml')]);
  assert.ok(a!.ok);
  assert.deepStrictEqual(got, ['shime1.png data:Mochi/img/shime1.png', 'shime2.png data:Mochi/img/shime2.png']);
  const { id, name } = a!.value as { id: string; name: string };
  assert.strictEqual(name, 'Mochi');
  assert.match(id, /^c[a-z0-9]+$/);
  assert.notStrictEqual(id, 'ignored');
  assert.strictEqual(row(s(), id).name, 'Mochi');
});

test('a Shimeji folder with no first image: the prototypes\' failure, word for word', async () => {
  const r = await setup(), { client, s } = await r.open();
  const [a] = await client.importFiles([handed('Mochi/shime2.png')]);
  assert.ok(!a!.ok);
  assert.strictEqual(a!.failure.title, "Mochi didn't come in");
  assert.strictEqual(a!.failure.why, 'No shime1.png in that folder.');
  assert.deepStrictEqual(s().failures.map(f => f.file), ['Mochi (folder)']);
});

test('a folder with nothing in it to use says the same, without trying', async () => {
  const r = await setup(), { client } = await r.open({ shimeji: () => { throw new Error('should not be asked'); } });
  const [a] = await client.importFiles([handed('Mochi/a.png')]);
  assert.ok(!a!.ok);
  assert.strictEqual(a!.failure.why, 'No shime1.png in that folder.');
});

test('Shimeji art that won\'t open is a failure, not a hang', async () => {
  const r = await setup(), { client } = await r.open({ shimeji: () => Promise.reject(new Event('error')) });
  const [a] = await client.importFiles([handed('Mochi/shime1.png')]);
  assert.ok(!a!.ok);
  assert.strictEqual(a!.failure.title, "Mochi didn't come in");
  assert.match(a!.failure.why, /wouldn't open/);
});

/* failures */

test('failures stay until cleared, one or all, and the list has a limit', async () => {
  const r = await setup(), { client, s } = await r.open();
  await client.importFiles(Array.from({ length: 25 }, (_, i) => handed(`bad${i}.buddy`, 'nope')));
  assert.strictEqual(s().failures.length, 20);
  assert.strictEqual(s().failures[19]!.file, 'bad24.buddy');
  await client.clearFailure(s().failures[0]!.id);
  await r.done();
  assert.strictEqual(s().failures.length, 19);
  await client.clearFailures();
  await r.done();
  assert.deepStrictEqual(s().failures, []);
});

test('a file opened from outside that fails shows the Manager, so it isn\'t just a log line', async () => {
  const r = await setup();
  assert.ok(!r.exe.windows.has('manager'));
  r.exe.emit('open-file', { name: 'x.buddy', content: 'nope' }); await r.done();
  assert.ok(r.exe.windows.has('manager'));
  const { s } = await r.open();
  assert.strictEqual(s().failures[0]!.title, "x didn't come in");
});

test('what the exe couldn\'t read is reported the same way', async () => {
  const r = await setup({ opened: [{ name: 'y.buddy', content: '', error: 'too big' }] });
  const { s } = await r.open();
  assert.match(s().failures[0]!.why, /64 MB/);
  assert.ok(r.exe.windows.has('manager'));
});

test('a file opened from outside that works is called, and no window opens', async () => {
  const r = await setup();
  r.exe.emit('open-file', { name: 'c1.buddy', content: write(small('c1')) }); await r.done();
  assert.ok(r.worldIds()!.includes('c1'));
  assert.ok(!r.exe.windows.has('manager'));
});

/* exporting */

test('export hands save_as one .buddy file that reads back as the same buddy', async () => {
  const r = await setup(), { client } = await r.open();
  r.exe.dialog = true;
  const a = await client.exportBuddy(SAMPLE_ID);
  assert.deepStrictEqual(a, { ok: true, value: { saved: true } });
  const saved = r.exe.saved[0]!;
  assert.strictEqual(saved.name, 'Olive.buddy');
  assert.deepStrictEqual(saved.filters, [{ name: 'Buddy file', extensions: ['buddy'] }]);
  const back = read(saved.content), original = read(SAMPLE);
  assert.strictEqual(back.character, original.character);
  assert.deepStrictEqual(Object.keys(back.poses).sort(), Object.keys(original.poses).sort());
  assert.match(back.base.src, /^data:image\//);
});

test('a name Windows can\'t use is cleaned, and one in another script stays', async () => {
  const r = await setup(), { client } = await r.open();
  await client.importFiles([buddyFile('c1', 'a/b:c?'), buddyFile('c2', 'ぬい'), buddyFile('c3', '...')]);
  for (const id of ['c1', 'c2', 'c3']) await client.exportBuddy(id);
  assert.deepStrictEqual(r.exe.saved.map(s => s.name), ['abc.buddy', 'ぬい.buddy', 'buddy.buddy']);
});

test('cancelling the save is an answer, not a failure', async () => {
  const r = await setup(), { client, s } = await r.open();
  const a = await client.exportBuddy(SAMPLE_ID);
  assert.deepStrictEqual(a, { ok: true, value: { saved: false } });
  assert.deepStrictEqual(s().failures, []);
});

test('a save that fails says what to do, and the next one still works', async () => {
  const r = await setup(), { client, s } = await r.open();
  r.exe.failNext('save_as', 'access denied');
  const a = await client.exportBuddy(SAMPLE_ID);
  assert.ok(!a.ok);
  assert.strictEqual(a.failure.title, "Olive wasn't exported");
  assert.match(a.failure.fix, /another place/);
  assert.strictEqual(s().failures.length, 1);
  assert.deepStrictEqual(await client.exportBuddy(SAMPLE_ID), { ok: true, value: { saved: false } });
});

test('a buddy that can\'t be read back fails before any dialog, and doesn\'t block the next', async () => {
  const r = await setup(), { client } = await r.open();
  r.exe.failNext('data_read', 'locked', (x: { path: string }) => x.path.endsWith('.webp'));
  const a = await client.exportBuddy(SAMPLE_ID);
  assert.ok(!a.ok);
  assert.match(a.failure.why, /couldn't be read/);
  assert.strictEqual(r.exe.saved.length, 0);
  assert.ok((await client.exportBuddy(SAMPLE_ID)).ok);
});

test('a save window left open holds up nothing: tray, monitors and imports all carry on', async () => {
  const r = await setup(), { client, s } = await r.open();
  let answer = (_: boolean) => {};
  r.exe.dialog = new Promise<boolean>(done => { answer = done; });
  const saving = client.exportBuddy(SAMPLE_ID);
  await r.done();
  assert.strictEqual(r.exe.saved.length, 1, 'the dialog is up');
  await r.clicked('pause');
  assert.strictEqual(s().paused, true);
  assert.ok((await client.importFiles([buddyFile('c1')]))[0]!.ok);
  r.exe.emit('monitors', TWO()); await r.done();
  assert.ok(r.exe.windows.has('overlay1'));
  answer(true);
  assert.deepStrictEqual(await saving, { ok: true, value: { saved: true } });
});

test('one save window at a time, and the next is fine once it\'s gone', async () => {
  const r = await setup(), { client } = await r.open();
  let answer = (_: boolean) => {};
  r.exe.dialog = new Promise<boolean>(done => { answer = done; });
  const first = client.exportBuddy(SAMPLE_ID);
  await r.done();
  const second = await client.exportBuddy(SAMPLE_ID);
  assert.ok(!second.ok);
  assert.strictEqual(second.failure.why, 'A save window is already open.');
  assert.strictEqual(r.exe.saved.length, 1);
  answer(false); await first;
  r.exe.dialog = false;
  assert.ok((await client.exportBuddy(SAMPLE_ID)).ok);
});

test('exporting never gives up on a slow person', async () => {
  const r = await setup(), { client } = await r.open();
  r.exe.dialog = new Promise<boolean>(() => {});
  void client.exportBuddy(SAMPLE_ID);
  await r.done();
  assert.strictEqual(r.clocks.length, 0, 'no timer running');
});

/* deleting */

test('delete takes it off disk, the desktop, the tray and the list', async () => {
  const r = await setup(), { client, s } = await r.open();
  await client.importFiles([buddyFile('c1')], { call: true });
  await client.callAnother('c1');
  assert.ok((await client.deleteBuddy('c1', revOf(client, 'c1'))).ok);
  assert.ok(![...r.exe.files.keys()].some(k => k.includes('/c1/')));
  assert.deepStrictEqual(r.dismissed(), ['c1', 'c1~1']);
  assert.ok(!row(s(), 'c1'));
  assert.ok(!settings(r.exe).out.includes('c1'));
  agree(r, s());
});

test('a delete that fails changes nothing and says so', async () => {
  const r = await setup(), { client, s } = await r.open();
  r.exe.failNext('data_move', 'locked');
  const a = await client.deleteBuddy(SAMPLE_ID, revOf(client, SAMPLE_ID));
  assert.ok(!a.ok);
  assert.strictEqual(a.failure.title, "Olive wasn't deleted");
  assert.ok(row(s(), SAMPLE_ID));
  assert.strictEqual(row(s(), SAMPLE_ID).copies, 1);
  assert.deepStrictEqual(r.dismissed(), []);
  assert.ok(r.exe.files.has(`library/${SAMPLE_ID}/buddy.json`));
});

test('deleting the last buddy stays deleted: Olive isn\'t seeded back next run', async () => {
  const r = await setup(), { client, s } = await r.open();
  await client.deleteBuddy(SAMPLE_ID, revOf(client, SAMPLE_ID));
  assert.deepStrictEqual(s().buddies, []);
  assert.strictEqual(settings(r.exe).noSeed, true);
  const next = await setup({}, async () => {}, r.exe);
  assert.ok(!r.exe.files.has(`library/${SAMPLE_ID}/buddy.json`));
  const again = await next.open();
  assert.deepStrictEqual(again.s().buddies, []);
});

/* switches */

test('hide all, pause and start with Windows are set, not toggled, so saying it twice is safe', async () => {
  const r = await setup(), { client, s } = await r.open();
  await client.setHidden(true); await client.setHidden(true);
  assert.strictEqual(s().hidden, true);
  assert.ok([...r.exe.windows.values()].every(w => w.hidden));
  await client.setPaused(true); await client.setPaused(true);
  assert.strictEqual(s().paused, true);
  await client.setAutostart(true); await client.setAutostart(true);
  assert.strictEqual(r.exe.autostart, true);
  agree(r, s());
  await client.setHidden(false); await client.setPaused(false); await client.setAutostart(false);
  agree(r, s());
  assert.deepStrictEqual([s().hidden, s().paused, s().autostart, r.exe.autostart], [false, false, false, false]);
  assert.strictEqual((r.sent.filter(m => m.k === 'pause').pop() as { on: boolean }).on, false);
});

test('start with Windows that fails says so, and neither side thinks it\'s on', async () => {
  const r = await setup(), { client, s } = await r.open();
  r.exe.failNext('autostart', 'registry refused');
  const a = await client.setAutostart(true);
  assert.ok(!a.ok);
  assert.strictEqual(s().autostart, false);
  assert.strictEqual(r.item('autostart').checked, false);
  r.exe.failNext('autostart', 'registry refused');
  await r.clicked('autostart');
  assert.strictEqual(s().failures.length, 2, 'from the tray too');
});

/* the Maker's hook */

test('new and edit open the Maker, and state says so', async () => {
  const r = await setup(), { client, s } = await r.open();
  assert.strictEqual(s().maker, true);
  assert.ok((await client.newBuddy()).ok);
  assert.ok([...r.exe.windows.values()].some(w => w.page === 'maker.html'));
  assert.ok((await client.editBuddy(SAMPLE_ID)).ok);
});

/* the window */

test('a left click on the tray opens the Manager, with the page from the app folder', async () => {
  const r = await setup();
  r.exe.emit('tray-click', null); await r.done();
  const w = r.exe.windows.get('manager')!;
  assert.deepStrictEqual([w.kind, w.page], ['window', 'manager.html']);
  assert.ok(fs.existsSync(new URL('../public/manager.html', import.meta.url)));
});

test('the tray menu opens the Manager too', async () => {
  const r = await setup();
  await r.clicked('manager');
  assert.strictEqual(r.exe.windows.get('manager')!.page, 'manager.html');
});

test('a second click focuses it, and never opens another', async () => {
  const r = await setup();
  r.exe.emit('tray-click', null); await r.done();
  r.exe.focused = 'elsewhere'; r.exe.calls.length = 0;
  r.exe.emit('tray-click', null); await r.done();
  assert.strictEqual(r.exe.focused, 'manager');
  assert.ok(!r.exe.calls.some(c => c.cmd === 'window_open'));
});

test('two clicks at once make one window', async () => {
  const r = await setup();
  r.exe.emit('tray-click', null); r.exe.emit('tray-click', null); r.exe.emit('tray-click', null); await r.done();
  assert.strictEqual(r.exe.calls.filter(c => c.cmd === 'window_open' && (c.args as { spec: { label: string } }).spec.label === 'manager').length, 1);
  assert.ok(!r.exe.logs.some(l => /hub error/.test(l)), r.exe.logs.join('; '));
});

test('a second launch with no file does the same, and one with a file doesn\'t', async () => {
  const r = await setup();
  r.exe.emit('second-launch', { args: ['C:\\x\\a.buddy'] }); await r.done();
  r.exe.emit('second-launch', { args: ['C:\\x\\a.BUDDY.JSON', '--buddies', '2'] }); await r.done();
  assert.ok(!r.exe.windows.has('manager'));
  r.exe.emit('second-launch', { args: [] }); await r.done();
  assert.ok(r.exe.windows.has('manager'));
  r.exe.focused = 'elsewhere';
  r.exe.emit('second-launch', { args: ['--whatever'] }); await r.done();
  assert.strictEqual(r.exe.focused, 'manager');
});

test('closing really closes, and the next click opens a new window, no hidden page', async () => {
  const r = await setup();
  r.exe.emit('tray-click', null); await r.done();
  const { client } = await r.open();
  await client.close();
  assert.ok(!r.exe.windows.has('manager'));
  assert.ok(!r.exe.calls.some(c => c.cmd === 'window_hide' && (c.args as { label: string }).label === 'manager'));
  r.exe.emit('tray-click', null); await r.done();
  assert.ok(r.exe.windows.has('manager'));
});

test('a window the user closed with its X is noticed the same way', async () => {
  const r = await setup();
  r.exe.emit('tray-click', null); await r.done();
  r.exe.windows.delete('manager');
  r.exe.emit('tray-click', null); await r.done();
  assert.ok(r.exe.windows.has('manager'));
  assert.ok(!r.exe.logs.some(l => /hub error/.test(l)), r.exe.logs.join('; '));
});

test('a minimized window comes back: focus can\'t restore one, so it\'s a fresh window', async () => {
  const r = await setup();
  r.exe.emit('tray-click', null); await r.done();
  r.exe.windows.get('manager')!.minimized = true; r.exe.focused = 'elsewhere';
  r.exe.emit('tray-click', null); await r.done();
  assert.strictEqual(r.exe.windows.get('manager')!.minimized, undefined);
  assert.strictEqual(r.exe.focused, 'manager');
});

test('a window that fails to open is tried again, and stops once it\'s up', async () => {
  const r = await setup();
  r.exe.failNext('window_open', 'webview failed');
  r.exe.emit('tray-click', null); await r.done();
  assert.ok(!r.exe.windows.has('manager'));
  assert.strictEqual(await r.retry(), 2000);
  assert.ok(r.exe.windows.has('manager'));
  assert.strictEqual(r.timers.length, 0);
});

test('a window that opened behind our back isn\'t an error', async () => {
  const r = await setup();
  const check = r.exe.shell.windowMinimized;
  r.exe.shell.windowMinimized = async l => { await r.exe.shell.windowOpen(MANAGER); r.exe.shell.windowMinimized = check; return check(l).then(() => { throw new Error('gone'); }); };
  r.exe.emit('tray-click', null); await r.done();
  assert.strictEqual(r.exe.focused, 'manager');
  assert.ok(!r.exe.logs.some(l => /hub error/.test(l)), r.exe.logs.join('; '));
});

/* closing mid-command */

test('a window that closes mid-import loses nothing: the hub finishes, and the next window sees it', async () => {
  const r = await setup(), first = await r.open();
  const going = first.client.importFiles([buddyFile('c1', 'Late')]);
  await Promise.resolve();
  first.wire.close();
  void going;
  await r.done();
  assert.ok(r.exe.files.has('library/c1/buddy.json'));
  assert.ok(r.exe.tray!.items!.find(i => i.label === 'Buddies')!.items!.some(i => i.id === 'buddy:c1'));
  const second = await r.open();
  assert.ok(row(second.s(), 'c1'));
});

test('a failure from a command whose window has gone waits for the next window', async () => {
  const r = await setup(), first = await r.open();
  void first.client.importFiles([handed('bad.buddy', 'nope')]);
  await Promise.resolve();
  first.wire.close();
  await r.done();
  const second = await r.open();
  assert.deepStrictEqual(second.s().failures.map(f => f.title), ["bad didn't come in"]);
});

test('a window that closes with the save window up: the save carries on, and a failure waits', async () => {
  const r = await setup(), first = await r.open();
  let answer = (_: boolean) => {}, boom = (_: unknown) => {};
  r.exe.dialog = new Promise<boolean>((done, fail) => { answer = done; boom = fail; });
  void first.client.exportBuddy(SAMPLE_ID);
  await r.done();
  first.wire.close();
  answer(true); void boom; await r.done();
  assert.ok(r.exe.logs.some(l => /export saved/.test(l)));
  r.exe.dialog = new Promise<boolean>((_, fail) => { boom = fail; });
  const second = await r.open();
  void second.client.exportBuddy(SAMPLE_ID);
  await r.done();
  second.wire.close();
  boom(new Error('access denied')); await r.done();
  const third = await r.open();
  assert.deepStrictEqual(third.s().failures.map(f => f.title), ["Olive wasn't exported"]);
});

test('an answer meant for a window that closed isn\'t taken by the next one', async () => {
  const bus = createBus<Said>(), hub = bus.wire(), ids: string[] = [];
  hub.listen(m => { if (m.k === 'do') ids.push(m.id); });
  const window_ = (session: string) => createManagerClient({ wire: bus.wire(), session, after: () => () => {}, shimeji: async () => null, closeWindow: async () => {} });
  void window_('old').setPaused(true);
  await tick();
  let answered = false;
  const next = window_('new').setPaused(false).then(a => { answered = true; return a; });
  await tick();
  hub.post({ k: 'done', id: ids[0]!, answer: { ok: true, value: 'for the old one' } });
  await tick();
  assert.strictEqual(answered, false);
  hub.post({ k: 'done', id: ids[1]!, answer: { ok: true, value: 'for the new one' } });
  assert.deepStrictEqual(await next, { ok: true, value: 'for the new one' });
});

test('a window can open while the old one\'s command is still running, and both stay right', async () => {
  const r = await setup(), first = await r.open(), second = await r.open();
  await Promise.all([first.client.callAnother(SAMPLE_ID), second.client.callAnother(SAMPLE_ID)]);
  await r.done();
  assert.strictEqual(row(first.s(), SAMPLE_ID).copies, 3);
  assert.strictEqual(row(second.s(), SAMPLE_ID).copies, 3);
});

test('a hub that never answers: the command gives up with a failure a person can read', async () => {
  const bus = createBus<Said>(), hub = bus.wire(), clocks: { ms: number; f: () => void }[] = [];
  hub.listen(m => { if (m.k === 'hello') hub.post({ k: 'state', state: { ready: true, buddies: [], hidden: false, paused: false, autostart: false, walk: true, exclude: [], apps: [], maker: false, failures: [], api: { on: false, apps: [], asking: [] }, replacing: [] } }); });
  const c = createManagerClient({ wire: bus.wire(), session: 'w', after: (ms, f) => { const x = { ms, f }; clocks.push(x); return () => {}; }, shimeji: async () => null, closeWindow: async () => {} });
  await tick(); await tick();
  const going = c.setPaused(true);
  clocks.filter(x => x.ms === 30000).pop()!.f();
  const a = await going;
  assert.ok(!a.ok);
  assert.match(a.failure.why, /didn't answer/);
  assert.deepStrictEqual(c.state!.failures, [a.failure], 'shown with the rest');
  await c.clearFailure(a.failure.id);
  assert.deepStrictEqual(c.state!.failures, []);
});

test('an answer that arrives after giving up is ignored', async () => {
  const bus = createBus<Said>(), hub = bus.wire(), clocks: { ms: number; f: () => void }[] = [];
  let id = '';
  hub.listen(m => { if (m.k === 'do') id = m.id; });
  const c = createManagerClient({ wire: bus.wire(), session: 'w', after: (ms, f) => { const x = { ms, f }; clocks.push(x); return () => {}; }, shimeji: async () => null, closeWindow: async () => {} });
  const going = c.setPaused(true);
  await tick();
  clocks.filter(x => x.ms === 30000).pop()!.f();
  assert.ok(!(await going).ok);
  hub.post({ k: 'done', id, answer: { ok: true } });
  await tick();
});

/* commands while the hub is retrying */

test('a command during an overlay retry works, and the retry still finishes', async () => {
  const r = await setup({ monitors: ONE() });
  const { client, s } = await r.open();
  r.exe.failNext('window_open', 'webview failed');
  r.exe.failNext('window_hide', 'busy');
  r.exe.emit('monitors', TWO()); await r.done();
  assert.ok(!r.exe.windows.has('overlay1'));
  assert.ok((await client.callAnother(SAMPLE_ID)).ok);
  assert.strictEqual(row(s(), SAMPLE_ID).copies, 2);
  assert.ok(r.worldIds()!.includes(`${SAMPLE_ID}~1`));
  assert.ok(r.exe.windows.has('overlay1'), 'the command tried it too, like any event');
  assert.strictEqual(r.timers.length, 1, 'one retry, never a pile');
  await r.retry();
  assert.strictEqual(r.timers.length, 0);
});

test('a settings file that won\'t write: the buddy still comes out, the tray agrees, and it\'s saved later', async () => {
  const r = await setup(), { client, s } = await r.open();
  await client.dismiss(SAMPLE_ID);
  r.exe.failNext('data_write', 'disk busy');
  const a = await client.call(SAMPLE_ID);
  assert.ok(a.ok);
  assert.deepStrictEqual(r.worldIds(), [SAMPLE_ID]);
  assert.strictEqual(row(s(), SAMPLE_ID).status, 'out');
  agree(r, s());
  assert.deepStrictEqual(settings(r.exe).out, [], 'not on disk yet');
  await r.retry();
  assert.deepStrictEqual(settings(r.exe).out, [SAMPLE_ID]);
  assert.strictEqual(r.timers.length, 0);
});

test('a tray that won\'t update is tried again, so it can\'t stay behind the Manager', async () => {
  const r = await setup(), { client, s } = await r.open();
  r.exe.failNext('tray_set', 'busy');
  await client.setPaused(true);
  assert.strictEqual(s().paused, true);
  assert.strictEqual(r.item('pause').checked, false, 'behind for now');
  await r.retry();
  agree(r, s());
});

test('a buddy written but not read back still answers ok, and the shelf catches up', async () => {
  const r = await setup(), { client, s } = await r.open();
  r.exe.failNext('data_read', 'busy', (a: { path: string }) => a.path === 'library/c1/buddy.json');
  const [a] = await client.importFiles([buddyFile('c1')], { call: true });
  assert.ok(a!.ok);
  await r.done();
  assert.ok(r.exe.logs.some(l => /couldn't read c1 back/.test(l)));
  assert.strictEqual(row(s(), 'c1').status, 'out');
  assert.ok(r.worldIds()!.includes('c1'));
  agree(r, s());
});

const waitingCopy = async (e: FakeExe) => {
  await e.shell.dataWrite('library/c1/buddy.json', manifest('c1', 'Other'));
  await e.shell.dataWrite('library/.outgoing/c2/buddy.json', manifest('c2', 'Waiting'));
  await e.shell.dataWrite('settings.json', JSON.stringify({ out: ['c1', 'c2'] }));
  e.failNext('data_move', 'locked');
};

test('a command while the library is still recovering works on what\'s there, and says it isn\'t ready', async () => {
  const r = await setup({}, waitingCopy), { client, s } = await r.open();
  assert.strictEqual(s().ready, false);
  assert.ok((await client.callAnother('c1')).ok);
  assert.strictEqual(row(s(), 'c1').copies, 2);
  await r.retry();
  assert.strictEqual(s().ready, true);
});

test('a command while the library is recovering doesn\'t forget who was out but not back yet', async () => {
  const r = await setup({}, waitingCopy), { client, s } = await r.open();
  await client.dismiss('c1');
  assert.ok(settings(r.exe).out.includes('c2'), 'saved with the one still waiting');
  await r.retry();
  assert.strictEqual(row(s(), 'c2').status, 'out');
  assert.strictEqual(row(s(), 'c1').status, 'home', 'and the recovery didn\'t undo the dismiss');
  assert.deepStrictEqual(r.worldIds(), ['c2']);
});

test('a dismiss during a failing save isn\'t undone when the library finishes recovering', async () => {
  const r = await setup({}, waitingCopy), { client, s } = await r.open();
  r.exe.failNext('data_write', 'disk busy');
  await client.dismiss('c1');
  await r.retry();
  assert.strictEqual(row(s(), 'c1').status, 'home');
  assert.strictEqual(settings(r.exe).out.includes('c1'), false);
});

test('an import while the library is recovering doesn\'t disturb what it\'s putting back', async () => {
  const r = await setup({}, waitingCopy), { client, s } = await r.open();
  assert.ok((await client.importFiles([buddyFile('c3')]))[0]!.ok);
  await r.retry();
  assert.deepStrictEqual(s().buddies.map(b => b.id).sort(), ['c1', 'c2', 'c3']);
  assert.ok(![...r.exe.files.keys()].some(k => k.includes('.outgoing')));
});

/* reading back what was imported */

/* Her manifest is what reading her back reads. */
const manifestIn = (dir: string) => (a: { path: string }) => a.path === `${dir}/buddy.json`;

test('an import nobody can see isn\'t a success, and it shows up once it can be read', async () => {
  const r = await setup(), { client, s } = await r.open();
  const stop = r.exe.failUntil('data_read', 'busy', manifestIn('library/c1'));
  const [a] = await client.importFiles([buddyFile('c1', 'One')], { call: true });
  assert.ok(!a!.ok);
  assert.strictEqual(a!.failure.title, "c1 isn't showing yet");
  assert.match(a!.failure.why, /saved/);
  assert.deepStrictEqual(s().failures.map(f => f.id), [a!.failure.id]);
  assert.ok(!row(s(), 'c1'));
  agree(r, s());
  assert.ok(!r.exe.logs.some(l => /imported as c1/.test(l)));
  assert.strictEqual(r.timers.length, 1, 'still to do');
  stop();
  await r.retry();
  assert.strictEqual(row(s(), 'c1').status, 'out');
  assert.ok(r.worldIds()!.includes('c1'));
  agree(r, s());
  assert.deepStrictEqual(s().failures, [], 'nothing left to say');
  assert.strictEqual(r.timers.length, 0);
});

test('one not called is retried the same', async () => {
  const r = await setup(), { client, s } = await r.open();
  const stop = r.exe.failUntil('data_read', 'busy', manifestIn('library/c1'));
  assert.ok(!(await client.importFiles([buddyFile('c1')]))[0]!.ok);
  stop();
  await r.retry();
  assert.strictEqual(row(s(), 'c1').status, 'home');
});

test('a folder that stays unreadable retries on the usual backoff, one timer, and reads only itself', async () => {
  const r = await setup(), { client, s } = await r.open();
  r.exe.failUntil('data_read', 'busy', manifestIn('library/c1'));
  await client.importFiles([buddyFile('c1')]);
  const waits: number[] = [];
  for (let i = 0; i < 7; i++) {
    r.exe.calls.length = 0;
    waits.push(await r.retry());
    assert.strictEqual(r.timers.length, 1);
    assert.deepStrictEqual(r.exe.calls.filter(c => c.cmd === 'data_read' || c.cmd === 'data_list').map(c => Object.values(c.args as object)[0]), ['library/c1/buddy.json']);
  }
  assert.deepStrictEqual(waits, [2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  assert.ok((await client.setPaused(true)).ok, 'and it stops nothing else');
  assert.strictEqual(s().paused, true);
});

test('importing it again while it waits clears the wait', async () => {
  const r = await setup(), { client, s } = await r.open();
  const stop = r.exe.failUntil('data_read', 'busy', manifestIn('library/c1'));
  await client.importFiles([buddyFile('c1')]);
  stop();
  assert.ok((await replacing(client, [buddyFile('c1')]))[0]!.ok);
  assert.ok(row(s(), 'c1'));
  assert.deepStrictEqual(s().failures, []);
  await r.retry();
  assert.strictEqual(r.timers.length, 0);
});

test('a double-clicked file that can\'t be read back shows the Manager, and comes out when it can', async () => {
  const r = await setup();
  const stop = r.exe.failUntil('data_read', 'busy', manifestIn('library/c1'));
  r.exe.emit('open-file', { name: 'c1.buddy', content: write(small('c1')) }); await r.done();
  assert.ok(r.exe.windows.has('manager'));
  stop();
  await r.retry();
  assert.ok(r.worldIds()!.includes('c1'));
});

test('a recovery that finishes while one still waits to be read doesn\'t forget it was called', async () => {
  const r = await setup({}, waitingCopy), { client, s } = await r.open();
  const stop = r.exe.failUntil('data_read', 'busy', manifestIn('library/c3'));
  await client.importFiles([buddyFile('c3')], { call: true });
  await r.retry();
  assert.strictEqual(s().ready, true);
  stop();
  await r.retry();
  assert.strictEqual(row(s(), 'c3').status, 'out');
});

test('a buddy deleted while its read-back fails stops being tried, and its failure goes', async () => {
  const r = await setup(), { client, s } = await r.open();
  await client.importFiles([buddyFile('c1', 'Old')]);
  const stop = r.exe.failUntil('data_read', 'busy', manifestIn('library/c1'));
  const [a] = await replacing(client, [buddyFile('c1', 'New')]);
  assert.ok(!a!.ok);
  assert.ok(row(s(), 'c1'), 'the old one still shows, so it can be deleted');
  assert.ok((await client.deleteBuddy('c1', revOf(client, 'c1'))).ok);
  stop();
  assert.deepStrictEqual(s().failures, []);
  await r.done();
  while (r.timers.length) await r.retry();
  r.exe.calls.length = 0;
  await client.setPaused(true);
  assert.ok(!r.exe.calls.some(c => c.cmd === 'data_read' && (c.args as { path: string }).path === 'library/c1/buddy.json'), 'not tried again');
  assert.strictEqual(r.timers.length, 0, 'nothing left to retry');
  assert.ok(!r.exe.logs.slice(-3).some(l => /hub error/.test(l)));
});

test('importing it again during a retry that keeps failing is one wait and one failure', async () => {
  const r = await setup(), { client, s } = await r.open();
  const stop = r.exe.failUntil('data_read', 'busy', manifestIn('library/c1'));
  await client.importFiles([buddyFile('c1')]);
  await client.importFiles([buddyFile('c1')]);
  await client.importFiles([buddyFile('c1')]);
  assert.strictEqual(s().failures.length, 1);
  assert.strictEqual(r.timers.length, 1);
  stop();
  await r.retry();
  assert.ok(row(s(), 'c1'));
  assert.deepStrictEqual(s().failures, []);
  assert.strictEqual(r.timers.length, 0);
});

/* deleting durably */

const lone = async (e: FakeExe) => {
  await e.shell.dataWrite('library/c1/buddy.json', manifest('c1', 'Last'));
  await e.shell.dataWrite('library/c1/base.png', 'art');
  await e.shell.dataWrite('settings.json', '{"out":["c1"]}');
};

test('a delete whose settings can\'t be saved changes nothing, and says so', async () => {
  const r = await setup({}, lone), { client, s } = await r.open();
  r.exe.failNext('data_write', 'disk full');
  const a = await client.deleteBuddy('c1', revOf(client, 'c1'));
  assert.ok(!a.ok);
  assert.strictEqual(a.failure.title, "Last wasn't deleted");
  assert.match(a.failure.why, /settings/);
  assert.strictEqual(row(s(), 'c1').copies, 1);
  assert.ok(r.exe.files.has('library/c1/buddy.json'));
  assert.deepStrictEqual(r.dismissed(), []);
  assert.strictEqual(settings(r.exe).noSeed, undefined);
  assert.ok((await client.deleteBuddy('c1', revOf(client, 'c1'))).ok, 'and it can be tried again');
  assert.strictEqual(settings(r.exe).noSeed, true);
});

test('noSeed is on disk before the folder goes', async () => {
  const r = await setup({}, lone), { client } = await r.open();
  r.exe.calls.length = 0;
  await client.deleteBuddy('c1', revOf(client, 'c1'));
  const cmds = r.exe.calls.map(c => c.cmd);
  assert.ok(cmds.indexOf('data_write') < cmds.indexOf('data_move'));
});

for (const n of [1, 2, 3, 4, 5]) {
  test(`a crash at step ${n} of deleting the last buddy never seeds Olive over it`, async () => {
    const r = await setup({}, lone), { client } = await r.open();
    r.exe.faultAt(n, true);
    void client.deleteBuddy('c1', revOf(client, 'c1'));
    await r.done();
    r.exe.revive();
    const next = await setup({}, async () => {}, r.exe);
    assert.ok(!r.exe.files.has(`library/${SAMPLE_ID}/buddy.json`), r.exe.logs.join('; '));
    assert.ok(!next.exe.logs.some(l => /seeded/.test(l)));
  });
}

/* reading settings */

const settingsFile = (a: { path: string }) => a.path === 'settings.json';
const noBuddies = async (e: FakeExe) => { await e.shell.dataWrite('settings.json', '{"out":[],"noSeed":true}'); };

test('settings that can\'t be read aren\'t a first run: nothing is seeded, and it tries again', async () => {
  const r = await setup({}, async e => { await noBuddies(e); e.failNext('data_read', 'sharing violation', settingsFile); });
  assert.ok(!r.exe.files.has(`library/${SAMPLE_ID}/buddy.json`), 'not seeded');
  const { s } = await r.open();
  assert.strictEqual(s().ready, false);
  await r.retry();
  assert.strictEqual(s().ready, true);
  assert.ok(!r.exe.files.has(`library/${SAMPLE_ID}/buddy.json`), 'still not, once it reads');
  assert.deepStrictEqual(s().buddies, []);
  assert.strictEqual(r.timers.length, 0);
});

test('it keeps trying for as long as the read fails, and never seeds meanwhile', async () => {
  const r = await setup({}, async e => { await noBuddies(e); e.failUntil('data_read', 'sharing violation', settingsFile); });
  for (let i = 0; i < 4; i++) await r.retry();
  assert.ok(!r.exe.files.has(`library/${SAMPLE_ID}/buddy.json`));
  assert.strictEqual(r.timers.length, 1);
});

test('no settings file at all is a first run', async () => {
  const r = await setup();
  assert.ok(r.exe.files.has(`library/${SAMPLE_ID}/buddy.json`));
  assert.strictEqual(r.timers.length, 0);
});

const twoOut = async (e: FakeExe) => {
  await e.shell.dataWrite('library/c1/buddy.json', manifest('c1', 'One'));
  await e.shell.dataWrite('library/c2/buddy.json', manifest('c2', 'Two'));
  await e.shell.dataWrite('settings.json', '{"out":["c2","c2"]}');
};
const library_ = (a: { dir: string }) => a.dir === 'library';
const writes = (exe: FakeExe) => exe.calls.filter(c => c.cmd === 'data_write').length;

test('until settings are read nothing changes who\'s out, and it says so in plain words', async () => {
  const r = await setup({}, async e => { await twoOut(e); e.failNext('data_read', 'sharing violation', settingsFile); });
  const { client, s } = await r.open();
  assert.strictEqual(row(s(), 'c2').copies, 0, 'shown, but nobody is out yet');
  for (const a of [await client.call('c1'), await client.callAnother('c2'), await client.dismiss('c2'), await client.dismissOne('c2'), await client.deleteBuddy('c1', revOf(client, 'c1'))]) {
    assert.ok(!a.ok);
    assert.strictEqual(`${a.failure.title}. ${a.failure.why}`, 'Still getting ready. Try again in a moment.');
  }
  assert.strictEqual(s().failures.length, 1, 'said once, however often it was asked');
  assert.ok(r.exe.files.has('library/c1/buddy.json'));
  assert.deepStrictEqual(settings(r.exe).out, ['c2', 'c2']);
  await r.retry();
  assert.strictEqual(row(s(), 'c2').copies, 2);
  assert.strictEqual(row(s(), 'c1').copies, 0, 'nothing refused comes back later');
  assert.deepStrictEqual(r.worldIds(), ['c2', 'c2~1']);
  assert.deepStrictEqual(settings(r.exe).out, ['c2', 'c2']);
  assert.deepStrictEqual(s().failures, [], 'and it stops saying it once it is ready');
  assert.ok((await client.call('c1')).ok);
});

test('a call then a dismiss before settings are read is refused, not quietly undone: the file stands', async () => {
  const r = await setup({}, async e => {
    await twoOut(e);
    await e.shell.dataWrite('settings.json', '{"out":["c1"]}');
    e.failNext('data_read', 'sharing violation', settingsFile);
  });
  const { client, s } = await r.open();
  assert.ok(!(await client.call('c1')).ok);
  assert.ok(!(await client.dismiss('c1')).ok);
  await r.retry();
  assert.strictEqual(row(s(), 'c1').status, 'out');
  assert.deepStrictEqual(settings(r.exe).out, ['c1']);
});

test('settings read but the library can\'t be listed: the step isn\'t done, and nothing writes over the file', async () => {
  let stop = () => {};
  const r = await setup({}, async e => { await twoOut(e); stop = e.failUntil('data_list', 'busy', library_); });
  const { client, s } = await r.open();
  stop();
  const before = writes(r.exe);
  const [a] = await client.importFiles([buddyFile('c3')], { call: true });
  assert.ok(a!.ok, 'it comes in');
  assert.strictEqual(row(s(), 'c3').status, 'home', 'but nobody comes out yet');
  assert.ok(!(await client.call('c3')).ok);
  assert.deepStrictEqual(settings(r.exe).out, ['c2', 'c2'], 'the file is safe');
  assert.ok(writes(r.exe) > before, 'the import itself did write');
  await r.retry();
  assert.strictEqual(row(s(), 'c2').copies, 2, 'and the roster is restored whole');
  assert.deepStrictEqual(settings(r.exe).out, ['c2', 'c2']);
  assert.ok((await client.call('c3')).ok);
  assert.deepStrictEqual(settings(r.exe).out.slice().sort(), ['c2', 'c2', 'c3']);
});

test('no settings write of any kind happens before the step finishes', async () => {
  const stop: (() => void)[] = [];
  const r = await setup({}, async e => { await twoOut(e); stop.push(e.failUntil('data_read', 'sharing violation', settingsFile)); });
  const { client } = await r.open();
  r.exe.calls.length = 0;
  await client.call('c1'); await client.deleteBuddy('c1', revOf(client, 'c1')); await client.setPaused(true); await client.setHidden(true);
  await r.clicked('buddy:c1');
  await r.retry();
  assert.ok(!r.exe.calls.some(c => c.cmd === 'data_write'), JSON.stringify(r.exe.calls.filter(c => c.cmd === 'data_write')));
  stop[0]!();
});

test('a tray item for a buddy does nothing until then, and puts the menu right', async () => {
  const r = await setup({}, async e => { await twoOut(e); e.failNext('data_read', 'sharing violation', settingsFile); });
  r.sent.length = 0; r.exe.calls.length = 0;
  await r.clicked('buddy:c1');
  assert.ok(r.exe.logs.some(l => /tray: still getting ready/.test(l)));
  assert.deepStrictEqual(r.sent.filter(m => m.k !== 'cursor'), []);
  assert.strictEqual(r.exe.calls.filter(c => c.cmd === 'tray_set').length, 1, 'the menu ticked itself, so it\'s set back');
  const { s } = await r.open();
  assert.deepStrictEqual(s().failures, []);
  await r.retry();
  assert.strictEqual(row(s(), 'c1').status, 'home');
});

test('a double-clicked file before then comes in without being called', async () => {
  const r = await setup({}, async e => { await twoOut(e); e.failNext('data_read', 'sharing violation', settingsFile); });
  r.exe.emit('open-file', { name: 'c3.buddy', content: write(small('c3')) }); await r.done();
  assert.ok(r.exe.files.has('library/c3/buddy.json'));
  assert.deepStrictEqual(settings(r.exe).out, ['c2', 'c2']);
  await r.retry();
  const { s } = await r.open();
  assert.strictEqual(row(s(), 'c3').status, 'home');
  assert.strictEqual(row(s(), 'c2').copies, 2);
});

test('hide, pause and export don\'t touch who\'s out, so they work meanwhile', async () => {
  const r = await setup({}, async e => { await lone(e); e.failNext('data_read', 'sharing violation', settingsFile); });
  const { client, s } = await r.open();
  assert.ok((await client.setPaused(true)).ok);
  assert.ok((await client.setHidden(true)).ok);
  assert.ok((await client.setPaused(false)).ok);
  assert.strictEqual(s().hidden, true);
  assert.deepStrictEqual(s().failures, []);
});

test('who\'s out restored while a copy still can\'t go back: the world, tray and Manager hear at once', async () => {
  const r = await setup({}, async e => {
    await e.shell.dataWrite('library/c1/buddy.json', manifest('c1', 'One'));
    await e.shell.dataWrite('library/.outgoing/c2/buddy.json', manifest('c2', 'Waiting'));
    await e.shell.dataWrite('settings.json', '{"out":["c1"]}');
    e.failNext('data_read', 'sharing violation', settingsFile);
    e.failNext('data_move', 'locked');
  });
  const { client, s } = await r.open();
  assert.strictEqual(row(s(), 'c1').status, 'home');
  r.exe.failNext('data_move', 'locked');
  await r.retry();
  assert.strictEqual(s().ready, false, 'the recovery still has work to do');
  assert.strictEqual(row(s(), 'c1').status, 'out');
  assert.deepStrictEqual(r.worldIds(), ['c1']);
  agree(r, s());
  assert.ok((await client.callAnother('c1')).ok, 'and commands work from here');
});

test('with no settings and a copy still to go back, who comes out waits for it, and commands wait too', async () => {
  const r = await setup({}, async e => {
    await e.shell.dataWrite('library/c1/buddy.json', manifest('c1', 'Other'));
    await e.shell.dataWrite(`library/.outgoing/a0/buddy.json`, manifest('a0', 'Aardvark'));
    e.failNext('data_move', 'locked');
  });
  const { client, s } = await r.open();
  assert.ok(!(await client.dismiss('c1')).ok);
  await r.retry();
  assert.strictEqual(row(s(), 'a0').status, 'out', 'the first buddy, once it\'s back');
  assert.ok((await client.dismiss('a0')).ok);
});

for (const [what, body] of [['not JSON', 'not json'], ['empty', ''], ['null', 'null'], ['a list', '[]'], ['a bad out', '{"out":5}'], ['bad ids', '{"out":[1]}']] as const) {
  test(`a corrupt settings file (${what}) doesn't seed, and doesn't retry`, async () => {
    const r = await setup({}, async e => { await e.shell.dataWrite('settings.json', body); });
    assert.ok(!r.exe.files.has(`library/${SAMPLE_ID}/buddy.json`));
    assert.ok(r.exe.logs.some(l => /settings file is damaged/.test(l)));
    assert.strictEqual(r.timers.length, 0);
    const { s } = await r.open();
    assert.strictEqual(s().ready, true);
  });

  test(`a corrupt settings file (${what}) with buddies: they stay, and the first comes out`, async () => {
    const r = await setup({}, async e => {
      await e.shell.dataWrite('library/c1/buddy.json', manifest('c1', 'One'));
      await e.shell.dataWrite('settings.json', body);
    });
    const { s } = await r.open();
    assert.strictEqual(row(s(), 'c1').status, 'out');
  });
}

/* one story */

test('whatever order things arrive in, the tray and the Manager agree', async () => {
  const r = await setup({}, async e => {
    for (const id of ['c1', 'c2']) await e.shell.dataWrite(`library/${id}/buddy.json`, manifest(id, id.toUpperCase()));
    await e.shell.dataWrite('settings.json', '{"out":[]}');
  });
  const { client, s } = await r.open();
  let seed = 7;
  const pick = (n: number) => { seed = seed * 1103515245 + 12345 & 0x7fffffff; return seed % n; };
  const ids = () => s().buddies.map(b => b.id);
  const moves: (() => Promise<unknown>)[] = [
    () => client.call(ids()[pick(ids().length)] ?? 'x'),
    () => client.callAnother(ids()[pick(ids().length)] ?? 'x'),
    () => client.dismiss(ids()[pick(ids().length)] ?? 'x'),
    () => client.dismissOne(ids()[pick(ids().length)] ?? 'x'),
    () => client.setHidden(!!pick(2)),
    () => client.setPaused(!!pick(2)),
    () => client.setAutostart(!!pick(2)),
    () => client.importFiles([buddyFile('c' + (3 + pick(3)))]),
    () => (id => client.deleteBuddy(id, revOf(client, id)))(ids()[pick(ids().length)] ?? 'x'),
    () => r.clicked(['hide', 'pause', 'autostart'][pick(3)]!),
    () => ids().length ? r.clicked('buddy:' + ids()[pick(ids().length)]) : Promise.resolve()
  ];
  /* It failed once in a full run under heavy load (11-09) and passed alone and in later full runs, so a
     failure has to say where it happened: the step, and the moves that led there. */
  const history: number[] = [];
  for (let i = 0; i < 300; i++) {
    const m = pick(moves.length);
    history.push(m);
    try {
      await moves[m]!();
      await r.done();
      agree(r, s());
      assert.deepStrictEqual(settings(r.exe).out.slice().sort(), s().buddies.flatMap(b => Array.from({ length: b.copies }, () => b.id)).sort());
    } catch (e) {
      throw new Error(`step ${i}, moves so far (last 12) ${history.slice(-12).join(',')}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
  }
});
