/* The MCP server: its protocol on a stream, its tools on a stand-in launch, and the whole thing as
   a process over stdio against a stand-in exe that writes replies like the app. */
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'vitest';
import { slotOf as hubSlot } from '../../../apps/desktop/src/api-replies';
import { MAX_FRAME, TOOLS, VERSIONS, config, createBridge, createTools, serve, slotOf } from '../server.mjs';

/* Where the app puts the reply to `id`. */
const slotFile = (dir, id) => path.join(dir, 'api', 'replies', `${slotOf(id)}.json`);

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, '..', 'server.mjs'), FAKE = path.join(here, 'fake-exe.mjs');
const dirs = [];
const scratch = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'buddies-mcp-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

/* A server on in-memory streams: send a message, read the replies. */
function onStreams(tools) {
  const input = new PassThrough(), output = new PassThrough(), lines = [];
  let buf = '';
  output.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const done = serve(input, output, tools);
  const send = m => input.write(typeof m === 'string' ? m + '\n' : JSON.stringify(m) + '\n');
  const reply = async id => { for (let i = 0; i < 200; i++) { const r = lines.find(l => l.id === id); if (r) return r; await new Promise(r => setTimeout(r, 5)); } throw new Error(`no reply to ${id}`); };
  return { send, reply, lines, end: () => { input.end(); return done; } };
}

test('config: flags, then the environment, then Windows defaults', () => {
  const d = config([], { APPDATA: 'C:\\Users\\a\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' });
  assert.strictEqual(d.dataDir, 'C:\\Users\\a\\AppData\\Roaming\\dev.exvanitas.desktop-buddies');
  assert.strictEqual(d.exe, 'C:\\Users\\a\\AppData\\Local\\Desktop Buddies\\desktop-buddies.exe');
  assert.strictEqual(d.app, 'AI agent');
  assert.strictEqual(d.timeoutMs, 10000);
  const e = config([], { BUDDIES_EXE: 'E', BUDDIES_DATA: 'D', BUDDIES_APP: 'Claude Code', BUDDIES_TIMEOUT_MS: '500' });
  assert.deepStrictEqual(e, { exe: 'E', dataDir: 'D', app: 'Claude Code', timeoutMs: 500 });
  const f = config(['--exe', 'X', '--data', 'Y', '--app', 'Z', '--timeout', '7'], { BUDDIES_EXE: 'E', BUDDIES_DATA: 'D' });
  assert.deepStrictEqual(f, { exe: 'X', dataDir: 'Y', app: 'Z', timeoutMs: 7 });
});

test('protocol: initialize, ping, tools/list, and the errors', async () => {
  const s = onStreams({});
  s.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  const init = await s.reply(1);
  assert.strictEqual(init.result.protocolVersion, '2025-03-26');
  assert.deepStrictEqual(init.result.capabilities, { tools: {} });
  s.send({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.strictEqual((await s.reply(2)).result.protocolVersion, VERSIONS[0]);
  s.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  s.send({ jsonrpc: '2.0', id: 3, method: 'ping' });
  assert.deepStrictEqual((await s.reply(3)).result, {});
  s.send({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
  assert.deepStrictEqual((await s.reply(4)).result.tools.map(t => t.name), ['list_buddies', 'wave', 'say']);
  s.send({ jsonrpc: '2.0', id: 5, method: 'nope' });
  assert.strictEqual((await s.reply(5)).error.code, -32601);
  s.send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'delete_everything', arguments: {} } });
  assert.strictEqual((await s.reply(6)).error.code, -32602);
  s.send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'constructor' } });
  assert.strictEqual((await s.reply(7)).error.code, -32602);
  s.send('not json');
  await new Promise(r => setTimeout(r, 20));
  assert.ok(s.lines.some(l => l.id === null && l.error.code === -32700));
  assert.strictEqual(s.lines.filter(l => !('id' in l)).length, 0, 'notifications get nothing');
  await s.end();
});

