/* The local API on the real hub and the fake exe: a request comes in as a second launch with
   `--api`, the reply is a file in the data folder. Off by default, asked per app, and nothing a
   request says changes a buddy, the library or settings. */
import assert from 'node:assert';
import { write } from '@buddies/buddy-file';
import { test } from 'vitest';
import { REPLIES, SLOTS, createReplies, replyPath, slotOf } from '../src/api-replies';
import type { Message } from '../src/host';
import { createHub, options } from '../src/hub-core';
import { LIMITS, MESSAGES, cleanLine, createLocalApi, parseRequest, type Reply } from '../src/local-api';
import type { Said } from '../src/manager-api';
import { text } from '../src/shell';
import { createFakeExe } from '../src/shell-fake';
import { createBus } from '../src/wire';
import { SAMPLE, SAMPLE_ID, allowed, errorOf, lasting, manifest, managerOpens, monitor, setup, tick } from './api-harness';

test('off by default: a request is refused, and no Manager opens', async () => {
  const s = await setup();
  assert.deepStrictEqual(s.state.api, { on: false, apps: [], asking: [] });
  const r = await s.ask({ do: 'list' });
  assert.deepStrictEqual(r, { v: 1, id: 'request-1', ok: false, error: 'off', message: MESSAGES.off });
  assert.strictEqual(managerOpens(s.exe), 0);
  assert.ok(!/api/.test(text(s.exe.files.get('settings.json')!)), 'and settings say nothing of it');
});

test('a second launch with --api never opens the Manager, whatever it holds', async () => {
  const s = await setup();
  for (const raw of ['', 'nope', '{}', '{"v":1}', 'x'.repeat(5000), JSON.stringify({ v: 1, id: 'abcdefgh', app: 'A', do: 'list' })]) await s.launch(raw);
  s.exe.emit('second-launch', { args: ['--api'] }); await s.done();
  s.exe.emit('second-launch', { args: ['--api', 'C:\\x\\pip.buddy'] }); await s.done();
  assert.strictEqual(managerOpens(s.exe), 0);
  s.exe.emit('second-launch', { args: [] }); await s.done();
  assert.strictEqual(managerOpens(s.exe), 1, 'a plain one still does');
});

test('turning it on, and off again, is the Manager\'s, and lasts', async () => {
  const s = await setup();
  assert.ok((await s.command({ k: 'api', on: true })).ok);
  assert.strictEqual(s.state.api.on, true);
  assert.strictEqual(JSON.parse(text(s.exe.files.get('settings.json')!)).api, true);
  await s.command({ k: 'api', on: false });
  assert.strictEqual(s.state.api.on, false);
  assert.strictEqual(JSON.parse(text(s.exe.files.get('settings.json')!)).api, undefined);
});

test('a new app is asked about in the Manager, once, and waits', async () => {
  const s = await setup();
  await s.command({ k: 'api', on: true });
  const r = await s.ask({ do: 'list' });
  assert.strictEqual(errorOf(r), 'waiting');
  assert.deepStrictEqual(s.state.api.asking, ['Claude Code']);
  assert.strictEqual(managerOpens(s.exe), 1, 'the Manager opens to ask');
  assert.strictEqual(errorOf(await s.ask({ do: 'list' }, 'claude code')), 'waiting', 'by its name in any case');
  assert.deepStrictEqual(s.state.api.asking, ['Claude Code']);
  assert.strictEqual(managerOpens(s.exe), 1, 'and asking again doesn\'t open it again');
});

test('Allow lets it, and is remembered; Remove asks again', async () => {
  const s = await allowed();
  assert.deepStrictEqual(s.state.api.asking, []);
  assert.deepStrictEqual(s.state.api.apps, [{ name: 'Claude Code', allow: true }]);
  assert.deepStrictEqual(JSON.parse(text(s.exe.files.get('settings.json')!)).apiApps, [{ name: 'Claude Code', allow: true }]);
  const r = await s.ask({ do: 'list' });
  assert.strictEqual(errorOf(r), 'ok');
  await s.command({ k: 'api-forget', app: 'Claude Code' });
  assert.deepStrictEqual(s.state.api.apps, []);
  assert.strictEqual(errorOf(await s.ask({ do: 'list' })), 'waiting');
});

