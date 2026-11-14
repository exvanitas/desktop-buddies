// @vitest-environment happy-dom
/* The Manager's view, on a page that isn't a browser: what each state offers, and what each click
   sends. Most run on a scripted hub, so a test can set any state. The ones that say so run on the
   real hub and the fake exe. tests/browser/run.mjs does the rest in a real browser. */
import { rectangle, type Outline } from '@buddies/art/outline';
import { write, type Buddy } from '@buddies/buddy-file';
import assert, { gone, same } from '@buddies/test-support/dom-assert';
import { beforeEach, test, vi } from 'vitest';
import { ANOTHER_FILE, ANOTHER_FOLDER, badFile, makerHolding, notDeleted, notReady, notStored, type Failure } from '../src/failures';
import { createHub } from '../src/hub-core';
import { createLibrary } from '../src/library';
import type { Answer, BuddyRow, Command, HubState, Replacing, Said } from '../src/manager-api';
import { createManagerClient } from '../src/manager-client';
import { cutline } from '../src/manager/cutline';
import { FIND_FROM, matches } from '../src/manager/find';
import { buddyItems } from '../src/manager/menu';
import { SHOWN, againFor } from '../src/manager/misprints';
import { FAILED_MS, KEEP, createOutlines } from '../src/manager/outlines';
import { outlineOfImage } from '@buddies/art/outline-canvas';
import { createPeel, type Peel } from '../src/manager/peel';
import { placed } from '@buddies/peel/popover';
import { THEME_KEY, readTheme, saveTheme } from '@buddies/peel/theme';
import { ART, ONLY, createSticker, fit, statusOf, type StickerIO } from '../src/manager/sticker';
import { mountView, type ViewIO } from '../src/manager-view';
import { createSheet } from '../src/manager/sheet';
import { SETTLE_MS } from '../src/manager/replacing';
import { createFakeExe } from '../src/shell-fake';
import { createBus } from '../src/wire';

const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r)); };
const row = (name: string, copies = 0, id = name.toLowerCase(), can: BuddyRow['can'] = []): BuddyRow => ({ id, name, image: `library/${id}/base.png`, status: copies ? 'out' : 'home', copies, can, rev: 1 });
const BASE: HubState = { ready: true, buddies: [], hidden: false, paused: false, autostart: false, packaged: false, files: false, walk: true, exclude: [], apps: [], maker: false, failures: [], api: { on: false, apps: [], asking: [] }, replacing: [] };
const fail = (id: string, title: string, more: Partial<Failure> = {}): Failure => ({ id, kind: 'other', file: title, title, why: 'Why.', fix: 'Fix.', ...more });
const LINE: Outline = rectangle(138, 138, 1.5);

function memoryStore() {
  const held = new Map<string, string>();
  return { held, store: () => ({ getItem: (k: string) => held.get(k) ?? null, setItem: (k: string, v: string) => { held.set(k, v); } }) };
}

function mount(client: ReturnType<typeof createManagerClient>, more: Partial<ViewIO> = {}) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  let clock = 0, minimized = 0;
  const memory = memoryStore();
  mountView(root, client, { minimize: async () => { minimized++; }, outline: async () => LINE, store: memory.store, moves: () => false, now: () => clock, after: () => {}, ...more });
  const all = <E extends Element = HTMLElement>(q: string) => [...root.querySelectorAll<E>(q)];
  const one = <E extends Element = HTMLElement>(q: string) => root.querySelector<E>(q);
  const shown = (e: Element | null) => { for (let n = e; n; n = n.parentElement) if ((n as HTMLElement).hidden) return false; return !!e; };
  const words = (q: string) => all(q).filter(shown).map(e => e.textContent);
  const button = (name: string, within = 'body') => {
    const scope = within === 'body' ? root : one(within)!;
    const hit = [...scope.querySelectorAll('button')].find(b => shown(b) && (b.textContent === name || b.getAttribute('aria-label') === name));
    assert.ok(hit, `a button called ${name}: ${[...scope.querySelectorAll('button')].filter(shown).map(b => b.textContent || b.getAttribute('aria-label'))}`);
    return hit;
  };
  const sticker = (name: string) => all('.st').find(s => s.querySelector('b')!.textContent === name)!;
  return { root, all, one, shown, words, button, sticker, memory, later: (ms: number) => { clock += ms; }, minimized: () => minimized };
}

