/* Random and malformed requests, thrown at the handler alone and at the real hub. Whatever comes
   in, nothing throws, every reply has the allowed shape, a line that reaches a bubble is clean, and
   the hub still answers afterwards. Seeded, so a failure repeats. */
import assert from 'node:assert';
import fs from 'node:fs';
import { read, type Buddy } from '@buddies/buddy-file';
import { test } from 'vitest';
import { REPLIES, SLOTS, replyPath } from '../src/api-replies';
import type { Message } from '../src/host';
import { createHub } from '../src/hub-core';
import { LIMITS, MESSAGES, createLocalApi, type Reply } from '../src/local-api';
import type { Answer, HubState, Said } from '../src/manager-api';
import { text } from '../src/shell';
import { createFakeExe } from '../src/shell-fake';
import { createBus } from '../src/wire';

const SAMPLE = fs.readFileSync(new URL('../../../packages/test-support/fixtures/sample.json', import.meta.url), 'utf8');
const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
const small = (character: string, name: string): Buddy => ({ character, name, base: { src: 'base.png', bb: box }, poses: {} });

function prng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const KEYS = ['v', 'id', 'app', 'do', 'buddy', 'action', 'text', '__proto__', 'constructor', 'extra', ''];
const DOS = ['list', 'act', 'say', 'delete', 'import', 'export', 'settings', 'open', 'toString', '', 'LIST'];

function maker(seed: number) {
  const r = prng(seed), pick = <T>(a: readonly T[]) => a[Math.floor(r() * a.length)]!;
  const chars = (n: number) => Array.from({ length: n }, () => String.fromCodePoint(pick([
    () => 32 + Math.floor(r() * 95), () => Math.floor(r() * 32), () => 0x80 + Math.floor(r() * 0x80),
    () => 0x2000 + Math.floor(r() * 0x70), () => 0xFF01 + Math.floor(r() * 0x5E), () => 0x1F600 + Math.floor(r() * 0x50)
  ])())).join('').replace(/[\uD800-\uDFFF]/g, '');
  const value = (depth = 0): unknown => pick([
    () => chars(Math.floor(r() * 40)), () => Math.floor(r() * 1e6) - 5e5, () => r() < .5, () => null,
    () => depth < 3 ? Array.from({ length: Math.floor(r() * 3) }, () => value(depth + 1)) : [],
    () => depth < 3 ? Object.fromEntries(Array.from({ length: Math.floor(r() * 3) }, () => [pick(KEYS), value(depth + 1)])) : {},
    () => 'x'.repeat(Math.floor(r() * 3000)), () => 'https://evil.example/' + chars(5), () => 'olive', () => 'wave'
  ])();
  const good = () => ({ v: 1, id: `fuzz-${Math.floor(r() * 1e9)}`, app: pick(['Claude Code', 'Fuzzer', 'claude code', 'A']), do: pick(['list', 'act', 'say']), buddy: 'olive', action: 'wave', text: chars(Math.floor(r() * 140)) });
  return () => pick([
    () => chars(Math.floor(r() * 200)),
    () => JSON.stringify(value()),
    () => { const g: Record<string, unknown> = good(); for (const k of Object.keys(g)) if (r() < .3) delete g[k]; return JSON.stringify(g); },
    () => { const g: Record<string, unknown> = good(); g[pick(KEYS)] = value(); return JSON.stringify(g); },
    () => { const g: Record<string, unknown> = good(); if (g.do === 'list') { delete g.buddy; delete g.action; delete g.text; } else if (g.do === 'act') delete g.text; else delete g.action; return JSON.stringify(g); },
    () => { const s = JSON.stringify(good()), i = Math.floor(r() * s.length); return s.slice(0, i) + chars(1) + s.slice(i + 1); },
    () => JSON.stringify({ ...good(), do: pick(DOS) }),
    () => '['.repeat(Math.floor(r() * 1200)) + ']'.repeat(Math.floor(r() * 1200)),
    () => '{"v":1,"id":"fuzz-dupe-1","app":"A","do":"list","do":"' + pick(DOS) + '"}'
  ])();
}

const TOP = new Set(['v', 'id', 'ok', 'buddies', 'error', 'message']), BUDDY = new Set(['id', 'name', 'out', 'copies', 'can']);
function shaped(r: Reply) {
  for (const k of Object.keys(r)) assert.ok(TOP.has(k), k);
  assert.strictEqual(r.v, 1);
  assert.match(r.id, /^[A-Za-z0-9_-]{8,64}$/);
  if (!r.ok) assert.strictEqual(r.message, MESSAGES[r.error]);
  for (const b of r.ok ? r.buddies ?? [] : []) for (const k of Object.keys(b)) assert.ok(BUDDY.has(k), k);
}
const LINK = /[a-z][a-z0-9+.-]*:\/\/|www\.|[a-z0-9-]\.[a-z]{2,}\S*\//i;

