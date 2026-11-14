// @vitest-environment happy-dom
/* The end-to-end run's probe, here on the real Manager view over the real hub and the fake exe, and
   on the real bubble view. What it clicks has to be what the person would click, and what it reads
   has to be what she shows: on Windows, a probe that missed a button would only say FAIL. */
import { rectangle } from '@buddies/art/outline';
import type { Frame, Input } from '@buddies/engine';
import assert from '@buddies/test-support/dom-assert';
import { createView } from '@buddies/view';
import { test } from 'vitest';
import type { HubState } from '../src/manager-api';
import { createManagerClient } from '../src/manager-client';
import { mountView } from '../src/manager-view';
import { text } from '../src/shell';
import { appLine, ascii, hex, imageName, perform, watchOverlay, type Look, type Seen, type Task } from '../shell-check/api-probe-core';
import { SAMPLE_ID, errorOf, setup, tick } from './api-harness';

/* A task as the driver writes it, before it's numbered. */
type Unnumbered<T = Task> = T extends Task ? Omit<T, 'n'> : never;
async function onManager() {
  const s = await setup();
  const client = createManagerClient({ wire: s.wire(), session: 'probe', after: () => () => {}, shimeji: async () => null, closeWindow: async () => {} });
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  mountView(root, client, { minimize: async () => {}, outline: async () => rectangle(138, 138, 1.5), store: () => ({ getItem: () => null, setItem: () => {} }), moves: () => false, now: () => 0, after: () => {} });
  const until = async (f: (st: HubState) => boolean) => {
    for (let i = 0; i < 50; i++) { await s.done(); if (client.state && f(client.state)) return true; }
    return false;
  };
  await until(st => st.ready);
  let n = 0;
  const run = (t: Unnumbered) => perform({ ...t, n: ++n } as Task, { root, state: () => client.state, until });
  const settings = () => JSON.parse(text(s.exe.files.get('settings.json')!)) as { api?: boolean; apiApps?: { name: string; allow: boolean }[] };
  return { s, run, settings, client };
}

test('the probe turns the setting on, sees the question, and answers it with the real buttons', async () => {
  const { s, run, settings } = await onManager();
  assert.strictEqual(errorOf(await s.ask({ do: 'list' }, 'E2E Check')), 'off');
  const on = await run({ do: 'on', on: true });
  assert.ok(on.ok, ascii(on.detail));
  assert.strictEqual(settings().api, true);
  assert.strictEqual(errorOf(await s.ask({ do: 'list' }, 'E2E Check')), 'waiting');
  const look = await run({ do: 'look', app: 'E2E Check' });
  assert.ok(look.ok, ascii(look.detail));
  const allow = await run({ do: 'answer', app: 'E2E Check', allow: true });
  assert.ok(allow.ok, ascii(allow.detail));
  assert.deepStrictEqual(settings().apiApps, [{ name: 'E2E Check', allow: true }]);
  assert.strictEqual(errorOf(await s.ask({ do: 'list' }, 'E2E Check')), 'ok');
});

test('the probe pauses and hides by the footer switches, and back', async () => {
  const { s, run } = await onManager();
  await s.command({ k: 'api', on: true });
  await s.ask({ do: 'list' }, 'E2E Check');
  await s.command({ k: 'api-answer', app: 'E2E Check', allow: true });
  for (const what of ['pause', 'hide'] as const) {
    const r = await run({ do: what, on: true });
    assert.ok(r.ok, ascii(r.detail));
    assert.strictEqual(s.state[what === 'pause' ? 'paused' : 'hidden'], true);
    const act = await s.ask({ do: 'act', buddy: SAMPLE_ID, action: 'wave' }, 'E2E Check');
    assert.strictEqual(errorOf(act), what === 'pause' ? 'paused' : 'hidden');
    const back = await run({ do: what, on: false });
    assert.ok(back.ok, ascii(back.detail));
  }
  assert.strictEqual(errorOf(await s.ask({ do: 'act', buddy: SAMPLE_ID, action: 'wave' }, 'E2E Check')), 'ok');
});

test('the probe says Not now, and Remove in Settings asks again', async () => {
  const { s, run, settings } = await onManager();
  await run({ do: 'on', on: true });
  await s.ask({ do: 'list' }, 'E2E Denied');
  const no = await run({ do: 'answer', app: 'E2E Denied', allow: false });
  assert.ok(no.ok, ascii(no.detail));
  assert.deepStrictEqual(settings().apiApps, [{ name: 'E2E Denied', allow: false }]);
  assert.strictEqual(errorOf(await s.ask({ do: 'list' }, 'E2E Denied')), 'not-allowed');
  const gone = await run({ do: 'forget', app: 'E2E Denied' });
  assert.ok(gone.ok, ascii(gone.detail));
  assert.strictEqual(settings().apiApps, undefined);
  assert.strictEqual(errorOf(await s.ask({ do: 'list' }, 'E2E Denied')), 'waiting');
  const off = await run({ do: 'on', on: false });
  assert.ok(off.ok, ascii(off.detail));
  assert.strictEqual(settings().api, undefined);
  const st = await run({ do: 'state' });
  assert.deepStrictEqual((st.detail as { hub: { asking: string[] } }).hub.asking, [], 'off forgets who was waiting');
});

