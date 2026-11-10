/* Opening a file whose buddy is already in the library asks first, on every path in: the Manager's
   import, a file passed at launch, and one sent to a running app. Nothing replaces her without a
   click. The real hub on the fake exe, the real client on a memory wire. */
import assert from 'node:assert';
import { write, type Buddy } from '@buddies/buddy-file';
import { test } from 'vitest';
import type { Handed } from '../src/handed';
import type { Message } from '../src/host';
import { createHub } from '../src/hub-core';
import { createLibrary } from '../src/library';
import type { HubState, Imported, Said } from '../src/manager-api';
import { createManagerClient } from '../src/manager-client';
import { MANAGER } from '../src/manager-window';
import { text, type Monitor } from '../src/shell';
import { createFakeExe, type FakeExe, type FakeOptions } from '../src/shell-fake';
import { createBus } from '../src/wire';
import { holding, revOf, saved, small as art } from './maker-harness';

const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const small = (character: string, name = 'Pip', more: Partial<Buddy> = {}): Buddy => ({ character, name, base: { src: PNG, bb: box }, poses: {}, ...more });
const MONITOR: Monitor = { i: 0, name: 'A', primary: true, scale: 1, x: 0, y: 0, w: 1920, h: 1040, full: { x: 0, y: 0, w: 1920, h: 1080 } };
const tick = () => new Promise(r => setTimeout(r));
const handed = (path: string, body: string): Handed => ({ name: path.split('/').pop()!, path, size: body.length, text: async () => body, url: async () => 'data:' + path });
const fileOf = (b: Buddy, name = `${b.name}.buddy`) => handed(name, write(b));
const OLD = small('c1', 'Olive'), NEW = small('c1', 'Olive', { lines: { chat: ['A new line'] } } as Partial<Buddy>);

/* A run with Olive (c1) in the library, out, and the Manager closed. */
async function setup(o: FakeOptions = {}, prepare: (e: FakeExe) => Promise<void> = async () => {}) {
  const exe = createFakeExe({ monitors: [MONITOR], ...o, args: [...o.args ?? [], '--no-manager'] }), sent: Message[] = [], bus = createBus<Said>();
  await prepare(exe);
  let wire = bus.wire(), hub = createHub({ shell: exe.shell, send: m => sent.push(m), seed: async () => write(OLD), after: () => {}, wire });
  await hub.start();
  const done = async () => { for (let i = 0; i < 6; i++) { await tick(); await hub.settled; } };
  /* The hub alone goes, and a new one starts on the same disk and the same channel. */
  async function restart() {
    wire.close(); wire = bus.wire();
    hub = createHub({ shell: exe.shell, send: m => sent.push(m), seed: async () => write(OLD), after: () => {}, wire });
    await hub.start(); await done();
  }
  let windows = 0;
  async function open() {
    const client = createManagerClient({
      wire: bus.wire(), session: `w${++windows}`, after: () => () => {},
      shimeji: async () => small('ignored'), closeWindow: () => exe.shell.windowClose(MANAGER.label)
    });
    await done();
    return { client, s: () => client.state as HubState };
  }
  const manifest = (id = 'c1') => { const f = exe.files.get(`library/${id}/buddy.json`); return f ? text(f) : null; };
  const worldIds = () => (sent.filter(m => m.k === 'pets').pop() as Extract<Message, { k: 'pets' }> | undefined)?.pets.map(p => p.id) ?? [];
  return { exe, get hub() { return hub; }, bus, sent, done, open, manifest, worldIds, restart };
}
type Run = Awaited<ReturnType<typeof setup>>;
const asked = (s: HubState) => s.replacing ?? [];
const value = (a: { ok: boolean; value?: unknown }) => (a.ok ? a.value : undefined) as Imported | undefined;
/* The disk's writes since `n` calls ago, which a question must not make. */
const writes = (r: Run, from: number) => r.exe.calls.slice(from).filter(c => /^data_(write|move|delete)$/.test(c.cmd) && c.path !== 'settings.json' && !String(c.path ?? '').startsWith('logs'));

/* the Manager's import */

