/* Edge cases of the local API, each from its reproduction: bounded rate buckets,
   the cold-start deadline, links, kept answers, id case, and the monotonic clock. Replies in slots
   and the ordinary file-open are tested in local-api.test.ts. */
import assert from 'node:assert';
import { test } from 'vitest';
import type { Message } from '../src/host';
import { createHub } from '../src/hub-core';
import { LIMITS, MESSAGES, cleanLine, createLocalApi, createRate, parseRequest } from '../src/local-api';
import type { Said } from '../src/manager-api';
import { createFakeExe, type FakeExe } from '../src/shell-fake';
import { createBus } from '../src/wire';
import { SAMPLE, SAMPLE_ID, allowed, errorOf, monitor, setup } from './api-harness';

test('rate buckets: fresh names each minute leave none behind, and refused ones make none', () => {
  const clock = { t: 0 };
  let asked = 0;
  const api = createLocalApi({
    now: () => clock.t, note: () => {}, on: () => true, ready: () => true, paused: () => false, hidden: () => false,
    consent: app => app.startsWith('Known') ? 'allow' : undefined, ask: () => (asked++ < 3 ? 'asked' : 'busy'),
    buddies: () => [], act: () => {}, say: () => {}
  });
  for (let i = 0; i < 500; i++) { clock.t += 61_000; api.handle(JSON.stringify({ v: 1, id: `id-${String(i).padStart(6, '0')}`, app: `Fresh ${i}`, do: 'list' })); }
  assert.ok(api.buckets <= 1, `buckets ${api.buckets}`);
  for (let i = 0; i < 500; i++) { clock.t += 61_000; api.handle(JSON.stringify({ v: 1, id: `id-${String(i).padStart(6, '0')}`, app: `Known ${i}`, do: 'list' })); }
  assert.ok(api.buckets <= 2, `buckets ${api.buckets}`);
});

test('rate buckets have a hard cap', () => {
  const rate = createRate(() => 0);
  for (let i = 0; i < 10_000; i++) rate.take(`k${i}`, 5);
  assert.ok(rate.size <= LIMITS.buckets, String(rate.size));
  assert.strictEqual(rate.take('one more', 5), false, 'a new key at the cap is refused');
});

async function coldStart(exe: FakeExe, io: { wait?: (ms: number) => Promise<void> } = {}) {
  let quit = 0; await exe.shell.on('quitting', () => { quit++; });
  await createHub({ shell: exe.shell, send: () => {}, seed: async () => SAMPLE, after: () => {}, wire: createBus<Said>().wire(), ...io }).start();
  return quit;
}
const coldExe = (id: string) => createFakeExe({ monitors: [monitor()], args: ['--api', JSON.stringify({ v: 1, id, app: 'A', do: 'list' })] });

test('a cold start with a stalled write still quits', async () => {
  const exe = coldExe('stalled-0001');
  exe.hold('data_write');
  let waited = 0;
  const quit = await coldStart(exe, { wait: async () => { waited++; } });
  assert.strictEqual(quit, 1);
  assert.ok(waited >= 1, 'it waited on a deadline, not the write');
});

/* 5 and 6 are the MCP server's, in tools/mcp/tests. */

/* 7 */
test('links: bare domains and dot lookalikes are refused, sentences pass', () => {
  for (const t of ['Visit example.com', 'www\u3002example\u3002com', 'example\uFF0Ecom', 'evil\uFF61com now', 'see mail.google.com', 'go to bit.ly', 'EXAMPLE.COM', 'a.b.c.example.org'])
    assert.deepStrictEqual(cleanLine(t), { ok: false, error: 'link' }, t);
  for (const t of ['Hello there.', 'e.g. this works', 'i.e. now', 'Version 1.2.3 is out', 'Done. Next up: tests', 'Pi is 3.14', 'Mr. Smith says hi', 'U.S.A. and the U.K.', 'Wait... what?', '50% done, 1/2 left'])
    assert.strictEqual(cleanLine(t).ok, true, t);
});

/* 8 */
test('an answer is never forgotten: at capacity a new app is told the list is full', async () => {
  const s = await allowed('App 0');
  await s.command({ k: 'api-forget', app: 'App 0' });
  await s.ask({ do: 'list' }, 'App 0');
  await s.command({ k: 'api-answer', app: 'App 0', allow: false });
  for (let i = 1; s.state.api.apps.length < 100; i++) {
    s.clock.t += 2000;
    await s.ask({ do: 'list' }, `App ${i}`);
    await s.command({ k: 'api-answer', app: `App ${i}`, allow: true });
  }
  s.clock.t += 2000;
  assert.strictEqual(errorOf(await s.ask({ do: 'list' }, 'App 0')), 'not-allowed');
  s.clock.t += 2000;
  const r = await s.ask({ do: 'list' }, 'One Too Many');
  assert.strictEqual(errorOf(r), 'full');
  assert.strictEqual(r && !r.ok && r.message, MESSAGES.full);
  assert.ok(s.state.api.apps.some(a => a.name === 'App 0' && !a.allow));
  assert.deepStrictEqual(s.state.api.asking, []);
});

/* 9 */
test('ids are lower case, so two can never share a file on Windows', () => {
  assert.deepStrictEqual(parseRequest(JSON.stringify({ v: 1, id: 'ABCDEFGH', app: 'A', do: 'list' })), { ok: false, error: 'bad-request' });
  assert.strictEqual(parseRequest(JSON.stringify({ v: 1, id: 'abcdefgh', app: 'A', do: 'list' })).ok, true);
});

test('the hub\'s limits default to the monotonic clock, not the wall', async () => {
  const realNow = performance.now, realDate = Date.now, mono = { t: 1e6 };
  performance.now = () => mono.t;
  try {
    const s = await setup({}, undefined, { now: undefined });
    await s.command({ k: 'api', on: true });
    await s.ask({ do: 'list' });
    await s.command({ k: 'api-answer', app: 'Claude Code', allow: true });
    for (let i = 0; i < LIMITS.perApp; i++) await s.ask({ do: 'list' });
    assert.strictEqual(errorOf(await s.ask({ do: 'list' })), 'rate-limited');
    Date.now = () => realDate() - 3_600_000;
    mono.t += LIMITS.windowMs + 1;
    assert.strictEqual(errorOf(await s.ask({ do: 'list' })), 'ok', 'a minute on the monotonic clock is a minute');
  } finally { performance.now = realNow; Date.now = realDate; }
});

test('the reviewed hub still answers after all of it', async () => {
  const s = await allowed();
  const sent: Message[] = s.sent;
  sent.length = 0;
  assert.strictEqual(errorOf(await s.ask({ do: 'act', buddy: SAMPLE_ID, action: 'wave' })), 'ok');
  assert.strictEqual(sent.length, 1);
});