test('the probe turns Open .buddy files on and off by its switch in Settings, and says the library\'s names', async () => {
  const { s, run } = await onManager();
  const on = await run({ do: 'files', on: true });
  assert.ok(on.ok, ascii(on.detail));
  assert.strictEqual(s.exe.fileAssoc, true);
  assert.strictEqual(document.querySelector('.panel'), null, 'Settings closed again');
  const st = await run({ do: 'state' });
  const hub = (st.detail as { hub: { files: boolean; names: string[] } }).hub;
  assert.strictEqual(hub.files, true);
  assert.deepStrictEqual(hub.names, s.state.buddies.map(b => b.name));
  assert.ok(hub.names.length > 0);
  const again = await run({ do: 'files', on: true });
  assert.ok(again.ok && (again.detail as { already?: boolean }).already, ascii(again.detail));
  const off = await run({ do: 'files', on: false });
  assert.ok(off.ok, ascii(off.detail));
  assert.strictEqual(s.exe.fileAssoc, false);
});

test('a click counts only once the hub says it took: one it never takes fails', async () => {
  const { s, client } = await onManager();
  await s.command({ k: 'api', on: true });
  await s.ask({ do: 'list' }, 'E2E Check');
  await s.command({ k: 'api-answer', app: 'E2E Check', allow: false });
  await s.ask({ do: 'list' }, 'E2E Other');
  await s.done();
  const root = document.body.firstElementChild!;
  const deaf = { root, state: () => client.state, until: async () => false };
  for (const t of [{ do: 'pause', on: true }, { do: 'hide', on: true }, { do: 'on', on: false }, { do: 'files', on: true }, { do: 'answer', app: 'E2E Other', allow: true }, { do: 'forget', app: 'E2E Check' }] as Unnumbered[]) {
    const r = await perform({ ...t, n: 1 } as Task, deaf);
    assert.ok(!r.ok, `${t.do}: ${ascii(r.detail)}`);
  }
});

test('a task the view can\'t do says what it saw, and fails', async () => {
  const { run } = await onManager();
  const r = await run({ do: 'answer', app: 'Nobody', allow: true });
  assert.ok(!r.ok);
  assert.ok(/no question/.test(ascii(r.detail)), ascii(r.detail));
  const look = await run({ do: 'look', app: 'Nobody' });
  assert.ok(!look.ok);
});

const input = { down() {}, move() {}, up() {}, enter() {}, leave() {}, pointer() {} } as unknown as Input;
const pet = (bubble: Partial<Frame['pets'][number]['bubble']>, src: string | null = 'library/o/s.webp', off = false): Frame => ({ fx: [], pets: [{ id: 'b0', size: '120px', src, origin: null, body: null, grab: false, stage: '', parts: null, off, box: { l: 0, t: 0, size: 120, ox: 0, oy: 0 }, tf: null, bubble: { text: '', hidden: true, pop: 0, below: false, tf: null, at: null, ...bubble }, tag: { text: '', hidden: true, tf: null } }] });

/* The real view on a page, watched through a look the test answers: what the browser itself judges
   is checked in a real one, tests/browser/probe-overlay.mjs. Each element is seen unless the test
   says otherwise. happy-dom loads no images, so `picture` says how hers went. */
function overlay(isWave: (name: string) => boolean = () => false) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const view = createView({ root, input, viewport: { x: 0, y: 0, scale: 1, w: 1920, h: 1040 } });
  const said: string[] = [], waves: number[] = [], cannot: string[] = [];
  const answers = new Map<Element, Seen>();
  let all: Seen = 'yes';
  const look: Look = { settle: async () => {}, seen: el => answers.get(el) ?? all };
  const w = watchOverlay(root, { said: (f, t) => said.push(`${hex(f)} ${hex(t)}`), waved: n => waves.push(n), isWave, cannot: why => cannot.push(why) }, look);
  const settle = async () => { for (let i = 0; i < 8; i++) { await tick(); w.flush(); } };
  const show = async (f: Frame) => { view.apply(f); await settle(); };
  const img = () => root.querySelector<HTMLImageElement>('.db-pet > .db-body > img')!;
  const bubble = () => root.querySelector('.db-bubble')!;
  /* Her image as the browser has it now: decoded, or failed, then the event for it. */
  const picture = async (ok: boolean) => {
    const i = img();
    for (const [k, v] of [['complete', true], ['naturalWidth', ok ? 64 : 0], ['currentSrc', ok ? i.src : '']] as const) Object.defineProperty(i, k, { value: v, configurable: true });
    i.dispatchEvent(new Event(ok ? 'load' : 'error'));
    await settle();
  };
  const recheck = async () => { w.recheck(); await settle(); };
  return { root, view, said, waves, cannot, answers, set all(s: Seen) { all = s; }, w, show, picture, img, bubble, recheck };
}
const LINE = 'He said "hi" \\ café \u{1F44B} a | b end\\';
const SAID = `${hex('E2E Check')} ${hex(LINE)}`;
const isW = (name: string) => name === 'w1.webp' || name === 'w2.webp';

