// @vitest-environment happy-dom
/* The right-click menu's page, on a page that isn't a browser: what it offers, what it asks the hub
   for, and when. The page never shows or hides its own window: it asks the hub, which does each
   thing in its turn. tests/browser/run.mjs does the keyboard in a real browser. */
import assert, { gone, same } from '@buddies/test-support/dom-assert';
import { beforeEach, test } from 'vitest';
import { MARGIN, mountMenu } from '../src/buddy-menu-view';
import type { BuddyRow, Command, Said } from '../src/manager-api';
import { buddyItems } from '../src/manager/menu';
import { createBus } from '../src/wire';

const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r)); };
const row = (name: string, copies = 1, can: BuddyRow['can'] = ['eat', 'chase'], id = name.toLowerCase()): BuddyRow => ({ id, name, image: `library/${id}/base.png`, status: copies ? 'out' : 'home', copies, can, rev: 7 });
/* this page's window */
const ME = 'buddy-menu-41';
const eq: (a: unknown, b: unknown, why?: string) => void = (a, b, why) => assert.deepStrictEqual(a, b, why);

function mount(theme?: string) {
  document.documentElement.removeAttribute('data-theme');
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const bus = createBus<Said>(), hub = bus.wire(), heard: Said[] = [];
  hub.listen(m => heard.push(m));
  let clock = 5000, keyboard = false;
  const menu = mountMenu(root, {
    wire: bus.wire(),
    label: ME,
    store: () => ({ getItem: k => k === 'theme' && theme ? theme : null, setItem: () => {} }),
    stamp: () => clock,
    focused: () => keyboard
  });
  let n = 0;
  const show = async (b: BuddyRow, maker = true, max = { w: 1920, h: 1040 }) => { hub.post({ k: 'menu-show', label: ME, n: ++n, row: b, maker, max }); await tick(); return n; };
  const buttons = () => [...root.querySelectorAll('button')];
  const words = () => buttons().map(b => b.textContent);
  const button = (w: string) => { const b = buttons().find(x => x.textContent === w); assert.ok(b, `a button ${w}: ${words()}`); return b; };
  const of = <K extends Said['k']>(k: K) => heard.filter((m): m is Extract<Said, { k: K }> => m.k === k);
  const chosen = () => of('menu-choose').map(m => [m.n, m.cmd] as [number, Command]);
  const closed = () => of('menu-closed').map(m => [m.n, m.why]);
  const key = async (k: string) => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); await tick(); };
  return { root, hub, heard, menu, of, show, buttons, words, button, key, chosen, closed, later: (ms: number) => { clock += ms; }, keyboard: (on: boolean) => { keyboard = on; } };
}

beforeEach(() => { document.body.replaceChildren(); });

test('the page says it\'s up, and again when the hub asks', async () => {
  const v = mount();
  await tick();
  eq(v.of('menu-up').length, 1);
  v.hub.post({ k: 'menu-ping', label: ME }); await tick();
  eq(v.of('menu-up').map(m => m.label), [ME, ME], 'signed with its label');
  v.hub.post({ k: 'menu-ping', label: 'buddy-menu-40' }); await tick();
  eq(v.of('menu-up').length, 2, 'another window\'s ping is not for it');
});

test('her menu: what she does on the desktop, then her file, from the Manager\'s own list', async () => {
  const v = mount();
  const n = await v.show(row('Ada', 1));
  eq(v.words(), ['Give a treat', 'Chase my mouse', 'Call another', 'Dismiss', 'Edit', 'Export to a file', 'Delete']);
  eq(v.root.querySelectorAll('[role="separator"]').length, 1);
  eq(v.root.querySelector('[role="menu"]')!.getAttribute('aria-label'), 'Ada');
  const r = v.of('menu-ready');
  eq(r.map(m => m.n), [n]);
  assert.ok(r[0]!.w >= 2 * MARGIN && r[0]!.h >= 2 * MARGIN, JSON.stringify(r[0]));
});

test('a menu shown in another window is not drawn here, and what it says is signed', async () => {
  const v = mount();
  v.hub.post({ k: 'menu-show', label: 'buddy-menu-40', n: 9, row: row('Ada'), maker: true, max: { w: 1920, h: 1040 } }); await tick();
  eq([v.words().length, v.of('menu-ready').length], [0, 0]);
  const n = await v.show(row('Ada'));
  v.button('Dismiss').click(); await tick();
  eq(v.of('menu-ready').map(m => m.label), [ME]);
  eq(v.of('menu-choose').map(m => [m.n, m.label]), [[n, ME]]);
});

