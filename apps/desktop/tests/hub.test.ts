/* The hub's logic against the fake exe and a recording world. */
import assert from 'node:assert';
import fs from 'node:fs';
import { read, write, type Buddy } from '@buddies/buddy-file';
import { test, vi } from 'vitest';
import { createCapture } from '../src/capture';
import { viewport, type Message } from '../src/host';
import { createHub, options, type OverlayBoot } from '../src/hub-core';
import type { Said } from '../src/manager-api';
import { changes, createScreens } from '../src/screens';
import { MIN_API, text, type MenuItem, type Monitor } from '../src/shell';
import { createFakeExe, type FakeOptions } from '../src/shell-fake';
import { menu } from '../src/tray';
import { createBus } from '../src/wire';

const SAMPLE = fs.readFileSync(new URL('../../../packages/test-support/fixtures/sample.json', import.meta.url), 'utf8');
const SAMPLE_ID = read(SAMPLE).character!;
const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
const small = (character: string, name = 'Pip'): Buddy => ({ character, name, base: { src: 'data:image/png;base64,iVBORw0KGgo=', bb: box }, poses: {} });
const monitor = (name: string, i: number, x: number, y = 0, w = 1920, h = 1040, scale = 1): Monitor => ({ i, name, primary: x === 0, scale, x, y, w, h, full: { x, y, w, h: h + 40 } });
const ONE = () => [monitor('A', 0, 0)], TWO = () => [monitor('A', 0, 0), monitor('B', 1, 1920)];

/* Quiet unless asked: most of these are about overlays, and a Manager opening at start would be one
   more window in each. The start itself is tested with `quiet` off. */
async function setup(o: FakeOptions = {}, prepare: (e: ReturnType<typeof createFakeExe>) => Promise<void> = async () => {}, quiet = true, seed: string | null = SAMPLE) {
  const exe = createFakeExe({ monitors: TWO(), ...o, args: quiet ? [...o.args ?? [], '--no-manager'] : o.args }), sent: Message[] = [], timers: { ms: number; f: () => void }[] = [];
  await prepare(exe);
  const hub = createHub({ shell: exe.shell, send: m => sent.push(m), seed: async () => seed, after: (ms, f) => { timers.push({ ms, f }); }, wire: createBus<Said>().wire() });
  await hub.start();
  const done = async () => { await new Promise(r => setTimeout(r)); await hub.settled; };
  const retry = async () => { const t = timers.shift(); assert.ok(t, 'a retry is waiting'); t.f(); await done(); return t.ms; };
  const last = <K extends Message['k']>(k: K) => sent.filter(m => m.k === k).pop() as Extract<Message, { k: K }> | undefined;
  const items = (): MenuItem[] => exe.tray!.items!;
  const item = (id: string) => items().flatMap(i => [i, ...(i.items || [])]).find(i => i.id === id)!;
  return { exe, hub, sent, last, done, retry, timers, item, items };
}
const overlays = (exe: ReturnType<typeof createFakeExe>) => [...exe.windows.keys()].sort();
const clicked = async (s: Awaited<ReturnType<typeof setup>>, id: string) => { s.exe.emit('tray', { id }); await s.done(); };

test('first run: the library is seeded with Olive, and she comes out', async () => {
  const s = await setup();
  assert.ok(s.exe.files.has(`library/${SAMPLE_ID}/buddy.json`));
  const start = s.last('start')!;
  assert.deepStrictEqual(start.pets.map(p => p.id), [SAMPLE_ID]);
  assert.match(start.pets[0]!.base.src, /^library\//);
  assert.ok(s.exe.logs.some(l => /library seeded/.test(l)));
});

test('first run of a build with no seed: an empty library, nobody out, and the Manager opens on it', async () => {
  const s = await setup({}, async () => {}, false, null);
  assert.ok(![...s.exe.files.keys()].some(k => k.startsWith('library/')), [...s.exe.files.keys()].join());
  assert.deepStrictEqual(s.last('start')!.pets, []);
  assert.ok(s.exe.logs.some(l => /no buddy to seed/.test(l)) && !s.exe.logs.some(l => /seeded with/.test(l)), s.exe.logs.join('; '));
  assert.ok(s.exe.windows.has('manager'), [...s.exe.windows.keys()].join());
  assert.ok(!JSON.parse(new TextDecoder().decode(s.exe.files.get('settings.json') ?? new Uint8Array([123, 125]))).noSeed, 'a later build with a seed still seeds');
});

test('a later run seeds nothing and brings back who was out', async () => {
  const s = await setup({}, async e => {
    await e.shell.dataWrite('library/c1/buddy.json', JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: { ...small('c1'), base: { src: 'base.png', bb: box } } }));
    await e.shell.dataWrite('library/c2/buddy.json', JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: { ...small('c2'), base: { src: 'base.png', bb: box } } }));
    await e.shell.dataWrite('settings.json', JSON.stringify({ out: ['c2', 'gone'] }));
  });
  assert.ok(!s.exe.logs.some(l => /seeded/.test(l)));
  assert.deepStrictEqual(s.last('start')!.pets.map(p => p.id), ['c2']);
});

test('the world starts before any overlay opens, one overlay per monitor', async () => {
  const s = await setup();
  assert.deepStrictEqual(overlays(s.exe), ['overlay0', 'overlay1']);
  const first = s.exe.calls.findIndex(c => c.cmd === 'window_open');
  assert.ok(first >= 0 && s.sent.some(m => m.k === 'start'));
  assert.strictEqual(s.sent[0]!.k, 'start');
  const o = s.exe.windows.get('overlay1')!;
  assert.strictEqual(o.page, 'overlay.html');
  /* at the whole screen less its top line, the taskbar's strip too, so she can be drawn over it */
  assert.deepStrictEqual(o.kind === 'overlay' && [o.x, o.y, o.w, o.h], [1920, 1, 1920, 1079]);
  const { n, ...boot } = o.boot as OverlayBoot;
  assert.deepStrictEqual(boot, { me: { i: 1, x: 1920, y: 0, w: 1920, h: 1040, scale: 1, full: { x: 1920, y: 0, w: 1920, h: 1080 } }, mode: 'demo' });
  assert.ok(Number.isInteger(n), 'and its own window number');
});

test('the cursor goes to the world', async () => {
  const s = await setup();
  s.exe.emit('cursor', { x: 5, y: 6, down: true, right: false });
  assert.deepStrictEqual(s.last('cursor'), { k: 'cursor', x: 5, y: 6, down: true, right: false });
});