test('tools: each asks the app one thing, with the app\'s name and a fresh id', async () => {
  const dir = scratch(), sent = [];
  const launch = async (exe, args) => {
    assert.strictEqual(exe, 'the.exe');
    assert.strictEqual(args[0], '--api');
    const req = JSON.parse(args[1]); sent.push(req);
    const reply = req.do === 'list' ? { v: 1, id: req.id, ok: true, buddies: [{ id: 'olive', name: 'Olive', out: true, copies: 1, can: ['wave'] }] } : { v: 1, id: req.id, ok: true };
    fs.mkdirSync(path.join(dir, 'api', 'replies'), { recursive: true });
    fs.writeFileSync(slotFile(dir, req.id), JSON.stringify(reply));
  };
  const c = { exe: 'the.exe', dataDir: dir, app: 'Test App', timeoutMs: 1000 };
  const tools = createTools(createBridge({ ...c, launch, poll: 5 }), c);
  assert.deepStrictEqual(JSON.parse((await tools.list_buddies({})).content[0].text), [{ id: 'olive', name: 'Olive', out: true, copies: 1, can: ['wave'] }]);
  assert.strictEqual((await tools.wave({ buddy: 'olive' })).isError, undefined);
  assert.strictEqual((await tools.say({ buddy: 'olive', text: 'Hi!' })).isError, undefined);
  assert.deepStrictEqual(sent.map(({ id, ...r }) => r), [
    { v: 1, app: 'Test App', do: 'list' },
    { v: 1, app: 'Test App', do: 'act', buddy: 'olive', action: 'wave' },
    { v: 1, app: 'Test App', do: 'say', buddy: 'olive', text: 'Hi!' }
  ]);
  assert.strictEqual(new Set(sent.map(r => r.id)).size, 3);
  assert.ok(sent.every(r => /^[A-Za-z0-9_-]{8,64}$/.test(r.id)));
  assert.strictEqual((await tools.wave({})).isError, true, 'bad arguments never reach the app');
  assert.strictEqual(sent.length, 3);
});