test('Not now is remembered as no, until it\'s removed', async () => {
  const s = await setup();
  await s.command({ k: 'api', on: true });
  await s.ask({ do: 'list' });
  await s.command({ k: 'api-answer', app: 'Claude Code', allow: false });
  assert.deepStrictEqual(s.state.api.apps, [{ name: 'Claude Code', allow: false }]);
  assert.strictEqual(errorOf(await s.ask({ do: 'list' })), 'not-allowed');
  assert.strictEqual(managerOpens(s.exe), 1, 'and it isn\'t asked about again');
});

test('only a waiting app can be answered', async () => {
  const s = await setup();
  await s.command({ k: 'api', on: true });
  await s.command({ k: 'api-answer', app: 'Sneaky', allow: true });
  assert.deepStrictEqual(s.state.api.apps, []);
});

test('answers survive a restart, and a damaged list costs only itself', async () => {
  const s = await setup({}, async e => {
    await e.shell.dataWrite('library/pip/buddy.json', manifest('pip', 'Pip'));
    await e.shell.dataWrite('settings.json', JSON.stringify({ out: ['pip'], api: true, apiApps: [{ name: 'Good', allow: true }, { name: 'bad/name', allow: true }, { name: 'Two', allow: 'yes' }, 7, { name: 'good', allow: false }] }));
  });
  assert.deepStrictEqual(s.state.api, { on: true, apps: [{ name: 'Good', allow: true }], asking: [] });
  assert.deepStrictEqual(s.state.buddies.map(b => b.status), ['out']);
});

test('few apps wait at once; more are told the Manager is busy', async () => {
  const s = await setup();
  await s.command({ k: 'api', on: true });
  for (let i = 0; i < LIMITS.asking; i++) assert.strictEqual(errorOf(await s.ask({ do: 'list' }, `App ${i}`)), 'waiting');
  assert.strictEqual(errorOf(await s.ask({ do: 'list' }, 'One more')), 'busy');
  assert.strictEqual(s.state.api.asking.length, LIMITS.asking);
  await s.command({ k: 'api', on: false });
  assert.deepStrictEqual(s.state.api.asking, [], 'off forgets who was waiting');
});

test('list: each buddy as id, name, out, copies and can, and nothing else', async () => {
  const s = await allowed();
  const r = await s.ask({ do: 'list' });
  assert.ok(r && r.ok);
  assert.deepStrictEqual(Object.keys(r).sort(), ['buddies', 'id', 'ok', 'v']);
  assert.deepStrictEqual(r.buddies, [
    { id: SAMPLE_ID, name: 'Olive', out: true, copies: 1, can: ['wave'] },
    { id: 'pip', name: 'Pip', out: false, copies: 0, can: r.buddies!.find(b => b.id === 'pip')!.can }
  ]);
  for (const b of r.buddies!) assert.deepStrictEqual(Object.keys(b), ['id', 'name', 'out', 'copies', 'can']);
});

test('a reply holds only allowed fields: no paths, settings, or other apps', async () => {
  const s = await allowed();
  await s.ask({ do: 'list' });
  await s.ask({ do: 'act', buddy: 'nobody', action: 'wave' });
  await s.ask({ do: 'list' }, 'Other');
  const replies = [...s.exe.files].filter(([p]) => p.startsWith(`${REPLIES}/`)).map(([, b]) => JSON.parse(text(b)) as Record<string, unknown>);
  assert.strictEqual(replies.length, 4);
  const TOP = new Set(['v', 'id', 'ok', 'buddies', 'error', 'message']), BUDDY = new Set(['id', 'name', 'out', 'copies', 'can']);
  for (const r of replies) {
    for (const k of Object.keys(r)) assert.ok(TOP.has(k), `reply field ${k}`);
    for (const b of (r.buddies as Record<string, unknown>[] | undefined) ?? []) for (const k of Object.keys(b)) assert.ok(BUDDY.has(k), `buddy field ${k}`);
    const flat = JSON.stringify(r);
    assert.ok(!/Claude Code|Other|library\/|\.png|settings|C:\\\\/.test(flat), `nothing private: ${flat}`);
  }
});