test('a monitor that goes closes its overlay and tells the world, world first', async () => {
  const s = await setup(); s.sent.length = 0;
  s.exe.emit('monitors', ONE()); await s.done();
  assert.deepStrictEqual(overlays(s.exe), ['overlay0']);
  assert.deepStrictEqual(s.sent.map(m => m.k), ['monitors', 'leave']);
  assert.strictEqual(s.last('monitors')!.all.length, 1);
  assert.strictEqual(s.last('leave')!.i, 1);
});

test('a monitor that comes opens an overlay', async () => {
  const s = await setup({ monitors: ONE() });
  s.exe.emit('monitors', TWO()); await s.done();
  assert.deepStrictEqual(overlays(s.exe), ['overlay0', 'overlay1']);
  assert.strictEqual(s.last('monitors')!.all.length, 2);
});

test('a monitor keeps its number when others go, by name and not by place in the list', async () => {
  const s = await setup();
  s.exe.emit('monitors', [monitor('B', 0, 1920)]); await s.done();
  assert.deepStrictEqual(overlays(s.exe), ['overlay1']);
  assert.deepStrictEqual(s.last('monitors')!.all.map(a => a.i), [1]);
  assert.strictEqual(s.last('leave')!.i, 0);
  s.exe.emit('monitors', TWO()); await s.done();
  assert.deepStrictEqual(overlays(s.exe), ['overlay0', 'overlay1']);
  assert.deepStrictEqual(s.last('monitors')!.all.map(a => a.i), [0, 1]);
});

test('a moved taskbar places the overlay that changed, and only that one', async () => {
  const s = await setup();
  s.exe.calls.length = 0;
  s.exe.emit('monitors', [monitor('A', 0, 0, 0, 1920, 1000), monitor('B', 1, 1920)]); await s.done();
  assert.deepStrictEqual(s.exe.calls.filter(c => c.cmd.startsWith('window')), [{ cmd: 'window_place', args: { label: 'overlay0', x: 0, y: 1, w: 1920, h: 1039 } }]);
  assert.strictEqual(s.last('monitors')!.all[0]!.h, 1000);
});

/* A monitor with its taskbar on one side: the work area is the screen less a 40 px strip there. */
const barred = (name: string, i: number, side: 'bottom' | 'top' | 'left' | 'right' | 'hidden', x = 0, scale = 1): Monitor => {
  const full = { x, y: 0, w: 1920, h: 1080 }, t = 40 * scale;
  const work = side === 'bottom' ? { ...full, h: 1080 - t } : side === 'top' ? { ...full, y: t, h: 1080 - t }
    : side === 'left' ? { ...full, x: x + t, w: 1920 - t } : side === 'right' ? { ...full, w: 1920 - t } : full;
  return { i, name, primary: x === 0, scale, ...work, full };
};
const placed = (s: Awaited<ReturnType<typeof setup>>) => s.exe.calls.filter(c => c.cmd.startsWith('window'));

/* The screen less one line, across from the taskbar, or off the top with none to tell: never the whole
   monitor, which Windows would take for a full-screen app and drop the taskbar under everything. */
const WINDOWS = { bottom: [0, 1, 1920, 1079], top: [0, 0, 1920, 1079], left: [0, 0, 1919, 1080], right: [1, 0, 1919, 1080], hidden: [0, 1, 1920, 1079] };

test('each overlay opens at its screen less one line, wherever its taskbar is; the world keeps the work area', async () => {
  for (const side of ['bottom', 'top', 'left', 'right', 'hidden'] as const) {
    const s = await setup({ monitors: [barred('A', 0, side)] });
    const o = s.exe.windows.get('overlay0')!;
    assert.deepStrictEqual(o.kind === 'overlay' && [o.x, o.y, o.w, o.h], WINDOWS[side], side);
    /* the page draws from the corner it was really opened at */
    const v = viewport((o.boot as OverlayBoot).me);
    assert.ok(o.kind === 'overlay');
    assert.deepStrictEqual([v.x, v.y, v.w! * v.scale, v.h! * v.scale], [o.x, o.y, o.w, o.h], `${side}: its viewport is its window`);
    const a = s.last('start')!.all[0]!, m = barred('A', 0, side);
    assert.deepStrictEqual([a.x, a.y, a.w, a.h], [m.x, m.y, m.w, m.h], `${side}: terrain is the work area`);
    assert.deepStrictEqual(a.full, m.full, side);
  }
});

test('a taskbar that hides or shows changes only one of the two rects, and the overlay is placed again', async () => {
  const s = await setup({ monitors: [barred('A', 0, 'bottom')] });
  s.exe.calls.length = 0;
  /* set to hide: the work area grows to the whole screen, the screen stays */
  s.exe.emit('monitors', [barred('A', 0, 'hidden')]); await s.done();
  assert.deepStrictEqual(placed(s), [{ cmd: 'window_place', args: { label: 'overlay0', x: 0, y: 1, w: 1920, h: 1079 } }]);
  assert.strictEqual(s.last('monitors')!.all[0]!.h, 1080, 'the world hears the new floor');
  /* only the screen changes: a new resolution with the taskbar hidden keeps nothing else */
  s.exe.calls.length = 0; s.sent.length = 0;
  const bigger = { ...barred('A', 0, 'hidden'), full: { x: 0, y: 0, w: 2560, h: 1440 } };
  s.exe.emit('monitors', [bigger]); await s.done();
  /* the work area now falls short most on the right, so that's the taskbar's side here */
  assert.deepStrictEqual(placed(s), [{ cmd: 'window_place', args: { label: 'overlay0', x: 1, y: 0, w: 2559, h: 1440 } }]);
  assert.deepStrictEqual(s.last('monitors')!.all[0]!.full, bigger.full, 'and the overlay hears it through the world');
  /* the same again does nothing */
  s.exe.calls.length = 0; s.sent.length = 0;
  s.exe.emit('monitors', [{ ...bigger }]); await s.done();
  assert.deepStrictEqual([placed(s), s.sent], [[], []]);
});

test('two monitors with different taskbars and scales each get their own screen less one line', async () => {
  const s = await setup({ monitors: [barred('A', 0, 'bottom'), barred('B', 1, 'left', 1920, 1.5)] });
  const a = s.exe.windows.get('overlay0')!, b = s.exe.windows.get('overlay1')!;
  assert.deepStrictEqual(a.kind === 'overlay' && [a.x, a.y, a.w, a.h], [0, 1, 1920, 1079]);
  assert.deepStrictEqual(b.kind === 'overlay' && [b.x, b.y, b.w, b.h], [1920, 0, 1919, 1080]);
  const [wa, wb] = s.last('start')!.all;
  assert.deepStrictEqual([wa!.x, wa!.h, wb!.x, wb!.w, wb!.scale], [0, 1040, 1980, 1860, 1.5]);
});

