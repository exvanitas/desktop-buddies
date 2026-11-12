#!/usr/bin/env node
/* Desktop Buddies as an MCP server, on stdio, with no network. Each tool call becomes one request
   to the app, `desktop-buddies.exe --api "<json>"`, and the reply is a file the app writes in its
   data folder. Plain JSON-RPC, newline-delimited, with no dependencies. See README.md and
   docs/local-api.md. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER = { name: 'desktop-buddies', version: '1.0.0' };
const BUDDY = { type: 'string', description: 'Her id, from list_buddies.' };
export const TOOLS = [
  {
    name: 'list_buddies',
    description: 'List the desktop buddies: each one\'s id, name, whether she\'s out on the desktop, how many copies are out, and the actions she can do.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'wave',
    description: 'Make a buddy who is out on the desktop wave.',
    inputSchema: { type: 'object', properties: { buddy: BUDDY }, required: ['buddy'], additionalProperties: false }
  },
  {
    name: 'say',
    description: 'Show one line in a buddy\'s speech bubble, marked with this app\'s name. Plain text, at most 120 characters, no links. A few lines a minute at most.',
    inputSchema: { type: 'object', properties: { buddy: BUDDY, text: { type: 'string', maxLength: 120 } }, required: ['buddy', 'text'], additionalProperties: false }
  }
];

/* The Store package's family name: its Name, an underscore, and an id Windows derives from its
   Publisher. `apps/desktop/packaging/msix/msix.py --family` prints it, and a test there checks this
   line against identity.json. A placeholder until the app is registered in Partner Center. */
export const PACKAGE_FAMILY = 'PLACEHOLDER.DesktopBuddies_m8z88z54g2w36';
const DATA = 'dev.exvanitas.desktop-buddies';

/* The two ways it's installed, each an exe and the data folder its replies land in. The installer's
   exe, in %LOCALAPPDATA%\Desktop Buddies (`zip` here, as a zip there is the same build), keeps its data in %APPDATA%. The Store's package is started by its
   alias, and keeps its data in its own LocalState. */
export function installs(env, family = PACKAGE_FAMILY) {
  const win = path.win32, local = env.LOCALAPPDATA || 'C:\\';
  return {
    zip: { exe: win.join(local, 'Desktop Buddies', 'desktop-buddies.exe'), dataDir: win.join(env.APPDATA || 'C:\\', DATA) },
    store: {
      exe: win.join(local, 'Microsoft', 'WindowsApps', 'desktop-buddies.exe'),
      dataDir: win.join(local, 'Packages', family, 'LocalState', 'data'),
      /* There only once this package is installed for this person. */
      home: win.join(local, 'Packages', family)
    }
  };
}

/* Whether an exe is a packaged one: an alias in %LOCALAPPDATA%\Microsoft\WindowsApps, or under
   %ProgramFiles%\WindowsApps. Windows paths, without case, by whole folder names. */
export function packagedExe(exe, env) {
  const win = path.win32, low = p => win.normalize(p).toLowerCase().replace(/\\+$/, '');
  const at = low(exe), aliases = low(win.join(env.LOCALAPPDATA || 'C:\\', 'Microsoft', 'WindowsApps'));
  const installed = low(win.join(env.ProgramFiles || 'C:\\Program Files', 'WindowsApps'));
  return win.dirname(at) === aliases || at.startsWith(installed + '\\');
}
/* An alias is a reparse point that only Windows can follow, so it's looked at, not through. */
const there = p => { try { lstatSync(p); return true; } catch { return false; } };

/* Flags first, then the environment, then whichever install is there: the zip, then the Store's,
   which counts only with its alias and its own package folder both there. The data folder goes
   with the exe, unless one is given. Both builds share one single-instance lock, so a request can
   reach whichever is running: with no folder given, both folders are watched, the exe's first. */
export function config(argv = process.argv.slice(2), env = process.env, exists = there) {
  const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const { zip, store } = installs(env, flag('--package-family') ?? env.BUDDIES_PACKAGE_FAMILY ?? PACKAGE_FAMILY);
  const timeout = Number(flag('--timeout') ?? env.BUDDIES_TIMEOUT_MS);
  const stored = exists(store.exe) && exists(store.home);
  const exe = flag('--exe') ?? env.BUDDIES_EXE ?? (exists(zip.exe) || !stored ? zip.exe : store.exe);
  const given = flag('--data') ?? env.BUDDIES_DATA;
  const paired = packagedExe(exe, env) ? [store.dataDir, zip.dataDir] : [zip.dataDir, store.dataDir];
  return {
    exe,
    dataDir: given ?? paired[0],
    dataDirs: given ? [given] : paired,
    app: flag('--app') ?? env.BUDDIES_APP ?? 'AI agent',
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 10000
  };
}