test('a name is only ever text', async () => {
  const v = mount();
  await v.show(row('<img src=x onerror=alert(1)>', 1));
  gone(v.root.querySelector('img'));
  eq(v.root.querySelector('[role="menu"]')!.getAttribute('aria-label'), '<img src=x onerror=alert(1)>');
});

test('the first item has the focus as soon as it\'s drawn, whenever the window\'s own focus came', async () => {
  const v = mount();
  /* the window took the foreground as it was made, before there was anything to draw */
  window.dispatchEvent(new Event('focus'));
  await v.show(row('Ada'));
  same(document.activeElement, v.button('Give a treat'));
  await v.key('ArrowDown');
  same(document.activeElement, v.button('Chase my mouse'));
});

test('when the window takes the focus, the first item has it, and the hub hears when', async () => {
  const v = mount();
  const n = await v.show(row('Ada'));
  v.button('Edit').focus();
  v.later(25);
  window.dispatchEvent(new Event('focus')); await tick();
  same(document.activeElement, v.button('Give a treat'));
  eq(v.of('menu-focused').map(m => [m.n, m.t]), [[n, 5025]]);
});

test('asked whether it has the keyboard, it says so if it does, and otherwise when it comes', async () => {
  const v = mount();
  const n = await v.show(row('Ada'));
  v.hub.post({ k: 'menu-check', label: ME, n }); await tick();
  eq(v.of('menu-focused').length, 0, 'not yet');
  window.dispatchEvent(new Event('focus')); await tick();
  eq(v.of('menu-focused').map(m => m.n), [n]);
  const m = await v.show(row('Ada'));
  v.keyboard(true);
  v.hub.post({ k: 'menu-check', label: ME, n: m - 1 }); await tick();
  eq(v.of('menu-focused').length, 1, 'not for an older showing');
  v.hub.post({ k: 'menu-check', label: 'buddy-menu-40', n: m }); await tick();
  eq(v.of('menu-focused').length, 1, 'not for another window');
  v.hub.post({ k: 'menu-check', label: ME, n: m }); await tick();
  eq(v.of('menu-focused').map(x => x.n), [n, m]);
  same(document.activeElement, v.button('Give a treat'));
});

test('a choice asks the hub to do it, once, for this showing, and asks for nothing else', async () => {
  const v = mount();
  const n = await v.show(row('Ada'));
  const b = v.button('Give a treat');
  b.click(); b.click(); await tick();
  eq(v.chosen(), [[n, { k: 'act', id: 'ada', action: 'eat' }]]);
  eq(v.closed(), [], 'choosing closes it: the hub hides it');
  /* each item reaches its own command */
  for (const [w, cmd] of [
    ['Chase my mouse', { k: 'act', id: 'ada', action: 'chase' }], ['Call another', { k: 'another', id: 'ada' }], ['Dismiss', { k: 'dismiss', id: 'ada' }],
    ['Edit', { k: 'maker', id: 'ada' }], ['Export to a file', { k: 'export', id: 'ada' }]
  ] as [string, Command][]) {
    const m = await v.show(row('Ada'));
    v.button(w).click(); await tick();
    eq(v.chosen().at(-1), [m, cmd]);
  }
});

test('copies: Bring here and Dismiss one join in', async () => {
  const v = mount();
  const n = await v.show(row('Ada', 3, []), false);
  eq(v.words(), ['Bring here', 'Call another', 'Dismiss one', 'Dismiss', 'Export to a file', 'Delete']);
  v.button('Dismiss one').click(); await tick();
  eq(v.chosen(), [[n, { k: 'dismiss-one', id: 'ada' }]]);
});

test('Esc asks the hub to close it, and a click after that asks for nothing', async () => {
  const v = mount();
  const n = await v.show(row('Ada'));
  await v.key('Escape');
  v.button('Call another').click(); await tick();
  eq(v.closed(), [[n, 'esc']]);
  eq(v.chosen(), []);
});

test('the arrow keys move along it, over the line', async () => {
  const v = mount();
  await v.show(row('Ada'));
  await v.key('ArrowUp');
  same(document.activeElement, v.button('Delete'));
  await v.key('ArrowDown');
  same(document.activeElement, v.button('Give a treat'));
  for (let i = 0; i < 4; i++) await v.key('ArrowDown');
  same(document.activeElement, v.button('Edit'));
});