test('the same list again does nothing', async () => {
  const s = await setup(); s.sent.length = 0; s.exe.calls.length = 0;
  s.exe.emit('monitors', TWO()); await s.done();
  assert.strictEqual(s.sent.length, 0);
  assert.strictEqual(s.exe.calls.filter(c => c.cmd.startsWith('window')).length, 0);
});

test('an empty list is a display waking up, and changes nothing', async () => {
  const s = await setup(); s.sent.length = 0;
  s.exe.emit('monitors', []); await s.done();
  assert.deepStrictEqual(overlays(s.exe), ['overlay0', 'overlay1']);
  assert.strictEqual(s.sent.length, 0);
});

test('changes arriving together are worked through in order', async () => {
  const s = await setup();
  s.exe.emit('monitors', ONE()); s.exe.emit('monitors', TWO()); s.exe.emit('monitors', ONE()); await s.done();
  assert.deepStrictEqual(overlays(s.exe), ['overlay0']);
  assert.ok(!s.exe.logs.some(l => /hub error/.test(l)), s.exe.logs.join('; '));
});

test('a window that fails to open is logged, and the next change still runs', async () => {
  const s = await setup({ monitors: ONE() });
  s.exe.failNext('window_open', 'webview failed');
  s.exe.emit('monitors', TWO()); await s.done();
  assert.ok(s.exe.logs.some(l => /hub error.*webview failed/.test(l)));
  s.exe.emit('monitors', [monitor('A', 0, 0), monitor('B', 1, 1920), monitor('C', 2, 3840)]); await s.done();
  assert.ok(s.exe.windows.has('overlay2'));
});

test('an overlay that failed to open is tried again until it opens, and only that', async () => {
  const s = await setup({ monitors: ONE() });
  s.exe.failNext('window_open', 'webview failed');
  s.exe.emit('monitors', TWO()); await s.done();
  assert.deepStrictEqual(overlays(s.exe), ['overlay0']);
  s.sent.length = 0;
  assert.strictEqual(await s.retry(), 2000);
  assert.deepStrictEqual(overlays(s.exe), ['overlay0', 'overlay1']);
  assert.strictEqual(s.exe.calls.filter(c => c.cmd === 'window_open').length, 3);
  assert.deepStrictEqual(s.sent, [], 'the world already knew');
  assert.strictEqual(s.timers.length, 0, 'nothing left to retry');
});

test('a retry that fails again waits longer, up to a limit, and a change in between works too', async () => {
  const s = await setup({ monitors: ONE() });
  s.exe.failNext('window_open', 'webview failed');
  s.exe.emit('monitors', TWO()); await s.done();
  const waits = [];
  for (let i = 0; i < 7; i++) { s.exe.failNext('window_open', 'webview failed'); waits.push(await s.retry()); }
  assert.deepStrictEqual(waits, [2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  s.exe.emit('monitors', TWO()); await s.done();
  assert.deepStrictEqual(overlays(s.exe), ['overlay0', 'overlay1'], 'the next event tries too');
  assert.strictEqual(s.timers.length, 1, 'one retry waiting, never a pile');
  await s.retry();
  assert.strictEqual(s.timers.length, 0);
  s.exe.failNext('window_open', 'webview failed');
  s.exe.emit('monitors', [...TWO(), monitor('C', 2, 3840)]); await s.done();
  assert.strictEqual(await s.retry(), 2000, 'success starts the wait over');
});

test('an overlay that failed at startup doesn\'t stop the hub, and comes back', async () => {
  const s = await setup({}, async e => { e.failNext('window_open', 'webview failed'); });
  assert.deepStrictEqual(overlays(s.exe), ['overlay1']);
  assert.ok(s.exe.tray, 'the tray still came up');
  assert.ok(s.exe.logs.some(l => /hub up/.test(l)));
  await s.retry();
  assert.deepStrictEqual(overlays(s.exe), ['overlay0', 'overlay1']);
});

test('files passed at launch still arrive when an overlay failed, and an import tries it again like any event', async () => {
  const s = await setup({ opened: [{ name: 'p.buddy.json', content: write(small('c1')) }] }, async e => { e.failNext('window_open', 'webview failed'); });
  assert.ok(s.exe.logs.some(l => /launch: a file, imported/.test(l)));
  assert.deepStrictEqual(overlays(s.exe), ['overlay0', 'overlay1']);
  await s.retry();
  assert.strictEqual(s.timers.length, 0);
});

test('a place that failed is tried again, at the latest place', async () => {
  const s = await setup({ monitors: ONE() });
  s.exe.failNext('window_place', 'busy');
  s.exe.emit('monitors', [monitor('A', 0, 0, 0, 1920, 1000)]); await s.done();
  assert.strictEqual((s.exe.windows.get('overlay0') as { h: number }).h, 1079);
  s.exe.monitors = [];
  await s.retry();
  assert.strictEqual((s.exe.windows.get('overlay0') as { h: number }).h, 1039);
});

test('a close that failed is tried again, and the monitor coming back in time cancels it', async () => {
  const s = await setup();
  s.exe.failNext('window_close', 'busy');
  s.exe.emit('monitors', ONE()); await s.done();
  assert.deepStrictEqual(overlays(s.exe), ['overlay0', 'overlay1']);
  await s.retry();
  assert.deepStrictEqual(overlays(s.exe), ['overlay0']);
  const t = await setup();
  t.exe.failNext('window_close', 'busy');
  t.exe.emit('monitors', ONE()); await t.done();
  t.exe.emit('monitors', TWO()); await t.done();
  assert.deepStrictEqual(overlays(t.exe), ['overlay0', 'overlay1']);
  assert.ok(!t.exe.calls.filter(c => c.cmd === 'window_open').slice(2).length, 'no second window');
});

test('a close that failed and was cancelled never left the world, and a retry does nothing', async () => {
  const s = await setup();
  s.exe.failNext('window_close', 'busy');
  s.exe.emit('monitors', ONE()); await s.done();
  s.exe.emit('monitors', TWO()); await s.done();
  assert.deepStrictEqual(s.sent.filter(m => m.k === 'leave'), [], 'the world keeps its connection');
  assert.strictEqual(s.last('monitors')!.all.length, 2, 'and hears the monitor is back');
  await s.retry();
  assert.strictEqual(s.exe.calls.filter(c => c.cmd === 'window_close').length, 1);
});

test('the world hears an overlay left once, after the window has gone', async () => {
  const s = await setup();
  const n = windowN(s, 'overlay1');
  s.exe.failNext('window_close', 'busy');
  s.exe.emit('monitors', ONE()); await s.done();
  assert.deepStrictEqual(s.sent.filter(m => m.k === 'leave'), []);
  await s.retry();
  assert.deepStrictEqual(s.sent.filter(m => m.k === 'leave'), [{ k: 'leave', i: 1, n }]);
});

test('a hide that failed on a new overlay is tried again', async () => {
  const s = await setup({ monitors: ONE() });
  await clicked(s, 'hide');
  s.exe.failNext('window_hide', 'busy');
  s.exe.emit('monitors', TWO()); await s.done();
  assert.strictEqual(s.exe.windows.get('overlay1')!.hidden, false);
  assert.ok(s.exe.logs.some(l => /hub error.*busy/.test(l)));
  await s.retry();
  assert.strictEqual(s.exe.windows.get('overlay1')!.hidden, true);
  assert.strictEqual(s.exe.calls.filter(c => c.cmd === 'window_open').length, 2, 'not opened again');
  assert.strictEqual(s.timers.length, 0);
});

test('hide all gets past one that fails, still pauses, and finishes it later', async () => {
  const s = await setup();
  s.exe.failNext('window_hide', 'busy', (a: { label: string }) => a.label === 'overlay0');
  await clicked(s, 'hide');
  assert.strictEqual(s.exe.windows.get('overlay0')!.hidden, false);
  assert.strictEqual(s.exe.windows.get('overlay1')!.hidden, true);
  assert.deepStrictEqual(s.last('pause'), { k: 'pause', on: true });
  assert.strictEqual(s.item('hide').checked, true);
  await s.retry();
  assert.strictEqual(s.exe.windows.get('overlay0')!.hidden, true);
});

test('a show that failed is tried again, and hiding in between cancels it', async () => {
  const s = await setup();
  await clicked(s, 'hide');
  s.exe.failNext('window_show', 'busy', (a: { label: string }) => a.label === 'overlay0');
  await clicked(s, 'hide');
  assert.strictEqual(s.exe.windows.get('overlay0')!.hidden, true);
  await s.retry();
  assert.strictEqual(s.exe.windows.get('overlay0')!.hidden, false);
  const t = await setup();
  await clicked(t, 'hide');
  t.exe.failNext('window_show', 'busy', (a: { label: string }) => a.label === 'overlay0');
  await clicked(t, 'hide');
  await clicked(t, 'hide');
  assert.strictEqual(t.exe.windows.get('overlay0')!.hidden, true);
  assert.strictEqual(t.exe.windows.get('overlay1')!.hidden, true);
});

const manifest = (id: string, name: string) => JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: { ...small(id, name), base: { src: 'base.png', bb: box } } });