test('importing a file for someone in the library writes nothing, and asks', async () => {
  const r = await setup(), { client, s } = await r.open(), before = r.manifest(), n = r.exe.calls.length;
  const [a] = await client.importFiles([fileOf(NEW, 'olive-v2.buddy')]);
  await r.done();
  assert.ok(a!.ok, 'asking is not a failure');
  assert.ok(value(a!)?.asked, 'the answer says it asked');
  assert.strictEqual(value(a!)?.replaced, false);
  assert.strictEqual(r.manifest(), before, 'she is untouched');
  assert.deepStrictEqual(writes(r, n), []);
  assert.deepStrictEqual(asked(s()).map(q => [q.id, q.name, q.called, q.file]), [['c1', 'Olive', 'Olive', 'olive-v2.buddy']]);
  assert.deepStrictEqual(s().failures, []);
});

test('Replace replaces her, says so, and the question goes', async () => {
  const r = await setup(), { client, s } = await r.open();
  await client.importFiles([fileOf(NEW)]);
  const ask = asked(s())[0]!.ask;
  const a = await client.answerReplace(ask, 'replace');
  await r.done();
  assert.ok(a.ok && value(a)!.replaced, 'the replaced flag is set');
  assert.deepStrictEqual(saved(r.exe, 'c1')!.lines, NEW.lines);
  assert.deepStrictEqual(asked(s()), []);
});

test('Keep both adds the file as a new buddy beside her, with a new character', async () => {
  const r = await setup(), { client, s } = await r.open(), before = r.manifest();
  await client.importFiles([fileOf(small('c1', 'Olive Two'))]);
  const a = await client.answerReplace(asked(s())[0]!.ask, 'both');
  await r.done();
  assert.ok(a.ok);
  const id = value(a)!.id;
  assert.notStrictEqual(id, 'c1');
  assert.match(id, /^c[a-z0-9]+$/);
  assert.strictEqual(value(a)!.replaced, false);
  assert.strictEqual(r.manifest(), before, 'she is untouched');
  assert.deepStrictEqual(s().buddies.map(b => b.name).sort(), ['Olive', 'Olive Two']);
  assert.deepStrictEqual(asked(s()), []);
});

test('closing the question imports nothing', async () => {
  const r = await setup(), { client, s } = await r.open(), before = r.manifest(), n = r.exe.calls.length;
  await client.importFiles([fileOf(NEW)]);
  const a = await client.answerReplace(asked(s())[0]!.ask, 'none');
  await r.done();
  assert.ok(a.ok);
  assert.strictEqual(r.manifest(), before);
  assert.deepStrictEqual(writes(r, n), []);
  assert.deepStrictEqual(asked(s()), []);
  assert.strictEqual(s().buddies.length, 1);
});

test('an answer to a question that has gone does nothing, so a double click is one replace', async () => {
  const r = await setup(), { client, s } = await r.open();
  await client.importFiles([fileOf(small('c1', 'Two'))]);
  const ask = asked(s())[0]!.ask;
  const [one, two] = await Promise.all([client.answerReplace(ask, 'both'), client.answerReplace(ask, 'both')]);
  await r.done();
  assert.ok(one.ok && two.ok);
  assert.strictEqual(s().buddies.length, 2, 'one copy kept, not two');
  assert.ok(!(await client.answerReplace('nonsense', 'replace')).ok, 'a question this run never asked is refused');
  assert.strictEqual(s().buddies.length, 2);
});

/* every path asks */

test('a file sent to the running app (a double-click) asks, and opens the Manager to ask there', async () => {
  const r = await setup(), before = r.manifest(), n = r.exe.calls.length;
  assert.ok(!r.exe.windows.has('manager'));
  r.exe.emit('second-launch', { args: ['olive-v2.buddy'] });
  r.exe.emit('open-file', { name: 'olive-v2.buddy', content: write(NEW) }); await r.done();
  assert.strictEqual(r.manifest(), before);
  assert.deepStrictEqual(writes(r, n), []);
  assert.ok(r.exe.windows.has('manager'), 'the Manager opens to ask');
  const { client, s } = await r.open();
  assert.deepStrictEqual(asked(s()).map(q => q.file), ['olive-v2.buddy']);
  const a = await client.answerReplace(asked(s())[0]!.ask, 'replace');
  assert.ok(a.ok && value(a)!.replaced);
  assert.notStrictEqual(r.manifest(), before);
});

