/* New and Edit: the window, and what the hub asks of a page already open. */
import assert from 'node:assert';
import fs from 'node:fs';
import { test } from 'vitest';
import type { MakerBoot, Said } from '../src/manager-api';
import { MAKER } from '../src/maker-window';
import { write } from '@buddies/buddy-file';
import { createDisk, holding, hubOn, importing, pageOn, saved, small } from './maker-harness';

async function hub() {
  const exe = createDisk(), r = await hubOn(exe), m = await r.manager();
  return { exe, r, m };
}
/* The Maker window the hub opened last, which has a label of its own. */
const specOf = (exe: ReturnType<typeof createDisk>) => [...exe.windows.values()].filter(w => w.page === 'maker.html').at(-1) as unknown as { label: string; boot: MakerBoot } & typeof MAKER;

test('the window is Peel\'s, on the page from the app folder', () => {
  assert.deepStrictEqual(MAKER, { kind: 'window', page: 'maker.html', title: 'Desktop Buddies Maker', width: 1180, height: 680, minWidth: 960, minHeight: 600, center: true, decorations: false, shadow: true });
});

test('Edit opens it with her in boot', async () => {
  const { exe, m } = await hub();
  assert.ok((await m.client.editBuddy('cseed')).ok);
  assert.strictEqual(specOf(exe).boot.id, 'cseed');
  assert.strictEqual(specOf(exe).page, 'maker.html');
  assert.strictEqual(specOf(exe).decorations, false);
  assert.strictEqual(exe.focused, specOf(exe).label);
});

test('New opens it with nobody in boot', async () => {
  const { exe, m } = await hub();
  assert.ok((await m.client.newBuddy()).ok);
  assert.ok(!('id' in specOf(exe).boot));
});

test('Edit for someone not in the library is refused, and opens nothing', async () => {
  const { exe, m } = await hub();
  const a = await m.client.editBuddy('nobody');
  assert.ok(!a.ok);
  assert.strictEqual(a.failure.title, "That buddy isn't here");
  assert.ok(!specOf(exe));
});

test('a window that won\'t open says so', async () => {
  const { exe, m } = await hub();
  exe.failNext('window_open', 'webview2 failed');
  const a = await m.client.newBuddy();
  assert.ok(!a.ok);
  assert.strictEqual(a.failure.title, "The Maker didn't open");
});

test('state says the Maker is there, so views offer New and Edit', async () => {
  const { m } = await hub();
  assert.strictEqual(m.s().maker, true);
});

test('open already: Edit for another brings it forward and tells the page, which flushes first', async () => {
  const s = await holding(small('c1', 'One'), small('c2', 'Two'));
  s.exe.focused = null;
  s.page.maker.setName('Mine');
  const opens = s.exe.calls.filter(c => c.cmd === 'window_open').length;
  assert.ok((await s.m.client.editBuddy('c2')).ok);
  await s.r.done();
  assert.strictEqual(s.exe.calls.filter(c => c.cmd === 'window_open').length, opens, 'no second window');
  assert.strictEqual(s.exe.focused, s.page.label);
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'Mine', 'flushed');
  assert.strictEqual(s.page.maker.current()?.character, 'c2');
  assert.deepStrictEqual(s.page.maker.state.pets.map(p => p.character), ['c1', 'c2']);
});

test('open already: New flushes, and leaves nobody selected', async () => {
  const s = await holding(small('c1'));
  s.page.maker.setName('Mine');
  await s.m.client.newBuddy();
  await s.r.done();
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'Mine');
  assert.strictEqual(s.page.maker.selected, null);
});

test('Edit for someone already open just selects her, with no reload over her edit', async () => {
  const s = await holding(small('c1', 'One'), small('c2', 'Two'));
  await s.m.client.editBuddy('c2');
  await s.r.done();
  s.page.maker.select(s.page.maker.state.pets.find(p => p.character === 'c1')!.id);
  const held = s.page.maker.current();
  s.page.maker.setName('Mine');
  s.exe.failUntil('data_write', 'disk full', () => true);
  await s.m.client.editBuddy('c2');
  await s.m.client.editBuddy('c1');
  await s.r.done();
  assert.strictEqual(s.page.maker.current(), held);
  assert.strictEqual(s.page.maker.current()!.name, 'Mine');
});

test('a page still loading picks up what it was asked after it opened', async () => {
  const s = await holding(small('c1', 'One'), small('c2', 'Two'));
  /* Two clicks: the window opening for c1, and the page not listening when c2 is asked for. */
  await s.m.client.editBuddy('c1');
  const boot = specOf(s.exe).boot;
  await s.m.client.editBuddy('c2');
  const late = pageOn(s.r, boot);
  await s.r.done();
  assert.strictEqual(late.maker.current()?.character, 'c2');
});

test('a page that heard already doesn\'t act on the same ask twice', async () => {
  const s = await holding(small('c1', 'One'), small('c2', 'Two'));
  await s.m.client.editBuddy('c2');
  await s.r.done();
  s.page.maker.select(s.page.maker.state.pets.find(p => p.character === 'c1')!.id);
  const wire = s.r.bus.wire();
  wire.post({ k: 'maker-hello', label: s.page.label } as Said);
  await s.r.done();
  assert.strictEqual(s.page.maker.current()?.character, 'c1', 'the hub said it again, and the page knew it had');
});