test('act: wave goes to every copy of her through the act route, and nothing else does', async () => {
  const s = await allowed();
  await s.command({ k: 'another', id: SAMPLE_ID });
  s.sent.length = 0;
  assert.strictEqual(errorOf(await s.ask({ do: 'act', buddy: SAMPLE_ID, action: 'wave' })), 'ok');
  assert.deepStrictEqual(s.sent, [{ k: 'act', id: SAMPLE_ID, a: 'wave' }, { k: 'act', id: `${SAMPLE_ID}~1`, a: 'wave' }]);
  for (const action of ['dance', 'eat', 'chase', 'delete', 'WAVE', '__proto__', 'constructor']) {
    assert.strictEqual(errorOf(await s.ask({ do: 'act', buddy: SAMPLE_ID, action })), 'unknown-action', action);
  }
  assert.strictEqual(s.sent.length, 2);
});

test('say: one clean line in her bubble, marked with the app', async () => {
  const s = await allowed();
  s.sent.length = 0;
  assert.strictEqual(errorOf(await s.ask({ do: 'say', buddy: SAMPLE_ID, text: '  Hello\tthere,\n friend\u0007!  ' })), 'ok');
  assert.deepStrictEqual(s.sent, [{ k: 'say', id: SAMPLE_ID, text: 'Hello there, friend !', from: 'Claude Code' }]);
});

test('say refuses a long line, an empty one, and anything like a link', async () => {
  const s = await allowed();
  s.sent.length = 0;
  const cases: [string, string][] = [
    ['x'.repeat(LIMITS.text + 1), 'too-long'], ['\u0000\u0001 \n\t', 'empty'], ['', 'empty'],
    ['see https://evil.example', 'link'], ['HTTP://X.Y', 'link'], ['go to www.evil', 'link'],
    ['evil.com/login', 'link'], ['ｈｔｔｐｓ://wide', 'link'], ['ftp://files', 'link'], ['xn--80ak6aa92e.com', 'link']
  ];
  for (const [line, error] of cases) {
    s.clock.t += 20_000; /* clear of the line limit */
    assert.strictEqual(errorOf(await s.ask({ do: 'say', buddy: SAMPLE_ID, text: line })), error, JSON.stringify(line));
  }
  assert.strictEqual(errorOf(await s.ask({ do: 'say', buddy: SAMPLE_ID, text: 'x'.repeat(LIMITS.text) })), 'ok', 'the cap itself is fine');
  assert.strictEqual(s.sent.length, 1);
  assert.strictEqual(errorOf(await s.ask({ do: 'say', buddy: SAMPLE_ID, text: '<b>hi</b>' })), 'ok', 'markup is only text');
  assert.strictEqual((s.sent[1] as { text: string }).text, '<b>hi</b>');
});