test('a saved copy that can\'t go back at the start isn\'t seeded over, and returns on a retry', async () => {
  const s = await setup({}, async e => {
    await e.shell.dataWrite(`library/.outgoing/${SAMPLE_ID}/buddy.json`, manifest(SAMPLE_ID, 'My Olive'));
    await e.shell.dataWrite(`library/.outgoing/${SAMPLE_ID}/base.png`, 'mine');
    e.failNext('data_move', 'locked');
  });
  const saved = () => text(s.exe.files.get(`library/.outgoing/${SAMPLE_ID}/buddy.json`) ?? s.exe.files.get(`library/${SAMPLE_ID}/buddy.json`)!);
  assert.ok(!s.exe.logs.some(l => /seeded/.test(l)), s.exe.logs.join('; '));
  assert.ok(s.exe.logs.some(l => /library not ready/.test(l)));
  assert.match(saved(), /My Olive/);
  assert.ok(s.exe.logs.some(l => /hub up/.test(l)), 'the rest of the hub still comes up');
  assert.deepStrictEqual(s.last('start')!.pets, []);
  await s.retry();
  assert.ok(!s.exe.logs.some(l => /seeded/.test(l)));
  assert.ok(s.exe.files.has(`library/${SAMPLE_ID}/buddy.json`) && !s.exe.files.has(`library/.outgoing/${SAMPLE_ID}/buddy.json`));
  assert.match(saved(), /My Olive/);
  assert.deepStrictEqual(s.last('pets')!.pets.map(p => p.name), ['My Olive'], 'she comes out');
  assert.strictEqual(s.timers.length, 0);
  assert.ok(s.item('buddy:' + SAMPLE_ID), 'and she is on the menu');
});

test('a failure that lasts keeps retrying, and never seeds', async () => {
  const s = await setup({}, async e => {
    await e.shell.dataWrite(`library/.outgoing/${SAMPLE_ID}/buddy.json`, manifest(SAMPLE_ID, 'My Olive'));
    e.failNext('data_move', 'locked');
  });
  for (let i = 0; i < 4; i++) { s.exe.failNext('data_move', 'locked'); await s.retry(); }
  assert.ok(!s.exe.logs.some(l => /seeded/.test(l)));
  assert.ok(s.exe.files.has(`library/.outgoing/${SAMPLE_ID}/buddy.json`));
  await s.retry();
  assert.ok(s.exe.files.has(`library/${SAMPLE_ID}/buddy.json`));
});

test('other buddies still come out while one waits to go back', async () => {
  const s = await setup({}, async e => {
    await e.shell.dataWrite('library/c1/buddy.json', manifest('c1', 'Other'));
    await e.shell.dataWrite('library/.outgoing/c2/buddy.json', manifest('c2', 'Waiting'));
    e.failNext('data_move', 'locked');
  });
  assert.deepStrictEqual(s.last('start')!.pets.map(p => p.id), ['c1']);
  await s.retry();
  assert.ok(s.exe.files.has('library/c2/buddy.json'));
});

