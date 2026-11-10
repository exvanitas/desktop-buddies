/* The client against the fake exe, and the contract's two sides kept in step. */
import assert from 'node:assert';
import fs from 'node:fs';
import { test } from 'vitest';
import { createFakeExe } from '../src/shell-fake';
import { text } from '../src/shell';

const source = (f: string) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const called = () => new Set([...source('../src/shell.ts').matchAll(/(?:call(?:<[^>]+>)?|invoke)\('(\w+)'/g)].map(m => m[1]!));

test('the client knows every command the exe has, and no others', () => {
  const list = /generate_handler!\[([\s\S]*?)\]/.exec(source('../src-tauri/src/commands/mod.rs'))![1]!;
  const exe = list.split(',').map(s => s.trim().split('::').pop()!).filter(Boolean);
  assert.strictEqual(exe.length, 30);
  assert.deepStrictEqual([...called()].sort(), [...exe].sort());
});

test('the fake answers every command the client can send', () => {
  const fake = source('../src/shell-fake.ts');
  for (const cmd of called()) assert.match(fake, new RegExp(`\\b${cmd}:`), cmd);
});

test('nothing but shell.ts touches the exe', () => {
  for (const f of ['overlay', 'hub', 'hub-core', 'library', 'screens', 'tray', 'capture', 'world', 'host']) {
    assert.ok(!/\.(core|event)\.|invoke\(/.test(source(`../src/${f}.ts`).replace(/window\.__TAURI__/g, '')), f);
  }
});

test('a window can be minimized, and says so', async () => {
  const exe = createFakeExe();
  await exe.shell.windowOpen({ kind: 'window', label: 'w', page: 'p.html' });
  assert.strictEqual(await exe.shell.windowMinimized('w'), false);
  await exe.shell.windowMinimize('w');
  assert.strictEqual(await exe.shell.windowMinimized('w'), true);
  assert.deepStrictEqual(exe.calls.at(-2), { cmd: 'plugin:window|minimize', args: { label: 'w' } });
});

test('bytes go in and come out unchanged, through paths that need encoding', async () => {
  const { shell } = createFakeExe();
  const bytes = new Uint8Array([0, 255, 10, 13]);
  await shell.dataWrite('library/ñui é/a b.bin', bytes);
  assert.deepStrictEqual([...await shell.dataRead('library/ñui é/a b.bin')], [...bytes]);
  await shell.dataWrite('t.txt', 'héllo');
  assert.strictEqual(text(await shell.dataRead('t.txt')), 'héllo');
});

test('a listing shows files and folders', async () => {
  const { shell } = createFakeExe();
  await shell.dataWrite('a/b/c.txt', 'x'); await shell.dataWrite('d.txt', 'yy');
  assert.deepStrictEqual((await shell.dataList('')).map(e => [e.name, e.dir]), [['a', true], ['d.txt', false]]);
  assert.deepStrictEqual((await shell.dataList('a')).map(e => e.name), ['b']);
  await assert.rejects(shell.dataList('none'));
});

test('paths that leave are refused', async () => {
  const { shell } = createFakeExe();
  await assert.rejects(shell.dataRead('../x'));
  await assert.rejects(shell.dataWrite('a/../../x', 'x'));
  await assert.rejects(shell.dataDelete(''));
});

test('data commands say what changed', async () => {
  const exe = createFakeExe(), seen: string[] = [];
  await exe.shell.on('data-changed', e => seen.push(e.path));
  await exe.shell.dataWrite('a', 'x'); await exe.shell.dataMove('a', 'b'); await exe.shell.dataDelete('b');
  assert.deepStrictEqual(seen, ['a', 'a', 'b', 'b']);
});

test('files from launch are read once', async () => {
  const { shell } = createFakeExe({ opened: [{ name: 'a.buddy', content: '{}' }] });
  assert.strictEqual((await shell.takeOpened()).length, 1);
  assert.strictEqual((await shell.takeOpened()).length, 0);
});

test('window_place sends the rectangle flat, as the exe takes it', async () => {
  const exe = createFakeExe();
  await exe.shell.windowOpen({ kind: 'overlay', label: 'o', page: 'p.html', x: 0, y: 0, w: 1, h: 1 });
  await exe.shell.windowPlace('o', { x: 1, y: 2, w: 3, h: 4 });
  assert.deepStrictEqual(exe.calls.at(-1), { cmd: 'window_place', args: { label: 'o', x: 1, y: 2, w: 3, h: 4 } });
});

test('commands that read or set send nothing for a read', async () => {
  const exe = createFakeExe();
  assert.strictEqual(await exe.shell.autostart(), false);
  assert.strictEqual(await exe.shell.autostart(true), true);
  assert.strictEqual(await exe.shell.autostart(), true);
});