test('a file passed at the first launch asks too, and the Manager opens for it', async () => {
  /* the first run seeds Olive before it takes what it was opened with */
  const r = await setup({ opened: [{ name: 'olive-v2.buddy', content: write(NEW) }] });
  const { s } = await r.open();
  assert.ok(!/A new line/.test(r.manifest()!), 'she is untouched');
  assert.deepStrictEqual(asked(s()).map(q => q.file), ['olive-v2.buddy']);
  assert.ok(r.exe.windows.has('manager'));
});

test('a file passed at the first launch that matches nobody comes in as before, with no Manager', async () => {
  const r = await setup({ opened: [{ name: 'pip.buddy', content: write(small('c9', 'Pip')) }] });
  await r.done();
  assert.ok(r.exe.files.has('library/c9/buddy.json'));
  assert.ok(r.worldIds().includes('c9'));
  assert.ok(!r.exe.windows.has('manager'));
});

test('paused and hidden, it still asks, and replaces nothing', async () => {
  const r = await setup(), { client, s } = await r.open(), before = r.manifest();
  await client.setPaused(true); await client.setHidden(true);
  r.exe.emit('open-file', { name: 'olive-v2.buddy', content: write(NEW) }); await r.done();
  assert.strictEqual(r.manifest(), before);
  assert.strictEqual(asked(s()).length, 1);
});

test('the question waits in the hub: a Manager that closes and opens again still has it', async () => {
  const r = await setup(), first = await r.open();
  await first.client.importFiles([fileOf(NEW)]);
  first.client.subscribe(() => {})();
  const again = await r.open();
  assert.deepStrictEqual(asked(again.s()).map(q => q.id), ['c1']);
  assert.ok((await again.client.answerReplace(asked(again.s())[0]!.ask, 'replace')).ok);
  assert.ok(/A new line/.test(r.manifest()!));
});

test('a launched file that is answered Replace is called out, as a launched file always was', async () => {
  const r = await setup({}, async e => { await e.shell.dataWrite('settings.json', '{"out":[]}'); });
  const { client, s } = await r.open();
  r.exe.emit('open-file', { name: 'olive-v2.buddy', content: write(NEW) }); await r.done();
  assert.ok(!r.worldIds().includes('c1'));
  await client.answerReplace(asked(s())[0]!.ask, 'replace'); await r.done();
  assert.ok(r.worldIds().includes('c1'));
});

/* several, and the same one twice */

test('several files: the ones for nobody come in now, the rest are asked one at a time, in order', async () => {
  const r = await setup(), { client, s } = await r.open();
  await client.importFiles([fileOf(small('c2', 'Bea'))]);
  await r.done();
  const answers = await client.importFiles([fileOf(small('c1', 'Olive X'), 'a.buddy'), fileOf(small('c3', 'Cid'), 'b.buddy'), fileOf(small('c2', 'Bea 2'), 'c.buddy')]);
  await r.done();
  assert.deepStrictEqual(answers.map(a => !!value(a)?.asked), [true, false, true]);
  assert.ok(s().buddies.some(b => b.id === 'c3'), 'Cid came in at once');
  assert.deepStrictEqual(asked(s()).map(q => q.file), ['a.buddy', 'c.buddy']);
  await client.answerReplace(asked(s())[0]!.ask, 'none');
  assert.deepStrictEqual(asked(s()).map(q => q.file), ['c.buddy']);
});

test('the same file opened again while it waits is one question, not two', async () => {
  const r = await setup(), { client, s } = await r.open();
  const content = write(NEW);
  r.exe.emit('open-file', { name: 'olive-v2.buddy', content });
  r.exe.emit('open-file', { name: 'olive-v2.buddy', content }); await r.done();
  await client.importFiles([handed('olive-v2.buddy', content)]);
  await r.done();
  assert.strictEqual(asked(s()).length, 1);
});

