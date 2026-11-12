/* The Store package check's own page (shell-check/public/store/hub.js), run as it is against the fake
   exe in its packaged mode: what it writes is what store-package.ps1 reads. */
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'vitest';
import { text } from '../src/shell';
import { createFakeExe } from '../src/shell-fake';

const PAGE = fs.readFileSync(new URL('../shell-check/public/store/hub.js', import.meta.url), 'utf8');

async function runPage(packaged: boolean) {
  const exe = createFakeExe({ api: 2, packaged });
  vm.runInNewContext(PAGE, { window: { __TAURI__: { core: { invoke: exe.invoke } } }, TextEncoder, encodeURIComponent, String, JSON });
  for (let i = 0; i < 200 && !exe.calls.some(c => c.cmd === 'quit'); i++) await new Promise(r => setTimeout(r, 1));
  return exe;
}

test('packaged: the page writes its answers where the script reads them, then quits', async () => {
  const exe = await runPage(true);
  const file = exe.files.get('store-check.json');
  assert.ok(file, `written: ${[...exe.files.keys()].join(',')}; ${exe.logs.join(' | ')}`);
  const said = JSON.parse(text(file));
  assert.deepStrictEqual(said.info, { ok: { packaged: true, dataDir: 'C:\\data' } });
  assert.deepStrictEqual(['startBefore', 'startOn', 'startRead', 'startOff', 'startAfter'].map(k => said[k].ok), [false, true, true, false, false]);
  assert.deepStrictEqual(said.assoc, { ok: true });
  assert.match(said.assocSet.error, /declares \.buddy/);
  assert.ok(exe.logs.includes('STORE CHECK written'));
  assert.strictEqual(exe.calls.at(-1)!.cmd, 'quit');
});

test('not packaged: the page still writes, and says so', async () => {
  const exe = await runPage(false);
  const said = JSON.parse(text(exe.files.get('store-check.json')!));
  assert.strictEqual(said.info.ok.packaged, false);
  assert.deepStrictEqual(said.assoc, { ok: false });
});