test('every refusal of a request\'s shape', async () => {
  const s = await allowed();
  const ok = { v: 1, id: 'abcdefgh-1', app: 'Claude Code', do: 'list' };
  const cases: [string, string][] = [
    ['not json', 'no reply'],
    ['[1,2]', 'no reply'],
    ['null', 'no reply'],
    [JSON.stringify({ ...ok, id: 'short' }), 'no reply'],
    [JSON.stringify({ ...ok, id: '../../settings' }), 'no reply'],
    [JSON.stringify({ ...ok, id: 'CON' }), 'no reply'],
    [JSON.stringify({ ...ok, id: 12345678 }), 'no reply'],
    [JSON.stringify({ ...ok, extra: 1 }), 'bad-request'],
    [JSON.stringify({ ...ok, v: 2 }), 'bad-request'],
    [JSON.stringify({ v: 1, id: ok.id, do: 'list' }), 'bad-request'],
    [JSON.stringify({ ...ok, app: '' }), 'bad-request'],
    [JSON.stringify({ ...ok, app: 'x'.repeat(LIMITS.app + 1) }), 'bad-request'],
    [JSON.stringify({ ...ok, app: 'Claude\nCode' }), 'bad-request'],
    [JSON.stringify({ ...ok, app: 'Claude  Code' }), 'bad-request'],
    [JSON.stringify({ ...ok, app: '<script>' }), 'bad-request'],
    [JSON.stringify({ ...ok, app: 'Clau\u202Ede' }), 'bad-request'],
    [JSON.stringify({ ...ok, do: 'delete' }), 'unknown-action'],
    [JSON.stringify({ ...ok, do: 'import' }), 'unknown-action'],
    [JSON.stringify({ ...ok, do: 'toString' }), 'unknown-action'],
    [JSON.stringify({ ...ok, do: 5 }), 'bad-request'],
    [JSON.stringify({ ...ok, do: 'act', buddy: SAMPLE_ID }), 'bad-request'],
    [JSON.stringify({ ...ok, do: 'act', buddy: SAMPLE_ID, action: 'wave', text: 'hi' }), 'bad-request'],
    [JSON.stringify({ ...ok, do: 'act', buddy: '../x', action: 'wave' }), 'bad-request'],
    [JSON.stringify({ ...ok, do: 'act', buddy: 'nobody', action: 'wave' }), 'no-buddy'],
    [JSON.stringify({ ...ok, do: 'act', buddy: 'pip', action: 'wave' }), 'not-out'],
    [JSON.stringify({ ...ok, do: 'say', buddy: SAMPLE_ID, text: 7 }), 'bad-request'],
    ['{"v":1,"id":"abcdefgh-1","app":"Claude Code","do":"list","__proto__":{"x":1}}', 'bad-request'],
    [JSON.stringify({ ...ok, pad: 'x'.repeat(LIMITS.bytes) }), 'no reply']
  ];
  for (const [raw, error] of cases) {
    s.exe.files.delete(replyPath(ok.id));
    await s.launch(raw);
    assert.strictEqual(errorOf(s.replyTo(ok.id)), error, raw.slice(0, 120));
  }
  assert.strictEqual(parseRequest(JSON.stringify({ ...ok, pad: 'x'.repeat(LIMITS.bytes) })).ok, false);
  assert.strictEqual(errorOf(s.replyTo(ok.id)), 'no reply', 'an oversize request is never read for its id');
});

test('paused, hidden and not ready are refused', async () => {
  const s = await allowed();
  await s.command({ k: 'pause', on: true });
  assert.strictEqual(errorOf(await s.ask({ do: 'list' })), 'paused');
  await s.command({ k: 'pause', on: false });
  await s.command({ k: 'hide', on: true });
  assert.strictEqual(errorOf(await s.ask({ do: 'act', buddy: SAMPLE_ID, action: 'wave' })), 'hidden');
  assert.strictEqual(errorOf(await s.ask({ do: 'list' })), 'ok', 'list still works hidden');
  const stuck = await setup({}, async e => { e.failUntil('data_list', 'busy', () => true); });
  assert.strictEqual(errorOf(await stuck.ask({ do: 'list' })), 'not-ready');
});