test('two different files for her are two questions, and the second still asks after the first is answered', async () => {
  const r = await setup(), { client, s } = await r.open();
  await client.importFiles([fileOf(small('c1', 'One'), 'one.buddy'), fileOf(small('c1', 'Two'), 'two.buddy')]);
  assert.deepStrictEqual(asked(s()).map(q => q.file), ['one.buddy', 'two.buddy']);
  assert.ok(value(await client.answerReplace(asked(s())[0]!.ask, 'replace'))!.replaced);
  assert.strictEqual(saved(r.exe, 'c1')!.name, 'One');
  const a = await client.answerReplace(asked(s())[0]!.ask, 'replace');
  assert.ok(a.ok && value(a)!.replaced, 'her own Replace a moment ago isn\'t a change behind her back');
  assert.strictEqual(saved(r.exe, 'c1')!.name, 'Two');
});

test('a file identical to her skips the question, and says she\'s up to date', async () => {
  const r = await setup(), { client, s } = await r.open(), n = r.exe.calls.length;
  const [a] = await client.importFiles([fileOf(OLD)]);
  await r.done();
  assert.ok(a!.ok && value(a!)!.upToDate);
  assert.deepStrictEqual(asked(s()), []);
  assert.deepStrictEqual(writes(r, n), []);
});

test('her own export, opened again, is identical too', async () => {
  const r = await setup(), { client, s } = await r.open();
  r.exe.dialog = true;
  await client.exportBuddy('c1');
  const [a] = await client.importFiles([handed('Olive.buddy', r.exe.saved[0]!.content)]);
  assert.ok(a!.ok && value(a!)!.upToDate, JSON.stringify(a));
  assert.deepStrictEqual(asked(s()), []);
});

test('a Shimeji folder is a new buddy, as always, and never asks', async () => {
  const r = await setup(), { client, s } = await r.open();
  const [a] = await client.importFiles([handed('Olive/shime1.png', '')]);
  assert.ok(a!.ok && !value(a!)!.asked);
  assert.deepStrictEqual(asked(s()), []);
  assert.strictEqual(s().buddies.length, 2);
});

test('a file for someone on disk the shelf couldn\'t read asks too, by the file\'s name', async () => {
  const r = await setup({}, async e => {
    await createLibrary(e.shell, () => {}).add(write(OLD));
    await e.shell.dataWrite('settings.json', '{"out":[],"noSeed":true}');
    e.failNext('data_read', 'locked', (x: never) => (x as { path: string }).path === 'library/c1/buddy.json');
  });
  const { client, s } = await r.open(), before = r.manifest();
  assert.ok(!s().buddies.some(b => b.id === 'c1'));
  const [a] = await client.importFiles([fileOf(small('c1', 'Imported'))]);
  assert.ok(value(a!)!.asked);
  assert.strictEqual(r.manifest(), before);
  assert.deepStrictEqual(asked(s()).map(q => [q.name, q.called]), [['Imported', 'Imported']]);
});

test('too many waiting: the next one is refused and says why, and nothing is replaced', async () => {
  const r = await setup(), { client, s } = await r.open(), before = r.manifest();
  for (let i = 0; i < 60; i++) r.exe.emit('open-file', { name: `v${i}.buddy`, content: write(small('c1', `Olive ${i}`)) });
  await r.done();
  assert.strictEqual(r.manifest(), before);
  assert.ok(asked(s()).length < 60 && asked(s()).length >= 20, String(asked(s()).length));
  assert.ok(s().failures.some(f => /waiting/.test(f.why)), JSON.stringify(s().failures.map(f => f.why)));
});

test('a page that still sends the old "any" is asked, not obeyed', async () => {
  const r = await setup(), { s } = await r.open(), before = r.manifest(), wire = r.bus.wire();
  const answer = new Promise<unknown>(done => wire.listen(m => { if (m.k === 'done' && m.id === 'old') done(m.answer); }));
  wire.post({ k: 'do', id: 'old', cmd: { k: 'import', name: 'olive.buddy', content: write(NEW), rev: 'any' as never } });
  await answer; await r.done();
  assert.strictEqual(r.manifest(), before);
  assert.strictEqual(asked(s()).length, 1);
});