/* A hub that says what it's told to, and answers ok unless told otherwise. */
async function scripted(state: Partial<HubState> = {}, more: Partial<ViewIO> = {}) {
  const bus = createBus<Said>(), hub = bus.wire(), sent: Command[] = [];
  let now: HubState = { ...BASE, ...state }, closed = 0;
  let answer = (_: Command): Answer => ({ ok: true });
  hub.listen(m => {
    if (m.k === 'hello') hub.post({ k: 'state', state: now });
    else if (m.k === 'do') { sent.push(m.cmd); hub.post({ k: 'done', id: m.id, answer: answer(m.cmd) }); }
  });
  const client = createManagerClient({ wire: bus.wire(), session: 'w', after: () => () => {}, shimeji: async () => null, closeWindow: async () => { closed++; } });
  const v = mount(client, more);
  await tick();
  return {
    ...v, sent, client,
    closed: () => closed,
    answers(f: (c: Command) => Answer) { answer = f; },
    async set(next: Partial<HubState>) { now = { ...now, ...next }; hub.post({ k: 'state', state: now }); await tick(); }
  };
}
const click = async (b: HTMLElement) => { b.click(); await tick(); };
const press = (key: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
const outside = () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
const openMenu = async (v: Awaited<ReturnType<typeof scripted>>, name: string) => { await click(v.sticker(name).querySelector<HTMLElement>('.dots')!); };

beforeEach(() => { document.documentElement.removeAttribute('data-theme'); });

/* what each state offers */

test('before the hub speaks, and while it gets ready, the window is calm with its controls off', async () => {
  const bus = createBus<Said>();
  const silent = createManagerClient({ wire: bus.wire(), session: 'w', after: () => () => {}, shimeji: async () => null, closeWindow: async () => {} });
  const v = mount(silent);
  assert.deepStrictEqual(v.words('.waiting'), ['Getting ready']);
  assert.ok(v.button('Import').disabled);
  assert.ok(v.all<HTMLButtonElement>('.tg').every(b => b.disabled));
  assert.deepStrictEqual(v.words('.misprint'), []);
  assert.ok(!v.shown(v.one('.welcome')), "it doesn't say the library is empty");
});

test('not ready: what can be read shows, with nothing to press, and the window can still be closed', async () => {
  const v = await scripted({ ready: false, buddies: [row('Pip', 1), row('Olive')] });
  assert.deepStrictEqual(v.words('.waiting'), ['Getting ready']);
  assert.deepStrictEqual(v.words('.st b'), ['Pip', 'Olive']);
  assert.ok(v.all<HTMLButtonElement>('.st button').every(b => b.disabled));
  assert.ok(!v.button('Close').disabled && !v.button('Minimize').disabled && !v.button('Settings').disabled);
  v.sticker('Olive').querySelector<HTMLElement>('.art')!.click();
  await tick();
  assert.deepStrictEqual(v.sent, []);
  await v.set({ ready: true });
  assert.deepStrictEqual(v.words('.waiting'), []);
  assert.ok(!v.sticker('Olive').querySelector<HTMLButtonElement>('.art')!.disabled);
});

test('the real hub: a disk that won\'t list is getting ready, never a failure', async () => {
  const exe = createFakeExe({ monitors: [{ i: 0, name: 'A', primary: true, scale: 1, x: 0, y: 0, w: 800, h: 600, full: { x: 0, y: 0, w: 800, h: 600 } }] });
  exe.failUntil('data_list', 'busy', () => true);
  const bus = createBus<Said>(), hub = createHub({ shell: exe.shell, send: () => {}, seed: async () => '', after: () => {}, wire: bus.wire() });
  await hub.start();
  const client = createManagerClient({ wire: bus.wire(), session: 'w', after: () => () => {}, shimeji: async () => null, closeWindow: async () => {} });
  const v = mount(client);
  await tick();
  assert.strictEqual(client.state!.ready, false);
  assert.deepStrictEqual(v.words('.waiting'), ['Getting ready']);
  assert.deepStrictEqual(v.words('.misprint'), []);
});

test('no buddies: an inviting sheet that says what to do', async () => {
  const v = await scripted();
  assert.deepStrictEqual(v.words('.welcome h2'), ['No buddies yet']);
  assert.match(v.one('.welcome p')!.textContent!, /Drop a \.buddy file or a Shimeji folder/);
  assert.deepStrictEqual(v.words('.st'), []);
  assert.deepStrictEqual(v.words('.welcome button'), ['Import']);
  assert.deepStrictEqual(v.words('.dropit'), []);
});

test('one buddy: one large sticker and a drop area', async () => {
  const v = await scripted({ buddies: [row('Pip')] });
  assert.ok(v.one('.wrap')!.classList.contains('only'));
  assert.strictEqual(v.one('.st img')!.getAttribute('height'), String(ONLY));
  assert.ok(v.shown(v.one('.dropit')));
  await v.set({ buddies: [row('Olive'), row('Pip')] });
  assert.ok(!v.one('.wrap')!.classList.contains('only'));
  assert.strictEqual(v.one('.st img')!.getAttribute('height'), String(ART));
});

test('each buddy has its art, name, status and button together, in the hub\'s order', async () => {
  const buddies = [row('Zed'), row('Ada', 1), row('Mo', 3)];
  const v = await scripted({ buddies });
  assert.deepStrictEqual(v.words('.st b'), ['Zed', 'Ada', 'Mo']);
  assert.deepStrictEqual(v.words('.st .s'), ['At home', 'On desktop', '3 on desktop']);
  assert.deepStrictEqual(v.words('.acts .btn'), ['Call', 'Dismiss', 'Dismiss all']);
  assert.deepStrictEqual(v.all('.st').map(s => s.classList.contains('out')), [false, true, true]);
  assert.deepStrictEqual(v.all('.st img').map(i => i.className), ['cut', 'ghost', 'ghost']);
  assert.deepStrictEqual(v.all<HTMLImageElement>('.st img').map(i => i.getAttribute('src')), buddies.map(b => b.image));
});

test('calling someone doesn\'t move them, and new arrivals go where the hub says', async () => {
  const v = await scripted({ buddies: [row('Ada'), row('Mo')] });
  const ada = v.sticker('Ada');
  await v.set({ buddies: [row('Ada', 1), row('Mo')] });
  assert.deepStrictEqual(v.words('.st b'), ['Ada', 'Mo']);
  same(v.sticker('Ada'), ada, 'the same sticker, so its art doesn\'t reload');
  await v.set({ buddies: [row('Ada', 1), row('Bo'), row('Mo')] });
  assert.deepStrictEqual(v.words('.st b'), ['Ada', 'Bo', 'Mo']);
  await v.set({ buddies: [row('Bo'), row('Mo')] });
  assert.deepStrictEqual(v.words('.st b'), ['Bo', 'Mo']);
});

test('the out state: one line per buddy, however many copies, and at home none', async () => {
  const v = await scripted({ buddies: [row('Ada', 5), row('Mo')] });
  assert.strictEqual(v.sticker('Ada').querySelectorAll('.cutline').length, 1);
  assert.strictEqual(v.sticker('Mo').querySelectorAll('.cutline').length, 0);
  await v.set({ buddies: [row('Ada', 6), row('Mo', 1)] });
  assert.strictEqual(v.sticker('Ada').querySelectorAll('.cutline').length, 1);
  assert.strictEqual(v.sticker('Mo').querySelectorAll('.cutline').length, 1);
  await v.set({ buddies: [row('Ada'), row('Mo', 1)] });
  assert.strictEqual(v.sticker('Ada').querySelectorAll('.cutline').length, 0);
});

test('long names are whole in the title, and their direction follows the text', async () => {
  const name = 'x'.repeat(64);
  const v = await scripted({ buddies: [row(name, 0, 'a'), row('ليلى', 0, 'b')] });
  assert.strictEqual(v.all('.st b')[0]!.title, name);
  assert.strictEqual(v.all('.st b')[1]!.getAttribute('dir'), 'auto');
  assert.strictEqual(v.all('.st .art')[0]!.title, `Call ${name}`);
});

test('a name in the page is text, never markup', async () => {
  const v = await scripted({ buddies: [row('<img src=x onerror=boom>', 0, 'a')] });
  gone(v.one('.st b')!.querySelector('img'));
  await openMenu(v, '<img src=x onerror=boom>');
  await click(v.button('Delete'));
  gone(v.one('.confirm h2')!.querySelector('img'));
});

/* what each click sends */

test('the art and the button both call and dismiss', async () => {
  const v = await scripted({ buddies: [row('Ada'), row('Mo', 2)] });
  await click(v.sticker('Ada').querySelector<HTMLElement>('.art')!); v.later(1000);
  await click(v.sticker('Ada').querySelector<HTMLElement>('.acts .btn')!); v.later(1000);
  await click(v.sticker('Mo').querySelector<HTMLElement>('.art')!); v.later(1000);
  await click(v.sticker('Mo').querySelector<HTMLElement>('.acts .btn')!);
  assert.deepStrictEqual(v.sent, [{ k: 'call', id: 'ada' }, { k: 'call', id: 'ada' }, { k: 'dismiss', id: 'mo' }, { k: 'dismiss', id: 'mo' }]);
});

test('a double-click is one call, not a call and a dismiss', async () => {
  const v = await scripted({ buddies: [row('Ada')] }), art = v.sticker('Ada').querySelector<HTMLElement>('.art')!;
  await click(art);
  await v.set({ buddies: [row('Ada', 1)] });
  await click(art);
  assert.deepStrictEqual(v.sent, [{ k: 'call', id: 'ada' }]);
  v.later(500);
  await click(art);
  assert.deepStrictEqual(v.sent.at(-1), { k: 'dismiss', id: 'ada' });
});

test('the switches send the opposite of what the hub says, and show only what it says', async () => {
  const v = await scripted({ buddies: [row('Ada')], paused: true });
  const tg = (name: string) => v.all('.tg').find(b => b.textContent === name)!;
  assert.deepStrictEqual(v.all('.tg').map(b => [b.textContent, b.getAttribute('aria-checked')]), [['Hide all', 'false'], ['Pause', 'true'], ['Start with Windows', 'false']]);
  await click(tg('Hide all')); await click(tg('Pause')); await click(tg('Start with Windows'));
  assert.deepStrictEqual(v.sent, [{ k: 'hide', on: true }, { k: 'pause', on: false }, { k: 'autostart', on: true }]);
  assert.strictEqual(tg('Hide all').getAttribute('aria-checked'), 'false', 'nothing moves until the hub says so');
  await v.set({ hidden: true });
  assert.strictEqual(tg('Hide all').getAttribute('aria-checked'), 'true');
});

test('the window\'s buttons: minimize, close, and no maximize', async () => {
  const v = await scripted();
  assert.deepStrictEqual(v.all('.wc button').map(b => b.getAttribute('aria-label')), ['Minimize', 'Close']);
  await click(v.button('Minimize')); await click(v.button('Close'));
  assert.strictEqual(v.minimized(), 1);
  assert.strictEqual(v.closed(), 1);
});

test('the bar drags the window, from every empty part of it', async () => {
  const v = await scripted();
  for (const q of ['.bar', '.bar .grow', '.bar .title']) assert.ok(v.one(q)!.hasAttribute('data-tauri-drag-region'), q);
  assert.strictEqual(v.one('.wc')!.hasAttribute('data-tauri-drag-region'), false);
});

/* the menu */

test('the menu offers what fits: Call another only when out, Dismiss one only with copies', () => {
  const none = () => {}, acts = { bringHere: none, treat: none, chase: none, another: none, dismissOne: none, edit: none, exportIt: none, remove: none };
  const words = (b: BuddyRow, maker = false) => buddyItems(b, maker, acts).map(i => i.words);
  assert.deepStrictEqual(words(row('A')), ['Export to a file', 'Delete']);
  assert.deepStrictEqual(words(row('A', 1)), ['Bring here', 'Call another', 'Export to a file', 'Delete']);
  assert.deepStrictEqual(words(row('A', 2)), ['Bring here', 'Call another', 'Dismiss one', 'Export to a file', 'Delete']);
  assert.deepStrictEqual(words(row('A', 2), true), ['Bring here', 'Call another', 'Dismiss one', 'Edit', 'Export to a file', 'Delete']);
});

test('out, she can be brought here, and given a treat or chase the mouse only if she can do it', () => {
  const none = () => {}, acts = { bringHere: none, treat: none, chase: none, another: none, dismissOne: none, edit: none, exportIt: none, remove: none };
  const words = (b: BuddyRow) => buddyItems(b, false, acts).map(i => i.words).filter(w => !['Export to a file', 'Delete'].includes(w));
  assert.deepStrictEqual(words(row('A', 1, 'a', ['eat', 'chase'])), ['Bring here', 'Give a treat', 'Chase my mouse', 'Call another']);
  assert.deepStrictEqual(words(row('A', 1, 'a', ['chase'])), ['Bring here', 'Chase my mouse', 'Call another']);
  assert.deepStrictEqual(words(row('A', 1, 'a', ['eat'])), ['Bring here', 'Give a treat', 'Call another']);
  assert.deepStrictEqual(words(row('A', 0, 'a', ['eat', 'chase'])), [], 'at home, none of it');
});

test('a line splits what she does on the desktop from her file, and only when both are there', () => {
  const none = () => {}, acts = { bringHere: none, treat: none, chase: none, another: none, dismissOne: none, edit: none, exportIt: none, remove: none };
  const ruled = (b: BuddyRow, maker = false) => buddyItems(b, maker, acts).filter(i => i.rule).map(i => i.words);
  assert.deepStrictEqual(ruled(row('A')), [], 'at home it is all her file');
  assert.deepStrictEqual(ruled(row('A'), true), []);
  assert.deepStrictEqual(ruled(row('A', 2, 'a', ['eat', 'chase'])), ['Export to a file']);
  assert.deepStrictEqual(ruled(row('A', 1), true), ['Edit']);
});

test('the menu draws the line as a separator the arrow keys step over', async () => {
  const v = await scripted({ buddies: [row('Ada', 1)] });
  await openMenu(v, 'Ada');
  const kids = [...v.one('.menu')!.children].map(e => e.getAttribute('role'));
  assert.deepStrictEqual(kids, ['menuitem', 'menuitem', 'separator', 'menuitem', 'menuitem']);
  assert.strictEqual(document.activeElement!.textContent, 'Bring here');
  v.one('.menu')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  v.one('.menu')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.strictEqual(document.activeElement!.textContent, 'Export to a file');
});

test('each menu item sends its command, and closes the menu', async () => {
  const v = await scripted({ buddies: [row('Ada', 3, 'ada', ['eat', 'chase'])] });
  for (const [words, cmd] of [['Bring here', { k: 'bring', id: 'ada' }], ['Give a treat', { k: 'act', id: 'ada', action: 'eat' }], ['Chase my mouse', { k: 'act', id: 'ada', action: 'chase' }], ['Call another', { k: 'another', id: 'ada' }], ['Dismiss one', { k: 'dismiss-one', id: 'ada' }], ['Export to a file', { k: 'export', id: 'ada', owner: 'manager' }]] as const) {
    await openMenu(v, 'Ada');
    await click(v.button(words, '.menu'));
    assert.deepStrictEqual(v.sent.at(-1), cmd);
    gone(v.one('.menu'));
  }
});

test('the menu closes on Escape, an outside click and a scroll, and its button toggles it', async () => {
  const v = await scripted({ buddies: [row('Ada'), row('Mo')] });
  await openMenu(v, 'Ada'); assert.ok(v.one('.menu'));
  press('Escape'); gone(v.one('.menu'));
  same(document.activeElement, v.sticker('Ada').querySelector('.dots'), 'the keyboard goes back to its button');
  await openMenu(v, 'Ada'); outside(); gone(v.one('.menu'));
  await openMenu(v, 'Ada'); v.one('.sheet')!.dispatchEvent(new Event('scroll')); gone(v.one('.menu'));
  await openMenu(v, 'Ada'); await openMenu(v, 'Ada'); gone(v.one('.menu'));
});

test('one menu at a time, and arrow keys walk it', async () => {
  const v = await scripted({ buddies: [row('Ada', 2), row('Mo')] });
  await openMenu(v, 'Ada'); await openMenu(v, 'Mo');
  assert.strictEqual(v.all('.menu').length, 1);
  assert.deepStrictEqual(v.words('.menu button'), ['Export to a file', 'Delete']);
  assert.strictEqual(document.activeElement!.textContent, 'Export to a file');
  v.one('.menu')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.strictEqual(document.activeElement!.textContent, 'Delete');
  v.one('.menu')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.strictEqual(document.activeElement!.textContent, 'Export to a file');
});

test('a menu follows the hub: more copies change it, the same state leaves it alone, and a deleted buddy closes it', async () => {
  const v = await scripted({ buddies: [row('Ada', 1), row('Mo')] });
  await openMenu(v, 'Ada');
  const menu = v.one('.menu');
  await v.set({ paused: true });
  same(v.one('.menu'), menu, 'an unrelated change doesn\'t rebuild it under the mouse');
  await v.set({ buddies: [row('Ada', 2), row('Mo')] });
  assert.ok(v.words('.menu button').includes('Dismiss one'));
  await v.set({ buddies: [row('Ada', 2, 'ada', ['eat']), row('Mo')] });
  assert.ok(v.words('.menu button').includes('Give a treat'), 'what she can do changed');
  await v.set({ buddies: [row('Mo')] });
  gone(v.one('.menu'));
});

test('a menu stays inside the window: below if it fits, above if not, pulled in from the sides', () => {
  const view = { w: 760, h: 580 }, box = { w: 168, h: 100 };
  const at = (left: number, top: number) => ({ left, top, bottom: top + 25, width: 25 });
  assert.deepStrictEqual(placed(at(300, 100), box, view), { x: 228.5, y: 129 });
  assert.deepStrictEqual(placed(at(300, 540), box, view), { x: 228.5, y: 436 }, 'above, near the bottom');
  assert.strictEqual(placed(at(740, 100), box, view).x, 584, 'pulled in from the right');
  assert.strictEqual(placed(at(0, 100), box, view).x, 8, 'and from the left');
  assert.strictEqual(placed(at(10, 5), { w: 168, h: 575 }, view).y, 8, 'taller than the room there is');
});

/* delete */

test('Delete sends nothing until it\'s confirmed, and names the buddy', async () => {
  const v = await scripted({ buddies: [row('Pip')] });
  await openMenu(v, 'Pip');
  await click(v.button('Delete', '.menu'));
  assert.deepStrictEqual(v.sent, []);
  gone(v.one('.menu'));
  assert.strictEqual(v.one('.confirm h2')!.textContent, 'Delete Pip?');
  assert.match(v.one('.confirm')!.textContent!, /can't be undone/);
  await click(v.button('Delete', '.confirm'));
  assert.deepStrictEqual(v.sent, [{ k: 'delete', id: 'pip', rev: 1 }]);
  gone(v.one('.confirm'));
});

test('the confirm says when the buddy is out, because it leaves the desktop too', async () => {
  const v = await scripted({ buddies: [row('Pip', 2)] });
  await openMenu(v, 'Pip');
  await click(v.button('Delete', '.menu'));
  assert.match(v.one('.confirm p')!.textContent!, /leaves your desktop/);
});

test('Cancel is the easy way out: it has the keyboard, and everything else means it too', async () => {
  const v = await scripted({ buddies: [row('Pip')] });
  const ask = async () => { await openMenu(v, 'Pip'); await click(v.button('Delete', '.menu')); assert.ok(v.one('.confirm')); };
  await ask();
  same(document.activeElement, v.button('Cancel'));
  assert.ok(v.button('Cancel').classList.contains('go'));
  await click(v.button('Cancel')); gone(v.one('.confirm'));
  await ask(); press('Escape'); gone(v.one('.confirm'));
  await ask(); outside(); gone(v.one('.confirm'));
  await ask(); v.one('.sheet')!.dispatchEvent(new Event('scroll')); gone(v.one('.confirm'));
  await tick();
  assert.deepStrictEqual(v.sent, []);
});

/* Pip on the real hub and the fake disk, with a Manager window on her and a way to save her as a
   Maker window does. A save that keeps her name and main image still makes her someone else to a
   confirm or a retry: what was asked about isn't what's there. */
async function realPip() {
  const exe = createFakeExe({ monitors: [{ i: 0, name: 'A', primary: true, scale: 1, x: 0, y: 0, w: 800, h: 600, full: { x: 0, y: 0, w: 800, h: 600 } }] });
  const png = (seed: string) => `data:image/png;base64,${btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) + seed)}`, box = { x0: 0, y0: 0, x1: 1, y1: 1 };
  const pip = (frames: string[]): Buddy => ({ character: 'pip', name: 'Pip', base: { src: png('base'), bb: box }, poses: { walk: { frames: frames.map(f => ({ src: png(f), bb: box })) } } });
  await createLibrary(exe.shell, () => {}).add(write(pip(['old'])));
  const bus = createBus<Said>();
  let hubWire = bus.wire(), hub = createHub({ shell: exe.shell, send: () => {}, seed: async () => '', after: () => {}, wire: hubWire });
  await hub.start();
  const client = createManagerClient({ wire: bus.wire(), session: 'w', after: () => () => {}, shimeji: async () => null, closeWindow: async () => {} });
  const v = mount(client);
  await tick();
  /* The hub goes, and a new one starts on the same disk and the same channel. */
  async function restart() {
    hubWire.close();
    hubWire = bus.wire();
    hub = createHub({ shell: exe.shell, send: () => {}, seed: async () => '', after: () => {}, wire: hubWire });
    await hub.start();
    await tick(); await hub.settled; await tick();
  }
  /* As a Maker window asks: one command, its answer. */
  const maker = bus.wire();
  let n = 0;
  const ask = <T>(cmd: Command) => new Promise<Answer<T>>(done => {
    const id = `m${++n}`;
    maker.listen(m => { if (m.k === 'done' && m.id === id) done(m.answer as Answer<T>); });
    maker.post({ k: 'do', id, cmd });
  });
  async function autosave(frames: string[]) {
    const opened = await ask<{ rev: number }>({ k: 'maker-open', id: 'pip' });
    assert.ok(opened.ok);
    const saved = await ask({ k: 'maker-save', id: 'pip', name: 'Pip', file: write(pip(frames)), rev: opened.value!.rev, session: 'maker' });
    assert.ok(saved.ok, JSON.stringify(saved));
    await tick(); await hub.settled; await tick();
  }
  const settle = async () => { await tick(); await hub.settled; await tick(); };
  /* What a hub that died before saying so left on disk: her new art. */
  const saveBehindIts = (frames: string[]) => createLibrary(exe.shell, () => {}).add(write(pip(frames)));
  const onDisk = () => { const f = exe.files.get('library/pip/buddy.json'); return f ? (JSON.parse(new TextDecoder().decode(f)) as { buddy: Buddy }).buddy.poses.walk!.frames.length : 0; };
  const pipFile = (frames: string[]) => write(pip(frames));
  return { exe, get hub() { return hub; }, client, v, autosave, settle, onDisk, pipFile, restart, saveBehindIts };
}
const askDelete = async (v: ReturnType<typeof mount>) => { await click(v.one('.st .dots')!); await click(v.button('Delete', '.pop')); };
/* A file for her, through the picker: it asks, and the question has settled. */
async function pickReplacing(r: Awaited<ReturnType<typeof realPip>>, frames: string[]) {
  const input = r.v.one<HTMLInputElement>('input[data-pick=file]')!;
  Object.defineProperty(input, 'files', { value: [new File([r.pipFile(frames)], 'pip.buddy')], configurable: true });
  input.dispatchEvent(new Event('change'));
  await r.settle();
  assert.deepStrictEqual(r.v.words('.replace b'), ['Replace Pip with this file?']);
  r.v.later(SETTLE_MS);
}

test('the real hub: Try again on a failed delete leaves her be when a save changed her since, though her name and main image didn\'t', async () => {
  const r = await realPip();
  r.exe.failNext('data_move', 'locked');
  await askDelete(r.v);
  await click(r.v.button('Delete', '.confirm'));
  await r.settle();
  assert.ok(r.v.words('.misprint button').includes('Try again'));
  await r.autosave(['new 1', 'new 2']);
  await click(r.v.button('Try again'));
  await r.settle();
  assert.strictEqual(r.onDisk(), 2, 'her new art is still there');
  assert.ok(r.v.words('.misprint').some(w => /changed since you asked/.test(w!)), r.v.words('.misprint').join(' | '));
});

test('the real hub: a confirm open across a restart at the same instant doesn\'t delete the art saved before it', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  try {
    const r = await realPip();
    await askDelete(r.v);
    assert.ok(r.v.one('.confirm'));
    await r.saveBehindIts(['new 1', 'new 2']);
    await r.restart();
    const confirm = r.v.one('.confirm');
    if (confirm) await click(r.v.button('Delete', '.confirm'));
    await r.settle();
    assert.strictEqual(r.onDisk(), 2, 'her new art is still there');
  } finally { now.mockRestore(); }
});

test('the real hub: a confirm open while a save changes her doesn\'t delete the new her', async () => {
  const r = await realPip();
  await askDelete(r.v);
  assert.ok(r.v.one('.confirm'));
  await r.autosave(['new 1', 'new 2']);
  const confirm = r.v.one('.confirm');
  if (confirm) await click(r.v.button('Delete', '.confirm'));
  await r.settle();
  assert.strictEqual(r.onDisk(), 2, 'her new art is still there');
});

test('the real hub: a Replace the disk wouldn\'t take asks again, and leaves her be when a save changed her since', async () => {
  const r = await realPip();
  await pickReplacing(r, ['imported']);
  r.exe.failNext('data_write', 'disk full', (() => true) as never);
  await click(r.v.button('Replace', '.replace'));
  await r.settle();
  assert.ok(r.v.words('.misprint').some(w => /couldn't be saved/.test(w!)), r.v.words('.misprint').join(' | '));
  assert.ok(r.v.one('.replace'), 'asked again, so the file isn\'t lost');
  await r.autosave(['new 1', 'new 2']);
  r.v.later(SETTLE_MS); /* shown again, so it waits again */
  await click(r.v.button('Replace', '.replace'));
  await r.settle();
  assert.strictEqual(r.onDisk(), 2, 'her new art is still there');
  assert.ok(r.v.words('.misprint').some(w => /changed since/.test(w!)), r.v.words('.misprint').join(' | '));
  assert.ok(!r.v.words('.misprint').some(w => /couldn't be saved/.test(w!)), 'the answer before is cleared');
});

test('the real hub: Try again on a failed delete still deletes her when nothing changed', async () => {
  const r = await realPip();
  r.exe.failNext('data_move', 'locked');
  await askDelete(r.v);
  await click(r.v.button('Delete', '.confirm'));
  await r.settle();
  await click(r.v.button('Try again'));
  await r.settle();
  assert.strictEqual(r.onDisk(), 0);
  assert.deepStrictEqual(r.v.words('.st'), []);
});

test('the real hub: a failed import of someone new says nobody was there, and her retry still comes in', async () => {
  const r = await realPip();
  const mo = r.pipFile(['x']).replace('"character":"pip"', '"character":"mo"');
  const file = { name: 'mo.buddy', path: 'mo.buddy', size: 1, text: async () => mo, url: async () => '' };
  r.exe.failNext('data_write', 'disk full', (() => true) as never);
  const [a] = await r.client.importFiles([file]);
  assert.ok(!a!.ok && a!.rev === null, JSON.stringify(a!.ok ? a : a!.rev));
  const [b] = await r.client.retryImport([file], null);
  assert.ok(b!.ok);
  const [c] = await r.client.retryImport([{ ...file, text: async () => mo.replace('"name":"Pip"', '"name":"Mo"') }], null);
  assert.ok(!c!.ok && /changed since/.test(c!.failure.why), 'now she\'s there, a retry that found nobody is refused');
});

test('the real hub: Replace again, after the disk wouldn\'t take it, still replaces her when nothing changed', async () => {
  const r = await realPip();
  await pickReplacing(r, ['a', 'b', 'c']);
  r.exe.failNext('data_write', 'disk full', (() => true) as never);
  await click(r.v.button('Replace', '.replace'));
  await r.settle();
  r.v.later(SETTLE_MS);
  await click(r.v.button('Replace', '.replace'));
  await r.settle();
  assert.strictEqual(r.onDisk(), 3);
  assert.deepStrictEqual(r.v.words('.misprint'), []);
  assert.deepStrictEqual(r.v.words('.note'), ['Pip was replaced.']);
});

test('the real hub: deleting the last buddy reaches the empty sheet', async () => {
  const exe = createFakeExe({ monitors: [{ i: 0, name: 'A', primary: true, scale: 1, x: 0, y: 0, w: 800, h: 600, full: { x: 0, y: 0, w: 800, h: 600 } }] });
  const PNG = 'data:image/png;base64,iVBORw0KGgo=', box = { x0: 0, y0: 0, x1: 1, y1: 1 };
  const buddy: Buddy = { character: 'pip', name: 'Pip', base: { src: PNG, bb: box }, poses: {} };
  await createLibrary(exe.shell, () => {}).add(write(buddy));
  await exe.shell.dataWrite('settings.json', JSON.stringify({ out: ['pip'] }));
  const bus = createBus<Said>(), hub = createHub({ shell: exe.shell, send: () => {}, seed: async () => '', after: () => {}, wire: bus.wire() });
  await hub.start();
  const client = createManagerClient({ wire: bus.wire(), session: 'w', after: () => () => {}, shimeji: async () => null, closeWindow: async () => {} });
  const v = mount(client);
  await tick();
  assert.deepStrictEqual(v.words('.st .s'), ['On desktop']);
  await click(v.one('.st .dots')!);
  await click(v.button('Delete', '.pop'));
  await click(v.button('Delete', '.confirm'));
  await tick(); await hub.settled; await tick();
  assert.deepStrictEqual(v.words('.st'), []);
  assert.deepStrictEqual(v.words('.welcome h2'), ['No buddies yet']);
});

/* the Maker isn't here yet */

test('a comparing assert refuses elements, in every shape, so a failure can\'t diff the page', () => {
  const e = document.createElement('div');
  for (const f of [() => assert.strictEqual(e, null), () => assert.strictEqual(e, e), () => assert.deepStrictEqual([e], []), () => assert.deepStrictEqual({ a: [e] }, {})]) {
    assert.throws(f, /DOM element/);
  }
  assert.throws(() => gone(e), /should be gone/);
  assert.throws(() => same(e, null), /same element/);
});

test('with no Maker there is no New buddy and no Edit', async () => {
  const empty = await scripted();
  assert.ok(!empty.words('button').includes('New buddy'));
  const v = await scripted({ buddies: [row('Pip', 1)] });
  assert.ok(!v.words('button').includes('New buddy'));
  await openMenu(v, 'Pip');
  assert.ok(!v.words('.menu button').includes('Edit'));
});

test('once there is a Maker, they appear and reach it', async () => {
  const v = await scripted({ buddies: [row('Pip')], maker: true });
  await click(v.button('New buddy', '.bar'));
  await openMenu(v, 'Pip');
  await click(v.button('Edit', '.menu'));
  assert.deepStrictEqual(v.sent, [{ k: 'maker' }, { k: 'maker', id: 'pip' }]);
  const none = await scripted({ maker: true });
  await click(none.button('New buddy', '.welcome'));
  assert.deepStrictEqual(none.sent, [{ k: 'maker' }]);
});

/* failures */

test('a failure is a misprint at the top: title, why, fix, and Clear', async () => {
  const v = await scripted({ buddies: [row('Ada')], failures: [fail('f1', 'Ada went wrong')] });
  const m = v.one('.misprint')!;
  assert.strictEqual(m.querySelector('b')!.textContent, 'Ada went wrong');
  assert.match(m.querySelector('p')!.textContent!, /Why\. Fix\.$/);
  assert.deepStrictEqual(v.words('.misprint button'), ['Clear']);
  same(v.one('.wrap')!.firstElementChild, v.one('.misprints'));
  await click(v.button('Clear'));
  assert.deepStrictEqual(v.sent, [{ k: 'clear', id: 'f1' }]);
});

test('a failure with no fix doesn\'t leave a gap', async () => {
  const v = await scripted({ failures: [{ ...notReady(), id: 'f' }] });
  assert.ok(v.one('.misprint p')!.textContent!.endsWith('Try again in a moment.'));
});

test('again shows for a picker, because that can truly be reopened', async () => {
  const f = { ...badFile('a.buddy', 'not a buddy file'), id: 'f1' }, g = { id: 'f2', kind: 'import', file: 'Mochi', title: 'Mochi', why: 'W', fix: 'F', again: ANOTHER_FOLDER } as Failure;
  const v = await scripted({ failures: [f, g] });
  assert.deepStrictEqual(v.words('.misprint .go'), [ANOTHER_FILE, ANOTHER_FOLDER]);
  const opened: string[] = [];
  for (const i of v.all<HTMLInputElement>('input[data-pick]')) i.addEventListener('click', () => opened.push(i.dataset.pick!));
  await click(v.button(ANOTHER_FILE)); await click(v.button(ANOTHER_FOLDER));
  assert.deepStrictEqual(opened, ['file', 'folder']);
  assert.deepStrictEqual(v.sent, [], 'it stays until something is picked');
});

test('Try again shows only where this window can really do it again', async () => {
  const f = { ...notDeleted('Ada', 'files'), id: 'f1' };
  assert.strictEqual(againFor(f, { pickFile() {}, pickFolder() {}, clear() {} }), null);
  const from = await scripted({ failures: [f], buddies: [row('Ada')] });
  assert.deepStrictEqual(from.words('.misprint button'), ['Clear'], 'it came from elsewhere, so there\'s nothing to repeat');
});

test('a command that fails here can be tried again, and it\'s the same command', async () => {
  const v = await scripted({ buddies: [row('Ada')] }), failure = { ...notDeleted('Ada', 'files'), id: 'f1' };
  v.answers(c => c.k === 'delete' ? { ok: false, failure } : { ok: true });
  await openMenu(v, 'Ada');
  await click(v.button('Delete', '.menu'));
  await v.set({ failures: [failure] });
  await click(v.button('Delete', '.confirm'));
  await tick();
  assert.deepStrictEqual(v.words('.misprint button'), ['Try again', 'Clear']);
  v.answers(() => ({ ok: true }));
  await click(v.button('Try again'));
  assert.deepStrictEqual(v.sent, [{ k: 'delete', id: 'ada', rev: 1 }, { k: 'clear', id: 'f1' }, { k: 'delete', id: 'ada', rev: 1 }]);
});

const replaced = (name: string, id: string): BuddyRow => ({ ...row(name, 0, id), rev: 2 });

test('a confirm closes when someone else takes that id, so it can\'t delete them', async () => {
  const v = await scripted({ buddies: [row('Old', 0, 'c1')] });
  await openMenu(v, 'Old');
  await click(v.button('Delete', '.menu'));
  await v.set({ buddies: [replaced('New', 'c1')] });
  gone(v.one('.confirm'));
  assert.ok(!v.sent.some(c => c.k === 'delete'));
});

test('a confirm closes when a save changes her, though her name and main image stay', async () => {
  const v = await scripted({ buddies: [row('Pip')] });
  await openMenu(v, 'Pip');
  await click(v.button('Delete', '.menu'));
  await v.set({ buddies: [{ ...row('Pip'), rev: 2 }] });
  gone(v.one('.confirm'));
  assert.ok(!v.sent.some(c => c.k === 'delete'));
});

test('a confirm stays open when only the copies change', async () => {
  const v = await scripted({ buddies: [row('Pip', 1)] });
  await openMenu(v, 'Pip');
  await click(v.button('Delete', '.menu'));
  await v.set({ buddies: [row('Pip', 2)] });
  assert.ok(v.one('.confirm'));
});

test('an open menu follows a replaced buddy, so its confirm names who it\'ll delete', async () => {
  const v = await scripted({ buddies: [row('Old', 0, 'c1')] });
  await openMenu(v, 'Old');
  await v.set({ buddies: [replaced('New', 'c1')] });
  await click(v.button('Delete', '.menu'));
  assert.match(v.one('.confirm h2')!.textContent!, /New/);
});

test('Try again on a failed delete asks for the her that was confirmed, so the hub can refuse one that has since replaced her', async () => {
  const v = await scripted({ buddies: [row('Old', 0, 'c1')] }), failure = { ...notDeleted('Old', 'files'), id: 'f1' };
  v.answers(c => c.k === 'delete' ? { ok: false, failure } : { ok: true });
  await openMenu(v, 'Old');
  await click(v.button('Delete', '.menu'));
  await v.set({ failures: [failure] });
  await click(v.button('Delete', '.confirm'));
  await tick();
  await v.set({ buddies: [replaced('New', 'c1')] });
  await click(v.button('Try again'));
  assert.deepStrictEqual(v.sent.filter(c => c.k === 'delete'), [{ k: 'delete', id: 'c1', rev: 1 }, { k: 'delete', id: 'c1', rev: 1 }]);
});

test('trying one import again sends only that one, even with the same name in another folder', async () => {
  const v = await scripted(), failure = { ...notStored('same.buddy'), id: 'f1' };
  v.answers(c => c.k === 'import' && c.content === 'two' ? { ok: false, failure } : { ok: true });
  const inFolder = (folder: string, words: string) => {
    const f = new File([words], 'same.buddy');
    Object.defineProperty(f, 'webkitRelativePath', { value: `${folder}/same.buddy` });
    return f;
  };
  const input = v.one<HTMLInputElement>('input[data-pick=file]')!;
  Object.defineProperty(input, 'files', { value: [inFolder('one', 'one'), inFolder('two', 'two')], configurable: true });
  input.dispatchEvent(new Event('change'));
  await tick();
  await v.set({ failures: [failure] });
  v.answers(() => ({ ok: true }));
  await click(v.button('Try again'));
  await tick();
  assert.deepStrictEqual(v.sent.flatMap(c => c.k === 'import' ? [c.content] : []), ['one', 'two', 'two']);
});

test('an import that couldn\'t be stored can be tried again with the same file', async () => {
  const v = await scripted(), failure = { ...notStored('a.buddy'), id: 'f1' };
  v.answers(c => c.k === 'import' ? { ok: false, failure } : { ok: true });
  const input = v.one<HTMLInputElement>('input[data-pick=file]')!;
  Object.defineProperty(input, 'files', { value: [new File(['{}'], 'a.buddy')], configurable: true });
  input.dispatchEvent(new Event('change'));
  await tick();
  await v.set({ failures: [failure] });
  assert.ok(v.words('.misprint button').includes('Try again'));
  await click(v.button('Try again'));
  assert.deepStrictEqual(v.sent.map(c => c.k), ['import', 'clear', 'import']);
});

test('a refusal with no again never offers one', async () => {
  const v = await scripted({ failures: [{ ...makerHolding(), id: 'f1' }] });
  assert.deepStrictEqual(v.words('.misprint button'), ['Clear']);
});

test('a big pile of failures doesn\'t push everyone away, and all of it can go at once', async () => {
  const many = Array.from({ length: 5 }, (_, i) => fail('f' + i, 'F' + i));
  const v = await scripted({ failures: many, buddies: [row('Ada')] });
  assert.strictEqual(v.all('.misprint').length, SHOWN);
  assert.match(v.one('.more')!.textContent!, new RegExp(`${5 - SHOWN} more`));
  await click(v.button('Show all'));
  assert.strictEqual(v.all('.misprint').length, 5);
  await click(v.button('Clear all'));
  assert.deepStrictEqual(v.sent, [{ k: 'clear' }]);
  await v.set({ failures: [] });
  assert.deepStrictEqual(v.words('.misprint'), []);
  assert.ok(!v.shown(v.one('.misprints')));
});

/* import */

test('Import offers a file or a folder, and each opens its picker', async () => {
  const v = await scripted({ buddies: [row('Ada')] });
  const opened: string[] = [];
  for (const i of v.all<HTMLInputElement>('input[data-pick]')) i.addEventListener('click', () => opened.push(i.dataset.pick!));
  assert.ok(v.one<HTMLInputElement>('input[data-pick=folder]')!.hasAttribute('webkitdirectory'));
  await click(v.button('Import'));
  await click(v.button('A .buddy file', '.menu'));
  gone(v.one('.menu'));
  await click(v.button('Import'));
  await click(v.button('A Shimeji folder', '.menu'));
  assert.deepStrictEqual(opened, ['file', 'folder']);
});

test('the empty sheet\'s Import offers the same choice', async () => {
  const v = await scripted();
  await click(v.button('Import', '.welcome'));
  assert.deepStrictEqual(v.words('.menu button'), ['A .buddy file', 'A Shimeji folder']);
});

const dragged = (type: string, types = ['Files'], target: EventTarget = document.body) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { types, items: [], files: [] } });
  target.dispatchEvent(e);
  return e;
};

test('a drag with files shows a drop state, however many elements it crosses', async () => {
  const v = await scripted({ buddies: [row('Ada')] });
  assert.ok(!v.shown(v.one('.veil')));
  dragged('dragenter'); assert.ok(v.shown(v.one('.veil')));
  dragged('dragenter'); dragged('dragleave'); assert.ok(v.shown(v.one('.veil')), 'moved from one element to the next');
  dragged('dragleave'); assert.ok(!v.shown(v.one('.veil')), 'left the window');
  dragged('dragenter'); dragged('drop'); assert.ok(!v.shown(v.one('.veil')));
});

test('dragging anything else shows nothing, and a dropped file is never a navigation', async () => {
  const v = await scripted({ buddies: [row('Ada')] });
  dragged('dragenter', ['text/plain']);
  assert.ok(!v.shown(v.one('.veil')));
  assert.ok(dragged('dragover').defaultPrevented);
  assert.ok(dragged('drop').defaultPrevented);
});

test('getting ready: a drop is refused, and the cursor and the window say so', async () => {
  const v = await scripted({ ready: false });
  dragged('dragenter');
  assert.ok(!v.shown(v.one('.veil')));
  const over = dragged('dragover') as Event & { dataTransfer: { dropEffect?: string } };
  assert.ok(over.defaultPrevented, 'still never a navigation');
  assert.strictEqual(over.dataTransfer.dropEffect, 'none');
  const drop = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], items: [], files: [new File(['{}'], 'a.buddy')] } });
  document.body.dispatchEvent(drop);
  await tick();
  assert.ok(drop.defaultPrevented);
  assert.ok(!v.sent.some(c => c.k === 'import'));
});