test('rate limits: per app, per app for lines, and for everyone', async () => {
  const s = await allowed();
  /* `allowed` spent none: an app has counters only once it's answered */
  let last: Reply | undefined;
  for (let i = 0; i < LIMITS.perApp; i++) assert.strictEqual(errorOf(last = await s.ask({ do: 'list' })), 'ok', `request ${i}`);
  assert.strictEqual(errorOf(await s.ask({ do: 'list' })), 'rate-limited');
  assert.ok(last);
  s.clock.t += LIMITS.windowMs;
  for (let i = 0; i < LIMITS.says; i++) assert.strictEqual(errorOf(await s.ask({ do: 'say', buddy: SAMPLE_ID, text: `hi ${i}` })), 'ok');
  assert.strictEqual(errorOf(await s.ask({ do: 'say', buddy: SAMPLE_ID, text: 'one more' })), 'rate-limited');
  assert.strictEqual(errorOf(await s.ask({ do: 'act', buddy: SAMPLE_ID, action: 'wave' })), 'ok', 'a wave isn\'t a line');
  s.clock.t += LIMITS.windowMs;
  const names = Array.from({ length: LIMITS.all + 5 }, (_, i) => `Name ${i}`);
  const errors = [];
  for (const n of names) errors.push(errorOf(await s.ask({ do: 'list' }, n)));
  assert.strictEqual(errors.filter(e => e === 'rate-limited').length, 5, 'made-up names don\'t get round it');
  assert.ok(s.state.api.asking.length <= LIMITS.asking);
});

test('no request changes a buddy, the library or settings', async () => {
  const s = await allowed();
  const before = lasting(s), rows = JSON.stringify(s.state.buddies);
  const tries: object[] = [
    { do: 'list' }, { do: 'act', buddy: SAMPLE_ID, action: 'wave' }, { do: 'say', buddy: SAMPLE_ID, text: 'hi' },
    { do: 'act', buddy: 'pip', action: 'wave' }, { do: 'delete', buddy: SAMPLE_ID }, { do: 'import', file: 'C:\\x.buddy' },
    { do: 'settings', api: false }, { do: 'say', buddy: 'pip', text: 'hi' }, { do: 'list', out: [] }
  ];
  for (const t of tries) await s.ask(t);
  for (const t of tries) await s.ask(t, 'Someone New');
  assert.strictEqual(lasting(s), before);
  assert.strictEqual(JSON.stringify(s.state.buddies), rows);
  assert.ok(!s.sent.some(m => m.k === 'pets' || m.k === 'dismiss' || m.k === 'bring'), 'nobody called, dismissed or moved');
});

test('the log says what was asked and what came of it, never the app or the words', async () => {
  const s = await allowed('Secret App');
  await s.ask({ do: 'say', buddy: SAMPLE_ID, text: 'a private line' }, 'Secret App');
  const lines = s.exe.logs.filter(l => /api/.test(l));
  assert.ok(lines.some(l => /api say: done/.test(l)), lines.join('\n'));
  assert.ok(!s.exe.logs.some(l => /Secret|private line/.test(l)), 'neither is logged');
});

test('options: --api is a request, and nothing else is', () => {
  assert.strictEqual(options([]).api, null);
  assert.strictEqual(options(['--api', '{"a":1}']).api, '{"a":1}');
  assert.strictEqual(options(['--api']).api, '');
  assert.strictEqual(options(['--buddies', '2']).api, null);
});