/* she changes while it waits */

test('saved in the Maker while it waits: Replace is refused, and the Maker\'s save stays', async () => {
  const h = await holding(art('c1', 'Olive'));
  await h.r.done();
  await h.m.client.importFiles([fileOf(art('c1', 'From file'))]);
  await h.r.done();
  const ask = (h.m.s().replacing ?? [])[0]!.ask;
  h.page.maker.setName('Edited');
  await h.page.pass(1300);
  assert.strictEqual(saved(h.exe, 'c1')!.name, 'Edited');
  const a = await h.m.client.answerReplace(ask, 'replace');
  await h.r.done();
  assert.ok(!a.ok);
  assert.strictEqual(a.failure.why, 'That buddy changed since you tried, so nothing was replaced.');
  assert.strictEqual(saved(h.exe, 'c1')!.name, 'Edited', 'the newer save stays');
  assert.deepStrictEqual(h.m.s().replacing, []);
});

test('deleted while it waits: Replace brings her in from the file, since nothing newer is lost', async () => {
  const r = await setup(), { client, s } = await r.open();
  await client.importFiles([fileOf(small('c1', 'From file'))]);
  assert.ok((await client.deleteBuddy('c1', revOf(client, 'c1'))).ok);
  assert.ok(!r.manifest());
  const a = await client.answerReplace(asked(s())[0]!.ask, 'replace');
  await r.done();
  assert.ok(a.ok && value(a)!.replaced === false, 'she came in, she didn\'t replace anyone');
  assert.strictEqual(saved(r.exe, 'c1')!.name, 'From file');
});

test('the Maker open on her still hears she was replaced, after Replace', async () => {
  const h = await holding(art('c1', 'Olive'));
  await h.m.client.importFiles([fileOf(art('c1', 'Replacement'))]);
  await h.r.done();
  assert.strictEqual(saved(h.exe, 'c1')!.name, 'Olive', 'asking replaced nothing');
  assert.ok((await h.m.client.answerReplace((h.m.s().replacing ?? [])[0]!.ask, 'replace')).ok);
  await h.r.done();
  h.page.maker.setName('Mine');
  await h.page.pass(1300);
  const st = h.page.saveState as { kind: string; title?: string };
  assert.strictEqual(st.kind, 'failed');
  assert.strictEqual(st.title, 'Mine changed somewhere else');
  assert.strictEqual(saved(h.exe, 'c1')!.name, 'Replacement');
});

test('a store that fails after Replace says so, and asks again rather than losing the file', async () => {
  const r = await setup(), { client, s } = await r.open(), before = r.manifest();
  await client.importFiles([fileOf(NEW)]);
  const ask = asked(s())[0]!.ask;
  r.exe.failNext('data_write', 'disk full');
  const a = await client.answerReplace(ask, 'replace');
  await r.done();
  assert.ok(!a.ok);
  assert.strictEqual(a.failure.why, "It couldn't be saved into your library.");
  assert.strictEqual(r.manifest(), before);
  assert.deepStrictEqual(asked(s()).map(q => q.ask), [ask], 'still asked');
  assert.ok((await client.answerReplace(ask, 'replace')).ok);
  assert.ok(/A new line/.test(r.manifest()!));
});

/* review 1 */

test('after a hub restart, a page\'s answer to a question from before is refused, and the new question waits', async () => {
  const r = await setup(), { client, s } = await r.open(), before = r.manifest();
  await client.importFiles([fileOf(small('c1', 'Old pending'))]);
  const old = asked(s())[0]!.ask;
  await r.restart();
  await client.importFiles([fileOf(small('c1', 'New pending'))]);
  await r.done();
  assert.notStrictEqual(asked(s())[0]!.ask, old, 'a new run asks by ids of its own');
  const a = await client.answerReplace(old, 'replace');
  await r.done();
  assert.ok(!a.ok, 'an id this run never gave out is refused');
  assert.strictEqual(r.manifest(), before);
  assert.deepStrictEqual(asked(s()).map(q => q.called), ['New pending']);
});