test('an app\'s line is told once, byte for byte, when her bubble and her decoded image are seen; her own lines never', async () => {
  const o = overlay();
  await o.show(pet({ text: 'her own line', hidden: false, pop: 1 }));
  await o.picture(true);
  await o.show(pet({ text: LINE, from: 'E2E Check', hidden: false, pop: 2 }));
  await o.show(pet({ text: LINE, from: 'E2E Check', hidden: true, pop: 2 }));
  await o.recheck();
  assert.deepStrictEqual(o.said, [SAID], 'once, and her own line not at all');
  assert.deepStrictEqual(appLine(o.bubble()), { from: 'E2E Check', text: LINE });
  assert.strictEqual(hex('é\u{1F44B}'), 'c3a9f09f918b');
  o.w.stop();
});

test('a line is not told while her bubble, or her image, isn\'t seen, or her image isn\'t decoded; told once they are', async () => {
  const o = overlay();
  await o.show(pet({ text: LINE, from: 'E2E Check', hidden: false, pop: 1 }));
  assert.deepStrictEqual(o.said, [], 'her image never decoded');
  o.answers.set(o.bubble(), 'no');
  await o.picture(true);
  assert.deepStrictEqual(o.said, [], 'the bubble not seen');
  o.answers.delete(o.bubble());
  o.answers.set(o.img(), 'no');
  await o.recheck();
  assert.deepStrictEqual(o.said, [], 'her image not seen');
  o.answers.delete(o.img());
  await o.recheck();
  assert.deepStrictEqual(o.said, [SAID], 'told once both are');
  o.w.stop();
});

test('a line with no buddy before it, or none with an image where the view puts it, is never told', async () => {
  const o = overlay();
  await o.show(pet({ text: 'x', hidden: false, pop: 1 }));
  await o.picture(true);
  const body = o.root.querySelector('.db-body')!;
  o.root.querySelector('.db-pet')!.append(o.img());
  body.remove();
  await o.show(pet({ text: LINE, from: 'E2E Check', hidden: false, pop: 2 }));
  await o.recheck();
  assert.deepStrictEqual(o.said, [], 'her image, but not at .db-pet > .db-body > img');
  o.root.querySelector('.db-pet')!.remove();
  await o.recheck();
  assert.deepStrictEqual(o.said, [], 'no pet');
  o.w.stop();
});

test('a page that can\'t judge says so once, and tells nothing at all', async () => {
  const o = overlay(isW);
  o.all = 'unknown';
  await o.show(pet({ text: LINE, from: 'E2E Check', hidden: false, pop: 1 }, 'library/o/w1.webp'));
  await o.picture(true);
  await o.recheck();
  assert.deepStrictEqual(o.said, []);
  assert.deepStrictEqual(o.waves, []);
  assert.strictEqual(o.cannot.length, 1, o.cannot.join());
  o.w.stop();
});

test('each wave is counted as it starts, once a decoded wave image is seen', async () => {
  const o = overlay(isW);
  for (const src of ['library/o/s.webp', 'library/o/w1.webp?v=2', 'library/o/w2.webp', 'library/o/s.webp', 'library/o/w2.webp']) {
    await o.show(pet({}, src));
    await o.picture(true);
  }
  assert.deepStrictEqual(o.waves, [1, 2]);
  assert.strictEqual(imageName('http://asset.localhost/library/o/w%201.webp?v=3'), 'w 1.webp');
  o.w.stop();
});

test('a wave image not seen, still loading, or failed is never a wave; one seen or loaded late is', async () => {
  const o = overlay(isW);
  await o.show(pet({}, 'library/o/w1.webp'));
  o.answers.set(o.img(), 'no');
  await o.picture(true);
  assert.deepStrictEqual(o.waves, [], 'not seen');
  o.answers.delete(o.img());
  await o.recheck();
  assert.deepStrictEqual(o.waves, [1], 'seen later');
  await o.show(pet({}, 'library/o/s.webp'));
  await o.picture(true);
  await o.show(pet({}, 'library/o/w2.webp'));
  assert.deepStrictEqual(o.waves, [1], 'not decoded yet: the old picture still says complete');
  await o.picture(false);
  assert.deepStrictEqual(o.waves, [1], 'broken: a wave by its file name only');
  await o.show(pet({}, 'library/o/s.webp'));
  await o.show(pet({}, 'library/o/w1.webp'));
  await o.picture(true);
  assert.deepStrictEqual(o.waves, [1, 2], 'decoded late, told when it loads');
  o.w.stop();
});

test('what the probe logs is plain ASCII', () => {
  assert.strictEqual(ascii({ a: 'café "x"' }), '{"a":"caf\\u00e9 \\"x\\""}');
  assert.strictEqual(ascii(undefined), 'null');
});