test('a start for a request: it writes "not running" and quits, opening, reading and seeding nothing', async () => {
  const req = JSON.stringify({ v: 1, id: 'cold-start-1', app: 'Claude Code', do: 'list' });
  const exe = createFakeExe({ monitors: [monitor()], args: ['--api', req] }), sent: Message[] = [];
  let quit = 0; exe.shell.on('quitting', () => { quit++; });
  const hub = createHub({ shell: exe.shell, send: m => sent.push(m), seed: async () => SAMPLE, after: () => {}, wire: createBus<Said>().wire() });
  await hub.start(); await tick(); await hub.settled;
  assert.deepStrictEqual(JSON.parse(text(exe.files.get(replyPath('cold-start-1'))!)), { v: 1, id: 'cold-start-1', ok: false, error: 'not-running', message: MESSAGES['not-running'] });
  assert.strictEqual(quit, 1);
  assert.deepStrictEqual([...exe.files.keys()], [replyPath('cold-start-1')], 'nothing seeded, no settings');
  assert.deepStrictEqual([...exe.windows.keys()], [], 'no Manager, no overlays');
  assert.deepStrictEqual(sent, [], 'nobody called out');
  assert.ok(!exe.calls.some(c => /^(data_list|data_read|tray_set|window_open|monitors|take_opened)$/.test(c.cmd)), exe.calls.map(c => c.cmd).join());

  const junk = createFakeExe({ monitors: [monitor()], args: ['--api', 'junk'] });
  let quitJunk = 0; junk.shell.on('quitting', () => { quitJunk++; });
  await createHub({ shell: junk.shell, send: () => {}, seed: async () => SAMPLE, after: () => {}, wire: createBus<Said>().wire() }).start();
  assert.strictEqual(quitJunk, 1, 'one with nothing to reply to quits too');
  assert.strictEqual(junk.files.size, 0);
});

test('cleanLine and parseRequest agree with the hub', () => {
  assert.deepStrictEqual(cleanLine('a\u200Bb\u202Ec'), { ok: true, text: 'a b c' });
  assert.deepStrictEqual(cleanLine('ok.'), { ok: true, text: 'ok.' });
  assert.deepStrictEqual(cleanLine('3.14 and 1/2'), { ok: true, text: '3.14 and 1/2' });
  assert.strictEqual(parseRequest('{"v":1,"id":"abcdefgh","app":"A","do":"list"}').ok, true);
});

test('the size cap is in bytes, not characters', () => {
  const wide = JSON.stringify({ v: 1, id: 'abcdefgh', app: 'A', do: 'say', buddy: 'olive', text: '日'.repeat(700) });
  assert.ok(wide.length < LIMITS.bytes);
  assert.deepStrictEqual(parseRequest(wide), { ok: false, error: 'too-big' });
});

test('an action she has no art for is refused, and nothing is sent', () => {
  const acted: string[] = [];
  const api = createLocalApi({
    now: () => 0, note: () => {}, on: () => true, ready: () => true, paused: () => false, hidden: () => false,
    consent: () => 'allow', ask: () => 'asked', buddies: () => [{ id: 'olive', name: 'Olive', out: true, copies: 1, can: [] }],
    act: (id, a) => acted.push(`${id} ${a}`), say: () => {}
  });
  const r = api.handle(JSON.stringify({ v: 1, id: 'abcdefgh', app: 'A', do: 'act', buddy: 'olive', action: 'wave' }));
  assert.strictEqual(errorOf(r ?? undefined), 'cant-do');
  assert.deepStrictEqual(acted, []);
});

test('a name in another case is the same app for its limits', async () => {
  const s = await allowed();
  for (let i = 0; i < LIMITS.perApp; i++) await s.ask({ do: 'list' }, i % 2 ? 'claude code' : 'CLAUDE CODE');
  assert.strictEqual(errorOf(await s.ask({ do: 'list' }, 'Claude Code')), 'rate-limited');
});

/* Replies in fixed slots */

test('a reply goes to its id\'s slot, carrying its id, and the folder never holds more than the slots', async () => {
  const exe = createFakeExe();
  const r = createReplies({ shell: exe.shell, note: () => {} });
  for (let i = 0; i < 5000; i++) void r.write({ v: 1, id: `reply-${String(i).padStart(6, '0')}`, ok: true });
  assert.ok(r.waiting <= SLOTS && r.flying <= SLOTS);
  await r.settled;
  const files = [...exe.files.keys()];
  assert.ok(files.length <= SLOTS && files.every(f => /^api\/replies\/\d\d\.json$/.test(f)), files.slice(0, 3).join());
  for (const f of files) { const got = JSON.parse(text(exe.files.get(f)!)) as Reply; assert.strictEqual(replyPath(got.id), f, 'each carries the id it belongs to'); }
});