test('only the question shown, the oldest, can be answered', async () => {
  const r = await setup(), { client, s } = await r.open(), before = r.manifest();
  await client.importFiles([fileOf(small('c1', 'First'), 'a.buddy'), fileOf(small('c1', 'Second'), 'b.buddy')]);
  await client.answerReplace(asked(s())[1]!.ask, 'replace');
  await r.done();
  assert.strictEqual(r.manifest(), before);
  assert.deepStrictEqual(asked(s()).map(q => q.file), ['a.buddy', 'b.buddy']);
});

test('an import that names her revision asks like any other', async () => {
  const r = await setup(), { client, s } = await r.open(), before = r.manifest();
  const rev = s().buddies.find(b => b.id === 'c1')!.rev;
  const [a] = await client.retryImport([fileOf(NEW)], rev);
  await r.done();
  assert.ok(a!.ok && value(a!)!.asked, JSON.stringify(a));
  assert.strictEqual(r.manifest(), before);
});

for (const how of ['missing', 'cut short'] as const) {
  test(`her own file asks, not "up to date", when an image of hers is ${how}, and Replace mends her`, async () => {
    const r = await setup(), { client, s } = await r.open();
    const image = [...r.exe.files.keys()].find(k => k.startsWith('library/c1/') && !k.endsWith('buddy.json'))!;
    if (how === 'missing') r.exe.files.delete(image); else r.exe.files.set(image, r.exe.files.get(image)!.slice(0, 3));
    const [a] = await client.importFiles([fileOf(OLD)]);
    assert.ok(a!.ok && value(a!)!.asked && !value(a!)!.upToDate, JSON.stringify(a));
    await client.answerReplace(asked(s())[0]!.ask, 'replace');
    assert.ok(r.exe.files.get(image)!.length > 3, 'her image is back whole');
  });
}

test('a flood of files sent while the disk is slow is refused at the door past the limit, not held', async () => {
  const r = await setup(), { s } = await r.open();
  const go = r.exe.hold('data_read', (x: never) => (x as { path: string }).path === 'library/c1/buddy.json');
  r.exe.emit('open-file', { name: 'held.buddy', content: write(small('c1', 'Held')) });
  await tick();
  for (let n = 0; n < 60; n++) r.exe.emit('open-file', { name: `${n}.buddy`, content: write(small('c1', `Queued ${n}`)) });
  await tick();
  const refused = s().failures.filter(f => /waiting/.test(f.why)).length;
  assert.ok(refused >= 10, `refused before the queue was reached: ${refused}`);
  go(); await r.done();
  assert.ok(asked(s()).length <= 50, String(asked(s()).length));
});

test('the same file sent again by a double-click keeps the double-click\'s call', async () => {
  const r = await setup({}, async e => { await e.shell.dataWrite('settings.json', '{"out":[]}'); });
  const { client, s } = await r.open(), content = write(NEW);
  await client.importFiles([handed('olive-v2.buddy', content)]);
  r.exe.emit('open-file', { name: 'olive-v2.buddy', content }); await r.done();
  assert.strictEqual(asked(s()).length, 1);
  await client.answerReplace(asked(s())[0]!.ask, 'replace'); await r.done();
  assert.ok(r.worldIds().includes('c1'), 'she comes out, as a double-clicked file always does');
});

/* review 2 */

test('a flood of Manager imports while the disk is slow is refused at the door past the limit, by the same rule', async () => {
  const r = await setup(), { client, s } = await r.open();
  const go = r.exe.hold('data_read', (x: never) => (x as { path: string }).path === 'library/c1/buddy.json');
  void client.importFiles([fileOf(small('c1', 'Held'), 'held.buddy')]);
  await tick(); await tick();
  const sent = Array.from({ length: 60 }, (_, n) => client.importFiles([fileOf(small('c1', `Dropped ${n}`), `${n}.buddy`)]));
  for (let i = 0; i < 6; i++) await tick();
  const refused = s().failures.filter(f => /waiting/.test(f.why)).length;
  assert.ok(refused >= 10, `refused before the queue was reached: ${refused}`);
  go(); await Promise.all(sent); await r.done();
  assert.ok(asked(s()).length <= 50, String(asked(s()).length));
});
