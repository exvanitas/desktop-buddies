/* The end-to-end run's MCP driver, against the stand-in exe: what it says when everything works, when
   the app is still waiting to be allowed, and when something it expects doesn't come. */
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'vitest';
import { drive } from './drive.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, 'fake-exe.mjs'), DRIVE = path.join(here, 'drive.mjs');
const dirs = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
function scratch(mode = 'ok') {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'buddies-drive-')); dirs.push(data);
  const log = path.join(data, 'requests.log');
  return { data, log, env: { ...process.env, BUDDIES_DATA: data, FAKE_LOG: log, FAKE_MODE: mode } };
}
const asked = log => fs.readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(JSON.parse(l)[1]));
const states = lines => lines.map(l => l.split(' ').slice(0, 2).join(' '));

test('run: initialize, tools/list, then list, wave and say, one at a time, all passing', { timeout: 30000 }, async () => {
  const s = scratch();
  const text = 'Café \u{1F44B} | "ok"';
  const lines = await drive({ exe: FAKE, data: s.data, app: 'E2E MCP', phase: 'run', text, timeoutMs: 3000, env: s.env });
  assert.deepStrictEqual(states(lines), ['PASS mcp.initialize', 'PASS mcp.tools_list', 'PASS mcp.list', 'INFO mcp.buddy', 'PASS mcp.wave', 'PASS mcp.say', 'INFO mcp.said', 'PASS mcp.exit'], lines.join('\n'));
  assert.ok(lines.every(l => /^[\x20-\x7e]*$/.test(l)), 'plain ASCII');
  assert.ok(lines.includes('INFO mcp.buddy olive'));
  const reqs = asked(s.log);
  assert.deepStrictEqual(reqs.map(({ id, ...r }) => r), [
    { v: 1, app: 'E2E MCP', do: 'list' },
    { v: 1, app: 'E2E MCP', do: 'act', buddy: 'olive', action: 'wave' },
    { v: 1, app: 'E2E MCP', do: 'say', buddy: 'olive', text }
  ]);
});

test('waiting: the first call from an app not allowed yet says it\'s waiting', { timeout: 30000 }, async () => {
  const s = scratch('waiting');
  const lines = await drive({ exe: FAKE, data: s.data, app: 'E2E MCP', phase: 'waiting', timeoutMs: 3000, env: s.env });
  assert.deepStrictEqual(states(lines), ['PASS mcp.initialize', 'PASS mcp.tools_list', 'PASS mcp.waiting', 'PASS mcp.exit'], lines.join('\n'));
  assert.strictEqual(asked(s.log).length, 1);
});

test('what fails says FAIL with what came instead, and the run goes on to the end', { timeout: 30000 }, async () => {
  const waiting = scratch('waiting');
  const lines = await drive({ exe: FAKE, data: waiting.data, app: 'E2E MCP', phase: 'run', timeoutMs: 3000, env: waiting.env });
  assert.deepStrictEqual(states(lines), ['PASS mcp.initialize', 'PASS mcp.tools_list', 'FAIL mcp.list', 'PASS mcp.exit'], lines.join('\n'));
  assert.ok(/\(waiting\)/.test(lines[2]), lines[2]);
  const ok = scratch();
  const early = await drive({ exe: FAKE, data: ok.data, app: 'E2E MCP', phase: 'waiting', timeoutMs: 3000, env: ok.env });
  assert.ok(early.includes('FAIL mcp.waiting [{"id":"olive","name":"Olive","out":true,"copies":1,"can":["wave"]}]'), early.join('\n'));
  const silent = scratch('silent');
  const none = await drive({ exe: FAKE, data: silent.data, app: 'E2E MCP', phase: 'run', timeoutMs: 300, env: silent.env });
  assert.ok(none.some(l => /^FAIL mcp\.list No reply/.test(l)), none.join('\n'));
});

test('as a command: its lines, exit 1 on a FAIL, and its flags checked', { timeout: 30000 }, () => {
  const s = scratch('waiting');
  const run = spawnSync(process.execPath, [DRIVE, '--exe', FAKE, '--data', s.data, '--app', 'E2E MCP', '--phase', 'run', '--timeout', '3000'], { env: s.env, encoding: 'utf8' });
  assert.strictEqual(run.status, 1);
  assert.ok(/^FAIL mcp\.list /m.test(run.stdout), run.stdout);
  const fine = spawnSync(process.execPath, [DRIVE, '--exe', FAKE, '--data', s.data, '--app', 'E2E MCP', '--phase', 'waiting', '--timeout', '3000'], { env: s.env, encoding: 'utf8' });
  assert.strictEqual(fine.status, 0, fine.stdout);
  const bad = spawnSync(process.execPath, [DRIVE, '--exe', FAKE], { encoding: 'utf8' });
  assert.strictEqual(bad.status, 1);
  assert.ok(/^FAIL mcp\.usage needs --app --phase/.test(bad.stdout), bad.stdout);
  const odd = spawnSync(process.execPath, [DRIVE, '--app', 'E2E MCP', '--phase', 'later'], { encoding: 'utf8' });
  assert.ok(/^FAIL mcp\.usage needs --phase off\|waiting\|run/.test(odd.stdout), odd.stdout);
});

test('off, with no --exe or --data: the server picks them, here from the environment', { timeout: 30000 }, async () => {
  const s = scratch('off');
  const lines = await drive({ app: 'E2E MCP', phase: 'off', timeoutMs: 3000, env: { ...s.env, BUDDIES_EXE: FAKE } });
  assert.deepStrictEqual(states(lines), ['PASS mcp.initialize', 'PASS mcp.tools_list', 'PASS mcp.off', 'PASS mcp.exit'], lines.join('\n'));
  assert.strictEqual(asked(s.log).length, 1);
  const wrong = await drive({ app: 'E2E MCP', phase: 'off', timeoutMs: 3000, env: { ...scratch('waiting').env, BUDDIES_EXE: FAKE } });
  assert.ok(wrong.some(l => /^FAIL mcp\.off .*\(waiting\)$/.test(l)), wrong.join('\n'));
});
