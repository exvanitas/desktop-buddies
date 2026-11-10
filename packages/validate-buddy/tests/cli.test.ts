/* The command: one line per problem or a JSON report, exit 0 only when every file is clean, and
   anything that isn't one plain file refused before it's read. */
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, test, vi } from 'vitest';
import { CAPS } from '../src/index';
import { run } from '../src/cli';
import { REAL } from './real-images';
import * as m from './make';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* not run from this suite's own pnpm, whose INIT_CWD would carry over */
const fresh = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'INIT_CWD' && !k.startsWith('npm_')));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-buddy-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const put = (name: string, b: Uint8Array | string) => { fs.writeFileSync(path.join(dir, name), b); return name; };
const good = put('good.buddy', m.file([m.url('png', REAL.png), m.url('webp', REAL.webpAnimated)]));
const bad = put('bad.buddy', m.file([m.url('png', m.png(9000, 9000)), m.url('png', REAL.gif)]));

test('clean files exit 0 with one ok line each', () => {
  const r = run([good, good], dir);
  assert.strictEqual(r.code, 0);
  const lines = r.out.trim().split('\n');
  assert.strictEqual(lines.length, 2);
  assert.match(lines[0]!, /^good\.buddy: ok, 2 images, /);
});

test('a problem is one plain line, and any problem exits 1', () => {
  const r = run([good, bad], dir);
  assert.strictEqual(r.code, 1);
  assert.deepStrictEqual(r.out.trim().split('\n').slice(1), [
    'bad.buddy: main image: is 9000 x 9000 px, more than 2048 a side [too-wide]',
    'bad.buddy: walk frame 1: says png but its bytes are gif [type-mismatch]'
  ]);
});

test('--json gives the same, for machines', () => {
  const r = run(['--json', good, bad], dir);
  assert.strictEqual(r.code, 1);
  const d = JSON.parse(r.out);
  assert.deepStrictEqual(d.files.map((f: { file: string; ok: boolean }) => [f.file, f.ok]), [[good, true], [bad, false]]);
  assert.deepStrictEqual(d.files[1].problems.map((p: { code: string }) => p.code), ['too-wide', 'type-mismatch']);
  assert.strictEqual(typeof d.files[0].ms, 'number');
  assert.strictEqual(d.files[0].bytes, fs.statSync(path.join(dir, good)).size);
});

test('no files, or an unknown flag, is a usage error', () => {
  assert.strictEqual(run([], dir).code, 2);
  assert.strictEqual(run(['--fix', good], dir).code, 2);
});

test('a folder, a symlink, a zip, a missing file and a device are refused unread', () => {
  fs.mkdirSync(path.join(dir, 'shimeji'));
  fs.writeFileSync(path.join(dir, 'shimeji', 'shime1.png'), m.bytes(REAL.png));
  fs.symlinkSync(path.join(dir, good), path.join(dir, 'link.buddy'));
  put('pack.buddy', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0]));
  const r = run(['--json', 'shimeji', 'link.buddy', 'pack.buddy', 'gone.buddy', '/dev/zero'], dir);
  assert.strictEqual(r.code, 1);
  assert.deepStrictEqual(JSON.parse(r.out).files.map((f: { problems: { code: string }[] }) => f.problems.map(p => p.code)), [['folder'], ['symlink'], ['zip'], ['unreadable'], ['not-file']]);
});

test('a file over the cap is refused on its size, without being read', () => {
  const big = path.join(dir, 'big.buddy');
  fs.writeFileSync(big, '');
  fs.truncateSync(big, CAPS.file + 1); // sparse: nothing is really there
  const before = process.memoryUsage().rss, r = run([big], dir);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /\[too-big\]/);
  assert.ok(process.memoryUsage().rss - before < 32e6, 'read it anyway');
});

test('pnpm validate-buddy runs the command, with paths from where it was called', () => {
  const root = path.resolve(HERE, '../../..');
  const r = spawnSync('pnpm', ['-s', '--dir', root, 'validate-buddy', '--json', good, bad], { cwd: dir, env: fresh, encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(r.status, 1, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout).files.map((f: { ok: boolean }) => f.ok), [true, false]);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts['validate-buddy'], 'node packages/validate-buddy/bin/validate-buddy.mjs');
});

/* Review 1 */
test('the command runs on a Node without type stripping, as early 22.x is', () => {
  const root = path.resolve(HERE, '../../..');
  const r = spawnSync(process.execPath, ['--no-experimental-strip-types', path.join(root, 'packages/validate-buddy/bin/validate-buddy.mjs'), good], { cwd: dir, env: fresh, encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(r.status, 0, (r.stdout + r.stderr).slice(0, 1000));
  assert.match(r.stdout, /^good\.buddy: ok/);
});

test('a failed close is reported, not thrown', () => {
  const close = vi.spyOn(fs, 'closeSync').mockImplementation(() => { throw Object.assign(new Error('EIO: i/o error, close'), { code: 'EIO' }); });
  try {
    const r = run(['--json', good], dir);
    assert.strictEqual(r.code, 1);
    assert.deepStrictEqual(JSON.parse(r.out).files[0].problems.map((p: { code: string }) => p.code), ['unreadable']);
  } finally { close.mockRestore(); }
});

test('a file swapped between the look and the open is refused', () => {
  const real = fs.lstatSync, other = real(path.join(dir, bad));
  const look = vi.spyOn(fs, 'lstatSync').mockImplementation(((p: fs.PathLike) => path.basename(String(p)) === good ? other : real(p)) as typeof fs.lstatSync);
  try {
    const r = run(['--json', good], dir);
    assert.deepStrictEqual(JSON.parse(r.out).files[0].problems.map((p: { code: string }) => p.code), ['symlink']);
  } finally { look.mockRestore(); }
});