test('while files come in, Import says so and can\'t be pressed twice', async () => {
  const v = await scripted();
  let finish = (_: Answer) => {};
  const importFiles = v.client.importFiles;
  v.client.importFiles = () => new Promise(done => { finish = a => done([a as never]); });
  const input = v.one<HTMLInputElement>('input[data-pick=file]')!;
  Object.defineProperty(input, 'files', { value: [new File(['{}'], 'a.buddy')], configurable: true });
  input.dispatchEvent(new Event('change'));
  await tick();
  const bar = v.one<HTMLButtonElement>('.bar .btn')!;
  assert.strictEqual(bar.textContent, 'Importing');
  assert.ok(bar.disabled);
  finish({ ok: true });
  await tick();
  assert.strictEqual(bar.textContent, 'Import');
  v.client.importFiles = importFiles;
});

/* Find */

test('Find only shows when there are enough buddies to need it', async () => {
  const some = Array.from({ length: FIND_FROM - 1 }, (_, i) => row('B' + i));
  const v = await scripted({ buddies: some });
  assert.ok(!v.shown(v.one('.search')));
  assert.ok(v.shown(v.one('.title')));
  await v.set({ buddies: [...some, row('Zed')] });
  assert.ok(v.shown(v.one('.search')));
  assert.ok(!v.shown(v.one('.title')));
});