for (const dir of ['', 'library/.outgoing']) {
  test(`a listing of ${JSON.stringify(dir)} that fails at the start seeds nothing until it can be read`, async () => {
    const s = await setup({}, async e => {
      await e.shell.dataWrite('library/.outgoing/x/old.txt', 'x'); await e.shell.dataDelete('library/.outgoing/x/old.txt');
      await e.shell.dataWrite('library/.outgoing/c2/buddy.json', manifest('c2', 'Waiting'));
      e.failNext('data_list', 'unreadable', (a: { dir: string }) => a.dir === dir);
    });
    assert.ok(!s.exe.logs.some(l => /seeded/.test(l)), s.exe.logs.join('; '));
    await s.retry();
    assert.ok(!s.exe.logs.some(l => /seeded/.test(l)));
    assert.ok(s.exe.files.has('library/c2/buddy.json'));
  });
}

test('an empty library that couldn\'t be listed is seeded once it can', async () => {
  const s = await setup({}, async e => { e.failNext('data_list', 'unreadable', (a: { dir: string }) => a.dir === ''); });
  assert.ok(!s.exe.logs.some(l => /seeded/.test(l)));
  await s.retry();
  assert.ok(s.exe.logs.some(l => /library seeded/.test(l)));
  assert.deepStrictEqual(s.last('pets')!.pets.map(p => p.id), [SAMPLE_ID]);
});

test('no monitors at the start: the hub waits, and the first real list starts the world', async () => {
  const s = await setup({ monitors: [], opened: [{ name: 'p.buddy.json', content: write(small('c1')) }] });
  assert.deepStrictEqual(s.sent.filter(m => m.k === 'start'), []);
  assert.deepStrictEqual(overlays(s.exe), []);
  assert.ok(s.exe.tray, 'the tray is up, so Quit and the menu work');
  assert.ok(s.exe.logs.some(l => /no monitors yet/.test(l)));
  assert.ok(s.exe.logs.some(l => /launch: a file, imported/.test(l)), 'launch files still arrive');
  assert.ok(!s.exe.logs.some(l => /hub error/.test(l)), s.exe.logs.join('; '));
  s.exe.emit('monitors', []); await s.done();
  assert.deepStrictEqual(s.sent.filter(m => m.k === 'start'), [], 'an empty event starts nothing');
  s.exe.emit('monitors', TWO()); await s.done();
  assert.deepStrictEqual(overlays(s.exe), ['overlay0', 'overlay1']);
  const starts = s.sent.filter(m => m.k === 'start');
  assert.strictEqual(starts.length, 1);
  assert.deepStrictEqual(s.last('start')!.all.map(a => a.i), [0, 1]);
  assert.deepStrictEqual(s.last('start')!.pets.map(p => p.id).sort(), [SAMPLE_ID, 'c1'].sort(), 'with whoever came out while it waited');
  assert.strictEqual(s.sent.filter(m => m.k === 'monitors').length, 0, 'the start carries the list');
  s.exe.emit('monitors', ONE()); await s.done();
  assert.strictEqual(s.last('monitors')!.all.length, 1, 'then changes go as usual');
  assert.strictEqual(s.sent.filter(m => m.k === 'start').length, 1);
});

test('what was set while waiting for monitors holds when the world starts', async () => {
  const s = await setup({ monitors: [] });
  await clicked(s, 'hide');
  s.exe.emit('monitors', ONE()); await s.done();
  assert.strictEqual(s.exe.windows.get('overlay0')!.hidden, true);
  assert.deepStrictEqual(s.last('pause'), { k: 'pause', on: true });
  assert.ok(s.sent.findIndex(m => m.k === 'start') < s.sent.map(m => m.k).lastIndexOf('pause'), 'the world hears it after it starts');
});

test('a monitor event during startup starts the world when the list it read was empty', async () => {
  const s = await setup({ monitors: [], listening: (name, e) => { if (name === 'monitors') e.emit('monitors', ONE()); } });
  await s.done();
  assert.deepStrictEqual(overlays(s.exe), ['overlay0']);
  assert.strictEqual(s.sent.filter(m => m.k === 'start').length, 1);
});

test('mode empty stays empty through a late start and a late library', async () => {
  const s = await setup({ monitors: [], args: ['--mode', 'empty'] });
  s.exe.emit('monitors', ONE()); await s.done();
  assert.deepStrictEqual(s.last('start')!.pets, []);
});

test('hide all only touches overlays that are really open', async () => {
  const s = await setup({ monitors: ONE() });
  s.exe.failNext('window_open', 'webview failed');
  s.exe.emit('monitors', TWO()); await s.done();
  await clicked(s, 'hide');
  assert.ok(!s.exe.logs.some(l => /no window/.test(l)), s.exe.logs.join('; '));
  assert.strictEqual(s.exe.windows.get('overlay0')!.hidden, true);
  await s.retry();
  assert.strictEqual(s.exe.windows.get('overlay1')!.hidden, true, 'one that opens late opens hidden');
});

test('a monitor event during startup waits for it, and startup runs as if it hadn\'t come', async () => {
  const s = await setup({
    opened: [{ name: 'p.buddy.json', content: write(small('c1')) }],
    listening: (name, e) => { if (name === 'monitors') e.emit('monitors', TWO()); }
  });
  await s.done();
  assert.deepStrictEqual(overlays(s.exe), ['overlay0', 'overlay1']);
  assert.ok(!s.exe.logs.some(l => /hub error/.test(l)), s.exe.logs.join('; '));
  assert.ok(s.exe.logs.some(l => /launch: a file, imported/.test(l)), 'take_opened was reached');
  assert.strictEqual(s.sent[0]!.k, 'start', 'the world starts first');
  assert.ok(s.exe.logs.some(l => /hub up/.test(l)));
});

test('a monitor event during startup that really is a change gets applied after it', async () => {
  const s = await setup({ monitors: ONE(), listening: (name, e) => { if (name === 'monitors') e.emit('monitors', TWO()); } });
  await s.done();
  assert.deepStrictEqual(overlays(s.exe), ['overlay0', 'overlay1']);
  assert.ok(!s.exe.logs.some(l => /hub error/.test(l)), s.exe.logs.join('; '));
});

test('a swap a crash interrupted is finished before the hub looks at the library', async () => {
  const buddy = JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: { ...small('c1'), base: { src: 'base.png', bb: box } } });
  const s = await setup({}, async e => { await e.shell.dataWrite('library/.outgoing/c1/buddy.json', buddy); await e.shell.dataWrite('library/.incoming/c1/x.png', 'x'); });
  assert.ok(!s.exe.logs.some(l => /seeded/.test(l)), 'she was only set aside, so nothing is seeded');
  assert.deepStrictEqual(s.last('start')!.pets.map(p => p.id), ['c1']);
  assert.ok(![...s.exe.files.keys()].some(k => /\.incoming|\.outgoing/.test(k)));
});

