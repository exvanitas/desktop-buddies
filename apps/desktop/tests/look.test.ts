/* Show names, Buddies talk, and one buddy's own mute: kept by the real hub on the fake exe, and
   what the world does with them. */
import assert from 'node:assert';
import fs from 'node:fs';
import { read } from '@buddies/buddy-file';
import type { BuddyData } from '@buddies/engine';
import { test } from 'vitest';
import { createHost, type Message, type Port } from '../src/host';
import { createHub } from '../src/hub-core';
import type { Said } from '../src/manager-api';
import { createManagerClient } from '../src/manager-client';
import { text, type Monitor } from '../src/shell';
import { createFakeExe, type FakeExe } from '../src/shell-fake';
import { createBus } from '../src/wire';
import { whole } from './areas';

const SAMPLE = fs.readFileSync(new URL('../../../packages/test-support/fixtures/sample.json', import.meta.url), 'utf8');
const SAMPLE_ID = read(SAMPLE).character!;
const monitor: Monitor = { i: 0, name: 'A', primary: true, scale: 1, x: 0, y: 0, w: 1920, h: 1040, full: { x: 0, y: 0, w: 1920, h: 1080 } };

async function setup(prepare: (e: FakeExe) => void | Promise<void> = () => {}) {
  const exe = createFakeExe({ monitors: [monitor], args: ['--no-manager'] }), sent: Message[] = [], bus = createBus<Said>();
  await prepare(exe);
  const hub = createHub({ shell: exe.shell, send: m => sent.push(m), seed: async () => SAMPLE, after: () => {}, wire: bus.wire() });
  await hub.start();
  const done = async () => { for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r)); await hub.settled; } };
  await done();
  const client = createManagerClient({ wire: bus.wire(), session: 'w', after: () => () => {}, shimeji: async () => null, closeWindow: async () => {} });
  await done();
  const looks = () => sent.flatMap(m => m.k === 'look' ? [m] : []);
  const settings = () => JSON.parse(text(exe.files.get('settings.json')!)) as Record<string, unknown>;
  return { exe, sent, client, done, looks, settings, state: () => client.state! };
}
const stored = (body: object) => (e: FakeExe) => e.shell.dataWrite('settings.json', JSON.stringify(body));
const her = (s: Awaited<ReturnType<typeof setup>>) => s.state().buddies.find(b => b.id === SAMPLE_ID)!;

test('names show and buddies talk by default, and nothing about it is written', async () => {
  const s = await setup();
  assert.strictEqual(s.state().names, true);
  assert.strictEqual(s.state().talk, true);
  assert.strictEqual(her(s).talks, true);
  assert.deepStrictEqual(s.looks().at(-1), { k: 'look', names: true, talk: true, quiet: [] });
  const order = s.sent.map(m => m.k);
  assert.ok(order.indexOf('start') < order.indexOf('look'), 'the world has started when it hears');
  await s.client.dismiss(SAMPLE_ID);
  assert.deepStrictEqual(s.settings(), { out: [] });
});

test('Show names and Buddies talk go to the world at once, and are kept only when off', async () => {
  const s = await setup();
  await s.client.setNames(false);
  assert.deepStrictEqual(s.looks().at(-1), { k: 'look', names: false, talk: true, quiet: [] });
  await s.client.setTalk(false);
  assert.deepStrictEqual(s.looks().at(-1), { k: 'look', names: false, talk: false, quiet: [] });
  assert.deepStrictEqual(s.settings(), { out: [SAMPLE_ID], names: false, talk: false });
  assert.strictEqual(s.state().names, false); assert.strictEqual(s.state().talk, false);
  assert.strictEqual(her(s).talks, true, 'her own switch is hers');
  await s.client.setNames(true); await s.client.setTalk(true);
  assert.deepStrictEqual(s.settings(), { out: [SAMPLE_ID] });
});

test('one buddy muted: kept by her id beside who is out, and her file is untouched', async () => {
  const s = await setup();
  const file = text(s.exe.files.get(`library/${SAMPLE_ID}/buddy.json`)!);
  await s.client.setTalks(SAMPLE_ID, false);
  assert.strictEqual(her(s).talks, false);
  assert.deepStrictEqual(s.looks().at(-1), { k: 'look', names: true, talk: true, quiet: [SAMPLE_ID] });
  assert.deepStrictEqual(s.settings(), { out: [SAMPLE_ID], quiet: [SAMPLE_ID] });
  await s.client.setTalks(SAMPLE_ID, false);
  assert.deepStrictEqual(s.settings().quiet, [SAMPLE_ID], 'once');
  assert.strictEqual(text(s.exe.files.get(`library/${SAMPLE_ID}/buddy.json`)!), file);
  await s.client.setTalks(SAMPLE_ID, true);
  assert.ok(!('quiet' in s.settings()));
  assert.strictEqual(her(s).talks, true);
});