test('Find filters by name, and says when nobody matches', async () => {
  const v = await scripted({ buddies: [...Array.from({ length: FIND_FROM }, (_, i) => row('B' + i)), row('Mochi')] });
  const input = v.one<HTMLInputElement>('.search input')!, type = (t: string) => { input.value = t; input.dispatchEvent(new Event('input')); };
  type('moc');
  assert.deepStrictEqual(v.words('.st b'), ['Mochi']);
  assert.ok(!v.shown(v.one('.dropit')));
  type('nobody');
  assert.deepStrictEqual(v.words('.st b'), []);
  assert.match(v.words('.none span')[0]!, /nobody/);
  await click(v.button('Clear', '.none'));
  assert.strictEqual(input.value, '');
  assert.strictEqual(v.words('.st b').length, FIND_FROM + 1);
});

test('Find ignores case and accents, and takes any script', () => {
  assert.ok(matches({ name: 'Ñandú' }, 'nandu'));
  assert.ok(matches({ name: 'MOCHI' }, ' mochi '));
  assert.ok(matches({ name: 'ぷりん' }, 'りん'));
  assert.ok(!matches({ name: 'Pip' }, 'olive'));
});

test('a search doesn\'t outlive Find: with few buddies left, everyone shows again', async () => {
  const many = Array.from({ length: FIND_FROM }, (_, i) => row('B' + i));
  const v = await scripted({ buddies: many });
  const input = v.one<HTMLInputElement>('.search input')!;
  input.value = 'B1'; input.dispatchEvent(new Event('input'));
  await v.set({ buddies: many.slice(0, 3) });
  assert.strictEqual(input.value, '');
  assert.deepStrictEqual(v.words('.st b'), ['B0', 'B1', 'B2']);
});