test('the tray lists the library, and it uses the icon from the app folder', async () => {
  const s = await setup();
  assert.strictEqual(s.exe.tray!.icon, 'tray.png');
  assert.strictEqual(s.item('buddy:' + SAMPLE_ID).label, 'Olive');
  assert.strictEqual(s.item('buddy:' + SAMPLE_ID).checked, true);
  for (const id of ['hide', 'pause', 'library', 'autostart']) assert.ok(s.item(id), id);
  assert.ok(!JSON.stringify(s.items()).includes('Quit'), 'the exe adds Quit');
});

test('the menu calls and dismisses a buddy, and it stays that way next run', async () => {
  const s = await setup();
  await clicked(s, 'buddy:' + SAMPLE_ID);
  assert.deepStrictEqual(s.last('dismiss'), { k: 'dismiss', id: SAMPLE_ID });
  assert.strictEqual(s.item('buddy:' + SAMPLE_ID).checked, false);
  assert.deepStrictEqual(JSON.parse(text(s.exe.files.get('settings.json')!)), { out: [] });
  await clicked(s, 'buddy:' + SAMPLE_ID);
  assert.deepStrictEqual(s.last('pets')!.pets.map(p => p.id), [SAMPLE_ID]);
  assert.strictEqual(s.item('buddy:' + SAMPLE_ID).checked, true);
  assert.deepStrictEqual(JSON.parse(text(s.exe.files.get('settings.json')!)), { out: [SAMPLE_ID] });
});

/* Bring everyone here: the stopgap for a buddy stuck behind windows, since the exe sets always on top
   once, when an overlay opens. */
const twoCopies = async (e: ReturnType<typeof createFakeExe>) => { await e.shell.dataWrite('settings.json', JSON.stringify({ out: [SAMPLE_ID, SAMPLE_ID] })); };
const windowN = (s: Awaited<ReturnType<typeof setup>>, label: string) => (s.exe.windows.get(label)!.boot as OverlayBoot).n;
const windowCalls = (s: Awaited<ReturnType<typeof setup>>) => s.exe.calls.filter(c => c.cmd.startsWith('window')).map(c => { const a = c.args as { label?: string; spec?: { label: string } }; return `${c.cmd} ${a.label ?? a.spec!.label}`; });

test('window numbers start somewhere new each run, even with the clock stood still across a restart', async () => {
  const still = vi.spyOn(Date, 'now').mockReturnValue(1.7e12);
  try {
    const first = await setup(), again = await setup();
    const ns = [first, again].flatMap(s => [windowN(s, 'overlay0'), windowN(s, 'overlay1')]);
    assert.strictEqual(new Set(ns).size, 4, String(ns));
    for (const n of ns) assert.ok(Number.isSafeInteger(n) && n >= 0, String(n));
  } finally { still.mockRestore(); }
});

test('the tray has Bring everyone here, after the buddies', async () => {
  const s = await setup();
  const ids = s.items().map(i => i.id ?? (i.separator ? '-' : i.label));
  assert.deepStrictEqual(ids, ['manager', '-', 'Buddies', 'bring', '-', 'hide', 'pause', '-', 'library', 'autostart']);
  assert.strictEqual(s.item('bring').label, 'Bring everyone here');
  assert.strictEqual(s.item('bring').enabled, undefined, 'always there, as the way to reopen the overlays');
});

test('bring everyone here closes every overlay, opens them again, then brings every copy out to the cursor', async () => {
  const s = await setup({}, twoCopies);
  assert.deepStrictEqual(s.last('start')!.pets.map(p => p.id), [SAMPLE_ID, SAMPLE_ID + '~1']);
  const settings = text(s.exe.files.get('settings.json')!), was = [windowN(s, 'overlay0'), windowN(s, 'overlay1')];
  s.exe.calls.length = 0; s.sent.length = 0;
  await clicked(s, 'bring');
  assert.deepStrictEqual(windowCalls(s), ['window_close overlay0', 'window_close overlay1', 'window_open overlay0', 'window_open overlay1']);
  assert.deepStrictEqual(overlays(s.exe), ['overlay0', 'overlay1']);
  assert.deepStrictEqual(s.sent, [{ k: 'leave', i: 0, n: was[0] }, { k: 'leave', i: 1, n: was[1] }, { k: 'bring', id: SAMPLE_ID }, { k: 'bring', id: SAMPLE_ID + '~1' }], 'nobody joins or leaves the world');
  const now = [windowN(s, 'overlay0'), windowN(s, 'overlay1')];
  assert.strictEqual(new Set([...was, ...now]).size, 4, 'each new window has a number of its own, so a late leave can only close its own');
  assert.strictEqual(text(s.exe.files.get('settings.json')!), settings);
  assert.strictEqual(s.item('buddy:' + SAMPLE_ID).checked, true);
  assert.ok(s.exe.logs.includes('brought 2 here, overlays reopened'), s.exe.logs.join('\n'));
});

test('reopened overlays open where they were, and hidden ones stay hidden', async () => {
  const s = await setup();
  await clicked(s, 'hide');
  const before = s.exe.windows.get('overlay1')!;
  await clicked(s, 'bring');
  const after = s.exe.windows.get('overlay1')!;
  assert.deepStrictEqual([(after.boot as OverlayBoot).me, after.hidden], [(before.boot as OverlayBoot).me, true]);
  assert.strictEqual(s.exe.windows.get('overlay0')!.hidden, true);
});

test('an overlay that won\'t close stays as it is, and is never opened twice', async () => {
  const s = await setup();
  s.exe.failNext('window_close', 'busy', (a: { label: string }) => a.label === 'overlay0');
  s.exe.calls.length = 0;
  const n = windowN(s, 'overlay1');
  await clicked(s, 'bring');
  assert.deepStrictEqual(windowCalls(s), ['window_close overlay0', 'window_close overlay1', 'window_open overlay1']);
  assert.deepStrictEqual(s.sent.filter(m => m.k === 'leave'), [{ k: 'leave', i: 1, n }]);
  assert.strictEqual(s.timers.length, 0, 'it still works, so nothing waits to close it');
  assert.ok(s.exe.logs.some(l => /hub error.*busy/.test(l)));
  assert.deepStrictEqual(s.last('bring'), { k: 'bring', id: SAMPLE_ID }, 'she comes anyway');
});