test('fuzz: the handler alone never throws, replies are shaped, and lines are clean', () => {
  const next = maker(1), clock = { t: 0 }, said: string[] = [], acted: string[] = [];
  const api = createLocalApi({
    now: () => clock.t, note: () => {}, on: () => true, ready: () => true, paused: () => false, hidden: () => false,
    consent: app => app.toLowerCase() === 'claude code' ? 'allow' : app === 'A' ? 'deny' : undefined, ask: () => 'asked',
    buddies: () => [{ id: 'olive', name: 'Olive', out: true, copies: 1, can: ['wave'] }],
    act: (id, a) => acted.push(`${id} ${a}`), say: (_, t) => said.push(t)
  });
  let replies = 0;
  for (let i = 0; i < 20000; i++) {
    clock.t += 500;
    const r = api.handle(next());
    if (r) { replies++; shaped(r); }
  }
  assert.ok(replies > 1000, `replies ${replies}`);
  assert.ok(said.length > 10, `lines ${said.length}`);
  for (const t of said) {
    assert.ok([...t].length <= LIMITS.text && t.length > 0, t);
    assert.ok(!/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/.test(t), JSON.stringify(t));
    assert.ok(!LINK.test(t.normalize('NFKC')), t);
  }
  assert.ok(acted.every(a => a === 'olive wave'));
  assert.ok(api.buckets <= LIMITS.buckets, `buckets ${api.buckets}`);
});

test('fuzz: the hub takes thousands of bad requests and stays healthy', { timeout: 60000 }, async () => {
  const exe = createFakeExe({ monitors: [{ i: 0, name: 'A', primary: true, scale: 1, x: 0, y: 0, w: 1920, h: 1040, full: { x: 0, y: 0, w: 1920, h: 1080 } }], args: ['--no-manager'] });
  await exe.shell.dataWrite('library/olive/buddy.json', JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: { ...read(SAMPLE), character: 'olive', base: { src: 'base.png', bb: box }, poses: { wave: { frames: [{ src: 'w.png', bb: box }] } } } }));
  await exe.shell.dataWrite('library/pip/buddy.json', JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: small('pip', 'Pip') }));
  await exe.shell.dataWrite('settings.json', JSON.stringify({ out: ['olive'], api: true, apiApps: [{ name: 'Claude Code', allow: true }, { name: 'A', allow: false }] }));
  const sent: Message[] = [], timers: (() => void)[] = [], bus = createBus<Said>(), page = bus.wire(), clock = { t: 5_000_000 };
  let state: HubState | null = null;
  const answers = new Map<string, (a: Answer) => void>();
  page.listen(m => { if (m.k === 'state') state = m.state; else if (m.k === 'done') answers.get(m.id)?.(m.answer); });
  const hub = createHub({ shell: exe.shell, send: m => sent.push(m), seed: async () => SAMPLE, after: (_, f) => { timers.push(f); }, wire: bus.wire(), now: () => clock.t, wait: async () => {} });
  await hub.start();
  const settle = async () => { for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r)); await hub.settled; } };
  await settle();
  const lasting = () => JSON.stringify([...exe.files].filter(([p]) => !p.startsWith('api/')).map(([p, b]) => [p, text(b)]));
  const before = lasting();

  const next = maker(2);
  for (let i = 0; i < 3000; i++) {
    clock.t += 700;
    exe.emit('second-launch', { args: ['--api', next()] });
    if (i % 50 === 0) await settle();
    if (i % 400 === 0) { for (const f of timers.splice(0)) f(); }
  }
  await settle();
  assert.strictEqual(lasting(), before, 'library and settings untouched');
  assert.ok(!exe.logs.some(l => /hub error/.test(l)), exe.logs.filter(l => /hub error/.test(l)).slice(0, 3).join('\n'));
  assert.ok([...exe.files.keys()].filter(p => p.startsWith(`${REPLIES}/`)).length <= SLOTS, 'replies bounded by their slots');
  assert.ok(sent.every(m => m.k === 'act' || m.k === 'say' || m.k === 'start' || m.k === 'pause' || m.k === 'look' || m.k === 'windows'), [...new Set(sent.map(m => m.k))].join());
  assert.ok(sent.filter(m => m.k === 'act').every(m => (m as { a: string }).a === 'wave'));
  for (const m of sent) if (m.k === 'say') assert.ok([...m.text].length <= LIMITS.text && !LINK.test(m.text.normalize('NFKC')), m.text);
  assert.ok(state!.api.asking.length <= LIMITS.asking);

  /* Still healthy: a person's command and a good request both work. */
  const answer = new Promise<Answer>(r => answers.set('after', r));
  page.post({ k: 'do', id: 'after', cmd: { k: 'call', id: 'pip' } });
  assert.ok((await answer).ok);
  clock.t += LIMITS.windowMs;
  exe.emit('second-launch', { args: ['--api', JSON.stringify({ v: 1, id: 'still-fine', app: 'Claude Code', do: 'list' })] });
  await settle();
  const r = JSON.parse(text(exe.files.get(replyPath('still-fine'))!)) as Reply;
  assert.ok(r.ok && r.buddies!.length === 2);
});