/* Settings and theme */

test('Settings is a small panel: Theme, dark first', async () => {
  const v = await scripted({ buddies: [row('Ada')] });
  await click(v.button('Settings'));
  assert.strictEqual(v.one('.panel h2')!.textContent, 'Settings');
  assert.deepStrictEqual(v.all('.panel [role=radio]').map(b => [b.textContent, b.getAttribute('aria-checked')]), [['Dark', 'true'], ['Light', 'false']]);
  press('Escape');
  gone(v.one('.panel'));
});

const FILES_NOTE = 'Windows opens .buddy files with Desktop Buddies.';

test('Settings says Windows opens .buddy files only in the Store\'s package, with nothing to switch', async () => {
  const plain = await scripted();
  await click(plain.button('Settings'));
  assert.deepStrictEqual(plain.words('.panel .files-note'), []);
  press('Escape');
  const boxed = await scripted({ packaged: true });
  await click(boxed.button('Settings'));
  assert.deepStrictEqual(boxed.words('.panel .files-note'), [FILES_NOTE]);
  assert.ok(!boxed.all('.panel [role=switch]').some(b => boxed.shown(b) && /buddy/i.test(b.getAttribute('aria-label') ?? '')), 'no .buddy switch');
  await boxed.set({ packaged: false });
  assert.deepStrictEqual(boxed.words('.panel .files-note'), []);
});

const FILES_SWITCH = 'Open .buddy files with Desktop Buddies';

test('Open .buddy files: a switch under Theme and above Walk on windows, showing the hub, and sending files', async () => {
  const v = await scripted({ ready: false });
  await click(v.button('Settings'));
  const sw = () => v.button(FILES_SWITCH, '.panel');
  assert.deepStrictEqual(v.words('.panel .files-setting > span'), [FILES_SWITCH]);
  assert.strictEqual(sw().getAttribute('role'), 'switch');
  assert.strictEqual(sw().getAttribute('aria-checked'), 'false');
  assert.ok(sw().disabled, 'not until the hub is ready');
  const order = [v.one('.panel [role=radiogroup]'), sw(), v.button('Walk on windows', '.panel')].map(e => [...v.all('.panel *')].indexOf(e!));
  assert.ok(order[0]! >= 0 && order[0]! < order[1]! && order[1]! < order[2]!, `order ${order}`);
  await v.set({ ready: true });
  assert.ok(!sw().disabled);
  await click(sw());
  assert.deepStrictEqual(v.sent, [{ k: 'files', on: true }]);
  assert.strictEqual(sw().getAttribute('aria-checked'), 'false', "what the hub says, not what was clicked");
  await v.set({ files: true });
  assert.strictEqual(sw().getAttribute('aria-checked'), 'true');
  await click(sw());
  assert.deepStrictEqual(v.sent.at(-1), { k: 'files', on: false });
  await v.set({ packaged: true });
  assert.ok(!v.all('.panel [role=switch]').some(b => v.shown(b) && b.getAttribute('aria-label') === FILES_SWITCH), 'packaged: no switch');
  assert.deepStrictEqual(v.words('.panel .files-note'), [FILES_NOTE]);
});

test('Theme: dark by default, Light is shown and remembered, and the panel stays', async () => {
  const v = await scripted();
  assert.strictEqual(document.documentElement.dataset.theme, 'dark');
  await click(v.button('Settings'));
  await click(v.button('Light', '.panel'));
  same(document.activeElement, v.one('[data-theme-choice=light]'), 'the keyboard stays on the choice');
  assert.strictEqual(document.documentElement.dataset.theme, 'light');
  assert.strictEqual(v.memory.held.get(THEME_KEY), 'light');
  assert.strictEqual(v.one('.panel [aria-checked=true]')!.textContent, 'Light');
});

test('a theme that was remembered comes back', async () => {
  await scripted({}, { store: () => ({ getItem: () => 'light', setItem() {} }) });
  assert.strictEqual(document.documentElement.dataset.theme, 'light');
});

test('storage that fails means dark, and never stops the window', async () => {
  const gone = () => { throw new Error('denied'); };
  assert.strictEqual(readTheme(gone), 'dark');
  assert.strictEqual(readTheme(() => ({ getItem: gone, setItem: gone })), 'dark');
  assert.strictEqual(readTheme(() => ({ getItem: () => 'purple', setItem() {} })), 'dark');
  assert.doesNotThrow(() => saveTheme(gone, 'light'));
  assert.doesNotThrow(() => saveTheme(() => ({ getItem: gone, setItem: gone }), 'light'));
  const v = await scripted({}, { store: gone });
  assert.strictEqual(document.documentElement.dataset.theme, 'dark');
  await click(v.button('Settings'));
  await click(v.button('Light', '.panel'));
  assert.strictEqual(document.documentElement.dataset.theme, 'light', 'it still changes for now');
});

/* Walk on windows */

const walkSwitch = (v: Awaited<ReturnType<typeof scripted>>, name = 'Walk on windows') => v.button(name, '.panel');
const checked = (b: HTMLElement) => b.getAttribute('aria-checked');

test('Settings has the switch, on by default, and lists the apps on offer in order', async () => {
  const v = await scripted({ apps: ['zed.exe', 'code.exe'] });
  await click(v.button('Settings'));
  assert.strictEqual(checked(walkSwitch(v)), 'true');
  assert.deepStrictEqual(v.words('.apps span'), ['code.exe', 'zed.exe']);
  assert.deepStrictEqual(v.all('.apps [role=switch]').map(checked), ['false', 'false']);
});

test('the switch sends what it should, and shows what the hub says, not what was clicked', async () => {
  const v = await scripted();
  await click(v.button('Settings'));
  await click(walkSwitch(v));
  assert.deepStrictEqual(v.sent, [{ k: 'walk', on: false }]);
  assert.strictEqual(checked(walkSwitch(v)), 'true', 'nothing has changed yet');
  await v.set({ walk: false });
  assert.strictEqual(checked(walkSwitch(v)), 'false');
  await click(walkSwitch(v));
  assert.deepStrictEqual(v.sent.at(-1), { k: 'walk', on: true });
});