test('an overlay that won\'t open again is tried until it does', async () => {
  const s = await setup();
  s.exe.failNext('window_open', 'webview failed');
  await clicked(s, 'bring');
  assert.deepStrictEqual(overlays(s.exe), ['overlay1']);
  assert.deepStrictEqual(s.last('bring'), { k: 'bring', id: SAMPLE_ID });
  await s.retry();
  assert.deepStrictEqual(overlays(s.exe), ['overlay0', 'overlay1']);
});

test('bring everyone here with nobody out still reopens the overlays', async () => {
  const s = await setup();
  await clicked(s, 'buddy:' + SAMPLE_ID);
  s.exe.calls.length = 0; s.sent.length = 0;
  await clicked(s, 'bring');
  assert.strictEqual(windowCalls(s).length, 4);
  assert.ok(!s.sent.some(m => m.k === 'bring'));
  assert.ok(s.exe.logs.includes('brought 0 here, overlays reopened'));
});

test('hide all hides overlays and pauses the world; showing undoes both', async () => {
  const s = await setup();
  await clicked(s, 'hide');
  assert.ok([...s.exe.windows.values()].every(w => w.hidden));
  assert.strictEqual(s.last('pause')!.on, true);
  assert.strictEqual(s.item('hide').checked, true);
  await clicked(s, 'hide');
  assert.ok([...s.exe.windows.values()].every(w => !w.hidden));
  assert.strictEqual(s.last('pause')!.on, false);
});

test('a monitor that comes while hidden stays hidden', async () => {
  const s = await setup({ monitors: ONE() });
  await clicked(s, 'hide');
  s.exe.emit('monitors', TWO()); await s.done();
  assert.strictEqual(s.exe.windows.get('overlay1')!.hidden, true);
});

test('pause pauses, and away pauses, and neither undoes the other', async () => {
  const s = await setup();
  await clicked(s, 'pause');
  assert.strictEqual(s.last('pause')!.on, true);
  s.exe.emit('system', { userState: 'away', onBattery: false, saver: false });
  s.exe.emit('system', { userState: 'normal', onBattery: false, saver: false });
  assert.strictEqual(s.last('pause')!.on, true, 'still paused by hand');
  await clicked(s, 'pause');
  assert.strictEqual(s.last('pause')!.on, false);
  s.exe.emit('system', { userState: 'away', onBattery: false, saver: false });
  assert.strictEqual(s.last('pause')!.on, true);
  s.exe.emit('system', { userState: 'normal', onBattery: false, saver: false });
  assert.strictEqual(s.last('pause')!.on, false);
});

test('starting while away starts paused', async () => {
  const s = await setup({ system: { userState: 'away' } });
  assert.strictEqual(s.last('pause')!.on, true);
});

test('start with Windows sets it through the exe, and only when asked', async () => {
  const s = await setup();
  assert.ok(!s.exe.calls.some(c => c.cmd === 'autostart' && (c.args as { on?: boolean }).on !== undefined), 'starting only reads');
  await clicked(s, 'autostart');
  assert.strictEqual(s.exe.autostart, true);
  assert.strictEqual(s.item('autostart').checked, true);
  await clicked(s, 'autostart');
  assert.strictEqual(s.exe.autostart, false);
});

test('the library item opens the folder', async () => {
  const s = await setup();
  await clicked(s, 'library');
  assert.ok(s.exe.calls.some(c => c.cmd === 'open_data_folder'));
});

test('a file passed at launch is imported and called', async () => {
  const s = await setup({ opened: [{ name: 'pip.buddy', content: write(small('pip')) }] });
  assert.ok(s.exe.files.has('library/pip/buddy.json'));
  assert.ok(s.last('pets')!.pets.some(p => p.id === 'pip'));
  assert.strictEqual(s.item('buddy:pip').checked, true);
});

test('a second launch with a file imports it into the running app', async () => {
  const s = await setup();
  s.exe.emit('second-launch', { args: ['pip.buddy'] });
  s.exe.emit('open-file', { name: 'pip.buddy', content: write(small('pip')) }); await s.done();
  assert.deepStrictEqual(s.last('pets')!.pets.map(p => p.id).sort(), [SAMPLE_ID, 'pip'].sort());
  assert.ok(s.item('buddy:pip'));
});

test('a file that isn\'t a buddy is logged and changes nothing', async () => {
  const s = await setup(); s.sent.length = 0;
  const before = s.exe.files.size;
  s.exe.emit('open-file', { name: 'x.buddy', content: '{"app":"nope"}' });
  s.exe.emit('open-file', { name: 'y.buddy', content: '', error: 'too big' }); await s.done();
  assert.strictEqual(s.exe.files.size, before);
  assert.strictEqual(s.sent.length, 0);
  assert.strictEqual(s.exe.logs.filter(l => /import failed/.test(l)).length, 2);
});

test('arguments the exe passes through reach the hub', async () => {
  const s = await setup({ args: ['--buddies', '3'] });
  assert.deepStrictEqual(s.last('start')!.pets.map(p => p.id), ['b0', 'b1', 'b2']);
  const e = await setup({ args: ['--mode', 'empty'] });
  assert.deepStrictEqual(e.last('start')!.pets, []);
  assert.strictEqual((e.exe.windows.get('overlay0')!.boot as { mode: string }).mode, 'empty');
  assert.deepStrictEqual(options(['--buddies', 'x']), { mode: 'demo', copies: null, trace: false, manager: true, api: null });
  assert.strictEqual(options(['--buddies', '99']).copies, 24);
});

/* "The app should open with the manager window." A sign-in launch carries no flag of its own, so
   Start with Windows on is what says it's one. */
const managerOpens = (exe: ReturnType<typeof createFakeExe>) => exe.calls.filter(c => c.cmd === 'window_open' && (c.args as { spec: { label: string } }).spec.label === 'manager').length;
const opensAt = (exe: ReturnType<typeof createFakeExe>) => exe.calls.findIndex(c => c.cmd === 'window_open' && (c.args as { spec: { label: string } }).spec.label === 'manager');

test('a start opens the Manager, once, after the library is in', async () => {
  const s = await setup({}, undefined, false);
  assert.ok(s.exe.windows.has('manager'));
  assert.strictEqual(managerOpens(s.exe), 1);
  const seeded = s.exe.calls.findIndex(c => c.cmd === 'data_move' && (c.args as { to: string }).to === `library/${SAMPLE_ID}`);
  assert.ok(seeded >= 0 && opensAt(s.exe) > seeded, 'with a library to show');
  assert.ok(opensAt(s.exe) > s.exe.calls.findIndex(c => c.cmd === 'autostart'), 'once it knows this is no sign-in');
  assert.strictEqual(s.timers.length, 0);
  s.exe.emit('second-launch', { args: [] }); await s.done();
  assert.strictEqual(managerOpens(s.exe), 1, 'a launch after that brings the same one forward');
});