test('slots are fixed: the values the docs and the Windows check use', () => {
  assert.strictEqual(slotOf('abcdefgh'), '13');
  assert.strictEqual(slotOf('6f1c2e4a-0d1b-4c55-9a1e-3f0b7c2d9e10'), '29');
  assert.strictEqual(replyPath('abcdefgh'), 'api/replies/13.json');
});

test('one write in flight per slot, and the newest waiting reply wins', async () => {
  const exe = createFakeExe();
  const r = createReplies({ shell: exe.shell, note: () => {} });
  const go = exe.hold('data_write');
  for (let i = 0; i < 10_000; i++) void r.write({ v: 1, id: 'same-id-1', ok: false, error: 'rate-limited', message: String(i) });
  assert.strictEqual(r.flying, 1);
  assert.strictEqual(r.waiting, 1);
  go(); await r.settled;
  const got = JSON.parse(text(exe.files.get(replyPath('same-id-1'))!)) as Reply;
  assert.ok(!got.ok && got.message === '9999');
  assert.strictEqual(exe.calls.filter(c => c.cmd === 'data_write').length, 2, 'the first, then only the newest');
});

test('a write that fails is logged, and the next one is written', async () => {
  const s = await allowed();
  s.exe.failNext('data_write', 'disk full');
  await s.ask({ do: 'list' });
  assert.ok(s.exe.logs.some(l => /couldn't write a reply/.test(l)));
  assert.strictEqual(errorOf(await s.ask({ do: 'list' })), 'ok');
});

test('a slot taken by another id is passed over by the caller', async () => {
  const s = await allowed();
  const mine = 'request-mine-1';
  const other = Array.from({ length: 5000 }, (_, i) => `other-${String(i).padStart(6, '0')}`).find(id => replyPath(id) === replyPath(mine))!;
  await s.launch({ v: 1, id: mine, app: 'Claude Code', do: 'list' });
  await s.launch({ v: 1, id: other, app: 'Claude Code', do: 'list' });
  assert.strictEqual(s.replyTo(mine), undefined, 'the newer reply in the slot is someone else\'s');
  assert.strictEqual(errorOf(s.replyTo(other)), 'ok');
});

test('cold starts with fresh ids never leave more files than the slots', async () => {
  let files = new Map<string, Uint8Array>();
  for (let i = 0; i < 300; i++) {
    const exe = createFakeExe({ monitors: [monitor()], args: ['--api', JSON.stringify({ v: 1, id: `cold-${String(i).padStart(6, '0')}`, app: 'A', do: 'list' })] });
    for (const [k, v] of files) exe.files.set(k, v);
    let quit = 0; await exe.shell.on('quitting', () => { quit++; });
    await createHub({ shell: exe.shell, send: () => {}, seed: async () => SAMPLE, after: () => {}, wire: createBus<Said>().wire() }).start();
    assert.strictEqual(quit, 1);
    files = exe.files;
  }
  assert.ok([...files.keys()].filter(f => f.startsWith(`${REPLIES}/`)).length <= SLOTS);
});

test('the API never imports: a buddy file on an --api launch goes the ordinary way, outside it', async () => {
  const s = await allowed();
  const file = write({ character: 'pip2', name: 'Pip Two', base: { src: 'data:image/png;base64,iVBORw0KGgo=', bb: { x0: 0, y0: 0, x1: 1, y1: 1 } }, poses: {} });
  s.exe.emit('second-launch', { args: ['--api', 'C:\\x\\pip2.buddy'] }); await s.done();
  assert.ok(!s.exe.files.has('library/pip2/buddy.json'), 'the launch alone imports nothing');
  assert.strictEqual(managerOpens(s.exe), 1, 'and opens nothing');
  s.exe.emit('open-file', { name: 'pip2.buddy', content: file }); await s.done();
  assert.ok(s.exe.files.has('library/pip2/buddy.json'), 'the exe\'s file-open is the ordinary double-click path');
});