test('a click anywhere else: the window loses the focus, and it asks to close, once', async () => {
  const v = mount();
  const n = await v.show(row('Ada'));
  window.dispatchEvent(new Event('blur')); await tick();
  window.dispatchEvent(new Event('blur')); await tick();
  eq(v.closed(), [[n, 'blur']]);
});

test('Alt+F4 asks to close it too', async () => {
  const v = mount();
  const n = await v.show(row('Ada'));
  v.menu.close('alt-f4'); await tick();
  eq(v.closed(), [[n, 'alt-f4']]);
});

test('once the hub has closed it, nothing more is asked', async () => {
  const v = mount();
  const n = await v.show(row('Ada'));
  v.hub.post({ k: 'menu-hide', n }); await tick();
  window.dispatchEvent(new Event('blur'));
  await v.key('Escape');
  v.button('Dismiss').click(); await tick();
  eq([v.closed().length, v.chosen().length], [0, 0]);
});

test('an older showing\'s close from the hub leaves the new one open', async () => {
  const v = mount();
  const first = await v.show(row('Ada'));
  const second = await v.show(row('Bo'));
  v.hub.post({ k: 'menu-hide', n: first }); await tick();
  await v.key('Escape');
  eq(v.closed(), [[second, 'esc']]);
});

test('before any menu, focus, blur and keys do nothing', async () => {
  const v = mount();
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('blur'));
  await v.key('Escape');
  eq([v.closed().length, v.of('menu-focused').length], [0, 0]);
});

test('the next buddy\'s menu replaces the last', async () => {
  const v = mount();
  await v.show(row('Ada', 1, ['eat']));
  await v.show(row('Bo', 1, []));
  eq(v.words(), ['Call another', 'Dismiss', 'Edit', 'Export to a file', 'Delete']);
  eq(v.root.querySelectorAll('[role="menu"]').length, 1);
});

test('Delete asks first, in the same window: Cancel has the focus, and the hub is told the new size', async () => {
  const v = mount();
  const n = await v.show(row('Ada'));
  v.button('Delete').click(); await tick();
  eq(v.chosen(), []);
  assert.ok(v.root.querySelector('[role="alertdialog"]'));
  same(document.activeElement, v.button('Cancel'));
  eq(v.of('menu-ready').map(m => m.n), [n, n]);
  v.button('Delete').click(); await tick();
  eq(v.chosen(), [[n, { k: 'delete', id: 'ada', rev: 7 }]]);
});

test('Cancel and Esc on the question close it with nothing deleted', async () => {
  const v = mount();
  const a = await v.show(row('Ada'));
  v.button('Delete').click(); await tick();
  v.button('Cancel').click(); await tick();
  const b = await v.show(row('Ada'));
  v.button('Delete').click(); await tick();
  await v.key('Escape');
  eq(v.chosen(), []);
  eq(v.closed(), [[a, 'cancel'], [b, 'esc']]);
});

test('a list too long for the work area scrolls inside the room there is', async () => {
  const v = mount();
  await v.show(row('Ada'), true, { w: 200, h: 120 });
  const m = v.root.querySelector<HTMLElement>('[role="menu"]')!;
  eq([m.style.maxHeight, m.style.maxWidth], [`${120 - 2 * MARGIN}px`, `${200 - 2 * MARGIN}px`]);
});

test('it follows the Manager\'s theme, read at each showing', async () => {
  const v = mount('light');
  await v.show(row('Ada'));
  eq(document.documentElement.dataset.theme, 'light');
  const d = mount();
  await d.show(row('Ada'));
  eq(document.documentElement.dataset.theme, 'dark');
});

test('the desktop list: Bring here only for other copies, and Dismiss, which the Manager has as a button', () => {
  const none = () => {}, acts = { bringHere: none, treat: none, chase: none, another: none, dismissOne: none, dismiss: none, edit: none, exportIt: none, remove: none };
  const words = (b: BuddyRow, maker = false) => buddyItems(b, maker, acts, 'desktop').map(i => i.words);
  eq(words(row('A', 1, [])), ['Call another', 'Dismiss', 'Export to a file', 'Delete']);
  eq(words(row('A', 2, ['eat']), true), ['Bring here', 'Give a treat', 'Call another', 'Dismiss one', 'Dismiss', 'Edit', 'Export to a file', 'Delete']);
  eq(buddyItems(row('A', 2), false, acts).map(i => i.words).includes('Dismiss'), false, 'the Manager\'s is as it was');
  eq(buddyItems(row('A', 1, []), false, acts, 'desktop').filter(i => i.rule).map(i => i.words), ['Export to a file']);
});