test('an app switch keeps buddies off that app, and back on', async () => {
  const v = await scripted({ apps: ['code.exe'] });
  await click(v.button('Settings'));
  await click(walkSwitch(v, 'Stay off code.exe'));
  assert.deepStrictEqual(v.sent, [{ k: 'exclude', app: 'code.exe', on: true }]);
  await v.set({ exclude: ['code.exe'] });
  assert.strictEqual(checked(walkSwitch(v, 'Stay off code.exe')), 'true');
  await click(walkSwitch(v, 'Stay off code.exe'));
  assert.deepStrictEqual(v.sent.at(-1), { k: 'exclude', app: 'code.exe', on: false });
});

test('an app on the list that has closed can still come off it', async () => {
  const v = await scripted({ apps: ['code.exe'], exclude: ['gone.exe'] });
  await click(v.button('Settings'));
  assert.deepStrictEqual(v.words('.apps span'), ['code.exe', 'gone.exe']);
  assert.strictEqual(checked(walkSwitch(v, 'Stay off gone.exe')), 'true');
});

test('with nothing to offer, the list and its heading are gone', async () => {
  const v = await scripted();
  await click(v.button('Settings'));
  assert.deepStrictEqual(v.words('.apps-head'), []);
  await v.set({ apps: ['code.exe'] });
  assert.deepStrictEqual(v.words('.apps-head'), ['Stay off']);
});

test('with the switch off the list stays, with nothing to press', async () => {
  const v = await scripted({ apps: ['code.exe'], walk: false });
  await click(v.button('Settings'));
  const rows = () => v.all<HTMLButtonElement>('.apps [role=switch]').filter(v.shown);
  assert.deepStrictEqual(v.words('.apps span'), ['code.exe']);
  assert.deepStrictEqual(v.words('.apps-head'), ['Stay off']);
  assert.strictEqual(rows().length, 1);
  assert.ok(rows().every(b => b.disabled));
  assert.ok(!walkSwitch(v).disabled);
  await v.set({ walk: true });
  assert.strictEqual(rows().length, 1);
  assert.ok(rows().every(b => !b.disabled));
});

test('not ready: nothing to press', async () => {
  const v = await scripted({ ready: false, apps: ['code.exe'] });
  await click(v.button('Settings'));
  const all = v.all<HTMLButtonElement>('.walk [role=switch]').filter(v.shown);
  assert.strictEqual(all.length, 2);
  assert.ok(all.every(b => b.disabled));
});

test('an app that opens or closes leaves the keyboard where it was', async () => {
  const v = await scripted({ apps: ['code.exe', 'zed.exe'] });
  await click(v.button('Settings'));
  const zed = walkSwitch(v, 'Stay off zed.exe');
  zed.focus();
  await v.set({ apps: ['alpha.exe', 'zed.exe'] });
  same(document.activeElement, zed);
  assert.deepStrictEqual(v.words('.apps span'), ['alpha.exe', 'zed.exe']);
});

test('changing the theme keeps the walk setting in the panel', async () => {
  const v = await scripted({ apps: ['code.exe'] });
  await click(v.button('Settings'));
  await click(v.button('Light', '.panel'));
  assert.deepStrictEqual(v.words('.apps span'), ['code.exe']);
  await click(walkSwitch(v));
  assert.deepStrictEqual(v.sent, [{ k: 'walk', on: false }]);
});

/* one sticker */

const stickerIO = (more: Partial<StickerIO> = {}) => {
  const moved: string[] = [], peel: Peel = {
    lift() { moved.push('lift'); }, drawIn() { moved.push('drawIn'); },
    land() { moved.push('land'); }, rubOut(_, done) { moved.push('rubOut'); done(); }
  };
  const io: StickerIO = { call() {}, dismiss() {}, more() {}, outline: async () => LINE, peel, now: () => 0, after: () => {}, ...more };
  return { io, moved };
};
const LOOK = { only: false, ready: true };

test('a buddy that\'s already out when the window opens doesn\'t animate', async () => {
  const { io, moved } = stickerIO(), s = createSticker(row('Ada', 1), io);
  await tick();
  assert.ok(s.el.querySelector('.cutline'));
  assert.deepStrictEqual(moved, []);
});

test('Call lifts the sticker and draws the line. Dismiss runs it back', async () => {
  const { io, moved } = stickerIO(), s = createSticker(row('Ada'), io);
  s.update(row('Ada', 1), LOOK);
  await tick();
  assert.deepStrictEqual(moved, ['lift', 'drawIn']);
  s.update(row('Ada'), LOOK);
  assert.deepStrictEqual(moved, ['lift', 'drawIn', 'land', 'rubOut']);
  gone(s.el.querySelector('.cutline'));
});

test('new art never wears the old line while its own is baking', async () => {
  let finish = (_: Outline) => {};
  const { io } = stickerIO({ outline: u => /v=2/.test(u) ? new Promise(done => { finish = done; }) : Promise.resolve(LINE) });
  const s = createSticker(row('Ada', 1), io);
  await tick();
  assert.ok(s.el.querySelector('.cutline'));
  s.update({ ...row('Ada', 1), image: 'library/ada/base.png?v=2' }, LOOK);
  gone(s.el.querySelector('.cutline'));
  finish(LINE);
  await tick();
  assert.ok(s.el.querySelector('.cutline'));
});

test('with several copies out, the button and the art both say it\'s all of them', () => {
  const { io } = stickerIO(), s = createSticker(row('Pip', 2), io), art = s.el.querySelector<HTMLElement>('.art')!;
  assert.strictEqual(s.el.querySelector('.acts .btn')!.textContent, 'Dismiss all');
  assert.strictEqual(art.title, 'Dismiss all copies of Pip');
  s.update(row('Pip', 1), LOOK);
  assert.strictEqual(s.el.querySelector('.acts .btn')!.textContent, 'Dismiss');
  assert.strictEqual(art.title, 'Dismiss Pip');
});

test('a second copy moves nothing', async () => {
  const { io, moved } = stickerIO(), s = createSticker(row('Ada', 1), io);
  await tick();
  s.update(row('Ada', 2), LOOK);
  await tick();
  assert.deepStrictEqual(moved, []);
});

test('with reduced motion the peel does nothing, and what\'s going still goes', () => {
  const peel = createPeel(() => false), line = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  let done = 0;
  const img = document.createElement('img');
  peel.lift(img); peel.land(img); peel.drawIn(line); peel.rubOut(line, () => done++);
  assert.strictEqual(done, 1);
});

test('a line that arrives after a dismiss is thrown away', async () => {
  let give = (_: Outline) => {};
  const { io } = stickerIO({ outline: () => new Promise(done => { give = done; }) }), s = createSticker(row('Ada'), io);
  s.update(row('Ada', 1), LOOK);
  s.update(row('Ada'), LOOK);
  give(LINE);
  await tick();
  gone(s.el.querySelector('.cutline'));
});

test('art that changes gets a new line', async () => {
  const asked: string[] = [], { io } = stickerIO({ outline: async u => { asked.push(u); return LINE; } }), s = createSticker(row('Ada', 1), io);
  await tick();
  s.update({ ...row('Ada', 1), image: 'library/ada/other.png' }, LOOK);
  await tick();
  assert.deepStrictEqual(asked, ['library/ada/base.png', 'library/ada/other.png']);
  assert.strictEqual(s.el.querySelectorAll('.cutline').length, 1);
});

test('status words', () => {
  assert.deepStrictEqual([0, 1, 2, 12].map(copies => statusOf({ copies })), ['At home', 'On desktop', '2 on desktop', '12 on desktop']);
});

test('art fits its box, however odd its shape', () => {
  assert.deepStrictEqual(fit(320, 320), [92, 92]);
  assert.deepStrictEqual(fit(150, 300), [46, 92]);
  assert.deepStrictEqual(fit(600, 100), [147, 25], 'wide art stops at the width');
  assert.deepStrictEqual(fit(10, 10, ONLY), [ONLY, ONLY]);
  assert.deepStrictEqual(fit(1, 3000), [1, 92]);
});

/* cut lines */

test('a line is drawn from the outline: pad under dots, a whole number of them, and its shape marked', () => {
  const line = cutline(rectangle(138, 138, 1.5), 92);
  assert.strictEqual(line.dataset.line, 'unread');
  assert.deepStrictEqual([...line.children].map(c => c.getAttribute('class')), ['cut-pad', 'cut-dots']);
  const dots = Number(line.querySelector('.cut-dots')!.getAttribute('pathLength'));
  assert.ok(Number.isInteger(dots) && dots > 20);
  assert.strictEqual(line.getAttribute('viewBox'), '0 0 138 138');
  assert.strictEqual(line.getAttribute('width'), '92');
});

test('dots stay the same size on the large sticker, and there are more of them', () => {
  const small = cutline(LINE, ART), large = cutline(LINE, ONLY), size = (s: SVGSVGElement) => Number(s.querySelector('.cut-dots')!.getAttribute('stroke-width')) * Number(s.getAttribute('width')) / 138;
  assert.ok(Math.abs(size(small) - 2.8) < .02 && Math.abs(size(large) - 2.8) < .02);
  assert.ok(Number(large.querySelector('.cut-dots')!.getAttribute('pathLength')) > Number(small.querySelector('.cut-dots')!.getAttribute('pathLength')));
});

test('outlines are baked once per image URL, one at a time, and a new URL bakes again', async () => {
  const asked: string[] = [];
  let running = 0, most = 0;
  const outline = createOutlines(async u => { asked.push(u); most = Math.max(most, ++running); await tick(); running--; return LINE; }, async () => {});
  const all = await Promise.all([outline('a?v=1'), outline('a?v=1'), outline('b?v=1'), outline('a?v=2')]);
  assert.deepStrictEqual(asked, ['a?v=1', 'b?v=1', 'a?v=2']);
  assert.strictEqual(most, 1);
  assert.strictEqual(all[0], all[1]);
  await outline('a?v=1');
  assert.strictEqual(asked.length, 3);
});

test('old lines are forgotten, so art replaced over a long session can\'t pile up', async () => {
  const asked: string[] = [], outline = createOutlines(async u => { asked.push(u); return LINE; }, async () => {});
  for (let i = 0; i <= KEEP; i++) await outline(`a?v=${i}`);
  await outline(`a?v=${KEEP}`);
  assert.strictEqual(asked.length, KEEP + 1, 'the newest is kept');
  await outline('a?v=0');
  assert.strictEqual(asked.length, KEEP + 2, 'the oldest had gone');
});