test('tools: a refusal, no reply, and no exe each say so', async () => {
  const dir = scratch();
  const refuse = async (_, args) => {
    const req = JSON.parse(args[1]);
    fs.mkdirSync(path.join(dir, 'api', 'replies'), { recursive: true });
    fs.writeFileSync(slotFile(dir, req.id), JSON.stringify({ v: 1, id: req.id, ok: false, error: 'off', message: 'The person hasn\'t turned this on.' }));
  };
  const c = { exe: 'x', dataDir: dir, app: 'A', timeoutMs: 100 };
  const off = await createTools(createBridge({ ...c, launch: refuse, poll: 5 }), c).wave({ buddy: 'olive' });
  assert.deepStrictEqual(off, { content: [{ type: 'text', text: 'The person hasn\'t turned this on. (off)' }], isError: true });
  const silent = await createTools(createBridge({ ...c, launch: async () => {}, poll: 5 }), c).list_buddies({});
  assert.ok(silent.isError && /No reply/.test(silent.content[0].text));
  const missing = { ...c, exe: path.join(dir, 'no-such.exe') };
  const gone = await createTools(createBridge(missing), missing).list_buddies({});
  assert.ok(gone.isError && /Couldn't start/.test(gone.content[0].text), gone.content[0].text);
});

/* The real thing: the server as a process, the stand-in as its exe. */
async function run(env) {
  const dir = scratch(), log = path.join(dir, 'requests.log');
  const child = spawn(process.execPath, [SERVER, '--exe', FAKE, '--data', dir, '--app', 'Test App', '--timeout', '3000'], { env: { ...process.env, BUDDIES_DATA: dir, FAKE_LOG: log, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = []; let buf = '';
  child.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const call = async (id, method, params) => {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    for (let i = 0; i < 400; i++) { const r = lines.find(l => l.id === id); if (r) return r; await new Promise(r => setTimeout(r, 10)); }
    throw new Error(`no reply to ${id}`);
  };
  const stop = () => new Promise(r => { child.once('exit', r); child.stdin.end(); });
  return { call, stop, log, dir };
}

test('over stdio against a stand-in exe: list, wave and say', { timeout: 20000 }, async () => {
  const s = await run({});
  assert.strictEqual((await s.call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })).result.serverInfo.name, 'desktop-buddies');
  const list = await s.call(2, 'tools/call', { name: 'list_buddies', arguments: {} });
  assert.deepStrictEqual(JSON.parse(list.result.content[0].text)[0], { id: 'olive', name: 'Olive', out: true, copies: 1, can: ['wave'] });
  assert.strictEqual((await s.call(3, 'tools/call', { name: 'wave', arguments: { buddy: 'olive' } })).result.content[0].text, 'She waved.');
  assert.strictEqual((await s.call(4, 'tools/call', { name: 'say', arguments: { buddy: 'olive', text: 'Tests pass!' } })).result.content[0].text, 'She said it.');
  await s.stop();
  const asked = fs.readFileSync(s.log, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.strictEqual(asked.length, 3);
  assert.ok(asked.every(a => a.length === 2 && a[0] === '--api'), 'one argument, the request');
  assert.deepStrictEqual(JSON.parse(asked[2][1]).text, 'Tests pass!');
});

test('over stdio: waiting for consent, and an app that wasn\'t running', { timeout: 20000 }, async () => {
  const waiting = await run({ FAKE_MODE: 'waiting' });
  const w = await waiting.call(1, 'tools/call', { name: 'wave', arguments: { buddy: 'olive' } });
  assert.ok(w.result.isError && /allow this app/.test(w.result.content[0].text));
  await waiting.stop();
  const cold = await run({ FAKE_MODE: 'not-running' });
  const c = await cold.call(1, 'tools/call', { name: 'list_buddies', arguments: {} });
  assert.ok(c.result.isError && /not-running/.test(c.result.content[0].text));
  await cold.stop();
});

test('the tool list matches what the app takes', () => {
  assert.deepStrictEqual(TOOLS.find(t => t.name === 'say').inputSchema.properties.text.maxLength, 120);
  for (const t of TOOLS) assert.strictEqual(t.inputSchema.additionalProperties, false);
});

/* From the first review */

test('a frame over the cap is refused before it is parsed, and the server goes on', async () => {
  const s = onStreams({});
  s.send('x'.repeat(MAX_FRAME * 2));
  s.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
  assert.deepStrictEqual((await s.reply(1)).result, {});
  const big = s.lines.find(l => l.id === null && l.error && /too large/.test(l.error.message));
  assert.ok(big, JSON.stringify(s.lines.slice(0, 3)));
  await s.end();
});

test('an unterminated frame is dropped at the cap, not held', async () => {
  const input = new PassThrough(), output = new PassThrough(), lines = [];
  output.on('data', d => { for (const l of String(d).split('\n').filter(Boolean)) lines.push(JSON.parse(l)); });
  const done = serve(input, output, {});
  for (let i = 0; i < 40; i++) input.write('y'.repeat(64 * 1024));
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(lines.filter(l => l.id === null).length, 1, 'refused as soon as it passes the cap, before it ends');
  input.write('\n' + JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }) + '\n');
  for (let i = 0; i < 100 && !lines.some(l => l.id === 2); i++) await new Promise(r => setTimeout(r, 5));
  assert.ok(lines.some(l => l.id === 2));
  assert.strictEqual(lines.filter(l => l.id === null).length, 1, 'one refusal for the whole oversized frame');
  input.end(); await done;
});

test('a bad JSON-RPC id or version is refused, and never crashes the server', async () => {
  const s = onStreams({});
  const nested = '['.repeat(10000) + ']'.repeat(10000);
  s.send(`{"jsonrpc":"2.0","id":${nested},"method":"ping"}`);
  s.send({ jsonrpc: '2.0', id: { a: 1 }, method: 'ping' });
  s.send({ jsonrpc: '2.0', id: 'x'.repeat(500), method: 'ping' });
  s.send({ jsonrpc: '2.0', id: true, method: 'ping' });
  s.send({ id: 5, method: 'ping' });
  s.send({ jsonrpc: '1.0', id: 6, method: 'ping' });
  s.send({ jsonrpc: '2.0', id: 7, method: 'ping' });
  assert.deepStrictEqual((await s.reply(7)).result, {});
  const refused = s.lines.filter(l => l.error && l.error.code === -32600);
  assert.strictEqual(refused.length, 6, JSON.stringify(s.lines));
  assert.ok(refused.slice(0, 4).every(l => l.id === null), 'a bad id is never echoed');
  await s.end();
});

test('a write that throws stops the server with 1, and nothing is left unhandled', async () => {
  const input = new PassThrough();
  const output = { on() {}, write() { throw new Error('closed'); } };
  const done = serve(input, output, {});
  input.write('not json\n'); /* refused straight from the reader */
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n');
  assert.strictEqual(await done, 1);
});

test('the reply deadline runs on a monotonic clock', { timeout: 5000 }, async () => {
  const real = Date.now;
  let calls = 0;
  Date.now = () => real() - (calls++ > 0 ? 3_600_000 : 0);
  try {
    const started = performance.now();
    const r = await createBridge({ exe: 'x', dataDir: scratch(), app: 'A', timeoutMs: 100, launch: async () => {}, poll: 5 })({ do: 'list' });
    assert.strictEqual(r, null);
    assert.ok(performance.now() - started < 2000);
  } finally { Date.now = real; }
});

/* From the second review, and the simpler design */

test('one message at a time: input is paused while a call runs, and a ping waits its turn', async () => {
  let release = () => {};
  const tools = { list_buddies: () => new Promise(r => { release = () => r({ content: [{ type: 'text', text: 'ok' }] }); }) };
  const input = new PassThrough(), output = new PassThrough(), lines = [];
  output.on('data', d => { for (const l of String(d).split('\n').filter(Boolean)) lines.push(JSON.parse(l)); });
  const done = serve(input, output, tools);
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_buddies', arguments: {} } }) + '\n');
  await new Promise(r => setTimeout(r, 20));
  for (let i = 2; i < 10; i++) input.write(JSON.stringify({ jsonrpc: '2.0', id: i, method: 'ping' }) + '\n');
  await new Promise(r => setTimeout(r, 20));
  assert.deepStrictEqual(lines, [], 'nothing is answered while the call runs');
  assert.ok(input.isPaused(), 'and input waits');
  release();
  for (let i = 0; i < 100 && lines.length < 9; i++) await new Promise(r => setTimeout(r, 5));
  assert.deepStrictEqual(lines.map(l => l.id), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'then each in order');
  input.end(); assert.strictEqual(await done, 0);
});

test('the frame limit is in bytes, and a \\r split from its \\n is still a line end', async () => {
  const frame = (n, fill = 'a') => { const head = '{"jsonrpc":"2.0","id":1,"method":"ping","pad":"', tail = '"}'; return head + fill.repeat(n - head.length - tail.length) + tail; };
  const exact = frame(MAX_FRAME);
  assert.strictEqual(Buffer.byteLength(exact), MAX_FRAME);
  const input = new PassThrough(), output = new PassThrough(), lines = [];
  output.on('data', d => { for (const l of String(d).split('\n').filter(Boolean)) lines.push(JSON.parse(l)); });
  const done = serve(input, output, {});
  input.write(exact + '\r'); await new Promise(r => setTimeout(r, 10));
  input.write('\n'); await new Promise(r => setTimeout(r, 10));
  assert.deepStrictEqual(lines.map(l => [l.id, !!l.result]), [[1, true]], 'exactly the limit, CR in one chunk and LF in the next');
  const wide = '{"jsonrpc":"2.0","id":2,"method":"ping","pad":"' + 'é'.repeat(45000) + '"}';
  assert.ok(wide.length < MAX_FRAME && Buffer.byteLength(wide) > MAX_FRAME);
  input.write(wide + '\n'); await new Promise(r => setTimeout(r, 10));
  assert.ok(lines.some(l => l.id === null && /too large/.test(l.error.message)), 'over in bytes is too large, whatever its length in characters');
  assert.ok(!lines.some(l => l.id === 2));
  input.end(); await done;
});

test('an output error later on stops the server with 1, with nothing unhandled', async () => {
  const { Writable } = await import('node:stream');
  const output = new Writable({ write(_c, _e, cb) { const e = new Error('EPIPE'); e.code = 'EPIPE'; cb(e); } });
  const input = new PassThrough();
  const done = serve(input, output, {});
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n');
  assert.strictEqual(await done, 1);
});

test('a write whose callback reports an error stops the server too', async () => {
  const output = { on() {}, write(_line, cb) { setTimeout(() => cb(new Error('EPIPE'))); } };
  const input = new PassThrough();
  const done = serve(input, output, {});
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n');
  assert.strictEqual(await done, 1);
});

test('the slot is the app\'s own', () => {
  for (let i = 0; i < 2000; i++) { const id = randomId(); assert.strictEqual(slotOf(id), hubSlot(id), id); }
  assert.ok(/^\d\d$/.test(slotOf('abcdefgh')) && Number(slotOf('abcdefgh')) < 64);
});
const randomId = () => globalThis.crypto.randomUUID();

test('a reply for another id in the slot is passed over, and a taken slot is tried once more', async () => {
  const dir = scratch(), asked = [];
  fs.mkdirSync(path.join(dir, 'api', 'replies'), { recursive: true });
  /* The first request's slot is taken by another reply; the second gets its own. */
  const launch = async (_, args) => {
    const req = JSON.parse(args[1]); asked.push(req.id);
    const other = { v: 1, id: 'someone-else-1', ok: true };
    if (asked.length === 1) setTimeout(() => fs.writeFileSync(slotFile(dir, req.id), JSON.stringify(other)), 20);
    else setTimeout(() => fs.writeFileSync(slotFile(dir, req.id), JSON.stringify({ v: 1, id: req.id, ok: true, buddies: [] })), 20);
  };
  const r = await createBridge({ exe: 'x', dataDir: dir, app: 'A', timeoutMs: 200, launch, poll: 5 })({ do: 'list' });
  assert.ok(r && r.ok, JSON.stringify(r));
  assert.strictEqual(asked.length, 2);
  assert.notStrictEqual(asked[0], asked[1], 'with a fresh id');
  /* A stale reply that was there before, and nothing new: one try, then no reply. */
  const quiet = [];
  const stale = async (_, args) => { const req = JSON.parse(args[1]); quiet.push(req.id); };
  const id0 = 'stale-reply-1';
  fs.writeFileSync(path.join(dir, 'api', 'replies', `${slotOf(id0)}.json`), JSON.stringify({ v: 1, id: id0, ok: true }));
  assert.strictEqual(await createBridge({ exe: 'x', dataDir: dir, app: 'A', timeoutMs: 50, launch: stale, poll: 5 })({ do: 'list' }), null);
  assert.strictEqual(quiet.length, 1);
});
