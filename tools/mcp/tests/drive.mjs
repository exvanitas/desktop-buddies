#!/usr/bin/env node
/* Speaks MCP to server.mjs over stdio as a host would, one message at a time: initialize, tools/list,
   then tools/call. Prints PASS, FAIL and INFO lines in plain ASCII, and exits 1 on any FAIL.
   apps/desktop/shell-check/api-e2e.ps1 runs it against the real exe; drive.test.mjs against the
   stand-in.
     node drive.mjs [--exe <exe>] [--data <data folder>] --app <name> --phase off|waiting|run [--text <line>] [--timeout <ms>]
   off: other apps aren't let in, so list_buddies says so. waiting: the app isn't allowed yet, so
   list_buddies says so. run: list_buddies, wave and say. Without --exe and --data the server picks
   them as it would for a person: shell-check/store-package.ps1 runs it that way. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs');
const TOOLS = 'list_buddies,wave,say';
export const ascii = s => String(s).replace(/[^\x20-\x7e]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

export async function drive({ exe, data, app, phase, text = 'Hello from MCP', timeoutMs = 8000, env = process.env, node = process.execPath }) {
  const lines = [];
  const note = (state, name, detail = '') => lines.push(`${state} mcp.${name} ${ascii(detail)}`.trimEnd());
  const expect = (ok, name, detail) => note(ok ? 'PASS' : 'FAIL', name, detail);
  const given = [...(exe ? ['--exe', exe] : []), ...(data ? ['--data', data] : [])];
  const child = spawn(node, [SERVER, ...given, '--app', app, '--timeout', String(timeoutMs)], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const got = [];
  let buf = '', err = '', wake = () => {}, code = null;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', d => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
      try { got.push(JSON.parse(buf.slice(0, i))); } catch { got.push({ unparsed: buf.slice(0, i) }); }
    }
    wake();
  });
  child.stderr.on('data', d => { err += d; });
  child.stdin.on('error', () => {});
  const exited = new Promise(r => child.once('exit', c => { code = c; wake(); r(c); }));
  child.once('error', e => { err += String(e); code = -1; wake(); });

  let next = 0;
  /* One request and its response, before anything else is sent. Null if none came in time. */
  async function call(method, params) {
    const id = ++next;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    const end = performance.now() + timeoutMs * 2 + 5000;
    for (;;) {
      const r = got.find(m => m.id === id);
      if (r) return r;
      if (code !== null || performance.now() > end) return null;
      await new Promise(res => { wake = res; setTimeout(res, 50); });
    }
  }
  const tool = async (name, args) => {
    const r = await call('tools/call', { name, arguments: args });
    const words = r?.result?.content?.[0]?.text;
    return { r, words: typeof words === 'string' ? words : null, isError: r?.result?.isError === true };
  };
  const said = t => t.r ? (t.words ?? JSON.stringify(t.r.error ?? t.r)) : 'no response';

  const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'api-e2e', version: '1' } });
  expect(init?.result?.serverInfo?.name === 'desktop-buddies' && init.result.protocolVersion === '2025-06-18', 'initialize', init ? JSON.stringify(init.result ?? init.error).slice(0, 200) : 'no response');
  if (init) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const listed = init && await call('tools/list', {});
  const names = (listed?.result?.tools ?? []).map(t => t.name).join(',');
  expect(names === TOOLS, 'tools_list', names || 'no tools');

  if (phase === 'waiting' || phase === 'off') {
    const t = await tool('list_buddies', {});
    expect(t.isError && new RegExp(`\\(${phase}\\)$`).test(t.words ?? ''), phase, said(t));
  } else {
    const t = await tool('list_buddies', {});
    let buddies = null;
    try { buddies = !t.isError && JSON.parse(t.words); } catch { /* said below */ }
    const her = Array.isArray(buddies) ? buddies.find(b => b.out && Array.isArray(b.can) && b.can.includes('wave')) : null;
    expect(!!her, 'list', Array.isArray(buddies) ? `${buddies.length} buddies, out: ${buddies.filter(b => b.out).map(b => b.id).join(' ')}` : said(t));
    if (her) {
      note('INFO', 'buddy', her.id);
      const w = await tool('wave', { buddy: her.id });
      expect(!w.isError && w.words === 'She waved.', 'wave', said(w));
      const s = await tool('say', { buddy: her.id, text });
      expect(!s.isError && s.words === 'She said it.', 'say', said(s));
      note('INFO', 'said', text);
    }
  }

  child.stdin.end();
  const timer = new Promise(r => setTimeout(r, 5000, 'still running'));
  const end = await Promise.race([exited, timer]);
  if (end === 'still running') child.kill();
  expect(end === 0, 'exit', `code ${end}`);
  if (err.trim()) note('INFO', 'stderr', err.trim().slice(0, 300));
  return lines;
}

const flag = (argv, name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const o = { exe: flag(argv, '--exe'), data: flag(argv, '--data'), app: flag(argv, '--app'), phase: flag(argv, '--phase') };
  const missing = ['app', 'phase'].filter(k => !o[k]).map(k => `--${k}`);
  if (missing.length || !['off', 'waiting', 'run'].includes(o.phase)) {
    console.log(`FAIL mcp.usage needs ${missing.join(' ') || '--phase off|waiting|run'}`);
    process.exit(1);
  }
  const timeout = Number(flag(argv, '--timeout'));
  const lines = await drive({ ...o, text: flag(argv, '--text'), timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 8000 });
  for (const l of lines) console.log(l);
  process.exit(lines.some(l => l.startsWith('FAIL ')) ? 1 : 0);
}