test('muting someone who isn\'t there is refused, and changes nothing', async () => {
  const s = await setup();
  const a = await s.client.setTalks('nobody', false);
  assert.ok(!a.ok);
  assert.deepStrictEqual(s.looks().at(-1)!.quiet, []);
});

test('the next run brings it all back, and the world hears it once it starts', async () => {
  const s = await setup(stored({ out: [SAMPLE_ID], names: false, talk: false, quiet: [SAMPLE_ID] }));
  assert.strictEqual(s.state().names, false); assert.strictEqual(s.state().talk, false); assert.strictEqual(her(s).talks, false);
  assert.deepStrictEqual(s.looks().at(-1), { k: 'look', names: false, talk: false, quiet: [SAMPLE_ID] });
});

test('a bad quiet list costs that list, not who is out', async () => {
  for (const quiet of ['oops', 7, null, { a: 1 }, [3, SAMPLE_ID, SAMPLE_ID]]) {
    const s = await setup(stored({ out: [SAMPLE_ID], quiet }));
    assert.strictEqual(her(s).status, 'out');
    assert.deepStrictEqual(s.looks().at(-1)!.quiet, Array.isArray(quiet) ? [SAMPLE_ID] : [], JSON.stringify(quiet));
  }
});

test('a muted buddy who is deleted leaves the list', async () => {
  const s = await setup();
  await s.client.setTalks(SAMPLE_ID, false);
  await s.client.deleteBuddy(SAMPLE_ID, her(s).rev);
  assert.deepStrictEqual(s.looks().at(-1)!.quiet, []);
  assert.ok(!('quiet' in s.settings()));
});

/* the world's side */
const BUDDY = (id: string): BuddyData => ({ id, name: 'Olive', size: 120, faces: 'right', poses: {}, base: { src: 'data:image/png;base64,AAAA', bb: { x0: .2, y0: 0, x1: .8, y1: 1 } } });
function world() {
  const host = createHost({ random: () => .5, now: () => 0, note() {}, after: () => 0, cancel() {}, every() {} });
  const hub: Port = { postMessage() {} };
  host.connect(hub);
  const send = (m: Message) => host.message(hub, m);
  return { host, send, sim: () => host.sim! };
}

test('the world shows what the hub says, for every copy of a muted buddy, and starts as it always has', () => {
  const w = world();
  w.send({ k: 'look', names: false, talk: true, quiet: ['ada'] });
  w.send({ k: 'start', all: [whole({ i: 0, x: 0, y: 0, w: 1920, h: 1040, scale: 1 })], pets: [BUDDY('ada'), BUDDY('ada~1'), BUDDY('bo')] });
  const { world: ws } = w.sim();
  assert.strictEqual(ws.names, false, 'heard before the start, kept for it');
  assert.deepStrictEqual([...ws.quiet].sort(), ['ada', 'ada~1']);
  w.send({ k: 'look', names: true, talk: false, quiet: [] });
  assert.strictEqual(ws.names, true); assert.strictEqual(ws.talk, false); assert.deepStrictEqual([...ws.quiet], []);
  const fresh = world();
  fresh.send({ k: 'start', all: [whole({ i: 0, x: 0, y: 0, w: 1920, h: 1040, scale: 1 })], pets: [BUDDY('ada')] });
  const d = fresh.sim().world;
  assert.deepStrictEqual([d.names, d.talk, d.bubbles, [...d.quiet]], [true, true, true, []], 'with nothing said, as before');
});

test('a copy called later is muted with the rest of her', () => {
  const w = world();
  w.send({ k: 'start', all: [whole({ i: 0, x: 0, y: 0, w: 1920, h: 1040, scale: 1 })], pets: [BUDDY('ada')] });
  w.send({ k: 'look', names: true, talk: true, quiet: ['ada'] });
  w.send({ k: 'pets', pets: [BUDDY('ada'), BUDDY('ada~1')] });
  assert.deepStrictEqual([...w.sim().world.quiet].sort(), ['ada', 'ada~1']);
});