/* Starts the exe and doesn't wait for it: a running app takes the request and this launch exits,
   and one that wasn't running answers "not running" and quits. */
export function launchExe(exe, args) {
  return new Promise((done, fail) => {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', fail);
    child.once('spawn', () => { child.unref(); done(); });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* The app's reply slot for an id: FNV-1a over its characters, mod 64, as two digits. The same as
   slotOf in apps/desktop/src/api-replies.ts. */
export function slotOf(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return String(h % 64).padStart(2, '0');
}

const readSlot = async file => {
  try { return await readFile(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};
const parsed = text => { try { return JSON.parse(text); } catch { return null; } };

/* One request, and its reply, or null if none came in time. A reply lands in a slot shared with
   other ids, so only one carrying this id counts, in any of the folders watched. If another
   request's reply took the slot while this one waited, it's tried once more with a fresh id. The
   deadline is monotonic. */
export function createBridge({ exe, dataDir, dataDirs = [dataDir], app, timeoutMs, launch = launchExe, poll = 100 }) {
  async function once(body) {
    const id = randomUUID(), files = dataDirs.map(d => path.join(d, 'api', 'replies', `${slotOf(id)}.json`));
    const before = await Promise.all(files.map(readSlot));
    await launch(exe, ['--api', JSON.stringify({ v: 1, id, app, ...body })]);
    const end = performance.now() + timeoutMs;
    let taken = false;
    for (;;) {
      const now = await Promise.all(files.map(readSlot));
      for (let i = 0; i < files.length; i++) {
        const r = now[i] === null ? null : parsed(now[i]);
        if (r && r.id === id) return { reply: r };
        if (now[i] !== null && now[i] !== before[i] && r) taken = true;
      }
      if (performance.now() >= end) return { reply: null, taken };
      await sleep(poll);
    }
  }
  return async function request(body) {
    const first = await once(body);
    return first.reply || !first.taken ? first.reply : (await once(body)).reply;
  };
}

const textResult = (text, isError = false) => ({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) });

/* What each tool asks the app, and how its reply reads. */
export function createTools(request, { exe, timeoutMs }) {
  /* The reply, or the tool result that says why there isn't one. */
  const ask = async body => {
    let r;
    try { r = await request(body); }
    catch (e) { return { failed: textResult(`Couldn't start Desktop Buddies at ${exe}: ${e.message}. Set --exe or BUDDIES_EXE.`, true) }; }
    if (!r) return { failed: textResult(`No reply from Desktop Buddies in ${Math.round(timeoutMs / 1000)} seconds. Check it's running, and that --data points at its data folder.`, true) };
    if (!r.ok) return { failed: textResult(`${r.message} (${r.error})`, true) };
    return { reply: r };
  };
  const str = v => typeof v === 'string';
  return {
    async list_buddies() {
      const { failed, reply } = await ask({ do: 'list' });
      return failed ?? textResult(JSON.stringify(reply.buddies ?? []));
    },
    async wave(args) {
      if (!str(args.buddy)) return textResult('wave needs a buddy id.', true);
      const { failed } = await ask({ do: 'act', buddy: args.buddy, action: 'wave' });
      return failed ?? textResult('She waved.');
    },
    async say(args) {
      if (!str(args.buddy) || !str(args.text)) return textResult('say needs a buddy id and a line of text.', true);
      const { failed } = await ask({ do: 'say', buddy: args.buddy, text: args.text });
      return failed ?? textResult('She said it.');
    }
  };
}

/* One message can be at most this many bytes, not counting its line end. */
export const MAX_FRAME = 64 * 1024;
const MAX_ID = 128;
/* JSON-RPC ids are a string or a number, and small: anything else is never echoed back. */
const goodId = id => (typeof id === 'string' && id.length <= MAX_ID) || (typeof id === 'number' && Number.isFinite(id));
const NL = 0x0a, CR = 0x0d;

/* JSON-RPC over stdio, one message a line, handled one at a time. Input is read as bytes and split
   on \n, with one \r before it dropped. A line over MAX_FRAME bytes is refused as soon as it's
   past the limit and skipped to its end, never held or parsed. While a message is handled, input
   is paused, so nothing piles up in memory. If output fails, it stops, and the promise says 1;
   otherwise 0 when input ends. Nothing in here throws or leaves a rejection unseen. */
export function serve(input, output, tools) {
  let failed = false, stop = () => {};
  const finished = new Promise(done => { stop = code => { failed ||= code !== 0; done(code); }; });
  const fail = () => { if (failed) return; failed = true; try { input.pause(); } catch { /* gone */ } stop(1); };
  output.on?.('error', fail);
  /* Waits for the line to be taken, so a slow host slows us down rather than filling memory. */
  const write = m => new Promise(done => {
    if (failed) return done();
    let line;
    try { line = JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n'; }
    catch { line = JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } }) + '\n'; }
    try { output.write(line, e => { if (e) fail(); done(); }); }
    catch { fail(); done(); }
  });
  const refuse = (id, code, message) => write({ id, error: { code, message } });
  const methods = {
    initialize: p => ({
      protocolVersion: VERSIONS.includes(p?.protocolVersion) ? p.protocolVersion : VERSIONS[0],
      capabilities: { tools: {} }, serverInfo: SERVER,
      instructions: 'Desktop Buddies are small characters on the person\'s desktop. You can list them, make one wave, or show a short line in her bubble. The person has to allow this app in the Manager first.'
    }),
    ping: () => ({}),
    'tools/list': () => ({ tools: TOOLS }),
    'tools/call': async p => {
      const name = p?.name, f = typeof name === 'string' && Object.prototype.hasOwnProperty.call(tools, name) ? tools[name] : null;
      if (!f) throw Object.assign(new Error('Unknown tool'), { code: -32602 });
      const args = p.arguments && typeof p.arguments === 'object' && !Array.isArray(p.arguments) ? p.arguments : {};
      return f(args);
    }
  };

  async function message(bytes) {
    let m;
    try { m = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return refuse(null, -32700, 'Parse error'); }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return refuse(null, -32600, 'Invalid request');
    if (!('method' in m)) return; /* a response: this server sends no requests */
    if (!('id' in m)) return; /* notifications/initialized and the rest */
    if (!goodId(m.id)) return refuse(null, -32600, 'Invalid request: id');
    if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return refuse(m.id, -32600, 'Invalid request');
    const f = Object.prototype.hasOwnProperty.call(methods, m.method) ? methods[m.method] : null;
    if (!f) return refuse(m.id, -32601, 'Method not found');
    let result;
    try { result = await f(m.params); }
    catch (e) { return refuse(m.id, Number.isInteger(e?.code) ? e.code : -32603, String(e?.message ?? 'Internal error')); }
    return write({ id: m.id, result });
  }

  /* The line so far, as chunks, and its length. It may hold one byte past the limit, a \r that a
     \n in the next chunk may end. */
  let parts = [], size = 0, skipping = false;
  const tooBig = () => refuse(null, -32600, `Request too large: at most ${MAX_FRAME} bytes`);
  async function chunk(buf) {
    let at = 0;
    while (at < buf.length && !failed) {
      const nl = buf.indexOf(NL, at), end = nl < 0 ? buf.length : nl;
      if (skipping) { if (nl >= 0) skipping = false; at = end + 1; continue; }
      parts.push(buf.subarray(at, end)); size += end - at;
      if (nl < 0) {
        if (size > MAX_FRAME + 1) { parts = []; size = 0; skipping = true; await tooBig(); }
        break;
      }
      let line = Buffer.concat(parts, size);
      parts = []; size = 0; at = nl + 1;
      if (line.length && line[line.length - 1] === CR) line = line.subarray(0, -1);
      if (line.length > MAX_FRAME) await tooBig();
      else if (line.length) await message(line);
    }
  }
  /* One chunk at a time, input paused while it's handled. */
  let busy = Promise.resolve();
  input.on('data', buf => {
    input.pause();
    busy = busy.then(() => chunk(Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf)))).catch(fail)
      .then(() => { if (!failed) input.resume(); });
  });
  const end = () => { void busy.then(() => stop(failed ? 1 : 0)); };
  input.on('end', end); input.on('close', end); input.on('error', end);
  return finished;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const c = config();
  void serve(process.stdin, process.stdout, createTools(createBridge(c), c)).then(code => { if (code) process.exit(code); });
}