/* The real loader with image loads answered by hand, a clock moved by hand, and timers run by it. */
function handLoads() {
  let t = 0;
  const loads: { src: string; ok(): void; fail(): void }[] = [], timers: { at: number; f: () => void }[] = [];
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null; onerror: (() => void) | null = null; naturalWidth = 0; naturalHeight = 0;
    set src(u: string) { loads.push({ src: u, ok: () => { this.naturalWidth = this.naturalHeight = 100; this.onload?.(); }, fail: () => this.onerror?.() }); }
  });
  const solid = (_: unknown, w: number, h: number) => ({ width: w, height: h, data: new Uint8Array(w * h).map((_, i) => (i % w > w / 4 && i % w < w * 3 / 4) ? 255 : 0) });
  const now = () => t, after = (ms: number, f: () => void) => { timers.push({ at: t + ms, f }); };
  const outline = createOutlines(u => outlineOfImage(u, (w, h) => fit(w, h), solid), async () => {}, now);
  async function later(ms: number) { t += ms; for (const x of timers.filter(x => x.at <= t)) { timers.splice(timers.indexOf(x), 1); x.f(); } await tick(); }
  return { loads, outline, now, after, later, of: (u: string) => loads.filter(l => l.src === u), queued: () => timers.length };
}

test('with the real loader, a failed line is kept for a while, then the next ask bakes again, with nothing changed about her', async () => {
  const h = handLoads();
  try {
    const first = h.outline('a.png'); await tick(); h.loads.at(-1)!.fail();
    assert.strictEqual((await first).shape, 'unread');
    for (let i = 0; i < 120; i++) await h.outline('a.png');
    assert.strictEqual(h.of('a.png').length, 1, 'no load again inside the period');
    await h.later(FAILED_MS);
    const again = h.outline('a.png'); await tick(); h.loads.at(-1)!.ok();
    assert.notStrictEqual((await again).shape, 'unread');
    await h.later(FAILED_MS * 10);
    await h.outline('a.png');
    assert.strictEqual(h.of('a.png').length, 2, 'a good line is kept');
  } finally { vi.unstubAllGlobals(); }
});

test('an out sticker that got a failed line asks once more when the failure is forgotten, with nothing changed about her', async () => {
  const h = handLoads();
  try {
    const { io } = stickerIO({ outline: h.outline, now: h.now, after: h.after }), s = createSticker({ ...row('Ada', 1), image: 'a.png' }, io);
    document.body.append(s.el); /* a sticker in the page, as the sheet keeps it */
    await tick(); h.loads.at(-1)!.fail(); await tick();
    assert.strictEqual(h.of('a.png').length, 1);
    await h.later(FAILED_MS + 1000);
    assert.strictEqual(h.of('a.png').length, 2, 'it asked again');
    h.loads.at(-1)!.ok(); await tick(); await tick();
    assert.notStrictEqual(s.el.querySelector<SVGElement>('.cutline')!.dataset.line, 'unread', 'and drew the line it got');
  } finally { vi.unstubAllGlobals(); }
});

/* Stepped in small moves, so a timer runs near when it's due. */
const stepped = async (h: ReturnType<typeof handLoads>, ms: number) => { for (let t = 0; t < ms; t += 250) await h.later(250); };

test('a sticker asks again only after the failure is forgotten, then once a period while it stays broken, and keeps its drawn line meanwhile', async () => {
  const h = handLoads();
  try {
    let asks = 0;
    const outline = (u: string) => { asks++; return h.outline(u); };
    const { io } = stickerIO({ outline, now: h.now, after: h.after }), s = createSticker({ ...row('Ada', 1), image: 'a.png' }, io);
    document.body.append(s.el); /* a sticker in the page, as the sheet keeps it */
    await tick(); h.loads.at(-1)!.fail(); await tick();
    const drawn = s.el.querySelector('.cutline');
    await stepped(h, FAILED_MS + 500);
    assert.strictEqual(asks, 2, 'one ask after the period, none before');
    h.loads.at(-1)!.fail(); await tick(); await tick();
    same(s.el.querySelector('.cutline'), drawn, 'a second unread line doesn\'t redraw');
    await stepped(h, FAILED_MS + 500);
    assert.strictEqual(h.of('a.png').length, 3, 'still broken, so once more a period later');
  } finally { vi.unstubAllGlobals(); }
});

test('a sticker with a good line never asks again, and one that went home doesn\'t either', async () => {
  const h = handLoads();
  try {
    let asks = 0;
    const outline = (u: string) => { asks++; return h.outline(u); };
    const { io } = stickerIO({ outline, now: h.now, after: h.after });
    const good = createSticker({ ...row('Ada', 1), image: 'good.png' }, io);
    document.body.append(good.el); /* a sticker in the page, as the sheet keeps it */
    await tick(); h.loads.at(-1)!.ok(); await tick(); await tick();
    await stepped(h, FAILED_MS * 3);
    assert.strictEqual(asks, 1, 'a good line is kept');
    void good;
    const home = createSticker({ ...row('Mo', 1, 'mo'), image: 'gone.png' }, io);
    document.body.append(home.el); /* a sticker in the page, as the sheet keeps it */
    await tick(); h.loads.at(-1)!.fail(); await tick();
    home.update({ ...row('Mo', 0, 'mo'), image: 'gone.png' }, LOOK);
    await stepped(h, FAILED_MS * 2);
    assert.strictEqual(h.of('gone.png').length, 1, 'home, so nobody wants her line');
  } finally { vi.unstubAllGlobals(); }
});

test('a deleted buddy\'s sticker stops: with a retry waiting, the real sheet drops her, then no more loads and no timer left', async () => {
  const h = handLoads();
  try {
    const top = document.createElement('div'), { io } = stickerIO({ outline: h.outline, now: h.now, after: h.after });
    const sheet = createSheet({ ...io, importIt() {}, newBuddy() {}, clearFind() {} }, top);
    document.body.replaceChildren(sheet.el);
    const view = (buddies: BuddyRow[]) => sheet.update({ buddies, query: '', ready: true, maker: false });
    view([{ ...row('Ada', 1), image: 'del.png' }]);
    await tick(); h.loads.at(-1)!.fail(); await tick(); await tick();
    assert.strictEqual(h.queued(), 1, 'a retry is waiting');
    view([]);
    await stepped(h, FAILED_MS * 4);
    assert.strictEqual(h.of('del.png').length, 1, 'no more loads');
    assert.strictEqual(h.queued(), 0, 'and no timer left');
  } finally { vi.unstubAllGlobals(); }
});

test('the Manager\'s view gives its stickers a timer, so a failed line is asked for again', async () => {
  const h = handLoads();
  try {
    let asks = 0;
    await scripted({ buddies: [{ ...row('Ada', 1), image: 'v.png' }] }, { outline: u => { asks++; return h.outline(u); }, now: h.now, after: h.after });
    await tick(); h.loads.at(-1)!.fail(); await tick();
    await stepped(h, FAILED_MS + 500);
    assert.strictEqual(asks, 2);
  } finally { vi.unstubAllGlobals(); }
});

test('A, then B, then A back while A\'s first bake is still going: a failure it ends with is tried again', async () => {
  const h = handLoads();
  try {
    const { io } = stickerIO({ outline: h.outline, now: h.now, after: h.after }), s = createSticker({ ...row('Ada', 1), image: 'a.png' }, io);
    document.body.append(s.el); /* a sticker in the page, as the sheet keeps it */
    await tick();
    const firstA = h.loads.at(-1)!;
    s.update({ ...row('Ada', 1), image: 'b.png', rev: 2 }, LOOK); await tick();
    s.update({ ...row('Ada', 1), image: 'a.png', rev: 3 }, LOOK); await tick();
    firstA.fail(); await tick(); await tick();
    for (const l of h.of('b.png')) l.ok();
    await tick(); await tick();
    for (let i = 0; i < 120; i++) s.update({ ...row('Ada', 1), image: 'a.png', rev: 3 }, LOOK);
    await tick();
    assert.strictEqual(h.of('a.png').length, 1, 'nothing asked again inside the period');
    await h.later(FAILED_MS + 1000);
    const retry = h.of('a.png').at(-1)!;
    assert.notStrictEqual(retry, firstA, 'A was asked for again');
    retry.ok(); await tick(); await tick();
    assert.ok(s.el.querySelector('.cutline'));
    assert.strictEqual(h.of('a.png').length, 2);
  } finally { vi.unstubAllGlobals(); }
});

test('a bake that throws still gets a line, and the next one still runs', async () => {
  const outline = createOutlines(async u => { if (u === 'bad') throw new Error('no'); return LINE; }, async () => {});
  const [bad, good] = await Promise.all([outline('bad'), outline('good')]);
  assert.strictEqual(bad.shape, 'unread');
  assert.ok(bad.loops.length);
  assert.strictEqual(good, LINE);
});

/* Other apps asking */

const API_ON = (more: Partial<HubState['api']> = {}): HubState['api'] => ({ on: true, apps: [], asking: [], ...more });

test('the setting is off by default, in plain words, and sends what it should', async () => {
  const v = await scripted();
  await click(v.button('Settings'));
  const flip = v.button('Let other apps ask buddies to do things', '.panel');
  assert.strictEqual(checked(flip), 'false');
  assert.ok(/They can wave and say a line, nothing else\./.test(v.one('.panel')!.textContent!));
  await click(flip);
  assert.deepStrictEqual(v.sent, [{ k: 'api', on: true }]);
  assert.strictEqual(checked(flip), 'false', 'nothing has changed yet');
  await v.set({ api: API_ON() });
  assert.strictEqual(checked(flip), 'true');
});

test('an app waiting is asked about at the top of the sheet: Allow or Not now', async () => {
  const v = await scripted({ buddies: [row('Pip', 1)], api: API_ON({ asking: ['Claude Code', 'Other'] }) });
  assert.deepStrictEqual(v.words('.ask b'), ['Claude Code wants your buddies to wave and talk', 'Other wants your buddies to wave and talk']);
  await click(v.button('Allow', '.ask[data-app="Claude Code"]'));
  await click(v.button('Not now', '.ask[data-app="Other"]'));
  assert.deepStrictEqual(v.sent, [{ k: 'api-answer', app: 'Claude Code', allow: true }, { k: 'api-answer', app: 'Other', allow: false }]);
  await v.set({ api: API_ON({ apps: [{ name: 'Claude Code', allow: true }, { name: 'Other', allow: false }] }) });
  assert.deepStrictEqual(v.words('.ask b'), []);
  assert.ok(!v.shown(v.one('.asking')), 'and the question goes');
});

test('with it off, nobody is asked about', async () => {
  const v = await scripted({ api: { on: false, apps: [], asking: ['Claude Code'] } });
  assert.deepStrictEqual(v.words('.ask b'), []);
});

test('answered apps are listed in Settings, each with Remove', async () => {
  const v = await scripted({ api: API_ON({ apps: [{ name: 'Claude Code', allow: true }, { name: 'Other', allow: false }] }) });
  await click(v.button('Settings'));
  assert.deepStrictEqual(v.words('.api-apps .setting > span'), ['Claude Code Allowed', 'Other Not allowed']);
  await click(v.button('Remove Other', '.panel'));
  assert.deepStrictEqual(v.sent, [{ k: 'api-forget', app: 'Other' }]);
});

test('an app\'s name is only ever text', async () => {
  const v = await scripted({ api: API_ON({ asking: ['<img src=x onerror=alert(1)>'], apps: [{ name: '<b>x</b>', allow: true }] }) });
  assert.strictEqual(v.all('.ask img').length, 0);
  assert.ok(/<img src=x onerror=alert\(1\)> wants/.test(v.one('.ask b')!.textContent!));
  await click(v.button('Settings'));
  assert.strictEqual(v.all('.api-apps b').length, 0);
});