test('two asks at once make one window, and the second takes the focus', async () => {
  const { exe, m } = await hub();
  const hold = exe.hold('window_open');
  const both = [m.client.newBuddy(), m.client.editBuddy('cseed')];
  await new Promise(r => setTimeout(r, 5));
  hold();
  const answers = await Promise.all(both);
  assert.ok(answers.every(a => a.ok), JSON.stringify(answers));
  assert.strictEqual(exe.calls.filter(c => c.cmd === 'window_open' && (c.args as { spec: { page: string } }).spec.page === 'maker.html').length, 1, 'one at a time, so one window');
  assert.strictEqual(exe.focused, specOf(exe).label);
});

test('two asks at once: the page, however late, ends on the last one', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1', 'One'))), m = await r.manager();
  await importing(m, small('c2', 'Two'));
  await r.done();
  const hold = exe.hold('window_open');
  const edit = m.client.editBuddy('c2'), fresh = m.client.newBuddy();
  await new Promise(r => setTimeout(r, 5));
  hold();
  await Promise.all([edit, fresh]);
  const late = pageOn(r, specOf(exe).boot);
  await r.done();
  assert.ok(late.maker.state.pets.some(p => p.character === 'c2'), 'it opened her');
  assert.strictEqual(late.maker.selected, null, 'and was told New after');
});

/* minimized */

async function minimized() {
  const s = await holding(small('c1', 'One'), small('c2', 'Two'));
  await s.exe.shell.windowMinimize(s.page.label);
  return s;
}

test('minimized: the exe can\'t restore it, so it flushes, closes and opens a fresh one on who was asked for', async () => {
  const s = await minimized();
  s.page.maker.setName('Mine');
  const a = await s.m.client.editBuddy('c2');
  assert.ok(a.ok, JSON.stringify(a));
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'Mine', 'nothing lost');
  assert.ok(!s.exe.windows.has(s.page.label), 'the minimized one went');
  assert.ok(!(specOf(s.exe) as { minimized?: boolean }).minimized);
  assert.strictEqual(specOf(s.exe).boot.id, 'c2');
  assert.strictEqual(s.exe.focused, specOf(s.exe).label);
});

test('minimized, with an edit that won\'t save: it stays as it is, and the Manager says why', async () => {
  const s = await minimized();
  s.exe.failUntil('data_write', 'disk full', () => true);
  s.page.maker.setName('Mine');
  const a = await s.m.client.editBuddy('c2');
  assert.ok(!a.ok);
  assert.strictEqual(a.failure.title, "The Maker has an edit it couldn't save");
  assert.ok((s.exe.windows.get(s.page.label) as { minimized?: boolean }).minimized, 'the window holding the edit stays');
  assert.strictEqual(s.page.maker.current()!.name, 'Mine');
});

test('minimized with a page that never answers: it isn\'t closed over an edit', async () => {
  const exe = createDisk(), r = await hubOn(exe), m = await r.manager();
  assert.ok((await m.client.newBuddy()).ok); /* its page never says anything at all */
  const label = specOf(exe).label;
  await exe.shell.windowMinimize(label);
  const asked = m.client.editBuddy('cseed');
  await r.done();
  r.fire(40000);
  const a = await asked;
  assert.ok(!a.ok);
  assert.ok(exe.windows.has(label));
});

test('the hub stays free while a minimized window flushes: nothing deadlocks on the queue', async () => {
  const s = await minimized();
  s.page.maker.setName('Mine');
  let answered = false;
  const asked = s.m.client.editBuddy('c2').then(a => { answered = true; return a; });
  await s.r.done();
  assert.ok(answered, 'the flush got through the queue it would be waiting behind');
  assert.ok((await asked).ok);
});

/* files */

const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the page\'s CSP is as tight as the Manager\'s, and it asks for nothing off the machine', () => {
  const html = read('public/maker.html'), manager = read('public/manager.html');
  const csp = (s: string) => /Content-Security-Policy" content="([^"]+)"/.exec(s)![1]!;
  assert.strictEqual(csp(html), csp(manager));
  assert.doesNotMatch(html, /https?:\/\/(?!ipc\.localhost)/);
  assert.match(html, /<script src="maker\.js"><\/script>/, 'smoke.ps1 swaps its probe in for this');
  assert.match(html, /<title>Desktop Buddies Maker<\/title>/);
});

test('it\'s in the build, and in what a preview has to hold', () => {
  assert.match(read('package.json'), /--config vite\.maker\.config\.ts/);
  assert.match(read('scripts/preview.py'), /"maker\.html", "maker\.js"/);
  assert.match(read('vite.maker.config.ts'), /input: 'src\/maker\.ts'/);
});

test('the page never loads fonts or anything else from the network', () => {
  for (const f of ['src/maker.ts', 'src/maker-page.ts', 'src/maker-store.ts', 'src/maker-env.ts']) assert.doesNotMatch(read(f), /https?:\/\/|fetch\(|fonts\.g/, f);
});