test('a start with Start with Windows on, or --no-manager, opens no Manager', async () => {
  const signIn = await setup({}, async e => { e.autostart = true; }, false);
  assert.strictEqual(managerOpens(signIn.exe), 0);
  assert.ok(signIn.exe.logs.some(l => /hub up/.test(l)));
  signIn.exe.emit('tray-click', null); await signIn.done();
  assert.strictEqual(managerOpens(signIn.exe), 1, 'the tray still opens it');
  const quiet = await setup({ args: ['--no-manager'] }, undefined, false);
  assert.strictEqual(managerOpens(quiet.exe), 0);
  assert.strictEqual(options(['--no-manager']).manager, false);
  quiet.exe.emit('second-launch', { args: [] }); await quiet.done();
  assert.strictEqual(managerOpens(quiet.exe), 1, 'and a second launch still does');
});

test('a buddy file at launch takes the path it always has: called if it imports, the Manager if not', async () => {
  const good = await setup({ args: ['C:\\x\\pip.buddy'], opened: [{ name: 'pip.buddy', content: write(small('pip')) }] }, undefined, false);
  assert.ok(good.last('pets')!.pets.some(p => p.id === 'pip'));
  assert.strictEqual(managerOpens(good.exe), 0, 'imported, so no Manager');
  const bad = await setup({ args: ['C:\\x\\x.buddy'], opened: [{ name: 'x.buddy', content: '{"app":"nope"}' }] }, undefined, false);
  assert.strictEqual(managerOpens(bad.exe), 1, 'refused, so the Manager says why, once');
  const event = await setup({ args: ['C:\\x\\pip.buddy'] }, undefined, false);
  assert.strictEqual(managerOpens(event.exe), 0, 'a file still coming as an event');
  const handed = await setup({ opened: [{ name: 'pip.buddy', content: write(small('pip')) }] }, undefined, false);
  assert.strictEqual(managerOpens(handed.exe), 0, 'a file the exe handed over with no argument for it');
});

test('a Manager that fails to open at start is noted and tried again until it opens', async () => {
  const s = await setup({}, async e => { e.failNext('window_open', 'webview failed', (a: { spec: { label: string } }) => a.spec.label === 'manager'); }, false);
  assert.ok(!s.exe.windows.has('manager'));
  assert.ok(s.exe.logs.some(l => /hub error.*webview failed/.test(l)), s.exe.logs.join('; '));
  assert.ok(s.exe.logs.some(l => /hub up/.test(l)), 'the hub is up anyway');
  assert.strictEqual(await s.retry(), 2000);
  assert.ok(s.exe.windows.has('manager'));
  assert.strictEqual(s.timers.length, 0, 'nothing left to retry');
});

test('--trace-hits reaches each overlay, and nothing else asks for it', async () => {
  assert.strictEqual(options(['--trace-hits']).trace, true);
  const s = await setup({ args: ['--trace-hits'] });
  assert.strictEqual((s.exe.windows.get('overlay0')!.boot as { trace?: boolean }).trace, true);
  const plain = await setup({});
  assert.ok(!('trace' in (plain.exe.windows.get('overlay0')!.boot as object)));
});

test('an exe older than the app is said, and nothing else happens', async () => {
  const s = await setup({ api: MIN_API - 1 });
  assert.strictEqual(s.sent.length, 0);
  assert.strictEqual(s.exe.windows.size, 0);
  assert.match(s.exe.tray!.tooltip!, /newer exe/);
  assert.ok(s.exe.logs.some(l => /needs exe api/.test(l)));
});

test('monitors keep their numbers, and changes says what to do', () => {
  const sc = createScreens();
  const a = sc.areas(TWO()), b = sc.areas([monitor('B', 0, 1920, 0, 1920, 1000)]), c = sc.areas([monitor('', 0, 0), monitor('', 1, 1920)]);
  assert.deepStrictEqual(a.map(x => x.i), [0, 1]);
  assert.strictEqual(b[0]!.i, 1);
  assert.deepStrictEqual(c.map(x => x.i), [2, 3], 'a monitor with no name falls back on its place');
  const d = changes(a, b);
  assert.deepStrictEqual([d.open.length, d.close.map(x => x.i), d.place.map(x => x.i)], [0, [0], [1]]);
  assert.deepStrictEqual(changes(b, a).open.map(x => x.i), [0]);
  assert.deepStrictEqual(changes(a, a), { open: [], close: [], place: [] });
});

test('a scale change alone counts as a change', () => {
  const sc = createScreens();
  const a = sc.areas(ONE()), b = sc.areas([monitor('A', 0, 0, 0, 1920, 1040, 1.5)]);
  assert.strictEqual(changes(a, b).place.length, 1);
});

test('the capture lease: asks on a change, renews while held, and goes quiet when let go', () => {
  const clock = { t: 0 }, calls: boolean[] = [], c = createCapture(on => calls.push(on), () => clock.t);
  c.set(false); c.tick();
  assert.deepStrictEqual(calls, [], 'nothing to say yet');
  c.set(true); c.set(true);
  assert.deepStrictEqual(calls, [true]);
  clock.t = 400; c.tick();
  assert.strictEqual(calls.length, 1, 'too soon');
  clock.t = 500; c.tick();
  clock.t = 1000; c.tick();
  assert.deepStrictEqual(calls, [true, true, true]);
  c.set(false); clock.t = 5000; c.tick();
  assert.deepStrictEqual(calls, [true, true, true, false]);
});

test('renewing runs well inside the exe\'s 1.5 s lease', () => {
  const lease = /LEASE: Duration = Duration::from_millis\((\d+)\)/.exec(fs.readFileSync(new URL('../shell-core/src/lease.rs', import.meta.url), 'utf8'))!;
  assert.ok(Number(lease[1]) >= 3 * 500);
});

test('a page with no buddies still has a menu', () => {
  const m = menu({ buddies: [], hidden: false, paused: false, autostart: false });
  const buddies = m.find(i => i.label === 'Buddies')!;
  assert.strictEqual(buddies.enabled, false);
  assert.strictEqual(buddies.items![0]!.enabled, false);
});
