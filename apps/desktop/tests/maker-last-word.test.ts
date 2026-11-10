/* A closing window's last word, and the hub's answer to it: what the fourth review found. Each of
   these failed before its fix. */
import assert from 'node:assert';
import { write } from '@buddies/buddy-file';
import { test } from 'vitest';
import type { Command, Said } from '../src/manager-api';
import type { Wire } from '../src/wire';
import { createDisk, holding, hubOn, importing, makerOn, saved, small } from './maker-harness';

type Exe = ReturnType<typeof createDisk>;
const shelved = (exe: Exe) => [...exe.files.keys()].filter(k => /^library\/[^/.]+\/buddy\.json$/.test(k)).map(k => k.split('/')[1]!);
const copiesNamed = (exe: Exe, name: string) => shelved(exe).filter(c => saved(exe, c)!.name === name && c !== 'c1');
function losingFirst() {
  let lost: string | null = null;
  return (w: Wire<Said>): Wire<Said> => ({
    ...w,
    post(m) { if (m.k === 'do' && m.cmd.k === 'maker-save' && !lost) lost = m.id; w.post(m); },
    listen(f) { w.listen(m => { if (!(m.k === 'done' && m.id === lost)) f(m); }); }
  });
}

/* A replacement now asks first, and Replace is refused over a save it didn't ask about, so the
   only way in between is a save whose answer was lost: asked about the her it made. */
test('a last word repeating a save that landed, with a replacement in between: kept beside her, and told', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1'))), m = await r.manager();
  const page = await makerOn(r, 'c1', { wireOf: losingFirst() });
  await r.done();
  page.maker.setName('Mine');
  await page.pass(1300); /* Mine lands, and its answer is lost */
  assert.strictEqual(saved(exe, 'c1')!.name, 'Mine');
  const [q] = await m.client.importFiles([{ name: 'r.buddy', path: 'r.buddy', size: 1, text: async () => write(small('c1', 'Replacement')), url: async () => '' }]);
  assert.ok((await m.client.answerReplace(q!.ok ? q!.value!.asked! : '', 'replace')).ok);
  await r.done();
  exe.emit('quitting', null); /* the last word repeats Mine */
  await r.done();
  assert.strictEqual(saved(exe, 'c1')!.name, 'Replacement');
  assert.strictEqual(copiesNamed(exe, 'Mine').length, 1, 'Mine is beside her');
  assert.deepStrictEqual(m.s().failures.map(f => f.title), ["Mine's last edit is a new buddy"]);
});

test('a last word repeating a save whose write failed once tries again, and the Manager isn\'t told it was lost', async () => {
  const s = await holding(small('c1'));
  s.page.maker.setName('Mine');
  const hold = s.exe.hold('data_write');
  await s.page.pass(1300);
  s.exe.emit('quitting', null);
  await s.r.done();
  s.exe.failNext('data_write', 'disk full'); /* the held write fails, once */
  hold();
  await s.r.done();
  assert.strictEqual(saved(s.exe, 'c1')!.name, 'Mine', 'the repeat landed');
  assert.deepStrictEqual(s.m.s().failures.map(f => f.title), [], 'so nothing was lost');
});

test('a closing window\'s save kept beside her, said again and again: one copy, told once', async () => {
  const s = await holding(small('c1'));
  await importing(s.m, small('c1', 'Replacement'));
  await s.r.done();
  const sent: Extract<Command, { k: 'maker-save' }>[] = [], spy = s.r.bus.wire();
  spy.listen(m => { if (m.k === 'do' && m.cmd.k === 'maker-save') sent.push(m.cmd); });
  const hold = s.exe.hold('data_list', (a: { dir: string }) => a.dir === 'library');
  s.page.maker.setName('Mine');
  await s.page.pass(1300);
  await s.page.killed();
  for (let i = 0; i < 2; i++) spy.post({ k: 'do', id: `again${i}`, cmd: sent.at(-1)! });
  hold();
  await s.r.done();
  assert.strictEqual(copiesNamed(s.exe, 'Mine').length, 1);
  assert.deepStrictEqual(s.m.s().failures.map(f => f.title), ["Mine's last edit is a new buddy"]);
});

test('back to what was on disk, with the write before still unanswered: the last word says so', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1', 'Original'))), m = await r.manager();
  const page = await makerOn(r, 'c1', { wireOf: losingFirst() });
  await r.done();
  page.maker.setName('A');
  await page.pass(1300);
  assert.strictEqual(saved(exe, 'c1')!.name, 'A', 'A reached the disk, and its answer was lost');
  page.maker.setName('Original');
  await page.pass(11000);
  exe.emit('quitting', null);
  await r.done();
  const name = saved(exe, 'c1')!.name, told = m.s().failures.map(f => f.title);
  assert.ok(name === 'Original' || told.length > 0, `disk has ${name}, and the Manager was told ${JSON.stringify(told)}`);
});

test('two buddies\' last words, each kept beside her: one copy each, however they interleave', async () => {
  const s = await holding(small('c1', 'One'), small('c2', 'Two'));
  await s.page.edit('c2');
  await s.r.done();
  await importing(s.m, small('c1', 'One again'));
  await importing(s.m, small('c2', 'Two again'));
  await s.r.done();
  const hold = s.exe.hold('data_list', (a: { dir: string }) => a.dir === 'library');
  for (const [c, name] of [['c1', 'Mine one'], ['c2', 'Mine two']] as const) {
    s.page.maker.select(s.page.maker.state.pets.find(p => p.character === c)!.id);
    s.page.maker.setName(name);
  }
  await s.page.pass(1300);
  await s.page.killed(); /* both again, behind both */
  hold();
  await s.r.done();
  assert.strictEqual(copiesNamed(s.exe, 'Mine one').length, 1);
  assert.strictEqual(copiesNamed(s.exe, 'Mine two').length, 1);
});

test('a different edit landing leaves an earlier edit\'s failure showing', async () => {
  const s = await holding(small('c1'));
  await importing(s.m, small('c1', 'Replacement'));
  await s.r.done();
  const hold = s.exe.hold('data_list', (a: { dir: string }) => a.dir === 'library');
  s.page.maker.setName('A');
  await s.page.pass(1300); /* A goes out, and waits behind the held disk */
  await s.page.pass(30000); /* and times out */
  s.page.maker.setName('B');
  await s.page.pass(1300); /* B goes too, behind it */
  await s.page.killed();
  s.exe.failNext('data_write', 'disk full'); /* A's copy beside her fails, once */
  hold();
  await s.r.done();
  assert.strictEqual(copiesNamed(s.exe, 'B').length, 1, 'B is kept beside her');
  assert.ok(s.m.s().failures.some(f => f.title === "A's last edit wasn't saved"), JSON.stringify(s.m.s().failures.map(f => f.title)));
});