/* a file that would replace someone */

const Q = (ask: string, name: string, more: Partial<Replacing> = {}): Replacing => ({ ask, id: name.toLowerCase(), name, called: name, file: `${name.toLowerCase()}.buddy`, ...more });

test('a file that would replace her asks at the top, with Replace on the keyboard', async () => {
  const v = await scripted({ buddies: [row('Olive')], replacing: [Q('r1', 'Olive')] });
  assert.deepStrictEqual(v.words('.replace b'), ['Replace Olive with this file?']);
  assert.deepStrictEqual(v.words('.replace span'), ['From olive.buddy. Keep both adds it as a new buddy.']);
  assert.deepStrictEqual(v.words('.replace button'), ['Replace', 'Keep both', '×']);
  same(document.activeElement, v.button('Replace', '.replace'));
  assert.strictEqual(v.one('.replace')!.getAttribute('role'), 'alertdialog');
  assert.deepStrictEqual(v.sent, [], 'asking sends nothing');
});

test('Replace waits a moment after it shows, so a press meant for the one before can\'t answer it', async () => {
  const v = await scripted({ buddies: [row('Olive')], replacing: [Q('r1', 'Olive')] });
  await click(v.button('Replace', '.replace'));
  await click(v.button('Keep both', '.replace'));
  assert.deepStrictEqual(v.sent, []);
  v.later(SETTLE_MS);
  await click(v.button('Replace', '.replace'));
  assert.deepStrictEqual(v.sent, [{ k: 'replace', ask: 'r1', how: 'replace' }]);
});

test('after Replace a note says she was, and it goes by itself', async () => {
  const timers: (() => void)[] = [];
  const v = await scripted({ buddies: [row('Olive')], replacing: [Q('r1', 'Olive')] }, { after: (_, f) => { timers.push(f); } });
  v.answers(c => c.k === 'replace' ? { ok: true, value: { id: 'olive', name: 'Olive', replaced: true } } : { ok: true });
  v.later(SETTLE_MS);
  await click(v.button('Replace', '.replace'));
  await v.set({ replacing: [] });
  assert.ok(!v.shown(v.one('.replace')), 'gone once answered');
  assert.deepStrictEqual(v.words('.note'), ['Olive was replaced.']);
  assert.strictEqual(v.one('.note')!.getAttribute('role'), 'status');
  for (const f of timers.splice(0)) f();
  assert.deepStrictEqual(v.words('.note'), []);
});

test('Keep both sends both, and the new one is brought to the keyboard', async () => {
  const v = await scripted({ buddies: [row('Olive'), row('Olive', 0, 'c2')], replacing: [Q('r1', 'Olive')] });
  v.answers(c => c.k === 'replace' ? { ok: true, value: { id: 'c2', name: 'Olive', replaced: false } } : { ok: true });
  v.later(SETTLE_MS);
  await click(v.button('Keep both', '.replace'));
  assert.deepStrictEqual(v.sent, [{ k: 'replace', ask: 'r1', how: 'both' }]);
  assert.ok(v.all('.st')[1]!.contains(document.activeElement), 'the new one has the keyboard');
  assert.deepStrictEqual(v.words('.note'), ['Kept both. The file is a new buddy.']);
});

test('closing it, or Escape, sends none, at once', async () => {
  const v = await scripted({ buddies: [row('Olive')], replacing: [Q('r1', 'Olive')] });
  await click(v.button('Close, and import nothing', '.replace'));
  await v.set({ replacing: [Q('r2', 'Olive')] });
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await tick();
  assert.deepStrictEqual(v.sent, [{ k: 'replace', ask: 'r1', how: 'none' }, { k: 'replace', ask: 'r2', how: 'none' }]);
});

test('her name heads it, and what the file calls her shows only when it differs', async () => {
  const v = await scripted({ buddies: [row('Olive')], replacing: [Q('r1', 'Olive', { called: 'Olive Two', file: 'olive-v2.buddy' })] });
  assert.deepStrictEqual(v.words('.replace b'), ['Replace Olive with this file?']);
  assert.deepStrictEqual(v.words('.replace span'), ['From olive-v2.buddy. It calls her Olive Two. Keep both adds it as a new buddy.']);
});

test('several: one at a time, oldest first, saying how many more', async () => {
  const v = await scripted({ buddies: [row('Ada'), row('Bea')], replacing: [Q('r1', 'Ada'), Q('r2', 'Bea'), Q('r3', 'Ada', { file: 'other.buddy' })] });
  assert.deepStrictEqual(v.words('.replace b'), ['Replace Ada with this file?']);
  assert.deepStrictEqual(v.words('.replace small'), [' 2 more after this.']);
  await v.set({ replacing: [Q('r2', 'Bea'), Q('r3', 'Ada', { file: 'other.buddy' })] });
  assert.deepStrictEqual(v.words('.replace b'), ['Replace Bea with this file?']);
  same(document.activeElement, v.button('Replace', '.replace'));
});

test('a question that comes while someone types in Find leaves the keyboard there', async () => {
  const many = Array.from({ length: FIND_FROM }, (_, i) => row(`B${i}`));
  const v = await scripted({ buddies: many });
  const input = v.one<HTMLInputElement>('.search input')!;
  input.focus();
  await v.set({ replacing: [Q('r1', 'B1')] });
  same(document.activeElement, input);
  assert.ok(v.shown(v.one('.replace')));
});

test('names from a file are only ever text', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const v = await scripted({ buddies: [row('Olive')], replacing: [Q('r1', evil, { called: `<b>${evil}</b>`, file: `${evil}.buddy` })] });
  assert.strictEqual(v.all('.replace img').length + v.all('.replace p b b').length, 0);
  assert.strictEqual(v.one('.replace b')!.textContent, `Replace ${evil} with this file?`);
});

test('a file she already is says so in a note, and asks nothing', async () => {
  const v = await scripted({ buddies: [row('Olive')] });
  v.answers(c => c.k === 'import' ? { ok: true, value: { id: 'olive', name: 'Olive', replaced: false, upToDate: true } } : { ok: true });
  const input = v.one<HTMLInputElement>('input[data-pick=file]')!;
  Object.defineProperty(input, 'files', { value: [new File(['{}'], 'olive.buddy')], configurable: true });
  input.dispatchEvent(new Event('change'));
  await tick();
  assert.deepStrictEqual(v.words('.note'), ['Olive is already up to date.']);
  assert.ok(!v.shown(v.one('.replace')));
});

test('the real hub: a picked file for her asks, and Replace replaces her', async () => {
  const r = await realPip();
  await pickReplacing(r, ['a', 'b']);
  assert.strictEqual(r.onDisk(), 1, 'asking changed nothing');
  await click(r.v.button('Replace', '.replace'));
  await r.settle();
  assert.strictEqual(r.onDisk(), 2);
  assert.ok(!r.v.shown(r.v.one('.replace')));
  assert.deepStrictEqual(r.v.words('.note'), ['Pip was replaced.']);
});

test('the real hub: a picked file for her, closed, imports nothing', async () => {
  const r = await realPip();
  await pickReplacing(r, ['a', 'b']);
  await click(r.v.button('Close, and import nothing', '.replace'));
  await r.settle();
  assert.strictEqual(r.onDisk(), 1);
  assert.ok(!r.v.shown(r.v.one('.replace')));
  assert.deepStrictEqual(r.v.words('.st b'), ['Pip']);
});

/* review 1 */

test('a new file waiting behind leaves the keyboard on the button it was on', async () => {
  const v = await scripted({ buddies: [row('Olive'), row('Bea')], replacing: [Q('r1', 'Olive')] });
  v.later(SETTLE_MS);
  const keep = v.button('Keep both', '.replace');
  keep.focus();
  await v.set({ replacing: [Q('r1', 'Olive'), Q('r2', 'Bea')] });
  assert.strictEqual(document.activeElement?.textContent, 'Keep both');
  assert.deepStrictEqual(v.words('.replace small'), [' 1 more after this.']);
});

const key = (type: 'keydown' | 'keyup', k = 'Enter', repeat = false) => document.activeElement!.dispatchEvent(new KeyboardEvent(type, { key: k, repeat, bubbles: true }));

test('a held key answers nothing: its repeats don\'t count', async () => {
  const v = await scripted({ buddies: [row('Olive')], replacing: [Q('r1', 'Olive')] });
  v.later(SETTLE_MS);
  key('keydown', 'Enter', true);
  await click(v.button('Replace', '.replace'));
  assert.deepStrictEqual(v.sent, []);
});

test('a key pressed before the question showed answers nothing, even held past the wait, and a fresh press does', async () => {
  const v = await scripted({ buddies: [row('Olive')] });
  v.one('.st .btn')!.focus();
  key('keydown');
  await v.set({ replacing: [Q('r1', 'Olive')] });
  v.later(SETTLE_MS);
  key('keydown', 'Enter', true);
  await click(v.button('Replace', '.replace'));
  key('keyup');
  await new Promise(r => setTimeout(r, 5));
  assert.deepStrictEqual(v.sent, []);
  key('keydown');
  await click(v.button('Replace', '.replace'));
  assert.deepStrictEqual(v.sent, [{ k: 'replace', ask: 'r1', how: 'replace' }]);
});

test('her name changing under the question keeps the keyboard where it was, and it waits again', async () => {
  const v = await scripted({ buddies: [row('Olive')], replacing: [Q('r1', 'Olive')] });
  v.later(SETTLE_MS);
  v.button('Keep both', '.replace').focus();
  await v.set({ replacing: [Q('r1', 'Olive', { name: 'Olive Renamed' })] });
  assert.deepStrictEqual(v.words('.replace b'), ['Replace Olive Renamed with this file?']);
  assert.strictEqual(document.activeElement?.textContent, 'Keep both');
  await click(v.button('Keep both', '.replace'));
  assert.deepStrictEqual(v.sent, [], 'new words, so a moment before it can be answered');
});

/* review 2 */

const mouse = (b: HTMLElement) => { b.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true })); return tick(); };

test('a key left down elsewhere never blocks the mouse: a pointer click only waits the moment', async () => {
  const v = await scripted({ buddies: [row('Olive')], replacing: [Q('r1', 'Olive')] });
  key('keydown', 'Enter', true); /* its keyup went to another window */
  await mouse(v.button('Replace', '.replace'));
  assert.deepStrictEqual(v.sent, [], 'too soon');
  v.later(SETTLE_MS);
  await mouse(v.button('Replace', '.replace'));
  assert.deepStrictEqual(v.sent, [{ k: 'replace', ask: 'r1', how: 'replace' }]);
});

for (const away of ['blur', 'visibilitychange'] as const) {
  test(`a press is forgotten on ${away}, so its lost keyup doesn't block the keyboard either`, async () => {
    const v = await scripted({ buddies: [row('Olive')], replacing: [Q('r1', 'Olive')] });
    v.later(SETTLE_MS);
    key('keydown', 'Enter', true);
    (away === 'blur' ? window : document).dispatchEvent(new Event(away));
    await click(v.button('Replace', '.replace'));
    assert.deepStrictEqual(v.sent, [{ k: 'replace', ask: 'r1', how: 'replace' }]);
  });
}
