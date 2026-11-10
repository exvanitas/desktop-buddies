// @vitest-environment happy-dom
/* The view on the real createMaker, on a page that isn't a browser: what each click reaches, and what
   each state offers. Art is fake and the clock is too. tests/browser/run.mjs does this in a real
   browser with real art. */
import { type PoseKey } from '@buddies/buddy-file';
import { LINES } from '@buddies/engine';
import { createMaker, memoryStore, type MakerBuddy, type MakerStore } from '@buddies/maker-core';
import assert, { gone, same } from '@buddies/test-support/dom-assert';
import { afterEach, test } from 'vitest';
import { createMakerView, everyoneSettings, type MakerViewHost, type MakerViewIO, type SaveState } from '../src';
import { createPopover } from '@buddies/peel/popover';
import { drawArt } from '../src/draw-art';

const BOX = { x0: .1, y0: .1, x1: .9, y1: 1 };
const REF = { ow: 300, oh: 300, w: 300, h: 300, cx: 150, by: 280, side: 280 };
const png = (n: string) => `data:image/png;base64,${n.replace(/[^a-z0-9]/gi, 'A')}`;
const frame = (n: string) => ({ src: png(n), bb: BOX });
const pose = (...n: string[]) => ({ frames: n.map(frame), fps: 6, scale: 1 });
const buddy = (more: Partial<MakerBuddy> = {}): MakerBuddy => ({ id: 'x', character: 'cabc', name: 'Ann', size: 120, faces: 'right', base: frame('base'), ref: REF, poses: {}, ...more });
const file = (name: string, type = 'image/png', text = '') => Object.assign(new File([text], name, { type }));
const tick = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r)); };

let destroy: (() => void) | null = null;
afterEach(() => { destroy?.(); destroy = null; document.body.replaceChildren(); });

function fakeClock() {
  const loops = new Map<number, { ms: number; f: () => void }>(); let next = 1;
  return {
    every(ms: number, f: () => void) { const id = next++; loops.set(id, { ms, f }); return () => { loops.delete(id); }; },
    fire() { for (const l of [...loops.values()]) l.f(); },
    get running() { return loops.size; },
    get ms() { return [...loops.values()][0]?.ms; }
  };
}
function memory() {
  const held = new Map<string, string>();
  return { held, store: () => ({ getItem: (k: string) => held.get(k) ?? null, setItem: (k: string, v: string) => { held.set(k, v); } }) };
}

interface Options { bottoms?: Record<string, number | null>; pets?: MakerBuddy[]; host?: Partial<MakerViewHost>; io?: Partial<MakerViewIO>; drop?: (keyof MakerViewHost)[]; start?: boolean; store?: MakerStore; mem?: ReturnType<typeof memory> }

async function mount(o: Options = {}) {
  const root = document.createElement('div'); document.body.append(root);
  const acts: [string, string][] = [], calls: unknown[][] = [], copied: string[] = [], toasts: string[] = [], clock = fakeClock(), mem = o.mem ?? memory();
  const later: (() => void)[] = [];
  const store = o.store ?? memoryStore({ pets: o.pets ?? [buddy()], started: true });
  const maker = createMaker({
    store, world: { sync() {}, act: (id, a) => { acts.push([id, a]); }, actAll: a => { acts.push(['*everyone*', a]); } },
    art: {
      processBase: async src => ({ frame: { src, bb: BOX }, ref: REF, photo: false }),
      processFrames: async srcs => ({ frames: srcs.map(src => ({ src, bb: BOX })), scale: 1 }),
      matchScale: async () => 1.5,
      bottomOf: async src => o.bottoms && src in o.bottoms ? o.bottoms[src]! : BOX.y1,
      fromShimeji: async list => ({ base: { src: list[0]!.src, bb: BOX }, ref: REF, poses: {}, faces: 'left', size: 100 }),
      natSort: (a, b) => a.localeCompare(b, undefined, { numeric: true })
    },
    samples: { build: async kind => ({ name: kind, base: frame(kind), ref: REF, poses: {}, faces: 'right', size: 120 }), thumb: kind => png(kind) },
    readImage: async f => f && /^image\//.test(f.type) ? png(f.name) : null,
    exportPage: () => { calls.push(['deps.exportPage']); },
    toast: m => { toasts.push(m); },
    after: (_ms, f) => { later.push(f); return later.length; }, cancel: () => {}, random: () => .5
  });
  let saveTo: (s: SaveState) => void = () => {}, toastTo: (m: string) => void = () => {}, unsub = 0;
  const host: MakerViewHost = {
    window: { minimize() { calls.push(['minimize']); }, close() { calls.push(['close']); } },
    onSave(f) { saveTo = f; return () => { unsub++; }; },
    onToast(f) { toastTo = f; return () => { unsub++; }; },
    tryOnScreen(id, a) { calls.push(['tryOnScreen', id, a]); },
    saveBuddyFile(id) { calls.push(['saveBuddyFile', id]); },
    exportPage() { calls.push(['exportPage']); },
    ...o.host
  };
  for (const k of o.drop || []) delete host[k];
  const io: Partial<MakerViewIO> = { store: mem.store, moves: () => false, copy: async t => { copied.push(t); }, every: clock.every, after: () => () => {}, ...o.io };
  const view = createMakerView(root, maker, host, io);
  destroy = () => view.destroy();
  if (o.start !== false) await maker.start();
  const shown = (e: Element | null) => { for (let n = e; n; n = n.parentElement) if ((n as HTMLElement).hidden) return false; return !!e; };
  const q = <E extends Element = HTMLElement>(s: string) => document.querySelector<E>(s);
  const all = <E extends Element = HTMLElement>(s: string) => [...document.querySelectorAll<E>(s)].filter(shown);
  const words = (s: string) => all(s).map(e => e.textContent);
  const click = (s: string) => { const e = q(s); assert.ok(e, `nothing at ${s}`); assert.ok(shown(e), `${s} is hidden`); e.click(); };
  const named = (n: string, within = 'body') => all<HTMLButtonElement>(`${within} button`).find(b => b.textContent === n || b.getAttribute('aria-label') === n);
  const press = (n: string, within = 'body') => { const b = named(n, within); assert.ok(b, `no button called ${n}`); assert.ok(!b.disabled, `${n} is disabled`); b.click(); };
  const fill = (s: string, v: string) => { const e = q<HTMLInputElement>(s)!; assert.ok(e, `nothing at ${s}`); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
  const type = (v: string) => fill('.tray .field', v);
  const choose = async (kind: string, ...files: File[]) => {
    const i = q<HTMLInputElement>(`input[data-pick=${kind}]`)!;
    Object.defineProperty(i, 'files', { value: files, configurable: true });
    i.dispatchEvent(new Event('change'));
    await tick();
  };
  const sheet = (n: number | string) => click(`.spine [data-s="${n}"]`);
  const pickPose = (k: PoseKey) => { const e = q(`.nm[data-art="${k}"], .spare button[data-art="${k}"]`); assert.ok(e, `no pose ${k} here`); e.click(); };
  return { root, maker, acts, calls, copied, toasts, clock, mem, later, q, all, words, click, named, press, fill, type, choose, sheet, pickPose, shown,
    save: (s: SaveState) => saveTo(s), hostToast: (m: string) => toastTo(m), pet: () => maker.current()!, get unsub() { return unsub; }, view, store };
}

const olive = () => buddy({ poses: { stand: pose('s1', 's2', 's3'), walk: pose('w1', 'w2'), wave: pose('w'), dance: pose('d1', 'd2'), dragL: pose('g', 's'), stand_up: pose('u1', 'u2', 'u3') }, lines: { hello: ['Yo!'] } });

test('before the Maker has started there is only a word, and nothing throws', async () => {
  const v = await mount({ start: false });
  assert.ok(v.shown(v.q('.first.waiting')));
  assert.ok(!v.shown(v.q('.mk')));
  assert.strictEqual(v.q('.win')!.dataset.ready, 'false');
  await v.maker.start();
  assert.ok(!v.shown(v.q('.first.waiting')));
  assert.ok(v.shown(v.q('.mk')));
  assert.strictEqual(v.q('.win')!.dataset.ready, 'true');
});

test('it opens on Everything, with the whole buddy on one page', async () => {
  const v = await mount({ pets: [olive()] });
  assert.strictEqual(v.q('.board h2')!.textContent, 'Everything');
  assert.strictEqual(v.q('.spine .on')!.dataset.s, 'all');
  assert.strictEqual(v.q('.spine .on')!.getAttribute('aria-current'), 'page');
  assert.deepStrictEqual(v.words('.blk .h').slice(0, 2), ['Hanging around', 'Picked up']);
  assert.strictEqual(v.q('.nm.sel')!.textContent, 'Stand');
  assert.ok(v.words('.c small').some(t => t === '3 frames'));
  assert.ok(v.words('.c small').some(t => t === 'Main image'));
  assert.ok(v.words('.spare button').includes('Stare'));
  gone(v.q('.resume'));
});

test('the title says who it is and offers the ways out', async () => {
  const v = await mount();
  assert.strictEqual(v.q('.who h1')!.textContent, 'Ann');
  v.press('Save buddy file');
  v.press('Export desktop page');
  assert.deepStrictEqual(v.calls, [['saveBuddyFile', v.pet().id], ['exportPage']]);
});

test('with host pieces absent, what needs them is gone and the rest works', async () => {
  const v = await mount({ drop: ['window', 'tryOnScreen', 'exportPage', 'onToast'] });
  gone(v.q('.wc'));
  gone(v.q('[data-screen]'));
  gone(v.q('[data-export]'));
  assert.ok(!v.q('.bar')!.hasAttribute('data-tauri-drag-region'));
  v.press('Save buddy file');
  assert.strictEqual(v.calls.length, 1);
});

test('the window buttons reach the host, and the bar drags', async () => {
  const v = await mount();
  v.press('Minimize'); v.press('Close');
  assert.deepStrictEqual(v.calls, [['minimize'], ['close']]);
  for (const s of ['.bar', '.bar .grow']) assert.ok(v.q(s)!.hasAttribute('data-tauri-drag-region'), s);
});

test('nothing in the default window deletes a buddy, or looks like it', async () => {
  const v = await mount({ pets: [olive(), buddy({ id: 'y', name: 'Bo' })] });
  v.click('[data-who]');
  for (const page of ['all', 'look', 'kit']) { v.sheet(page); assert.ok(!v.all('button').some(b => /delete|remove (this )?buddy/i.test(b.textContent || '')), page); }
  gone(v.q('[data-remove]'));
});

test('the headings on Everything and All words open their sheets', async () => {
  const v = await mount({ pets: [olive()] });
  v.press('Feelings', '.stick.all');
  assert.strictEqual(v.q('.board h2')!.textContent, 'Feelings');
  v.sheet('words');
  v.press('Off for a run', '.allw');
  assert.strictEqual(v.q('.board h2')!.textContent, 'Off for a run');
});

test('slots on one picture read as one sticker, and own art as its own', async () => {
  const v = await mount({ pets: [olive()] });
  assert.ok(v.q('.c.multi[data-keys="dragL"]') === null);
  assert.ok(v.q('.c:not(.multi)[data-keys="stand"]'));
  v.view.destroy();
  const w = await mount();
  assert.ok(w.q('.c.multi[data-keys="stand walk"]'));
});

test('a sticker\'s size follows its scale without a redraw', async () => {
  const v = await mount({ pets: [olive()] });
  const img = () => v.q<HTMLImageElement>('.c[data-keys="stand"] .art img')!, before = img().style.width, same_ = img();
  v.fill('[data-k="Scale"]', '60');
  assert.notStrictEqual(img().style.width, before);
  same(img(), same_);
});

test('each thing that\'s picked is marked, and only that', async () => {
  const v = await mount({ pets: [buddy({ poses: { wave: pose('w') }, lines: { hello: ['a', 'b'], greet: ['c'] } })] });
  v.sheet(9);
  assert.deepStrictEqual(v.words('.says .say.on'), ['c']);
  assert.deepStrictEqual(v.all('.sit.on').map(g => g.dataset.g), ['greet']);
  gone(v.q('.ref.on'));
  v.click('.ref[data-art~="wave"]');
  assert.ok(v.q('.ref.on[data-art~="wave"]'));
  assert.strictEqual(v.all('.ref.on').length, 1);
  gone(v.q('.says .say.on'));
  gone(v.q('.sit.on'));
  v.sheet(4);
  v.click('.says .say[data-sit="hello"][data-i="1"]');
  assert.deepStrictEqual(v.words('.says .say.on'), ['b']);
  v.click('.says .say[data-sit="hello"][data-i="0"]');
  assert.deepStrictEqual(v.words('.says .say.on'), ['a']);
});

test('a reference to the main image says so, and names each thing once', async () => {
  const v = await mount();
  v.sheet(9);
  assert.strictEqual(v.all('.ref').length, 1);
  assert.strictEqual(v.q('.ref b')!.textContent, 'Main image');
  assert.strictEqual(v.q('.ref small')!.textContent, 'Wave, Happy, Walk');
});

test('with no name, it still reads', async () => {
  const v = await mount({ pets: [buddy({ name: '' })] });
  v.sheet(1);
  assert.strictEqual(v.q('.strip > h3')!.textContent, 'What this buddy says');
  assert.strictEqual(v.q('.who h1')!.textContent, 'No name');
});

test('the backing says which is which', async () => {
  const v = await mount();
  assert.strictEqual(v.q('[data-b="light"]')!.textContent, 'Light');
});

test('at the file\'s limit, a situation offers no more lines', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: Array.from({ length: 64 }, (_, i) => `l${i}`), love: Array.from({ length: 63 }, (_, i) => `l${i}`) } })] });
  v.sheet(4);
  gone(v.q('.say[data-add="hello"]'));
  assert.ok(v.q('.say[data-add="love"]'));
  v.click('.says .say[data-sit="hello"][data-i="0"]');
  gone(v.q('[data-add-line]'));
  v.q('.field')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.strictEqual(v.q('.field')!.getAttribute('aria-label'), 'When you click it: line 1');
});

test('a frame past the end shows the last, and showing none does nothing', async () => {
  const a = drawArt({ kind: 'own', from: 'walk', frames: [frame('a'), frame('b')], fps: 6, scale: 1, bb: BOX, turn: 0 }, 9);
  assert.strictEqual(a.img.getAttribute('src'), png('b'));
  assert.strictEqual(a.img.getAttribute('draggable'), 'false');
  a.show(0);
  assert.strictEqual(a.img.getAttribute('src'), png('a'));
  a.show(9);
  assert.strictEqual(a.img.getAttribute('src'), png('a'));
});

test('a click on art picks it and the tray edits it. Nothing performs', async () => {
  const v = await mount({ pets: [olive()] });
  v.pickPose('walk');
  assert.strictEqual(v.q('.tray h3')!.textContent, 'Walk');
  assert.strictEqual(v.q('.nm.sel')!.textContent, 'Walk');
  assert.strictEqual(v.acts.length, 0);
  assert.strictEqual(v.maker.openPose, 'walk');
});

test('a picked pose with no art of its own says what\'s really happening', async () => {
  const v = await mount({ pets: [olive()] });
  v.pickPose('sit');
  assert.match(v.q('.note')!.textContent!, /Works already, using Stand/);
  gone(v.q('[data-play]'));
  gone(v.q('[data-clear]'));
  assert.ok(v.q('.fs.empty'));
  v.pickPose('dangle_legs');
  assert.match(v.q('.note')!.textContent!, /Not in the game yet/);
  assert.match(v.q('.uf')!.textContent!, /Nothing says lines over this yet/);
  v.pickPose('stare');
  assert.match(v.q('.note')!.textContent!, /Add art and it will/);
  assert.match(v.q('.uf')!.textContent!, /No lines use this art/);
  v.pickPose('tired');
  assert.match(v.q('.note')!.textContent!, /Add art and it will/);
});

test('a long note opens whole', async () => {
  const v = await mount({ pets: [buddy({ poses: { climb: pose('c') } })] });
  v.pickPose('climb');
  v.click('.note');
  assert.match(v.q('.note-all')!.textContent!, /hands reaching forward onto the wall/);
  v.click('.note');
  gone(v.q('.note-all'));
});

test('art lists the words that use it, and a long list opens whole', async () => {
  const v = await mount();
  v.pickPose('stand');
  assert.deepStrictEqual(v.words('.uf .lk'), ['Getting back up', 'Woken from a nap', 'and 2 more']);
  v.click('[data-more-uses]');
  assert.deepStrictEqual(v.words('.uses-all .pick'), ['Getting back up', 'Woken from a nap', 'Finished eating', 'Rolling along']);
  v.press('Rolling along', '.uses-all');
  assert.strictEqual(v.q('.tray h3')!.textContent, 'Rolling along');
  assert.strictEqual(v.q('.board h2')!.textContent, 'Just for fun');
});

test('a word opens its words, and its art stays where it is until asked', async () => {
  const v = await mount({ pets: [olive()] });
  v.sheet(4);
  v.click('.say[data-sit="hello"][data-i="0"]');
  assert.strictEqual(v.q('.tray h3')!.textContent, 'When you click it');
  assert.strictEqual(v.q('.field')!.getAttribute('aria-label'), 'When you click it: line 1');
  assert.strictEqual(v.q<HTMLTextAreaElement>('.field')!.value, 'Yo!');
  assert.ok(v.q('.c.linked[data-keys~="wave"]'), 'the dotted line is on its art');
  assert.ok(!v.q('.c.on'), 'the art itself isn\'t picked');
  assert.strictEqual(v.q('.sit.on')!.dataset.g, 'hello');
  assert.strictEqual(v.acts.length, 0);
  assert.match(v.q('.knobs small')!.textContent!, /Shared: 2 other situations use Wave/);
  v.press('Edit Wave art');
  assert.strictEqual(v.q('.tray h3')!.textContent, 'Wave / greet');
  assert.ok(v.q('.c.on[data-keys~="wave"]'));
});

test('a word with art nobody drew says Add, and with no art there\'s nothing to edit', async () => {
  const v = await mount();
  v.sheet(4);
  v.click('.say[data-sit="shy"]');
  assert.ok(v.named('Add Shy art'));
  v.sheet(1);
  v.click('.say[data-sit="chat"]');
  assert.match(v.q('.knobs small')!.textContent!, /no art to edit/);
  gone(v.q('[data-edit-art]'));
});

test('a word picked elsewhere opens on its own sheet, and All words stays put', async () => {
  const v = await mount();
  v.sheet('words');
  assert.strictEqual(v.q('.sit.on')!.dataset.g, 'chat');
  v.click('.say[data-sit="hello"]');
  assert.strictEqual(v.q('.board h2')!.textContent, 'All words');
  v.sheet('all');
  assert.ok(v.q('.nm.sel'));
  v.pickPose('stand');
  v.click('[data-more-uses]');
  v.press('Finished eating', '.uses-all');
  assert.strictEqual(v.q('.spine .on')!.dataset.s, '8');
});

test('typing a line updates it everywhere, and the first change makes the list its own', async () => {
  const v = await mount();
  v.sheet(4);
  v.click('.say[data-sit="hello"][data-i="1"]');
  assert.match(v.q('.src')!.textContent!, /Default lines, until you change one/);
  v.type('Hello there');
  assert.deepStrictEqual(v.pet().lines!.hello, [LINES.hello[0], 'Hello there', ...LINES.hello.slice(2)]);
  assert.strictEqual(v.q('.says .say[data-sit="hello"][data-i="1"]')!.textContent, 'Hello there');
  assert.strictEqual(v.q('.pv')!.textContent, 'Hello there');
  assert.match(v.q('.src')!.textContent!, /Own lines/);
  assert.strictEqual(v.q('.c[data-keys~="wave"] .bub')!.textContent, 'Hello there');
});

test('only a short line rides on the sticker', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['Hi'] } })] });
  v.sheet(4);
  v.click('.say[data-sit="hello"]');
  const bub = () => v.q('.c[data-keys~="wave"] .bub')!;
  v.type('x'.repeat(26));
  assert.strictEqual(bub().hidden, false);
  assert.ok(bub().classList.contains('now'));
  v.type('x'.repeat(27));
  assert.ok(bub().hidden || !bub().classList.contains('now'));
  assert.notStrictEqual(bub().textContent, 'x'.repeat(27));
});

test('the writer counts down near the limit and the field holds to it', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['Hi'] } })] });
  v.sheet(4);
  v.click('.say[data-sit="hello"]');
  assert.strictEqual(v.q('.field')!.getAttribute('maxlength'), '300');
  assert.strictEqual(v.q('.count')!.textContent, '');
  v.type('x'.repeat(280));
  assert.strictEqual(v.q('.count')!.textContent, '20 left');
});

test('Add a line opens a new line that doesn\'t exist until something is typed', async () => {
  const v = await mount();
  v.sheet(4);
  v.click('.say[data-add="hello"]');
  assert.strictEqual(v.pet().lines, undefined);
  assert.strictEqual(v.q<HTMLTextAreaElement>('.field')!.value, '');
  assert.ok(v.q('.say.draft[data-sit="hello"]'));
  same(document.activeElement, v.q('.field'));
  assert.match(v.q('.tape header span')!.textContent!, new RegExp(`Line ${LINES.hello.length + 1} of ${LINES.hello.length + 1}`));
  v.click('.say[data-sit="love"][data-i="0"]');
  assert.strictEqual(v.pet().lines, undefined);
  gone(v.q('.say.draft'));
});

test('a typed new line joins the list', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['a'] } })] });
  v.sheet(4);
  v.click('.say[data-sit="hello"]');
  v.press('Add a line', '.knobs');
  v.type('b');
  assert.deepStrictEqual(v.pet().lines!.hello, ['a', 'b']);
  gone(v.q('.say.draft'));
  assert.strictEqual(v.q('.says .say[data-sit="hello"][data-i="1"]')!.textContent, 'b');
  v.type('bb');
  assert.deepStrictEqual(v.pet().lines!.hello, ['a', 'bb']);
  assert.strictEqual(v.q('.says .say[data-sit="hello"][data-i="1"]')!.textContent, 'bb');
});

test('Enter writes the next line, and Shift+Enter stays in this one', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['a'] } })] });
  v.sheet(4);
  v.click('.say[data-sit="hello"]');
  const enter = (shiftKey = false) => { const e = new KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true, cancelable: true }); v.q('.field')!.dispatchEvent(e); return e; };
  assert.strictEqual(enter(true).defaultPrevented, false);
  assert.strictEqual(v.q('.field')!.getAttribute('aria-label'), 'When you click it: line 1');
  assert.strictEqual(enter().defaultPrevented, true);
  assert.strictEqual(v.q('.field')!.getAttribute('aria-label'), 'When you click it: line 2');
  /* nothing typed, so no third */
  enter();
  assert.strictEqual(v.q('.field')!.getAttribute('aria-label'), 'When you click it: line 2');
});

test('a line left blank is gone when the writer moves on', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['a', 'b'] } })] });
  v.sheet(4);
  v.click('.says .say[data-sit="hello"][data-i="1"]');
  v.type('');
  assert.deepStrictEqual(v.pet().lines!.hello, ['a', '']);
  assert.strictEqual(v.q('.says .say[data-sit="hello"][data-i="1"]')!.textContent, 'New line');
  v.click('.say[data-sit="love"][data-i="0"]');
  assert.deepStrictEqual(v.pet().lines!.hello, ['a']);
  gone(v.q('.says .say[data-sit="hello"][data-i="1"]'));
});

test('a blank line goes when another sheet opens too', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['a', 'b'] } })] });
  v.sheet(4);
  v.click('.says .say[data-sit="hello"][data-i="1"]');
  v.type('  ');
  v.sheet('all');
  assert.deepStrictEqual(v.pet().lines!.hello, ['a']);
});

test('Remove takes a line away, and the last one goes back to the defaults', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['a', 'b'] } })] });
  v.sheet(4);
  v.click('.says .say[data-sit="hello"][data-i="1"]');
  v.press('Remove');
  assert.deepStrictEqual(v.pet().lines!.hello, ['a']);
  assert.strictEqual(v.q('.field')!.getAttribute('aria-label'), 'When you click it: line 1');
  v.press('Remove');
  assert.strictEqual(v.pet().lines, undefined);
  assert.strictEqual(v.q<HTMLTextAreaElement>('.field')!.value, LINES.hello[0]);
  assert.match(v.q('.src')!.textContent!, /Default lines/);
  assert.strictEqual(v.all('.says .say[data-sit="hello"]').length, LINES.hello.length);
});

test('Remove on a new line just closes it', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['a'] } })] });
  v.sheet(4);
  v.click('.say[data-add="hello"]');
  v.press('Remove');
  assert.deepStrictEqual(v.pet().lines!.hello, ['a']);
  assert.strictEqual(v.q('.field')!.getAttribute('aria-label'), 'When you click it: line 1');
});

test('Use the defaults gives one situation back', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['a'], love: ['b'] } })] });
  v.sheet(4);
  v.click('.say[data-sit="hello"]');
  v.click('[data-restore]');
  assert.match(v.q('.confirm')!.textContent!, /Use the defaults\?/);
  assert.deepStrictEqual(v.pet().lines, { hello: ['a'], love: ['b'] });
  v.press('Use defaults', '.confirm');
  assert.deepStrictEqual(v.pet().lines, { love: ['b'] });
  assert.strictEqual(v.q<HTMLTextAreaElement>('.field')!.value, LINES.hello[0]);
  assert.strictEqual(v.q('.says .say[data-sit="hello"][data-i="0"]')!.textContent, LINES.hello[0]);
});

test('Say it performs in the tray and nowhere else', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['Yo'] } })] });
  v.sheet(4);
  v.click('.say[data-sit="hello"]');
  gone(v.q('.live > .say.said'));
  v.press('Say it');
  assert.ok(v.q('.live > .say.said'));
  assert.strictEqual(v.q('.pv')!.textContent, 'Yo');
  assert.strictEqual(v.acts.length, 0);
  v.click('.say[data-sit="hello"]');
  gone(v.q('.live > .say.said'));
});

test('words waiting for art say so, and still open', async () => {
  const v = await mount();
  v.sheet(8);
  assert.deepStrictEqual(v.words('.strip .waiting button'), ['Eating a snack', 'Finished eating', 'Starting to dance', 'Starting to sing']);
  gone(v.q('.sit[data-g="eat"]'));
  v.click('[data-wait="eat"]');
  assert.match(v.q('.sit[data-g="eat"] .cap')!.textContent!, /Saved, and said once Eat snack has art/);
  assert.match(v.q('.tray .cap')!.textContent!, /Saved, and said once Eat snack has art/);
  v.click('.say[data-sit="spin"]');
  gone(v.q('.sit[data-g="eat"]'));
});

test('a sheet with no art of its own shows references, marked as living elsewhere', async () => {
  const v = await mount({ pets: [olive()] });
  v.sheet(9);
  gone(v.q('.stick'));
  assert.strictEqual(v.q('.refs > span')!.textContent, 'Art these words use');
  const refs = v.words('.ref');
  assert.ok(refs.some(t => /Wave.*On Feelings/.test(t!)), String(refs));
  assert.strictEqual(v.q('.tray h3')!.textContent, 'Meeting a buddy');
  v.click('.ref[data-art~="wave"]');
  assert.strictEqual(v.q('.tray h3')!.textContent, 'Wave / greet');
});

test('picking a word marks its reference with the dotted line', async () => {
  const v = await mount({ pets: [olive()] });
  v.sheet(9);
  assert.ok(v.q('.ref.linked[data-art~="wave"]'));
  v.click('.say[data-sit="bump"]');
  assert.ok(v.q('.ref.linked[data-art~="walk"]'));
  gone(v.q('.ref.linked[data-art~="wave"]'));
});

test('How it goes draws the real sequence, and its links pick art', async () => {
  const v = await mount({ pets: [olive()] });
  v.sheet(5);
  assert.deepStrictEqual(v.words('.flow li'), ['Run can trip into Sprawled, then Up from a trip, or Stand up without it', 'Jump comes down to Landing bounce']);
  assert.ok(v.q('.stp[data-art="stand_up"] img'));
  assert.ok(v.q('.stp.no[data-art="sprawl"]') === null);
  v.click('.stp[data-art="jump"]');
  assert.strictEqual(v.q('.tray h3')!.textContent, 'Jump (going up)');
});

test('a sheet says what could be added', async () => {
  const v = await mount();
  v.sheet(1);
  assert.deepStrictEqual(v.words('.spare button'), ['Think', 'Stare', 'Face away', 'Tap the screen', 'Turn back']);
  v.click('.spare button[data-art="stare"]');
  assert.ok(v.q('.spare button.on[data-art="stare"]'));
});

test('the last sheet comes back as Back to, and is the buddy\'s own', async () => {
  const mem = memory();
  const a = await mount({ mem });
  a.sheet(4);
  a.sheet('all');
  assert.strictEqual(a.q('.resume')!.textContent, 'Back to Feelings');
  a.click('.resume');
  assert.strictEqual(a.q('.board h2')!.textContent, 'Feelings');
  a.view.destroy();
  const b = await mount({ mem });
  assert.strictEqual(b.q('.board h2')!.textContent, 'Everything');
  assert.strictEqual(b.q('.resume')!.textContent, 'Back to Feelings');
  b.view.destroy();
  const c = await mount({ mem, pets: [buddy({ id: 'z', character: 'cother' })] });
  gone(c.q('.resume'));
});

test('a sheet opens with its first art picked, or its first word if it has none', async () => {
  const v = await mount({ pets: [olive()] });
  v.sheet(2);
  assert.strictEqual(v.q('.tray h3')!.textContent, 'Held (still)');
  v.sheet(9);
  assert.strictEqual(v.q('.tray h3')!.textContent, 'Meeting a buddy');
});

test('Prompt kit and Look leave the pick alone, and All words needs a word', async () => {
  const v = await mount({ pets: [olive()] });
  v.pickPose('walk');
  v.sheet('kit');
  assert.strictEqual(v.q('.tray h3')!.textContent, 'Walk');
  v.sheet('look');
  assert.strictEqual(v.q('.tray h3')!.textContent, 'Walk');
  v.sheet('words');
  assert.strictEqual(v.q('.tray h3')!.textContent, 'While wandering');
  v.sheet('all');
  assert.strictEqual(v.q('.tray h3')!.textContent, 'Stand / idle');
});

test('the backing switches, and is remembered', async () => {
  const mem = memory();
  const v = await mount({ mem });
  assert.strictEqual(v.q('.mk')!.dataset.back, 'light');
  assert.strictEqual(v.q('[data-b="light"]')!.getAttribute('aria-pressed'), 'true');
  v.click('[data-b="dark"]');
  assert.strictEqual(v.q('.mk')!.dataset.back, 'dark');
  assert.strictEqual(v.q('[data-b="dark"]')!.getAttribute('aria-pressed'), 'true');
  v.view.destroy();
  const w = await mount({ mem });
  assert.strictEqual(w.q('.mk')!.dataset.back, 'dark');
});

test('the divider moves by the keys, stops at its ends, and each sheet keeps its own', async () => {
  const mem = memory();
  const v = await mount({ mem });
  v.sheet(1);
  const div = () => v.q('.perf')!, now = () => +div().getAttribute('aria-valuenow')!;
  const key = (k: string) => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }); div().dispatchEvent(e); return e; };
  assert.strictEqual(div().getAttribute('role'), 'separator');
  assert.strictEqual(div().getAttribute('tabindex'), '0');
  const first = now();
  assert.ok(key('ArrowRight').defaultPrevented);
  assert.strictEqual(now(), first + 4);
  key('ArrowLeft'); key('ArrowLeft');
  assert.strictEqual(now(), first - 4);
  key('ArrowUp');
  assert.strictEqual(now(), first);
  key('ArrowDown');
  assert.strictEqual(now(), first - 4);
  assert.strictEqual(key('Tab').defaultPrevented, false);
  key('Home');
  assert.strictEqual(now(), 28);
  assert.strictEqual(Math.round(parseFloat(v.q('.page')!.style.flexBasis)), 28);
  key('ArrowLeft');
  assert.strictEqual(now(), 28);
  key('End');
  assert.strictEqual(now(), 74);
  key('ArrowRight');
  assert.strictEqual(now(), 74);
  v.sheet(2);
  assert.notStrictEqual(now(), 74);
  v.sheet(1);
  assert.strictEqual(now(), 74);
  v.view.destroy();
  const w = await mount({ mem });
  w.sheet(1);
  assert.strictEqual(+w.q('.perf')!.getAttribute('aria-valuenow')!, 74);
});

test('the divider follows the pointer only while dragged', async () => {
  const v = await mount();
  v.sheet(1);
  const div = v.q('.perf')!, spread = v.q('.spread')!;
  spread.getBoundingClientRect = () => ({ left: 100, width: 1000 }) as DOMRect;
  const ev = (type: string, clientX: number) => { div.dispatchEvent(new PointerEvent(type, { clientX, bubbles: true, cancelable: true })); };
  ev('pointermove', 400);
  const before = div.getAttribute('aria-valuenow');
  assert.notStrictEqual(before, '30');
  ev('pointerdown', 400);
  ev('pointermove', 600);
  assert.strictEqual(div.getAttribute('aria-valuenow'), '50');
  ev('pointerup', 600);
  ev('pointermove', 700);
  assert.strictEqual(div.getAttribute('aria-valuenow'), '50');
});

test('frames go earlier and later, come off, and the strip says where it is', async () => {
  const v = await mount({ pets: [olive()] });
  const srcs = () => v.pet().poses.stand!.frames.map(f => f.src);
  const [a, b, c] = srcs();
  assert.strictEqual(v.q('.fs-bar b')!.textContent, 'Frame 1 of 3');
  assert.ok(v.named('Move earlier')!.disabled);
  v.press('Move later');
  assert.deepStrictEqual(srcs(), [b, a, c]);
  assert.strictEqual(v.q('.fs-bar b')!.textContent, 'Frame 2 of 3');
  v.press('Move later');
  assert.deepStrictEqual(srcs(), [b, c, a]);
  assert.ok(v.named('Move later')!.disabled);
  v.press('Move earlier');
  assert.deepStrictEqual(srcs(), [b, a, c]);
  v.click('[data-fi="0"]');
  assert.strictEqual(v.q('.fs-bar b')!.textContent, 'Frame 1 of 3');
  v.press('Remove frame');
  assert.deepStrictEqual(srcs(), [a, c]);
  assert.strictEqual(v.q('.fs-bar b')!.textContent, 'Frame 1 of 2');
  v.click('[data-fi="1"]');
  v.press('Remove frame');
  assert.deepStrictEqual(srcs(), [a]);
  assert.strictEqual(v.q('.fs-bar b')!.textContent, 'Frame 1 of 1');
  v.press('Remove frame');
  assert.strictEqual(v.pet().poses.stand, undefined);
  assert.ok(v.q('.fs.empty'));
});

test('the keyboard stays on the button it pressed', async () => {
  const v = await mount({ pets: [olive()] });
  v.named('Move later')!.focus();
  v.press('Move later');
  same(document.activeElement, v.named('Move later'));
  /* the last place: Later is disabled, so it lands somewhere that still works */
  v.press('Move later');
  same(document.activeElement, v.named('Add frames'));
});

test('over 12 frames, a slider jumps along the strip', async () => {
  const many = Array.from({ length: 13 }, (_, i) => `f${i}`);
  const v = await mount({ pets: [buddy({ poses: { walk: pose(...many), stand: pose(...many.slice(0, 12)) } })] });
  gone(v.q('.fs-go'));
  v.pickPose('walk');
  v.fill('.fs-go', '9');
  assert.strictEqual(v.q('.fs-bar b')!.textContent, 'Frame 9 of 13');
  assert.strictEqual(v.q('.fs-t.on')!.dataset.fi, '8');
});

test('at the file\'s limit, a pose offers no more frames', async () => {
  const v = await mount({ pets: [buddy({ poses: { walk: pose(...Array.from({ length: 120 }, (_, i) => `f${i}`)) } })] });
  v.pickPose('walk');
  gone(v.q('.fs-t.add'));
});

test('frames added land on the picked pose', async () => {
  const v = await mount({ pets: [olive()] });
  v.pickPose('sit');
  assert.ok(v.named('Add frames'));
  await v.choose('frames', file('b.png'), file('a.png'));
  assert.deepStrictEqual(v.pet().poses.sit!.frames.map(f => f.src), [png('a.png'), png('b.png')]);
  assert.strictEqual(v.q('.fs-bar b')!.textContent, 'Frame 1 of 2');
  assert.ok(v.q('.c[data-keys~="sit"] small')!.textContent!.startsWith('2 frames') === true);
});

test('speed and scale reach the Maker, and say so', async () => {
  const v = await mount({ pets: [olive()] });
  v.fill('[data-k="Speed"]', '12');
  assert.strictEqual(v.pet().poses.stand!.fps, 12);
  assert.strictEqual(v.q('.rng output')!.textContent, '12 fps');
  v.fill('[data-k="Scale"]', '150');
  assert.strictEqual(v.pet().poses.stand!.scale, 1.5);
  assert.strictEqual(v.all('.rng output')[1]!.textContent, '150%');
});

test('Lift is in the tray for a pose she stands on the floor in with her own art, once that art is measured', async () => {
  const v = await mount({ pets: [buddy({ poses: { ...olive().poses, climb: pose('c'), sit: pose('t') } })] });
  assert.strictEqual(v.q('[data-k="Lift"]'), null, 'not until it is measured');
  await tick();
  assert.ok(v.q('[data-k="Lift"]'), 'Stand');
  assert.strictEqual(v.all('.knobs .rng output')[2]!.textContent, '0 px');
  for (const [k, has] of [['walk', true], ['sit', true], ['stand_up', true], ['climb', false], ['dragL', false], ['cry', false]] as const) {
    v.pickPose(k); await tick();
    assert.strictEqual(!!v.q('[data-k="Lift"]'), has, k);
  }
});

test('Lift moves her art off the floor or into it, and says so', async () => {
  const v = await mount({ pets: [buddy({ poses: { sit: { frames: [{ src: png('t'), bb: { x0: .1, y0: .1, x1: .9, y1: .9 } }], fps: 6, scale: 1 } } })], bottoms: { [png('t')]: .9 } });
  v.pickPose('sit'); await tick();
  const lift = v.q<HTMLInputElement>('[data-k="Lift"]')!;
  assert.deepStrictEqual([lift.min, lift.max, lift.value], ['-60', '12', '0']);
  v.fill('[data-k="Lift"]', '6');
  assert.ok(Math.abs(v.pet().poses.sit!.frames[0]!.bb.y1 - .95) < 1e-9);
  assert.strictEqual(v.all('.knobs .rng output')[2]!.textContent, '+6 px');
  v.fill('[data-k="Lift"]', '-6');
  assert.ok(Math.abs(v.pet().poses.sit!.frames[0]!.bb.y1 - .85) < 1e-9);
  assert.strictEqual(v.all('.knobs .rng output')[2]!.textContent, '-6 px');
});

test('art that cannot be measured has no Lift', async () => {
  const v = await mount({ pets: [olive()], bottoms: { [png('s2')]: null } });
  await tick();
  assert.strictEqual(v.q('[data-k="Lift"]'), null);
  assert.ok(v.q('[data-k="Scale"]'));
});

test('the preview draws the floor under a pose she stands on, and nowhere else', async () => {
  const v = await mount({ pets: [buddy({ poses: { ...olive().poses, climb: pose('c') } })] });
  assert.ok(v.q('.tray .live .floor'), 'Stand');
  for (const [k, has] of [['walk', true], ['cry', true], ['climb', false], ['dragL', false], ['jump', false], ['crawl', false]] as const) {
    v.pickPose(k);
    assert.strictEqual(!!v.q('.tray .live .floor'), has, k);
  }
});

test('Clear pose asks first, and Cancel is the easy way out', async () => {
  const v = await mount({ pets: [olive()] });
  v.click('[data-clear]');
  assert.match(v.q('.confirm')!.textContent!, /Clear Stand\?3 frames will go/);
  same(document.activeElement, v.named('Cancel'));
  v.press('Cancel');
  gone(v.q('.confirm'));
  assert.ok(v.pet().poses.stand);
  v.click('[data-clear]');
  v.press('Clear', '.confirm');
  assert.strictEqual(v.pet().poses.stand, undefined);
  gone(v.q('.confirm'));
});

test('a loop runs when picked, at its real speed, and Pause and Play work it', async () => {
  const v = await mount({ pets: [olive()], io: { moves: () => true } });
  assert.strictEqual(v.clock.running, 1);
  assert.strictEqual(v.clock.ms, 1000 / 6);
  const img = () => v.q<HTMLImageElement>('.live .art img')!;
  assert.strictEqual(img().getAttribute('src'), png('s1'));
  v.clock.fire();
  assert.strictEqual(img().getAttribute('src'), png('s2'));
  assert.strictEqual(v.q('[data-play]')!.textContent, 'Pause');
  v.click('[data-play]');
  assert.strictEqual(v.clock.running, 0);
  assert.strictEqual(v.q('[data-play]')!.textContent, 'Play');
  v.click('[data-play]');
  assert.strictEqual(v.clock.running, 1);
  assert.deepStrictEqual(v.acts, [[v.pet().id, 'stand']]);
});

test('with reduced motion nothing runs by itself, and Play still does', async () => {
  const v = await mount({ pets: [olive()] });
  assert.strictEqual(v.clock.running, 0);
  v.click('[data-play]');
  assert.strictEqual(v.clock.running, 1);
});

test('a pose with one frame has nothing to play', async () => {
  const v = await mount({ pets: [olive()] });
  v.pickPose('wave');
  assert.ok(v.q<HTMLButtonElement>('[data-play]')!.disabled);
});

test('a play-once pose waits for Play, plays once and holds its last frame', async () => {
  const v = await mount({ pets: [olive()], io: { moves: () => true } });
  v.pickPose('stand_up');
  assert.strictEqual(v.clock.running, 0);
  const img = () => v.q<HTMLImageElement>('.live .art img')!.getAttribute('src');
  assert.strictEqual(img(), png('u1'));
  v.click('[data-play]');
  v.clock.fire(); v.clock.fire(); v.clock.fire(); v.clock.fire();
  assert.strictEqual(img(), png('u3'));
  assert.strictEqual(v.clock.running, 0);
  assert.strictEqual(v.q('[data-play]')!.textContent, 'Play');
  v.click('[data-play]');
  assert.strictEqual(img(), png('u1'));
});

test('the two-frame swing shows gentle then strong, and never loops as if it were a walk', async () => {
  const v = await mount({ pets: [olive()], io: { moves: () => true } });
  v.pickPose('dragL');
  assert.strictEqual(v.clock.running, 0);
  assert.match(v.q('.note')!.textContent!, /Frame 1 is a gentle swing, frame 2 a strong one/);
  const seen: (string | null)[] = [], img = () => v.q<HTMLImageElement>('.live .art img')!.getAttribute('src');
  v.click('[data-play]');
  seen.push(img());
  for (let i = 0; i < 5; i++) { v.clock.fire(); seen.push(img()); }
  assert.deepStrictEqual(seen, [png('g'), png('s'), png('g'), png('g'), png('g'), png('g')]);
  assert.strictEqual(v.clock.running, 0);
});

test('picking a frame stops the preview on it, and Play takes it back', async () => {
  const v = await mount({ pets: [olive()], io: { moves: () => true } });
  v.click('[data-fi="2"]');
  assert.strictEqual(v.clock.running, 0);
  assert.strictEqual(v.q<HTMLImageElement>('.live .art img')!.getAttribute('src'), png('s3'));
  v.click('[data-play]');
  assert.strictEqual(v.clock.running, 1);
  v.pickPose('walk');
  assert.strictEqual(v.clock.running, 1);
});

test('a picked pose\'s timer never outlives its tray', async () => {
  const v = await mount({ pets: [olive()], io: { moves: () => true } });
  v.pickPose('walk'); v.pickPose('dance'); v.pickPose('stand');
  assert.strictEqual(v.clock.running, 1);
  v.pickPose('wave');
  assert.strictEqual(v.clock.running, 0);
  v.pickPose('walk');
  v.view.destroy();
  assert.strictEqual(v.clock.running, 0);
});

test('changing speed while it plays changes what plays', async () => {
  const v = await mount({ pets: [olive()], io: { moves: () => true } });
  v.fill('[data-k="Speed"]', '10');
  assert.strictEqual(v.clock.ms, 100);
  assert.strictEqual(v.clock.running, 1);
});

test('Try performs in the tray and reaches the world', async () => {
  const v = await mount({ pets: [olive()] });
  v.click('[data-t="wave"]');
  assert.deepStrictEqual(v.acts, [[v.pet().id, 'wave']]);
  assert.ok(v.q('[data-t="wave"]')!.classList.contains('on'));
  assert.strictEqual(v.q('.live .say')!.textContent, LINES.hello[0] && 'Yo!');
  assert.strictEqual(v.q('.tray h3')!.textContent, 'Stand / idle');
});

test('Try Roll shows her Roll art when it is drawn, and Stand when it is not', async () => {
  const drawn = await mount({ pets: [buddy({ poses: { stand: pose('st'), roll: pose('ro', 'rp') } })] });
  drawn.click('[data-all]'); drawn.press('Roll', '.allact');
  assert.strictEqual(drawn.q<HTMLImageElement>('.live .art img')!.src, png('ro'));
  drawn.view.destroy();
  const not = await mount({ pets: [buddy({ poses: { stand: pose('st') } })] });
  not.click('[data-all]'); not.press('Roll', '.allact');
  assert.strictEqual(not.q<HTMLImageElement>('.live .art img')!.src, png('st'));
});

test('Try puts the pose on its surface', async () => {
  const v = await mount();
  v.click('[data-all]');
  v.press('Climb wall', '.allact');
  assert.strictEqual(v.q('.live')!.dataset.s, 'wall');
  assert.ok(v.q<HTMLImageElement>('.live .art img')!.style.rotate.includes('90'));
  v.click('[data-all]');
  v.press('To ceiling', '.allact');
  assert.strictEqual(v.q('.live')!.dataset.s, 'ceiling');
  gone(v.q('.allact'));
  assert.strictEqual(document.activeElement === document.body || !!document.activeElement, true);
});

test('Play after a Try plays the pose, not the Try', async () => {
  const v = await mount({ pets: [olive()] });
  v.click('[data-t="wave"]');
  v.click('[data-play]');
  assert.strictEqual(v.q('[data-t="wave"]')!.classList.contains('on'), false);
  assert.strictEqual(v.clock.running, 1);
  assert.deepStrictEqual(v.acts.at(-1), [v.pet().id, 'stand']);
});

test('every action a buddy can do is on offer, and no others', async () => {
  const v = await mount();
  v.click('[data-all]');
  const one = v.words('.allact button');
  assert.ok(!one.includes('Dance') && !one.includes('Think') && one.includes('Wave'));
  assert.strictEqual(one.length, 17);
  v.click('[data-all]');
  gone(v.q('.allact'));
  v.view.destroy();
  const w = await mount({ pets: [buddy({ poses: { dance: pose('d'), sing: pose('s'), eat: pose('e'), think: pose('t') } })] });
  w.click('[data-all]');
  assert.strictEqual(w.words('.allact button').length, 21);
  w.click('[data-all]');
  w.sheet(8);
  assert.deepStrictEqual(w.words('.try > button[data-t]'), ['Dance', 'Sing', 'Snack', 'Spin', 'Roll']);
});

test('a sheet\'s own actions come first', async () => {
  const v = await mount();
  assert.deepStrictEqual(v.words('.try > button[data-t]'), ['Hearts', 'Wave', 'Sleep', 'Jump', 'Run']);
  v.sheet(3);
  assert.deepStrictEqual(v.words('.try > button[data-t]'), ['Climb wall', 'To ceiling', 'Come down']);
});

test('Try on my screen sends the Try, or else the pose, or else the art the words use', async () => {
  const v = await mount({ pets: [olive()] });
  v.pickPose('walk');
  v.click('[data-screen]');
  assert.deepStrictEqual(v.calls.at(-1), ['tryOnScreen', v.pet().id, 'walk']);
  v.click('[data-t="wave"]');
  v.click('[data-screen]');
  assert.deepStrictEqual(v.calls.at(-1), ['tryOnScreen', v.pet().id, 'wave']);
  v.sheet(4);
  v.click('.say[data-sit="love"]');
  v.click('[data-screen]');
  assert.deepStrictEqual(v.calls.at(-1), ['tryOnScreen', v.pet().id, 'happy']);
  v.pickPose('surprised');
  v.click('[data-screen]');
  assert.deepStrictEqual(v.calls.at(-1), ['tryOnScreen', v.pet().id, 'wave']);
  assert.strictEqual(v.acts.filter(([, a]) => a === 'walk').length, 0);
});

test('the Prompt kit fields reach the buddy, and tags or text changes what shows', async () => {
  const v = await mount();
  v.sheet('kit');
  v.fill('[data-kit="personality"]', 'grumpy');
  v.fill('[data-kit="appearance"]', 'round moss');
  v.fill('[data-kit="quality"]', 'best');
  v.fill('[data-kit="style"]', 'chibi');
  const k = () => v.pet().kit!;
  assert.deepStrictEqual([k().personality, k().appearance, k().quality, k().styleTags], ['grumpy', 'round moss', 'best', 'chibi']);
  v.click('[data-mode="text"]');
  assert.strictEqual(k().mode, 'text');
  assert.strictEqual(v.q('[data-mode="text"]')!.getAttribute('aria-checked'), 'true');
  gone(v.q('[data-kit="quality"]'));
  assert.strictEqual(v.q<HTMLInputElement>('[data-kit="style"]')!.value, k().styleText);
  v.fill('[data-kit="style"]', 'sentences');
  assert.strictEqual(v.pet().kit!.styleText, 'sentences');
  assert.strictEqual(v.pet().kit!.styleTags, 'chibi');
});

test('kit fields hold to what a file takes', async () => {
  const v = await mount();
  v.sheet('kit');
  for (const f of ['personality', 'appearance', 'quality', 'style']) assert.strictEqual(v.q(`[data-kit="${f}"]`)!.getAttribute('maxlength'), '4000', f);
});

test('typing a kit field leaves the field alone', async () => {
  const v = await mount();
  v.sheet('kit');
  const f = v.q('[data-kit="personality"]')!;
  f.focus();
  v.fill('[data-kit="personality"]', 'a');
  same(document.activeElement, f);
  same(v.q('[data-kit="personality"]'), f);
});

test('the dialogue prompt copies, and says it did', async () => {
  const v = await mount();
  v.sheet('kit');
  v.press('Copy dialogue prompt');
  await tick();
  assert.match(v.copied[0]!, /JSON/);
  assert.strictEqual(v.q('.toast')!.textContent, 'Copied dialogue prompt');
  assert.strictEqual(v.q('.toast')!.hidden, false);
});

test('a copy that fails says so', async () => {
  const v = await mount({ io: { copy: async () => { throw new Error('no'); } } });
  v.sheet('kit');
  v.press('Copy dialogue prompt');
  await tick();
  assert.strictEqual(v.q('.toast')!.textContent, "Couldn't copy the dialogue prompt");
});

test('Edit current lines fills the paste box, and it survives a redraw', async () => {
  const v = await mount();
  v.sheet('kit');
  v.press('Edit current lines');
  assert.strictEqual(JSON.parse(v.q<HTMLTextAreaElement>('[data-reply]')!.value).hello[0], LINES.hello[0]);
  v.click('[data-mode="text"]');
  assert.match(v.q<HTMLTextAreaElement>('[data-reply]')!.value, /"hello"/);
});

test('a reply that applies clears the box and changes the lines', async () => {
  const v = await mount();
  v.sheet('kit');
  v.fill('[data-reply]', 'sure! {"hello": ["Howdy"]}');
  v.press('Apply dialogue');
  assert.deepStrictEqual(v.pet().lines!.hello, ['Howdy']);
  assert.strictEqual(v.q<HTMLTextAreaElement>('[data-reply]')!.value, '');
  assert.match(v.q('[data-stat]')!.textContent!, /Using Ann's own lines for 1 of 33 situations/);
  assert.match(v.toasts.at(-1)!, /Applied 1 lines/);
});

test('a reply that doesn\'t read stays in the box', async () => {
  const v = await mount();
  v.sheet('kit');
  v.fill('[data-reply]', 'not json');
  v.press('Apply dialogue');
  assert.strictEqual(v.q<HTMLTextAreaElement>('[data-reply]')!.value, 'not json');
  assert.strictEqual(v.pet().lines, undefined);
  assert.match(v.toasts.at(-1)!, /Couldn't read that/);
});

test('a refused reply says why beside the box, and keeps saying it until the box changes', async () => {
  const v = await mount();
  v.sheet('kit');
  const why = () => v.q<HTMLElement>('[data-reply-why]')!;
  assert.ok(why().hidden, 'nothing to say yet');
  v.fill('[data-reply]', 'not json');
  v.press('Apply dialogue');
  assert.ok(!why().hidden);
  assert.match(why().textContent!, /Couldn't read that: .*No JSON object found/);
  v.sheet('look'); v.sheet('kit');
  assert.match(why().textContent!, /No JSON object found/, 'it outlives a redraw, as the box does');
  v.fill('[data-reply]', 'not json, edited');
  assert.ok(why().hidden, 'the box changed');
});

test('a reply that reads leaves nothing said, and Edit current lines clears it too', async () => {
  const v = await mount();
  v.sheet('kit');
  v.fill('[data-reply]', 'not json');
  v.press('Apply dialogue');
  v.press('Edit current lines');
  assert.ok(v.q<HTMLElement>('[data-reply-why]')!.hidden);
  v.fill('[data-reply]', 'not json');
  v.press('Apply dialogue');
  v.fill('[data-reply]', '{"hello": ["Hi"]}');
  v.press('Apply dialogue');
  assert.ok(v.q<HTMLElement>('[data-reply-why]')!.hidden);
});

test('Use default lines asks first, and only offers itself when there are own lines', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['a'] } })] });
  v.sheet('kit');
  v.click('[data-reset]');
  v.press('Cancel');
  assert.ok(v.pet().lines);
  v.click('[data-reset]');
  v.press('Use defaults', '.confirm');
  assert.strictEqual(v.pet().lines, undefined);
  assert.strictEqual(v.q('[data-stat]')!.textContent, 'Using the default lines.');
  assert.ok(v.q<HTMLButtonElement>('[data-reset]')!.disabled);
});

test('with no appearance, the pictures half says what it needs', async () => {
  const v = await mount();
  v.sheet('kit');
  assert.match(v.q('.prompts')!.textContent!, /Add an appearance/);
  gone(v.q('[data-copy-all]'));
  v.fill('[data-kit="appearance"]', 'round');
  assert.strictEqual(v.all('.pr').length, 11);
  v.fill('[data-kit="appearance"]', '');
  assert.match(v.q('.prompts')!.textContent!, /Add an appearance/);
});

test('image prompts copy one by one, all at once, and with the negative', async () => {
  const v = await mount({ pets: [buddy({ kit: { appearance: 'round moss' } })] });
  v.sheet('kit');
  assert.strictEqual(v.named('Copy these (11)') !== undefined, true);
  v.click('[data-copy="walk_1"]');
  v.click('[data-copy-all]');
  v.click('[data-negative]');
  await tick();
  assert.match(v.copied[0]!, /round moss/);
  assert.match(v.copied[0]!, /walking/);
  assert.match(v.copied[1]!, /### main\.png/);
  assert.match(v.copied[1]!, /### negative prompt/);
  assert.match(v.copied[2]!, /worst quality|lowres|bad/);
  v.click('[data-mode="text"]');
  gone(v.q('[data-negative]'));
});

test('more poses show, and essentials come back', async () => {
  const v = await mount({ pets: [buddy({ kit: { appearance: 'round' } })] });
  v.sheet('kit');
  v.click('[data-more]');
  assert.strictEqual(v.all('.pr').length, 31);
  assert.strictEqual(v.q('[data-more]')!.textContent, 'Essentials only');
  assert.ok(v.named('Copy all (31)'));
  v.click('[data-more]');
  assert.strictEqual(v.all('.pr').length, 11);
});

test('a click on a prompt picks it and the tray reads it whole', async () => {
  const v = await mount({ pets: [buddy({ kit: { appearance: 'round moss' } })] });
  v.sheet('kit');
  v.click('.pr[data-file="walk_1"] .pr-pick');
  assert.ok(v.q('.pr.on[data-file="walk_1"]'));
  assert.strictEqual(v.q('.tray h3')!.textContent, 'Walk');
  const text = () => v.q<HTMLTextAreaElement>('[data-prompt-text]')!.value;
  assert.match(text(), /round moss/);
  assert.ok(v.q('[data-prompt-text]')!.hasAttribute('readonly'));
  v.press('Copy prompt');
  await tick();
  assert.strictEqual(v.copied[0], text());
  v.fill('[data-kit="appearance"]', 'square rock');
  assert.match(text(), /square rock/);
  assert.match(v.q('.pr[data-file="walk_1"] .sum')!.textContent!, /walking/);
  v.press('Go to Walk art');
  assert.strictEqual(v.q('.tray h3')!.textContent, 'Walk');
  assert.ok(v.q('.fs.empty, .fs'));
  gone(v.q('.pr.on'));
});

test('a prompt\'s row shows the art it asks for, or a dashed gap', async () => {
  const v = await mount({ pets: [buddy({ kit: { appearance: 'round' }, poses: { walk: pose('w1') } })] });
  v.sheet('kit');
  assert.ok(v.q('.pr[data-file="main"] .art img'));
  assert.ok(v.q('.pr[data-file="walk_1"] .art img'));
  assert.ok(v.q('.pr[data-file="walk_2"] .gap'));
  assert.ok(v.q('.pr[data-file="sit"] .gap'));
});

test('generated images land on their poses', async () => {
  const v = await mount();
  v.sheet('kit');
  await v.choose('generated', file('walk_1.png'), file('walk_2.png'), file('main.png'));
  assert.strictEqual(v.pet().poses.walk!.frames.length, 2);
  assert.strictEqual(v.pet().base.src, png('main.png'));
});

test('Look changes the name, the facing, the size and the main image', async () => {
  const v = await mount();
  v.sheet('look');
  v.fill('[data-name]', 'Bo');
  assert.strictEqual(v.pet().name, 'Bo');
  assert.strictEqual(v.q('.who h1')!.textContent, 'Bo');
  assert.strictEqual(v.q('[data-name]')!.getAttribute('maxlength'), '64');
  v.click('[data-faces="left"]');
  assert.strictEqual(v.pet().faces, 'left');
  assert.strictEqual(v.q('[data-faces="left"]')!.getAttribute('aria-checked'), 'true');
  v.fill('[data-size]', '200');
  assert.strictEqual(v.pet().size, 200);
  assert.strictEqual(v.q('.rng.wide output')!.textContent, '200 px');
  await v.choose('main', file('new.png'));
  assert.strictEqual(v.pet().base.src, png('new.png'));
  assert.ok(v.q('.who .art img')!.getAttribute('src') === png('new.png'));
});

test('Look has her Lift for the floor, walls and ceilings, each in px at her size', async () => {
  const v = await mount();
  v.sheet('look');
  const lift = (k: string) => v.q<HTMLInputElement>(`[data-lift="${k}"]`)!, out = (k: string) => v.q(`[data-lift-out="${k}"]`)!.textContent;
  const read = (k: string) => [lift(k).min, lift(k).max, lift(k).value, out(k)];
  for (const k of ['floor', 'wall', 'ceiling']) assert.deepStrictEqual(read(k), ['-60', '60', '0', '0 px'], k);
  assert.deepStrictEqual(v.words('.look-form [data-lift-row] > span'), ['Floor', 'Walls', 'Ceilings']);
  v.fill('[data-lift="wall"]', '6');
  assert.deepStrictEqual(v.pet().lift, { wall: .05 });
  assert.strictEqual(out('wall'), '+6 px');
  v.fill('[data-lift="ceiling"]', '-12');
  v.fill('[data-lift="floor"]', '3');
  assert.deepStrictEqual(v.pet().lift, { floor: .025, wall: .05, ceiling: -.1 });
  v.fill('[data-size]', '200');
  assert.deepStrictEqual(read('wall'), ['-100', '100', '10', '+10 px'], 'a share of her size, so it grows with her');
  assert.deepStrictEqual(read('ceiling'), ['-100', '100', '-20', '-20 px']);
  for (const k of ['floor', 'wall', 'ceiling']) v.fill(`[data-lift="${k}"]`, '0');
  assert.ok(!('lift' in v.pet()));
});

test('Look shows each lift where it acts: the floor under her, a wall beside her, a ceiling above her', async () => {
  const v = await mount({ pets: [buddy({ poses: { ...olive().poses, wall: pose('wl'), hang: pose('hg') } })] });
  v.sheet('look');
  const side = (k: string) => v.q(`.look-art .side[data-s="${k}"]`)!;
  assert.ok(v.q('.look-art .stage .floor'), 'the floor under the main image');
  assert.ok(side('wall').querySelector('.wall') && side('wall').querySelector('img')!.getAttribute('src') === png('wl'), 'her wall art against a wall');
  assert.ok(side('ceiling').querySelector('.ceiling') && side('ceiling').querySelector('img')!.getAttribute('src') === png('hg'), 'her hang art under a ceiling');
  const moved = (k: string) => side(k).querySelector<HTMLElement>('.art')!.style.translate;
  assert.deepStrictEqual([moved('wall'), moved('ceiling')], ['', '']);
  v.fill('[data-lift="wall"]', '12');
  const [x, y] = moved('wall').split(' ').map(parseFloat);
  assert.ok(x! > 0 && y === 0, `out from the wall: ${moved('wall')}`);
  assert.strictEqual(moved('ceiling'), '', 'and nothing else moves');
  v.fill('[data-lift="ceiling"]', '12');
  const [cx, cy] = moved('ceiling').split(' ').map(parseFloat);
  assert.ok(cx === 0 && cy! > 0, `down from the ceiling: ${moved('ceiling')}`);
});

test('on the wall preview she faces the wall on her left, as the screen draws her there', async () => {
  for (const [faces, mirrored] of [['right', '-1 1'], ['left', ''], [undefined, '-1 1']] as const) {
    const v = await mount({ pets: [buddy({ faces, poses: { ...olive().poses, wall: pose('wl') } })] });
    v.sheet('look');
    assert.strictEqual(v.q<HTMLElement>('.look-art .side[data-s="wall"] .art')!.style.scale, mirrored, faces);
    destroy?.(); destroy = null; document.body.replaceChildren();
  }
  const v = await mount();
  v.sheet('look');
  assert.strictEqual(v.q<HTMLElement>('.look-art .side[data-s="wall"] .art')!.style.scale, '', 'the main image turned is never mirrored');
});

test('the tray\'s wall preview faces the wall on her left too, as Look and the screen draw her', async () => {
  const scale = (v: Awaited<ReturnType<typeof mount>>) => v.q<HTMLElement>('.live .art')!.style.scale;
  for (const [faces, mirrored] of [['right', '-1 1'], ['left', ''], [undefined, '-1 1']] as const) {
    const v = await mount({ pets: [buddy({ faces, poses: { ...olive().poses, wall: pose('wl'), climb: pose('cl') } })] });
    for (const k of ['wall', 'climb'] as const) {
      v.pickPose(k); await tick();
      assert.strictEqual(v.q('.live')!.dataset.s, 'wall', k);
      assert.strictEqual(scale(v), mirrored, `${k} facing ${faces}`);
    }
    v.click('[data-all]');
    v.press('Climb wall', '.allact');
    assert.strictEqual(scale(v), mirrored, `a Try on the wall, facing ${faces}`);
    v.pickPose('stand'); await tick();
    assert.strictEqual(scale(v), '', 'never on the floor');
    destroy?.(); destroy = null; document.body.replaceChildren();
  }
  const v = await mount();
  v.click('[data-all]');
  v.press('Climb wall', '.allact');
  assert.ok(v.q<HTMLImageElement>('.live .art img')!.style.rotate.includes('90'));
  assert.strictEqual(scale(v), '', 'the main image turned is never mirrored');
});

test('with no wall or hang art, the previews turn her main image, as the screen does', async () => {
  const v = await mount();
  v.sheet('look');
  for (const [k, turn] of [['wall', '90deg'], ['ceiling', '180deg']] as const) {
    const img = v.q<HTMLImageElement>(`.look-art .side[data-s="${k}"] img`)!;
    assert.strictEqual(img.getAttribute('src'), png('base'), k);
    assert.strictEqual(img.style.rotate, turn, k);
  }
});

test('the tray preview holds her off what she is on by the lift for that surface, never held or in the air', async () => {
  const v = await mount({ pets: [buddy({ lift: { floor: .1, wall: .1, ceiling: .1 }, poses: { ...olive().poses, climb: pose('c') } })] });
  const moved = () => v.q('.tray .live .art')!.style.translate;
  const px = (t: string) => t.split(' ').map(n => parseFloat(n));
  const [x0, y0] = px(moved());
  assert.ok(x0 === 0 && y0 < 0, `Stand: up, ${moved()}`);
  v.pickPose('climb'); { const [x, y] = px(moved()); assert.ok(x > 0 && y === 0, `wall: out, ${moved()}`); }
  v.pickPose('crawl'); { const [x, y] = px(moved()); assert.ok(x === 0 && y > 0, `ceiling: down, ${moved()}`); }
  for (const k of ['dragL', 'jump'] as const) { v.pickPose(k); assert.strictEqual(moved(), '', k); }
});

test('the tray preview takes only the lift for its own surface', async () => {
  const v = await mount({ pets: [buddy({ lift: { wall: .1 }, poses: { ...olive().poses, climb: pose('c') } })] });
  const moved = () => v.q('.tray .live .art')!.style.translate;
  assert.strictEqual(moved(), '', 'Stand, on the floor');
  v.pickPose('crawl'); assert.strictEqual(moved(), '', 'the ceiling');
  v.pickPose('climb'); assert.ok(parseFloat(moved()) > 0, moved());
});

test('the tray preview holds her off by her lift at her size, whatever the pose is scaled to', async () => {
  const at = async (scale: number) => {
    const v = await mount({ pets: [buddy({ lift: { floor: .1 }, poses: { stand: { ...pose('s'), scale } } })] });
    const t = v.q('.tray .live .art')!.style.translate;
    destroy?.(); destroy = null; document.body.replaceChildren();
    return t;
  };
  const one = await at(1);
  assert.ok(one && one === await at(.5), one);
});

test('Look moves its floor line by her floor lift alone', async () => {
  const v = await mount();
  v.sheet('look');
  const top = () => parseFloat(v.q('.look-art .stage .floor')!.style.top);
  const was = top();
  v.fill('[data-lift="wall"]', '9'); v.fill('[data-lift="ceiling"]', '9');
  assert.strictEqual(top(), was);
  v.fill('[data-lift="floor"]', '6');
  assert.ok(Math.abs(top() - was - 6) < .5, `${was} to ${top()}`);
});

test("a pose's Lift says what she gets in all, with her own lift from Look", async () => {
  const v = await mount({ pets: [buddy({ lift: { floor: .05, wall: .2, ceiling: .3 }, poses: olive().poses })] });
  await tick();
  assert.strictEqual(v.q('[data-k="Lift"]')!.closest('.rng')!.getAttribute('title'), '+6 px in all, with +6 px from the floor for every pose from Look');
});

test('Look says what the main image stands in for, and a click picks it', async () => {
  const v = await mount({ pets: [buddy({ poses: { walk: pose('w') } })] });
  v.sheet('look');
  const words = v.words('.look-art .spare button');
  assert.ok(words.includes('Stand') && words.includes('Climb wall') && !words.includes('Walk'), String(words));
  v.click('.look-art .spare button[data-art="stand"]');
  assert.strictEqual(v.q('.tray h3')!.textContent, 'Stand / idle');
});

test('matching sizes reaches the Maker from both places', async () => {
  const v = await mount({ pets: [olive()] });
  v.click('.spine [data-match]');
  await tick();
  assert.strictEqual(v.pet().poses.walk!.scale, 1.5);
  v.pet().poses.walk!.scale = 1;
  v.sheet('look');
  v.click('.look-form [data-match]');
  await tick();
  assert.strictEqual(v.pet().poses.walk!.scale, 1.5);
});

test('Look switches the window\'s theme and remembers it', async () => {
  const v = await mount();
  v.sheet('look');
  v.click('[data-theme-choice="light"]');
  assert.strictEqual(document.documentElement.dataset.theme, 'light');
  assert.strictEqual(v.mem.held.get('theme'), 'light');
  assert.strictEqual(v.q('[data-theme-choice="light"]')!.getAttribute('aria-checked'), 'true');
  v.click('[data-theme-choice="dark"]');
  assert.strictEqual(document.documentElement.dataset.theme, 'dark');
});

test('world settings only show when the host asks, and work when it does', async () => {
  const v = await mount();
  v.sheet('look');
  gone(v.q('.world'));
  v.view.destroy();
  const holder: { maker?: ReturnType<typeof createMaker> } = {};
  const w = await mount({ io: { worldSettings: box => { holder.maker = undefined; box.textContent = 'here'; } } });
  w.sheet('look');
  assert.strictEqual(w.q('.world')!.textContent, 'here');
});

test('everyoneSettings gives a web page what the Manager gives the app', async () => {
  const root = document.createElement('div');
  const v = await mount({ pets: [olive()] });
  const set = everyoneSettings(v.maker);
  document.body.append(root);
  set(root);
  const inRoot = (n: string) => [...root.querySelectorAll('button')].find(b => b.textContent === n)!;
  inRoot('Speech bubbles').click();
  assert.strictEqual(v.maker.state.bubbles, false);
  inRoot('Name tags').click();
  assert.strictEqual(v.maker.state.names, false);
  inRoot('High').click();
  assert.strictEqual(v.maker.state.chatter, 'high');
  inRoot('Everyone dance').click();
  assert.deepStrictEqual(v.acts.at(-1), ['*everyone*', 'dance']);
  set(root);
  assert.strictEqual(inRoot('Speech bubbles').getAttribute('aria-checked'), 'false');
  assert.strictEqual(inRoot('High').getAttribute('aria-checked'), 'true');
  inRoot('Remove this buddy from the page').click();
  assert.strictEqual(v.maker.state.pets.length, 0);
});

test('with no buddy, the first step is all there is, and nothing exists until there\'s an image', async () => {
  const v = await mount({ pets: [] });
  assert.ok(v.shown(v.q('.first:not(.waiting)')));
  assert.ok(!v.shown(v.q('.mk')));
  assert.ok(!v.shown(v.q('[data-save-file]')));
  assert.ok(!v.shown(v.q('[data-who]')));
  assert.strictEqual(v.q('.fresh')!.textContent, 'New buddy');
  assert.strictEqual(v.maker.state.pets.length, 0);
  assert.deepStrictEqual(v.words('.first-more .sample b'), ['Pip', 'Pudding', 'Sprout']);
  await v.choose('buddies', file('moss.png'));
  assert.strictEqual(v.maker.state.pets.length, 1);
  assert.strictEqual(v.pet().name, 'moss');
  assert.ok(!v.shown(v.q('.first:not(.waiting)')));
  assert.ok(v.shown(v.q('.mk')));
  assert.strictEqual(v.q('.board h2')!.textContent, 'Everything');
  assert.ok(v.shown(v.q('[data-save-file]')));
});

test('a first start, on a store that never held anything, holds no buddy and offers the samples', async () => {
  const v = await mount({ store: memoryStore() });
  assert.strictEqual(v.maker.state.pets.length, 0);
  assert.strictEqual(v.maker.selected, null);
  assert.ok(v.shown(v.q('.first:not(.waiting)')));
  assert.ok(!v.shown(v.q('.mk')));
  assert.ok(v.shown(v.q('.fresh')));
  assert.strictEqual(v.q('.fresh')!.textContent, 'New buddy');
  assert.deepStrictEqual(v.words('.first-more .sample b'), ['Pip', 'Pudding', 'Sprout']);
});

test('a sample starts a buddy too', async () => {
  const v = await mount({ pets: [] });
  v.click('.first-more [data-sample="pudding"]');
  await tick();
  assert.strictEqual(v.pet().name, 'pudding');
});

test('files that can\'t be read leave the first step where it was, saying so', async () => {
  const v = await mount({ pets: [] });
  await v.choose('buddyFile', file('bad.buddy', '', 'nope'));
  assert.strictEqual(v.maker.state.pets.length, 0);
  assert.match(v.toasts.at(-1)!, /isn't a Desktop Buddies file/);
  assert.ok(v.shown(v.q('.first:not(.waiting)')));
});

test('a buddy file and a Shimeji folder come in from the buddies menu', async () => {
  const v = await mount();
  v.click('[data-who]');
  assert.deepStrictEqual(v.words('.buddies .pick'), ['From an image', 'Import buddy file', 'Import Shimeji folder']);
  v.click('[data-who]');
  gone(v.q('.buddies'));
  await v.choose('shimeji', ...['shime1.png', 'shime2.png'].map(n => file(n)));
  assert.strictEqual(v.maker.state.pets.length, 2);
  assert.match(v.toasts.join(), /Imported/);
  v.click('[data-who]');
  assert.deepStrictEqual(v.words('.in-window .pick'), ['Ann', 'Shimeji']);
  assert.strictEqual(v.q('.in-window .pick[aria-current="true"]')!.textContent, 'Shimeji');
  v.press('Ann', '.buddies');
  assert.strictEqual(v.pet().name, 'Ann');
  assert.strictEqual(v.q('.who h1')!.textContent, 'Ann');
  gone(v.q('.buddies'));
});

test('switching buddies starts again on Everything', async () => {
  const v = await mount({ pets: [olive(), buddy({ id: 'y', character: 'cy', name: 'Bo' })] });
  v.sheet(4);
  v.maker.select('y');
  assert.strictEqual(v.q('.board h2')!.textContent, 'Everything');
  assert.strictEqual(v.q('.tray h3')!.textContent, 'Stand / idle');
  assert.strictEqual(v.maker.openPose, 'stand');
});

test('a buddy with no frames anywhere gets the slim tray, whichever is picked', async () => {
  const v = await mount();
  assert.ok(v.q('.mk.slim'));
  v.sheet(4);
  v.click('.say[data-sit="hello"]');
  assert.ok(v.q('.mk.slim'));
  v.view.destroy();
  const w = await mount({ pets: [olive()] });
  assert.ok(!w.q('.mk.slim'));
});

const failure = (more: object = {}): SaveState => ({ kind: 'failed', title: "Ann didn't save", why: 'The disk is full.', fix: 'Free some space.', ...more });

test('a good save is quiet', async () => {
  const v = await mount();
  assert.ok(!v.shown(v.q('.save-fail')));
  v.save({ kind: 'saving' });
  assert.strictEqual(v.q('.saved[data-save]')!.textContent, 'Saving');
  v.save({ kind: 'saved' });
  assert.strictEqual(v.q('.saved[data-save]')!.textContent, 'Saved');
  assert.ok(!v.q('.saved')!.classList.contains('bad'));
  assert.ok(!v.shown(v.q('.save-fail')));
});

test('a failed save shows its title, why and fix, and its actions run', async () => {
  const ran: string[] = [];
  const v = await mount();
  v.save(failure({ actions: [{ label: 'Try again', run: () => ran.push('again') }, { label: 'Show the folder', run: () => ran.push('folder') }] }));
  const m = v.q('.misprint')!;
  assert.ok(v.shown(m));
  assert.strictEqual(m.getAttribute('role'), 'alert');
  assert.match(m.textContent!, /Ann didn't saveThe disk is full\. Free some space\./);
  assert.strictEqual(v.q('.saved[data-save]')!.textContent, 'Not saved');
  assert.ok(v.q('.saved[data-save]')!.classList.contains('bad'));
  v.press('Try again', '.misprint');
  v.press('Show the folder', '.misprint');
  assert.deepStrictEqual(ran, ['again', 'folder']);
  assert.ok(v.q('.misprint .btn')!.classList.contains('go'));
});

test('a failed save always offers a way to keep the work', async () => {
  const v = await mount();
  v.save(failure());
  v.click('.misprint [data-keep]');
  assert.deepStrictEqual(v.calls, [['saveBuddyFile', v.pet().id]]);
});

test('trying again doesn\'t look saved, and only a real save clears it', async () => {
  const v = await mount();
  v.save(failure());
  v.save({ kind: 'saving' });
  assert.ok(v.shown(v.q('.misprint')));
  assert.ok(v.q('.saved[data-save]')!.classList.contains('bad'));
  assert.match(v.q('.saved[data-save]')!.textContent!, /Not saved yet/);
  v.save({ kind: 'saved' });
  assert.ok(!v.shown(v.q('.save-fail')));
  assert.strictEqual(v.q('.saved[data-save]')!.textContent, 'Saved');
  assert.ok(!v.q('.saved[data-save]')!.classList.contains('bad'));
});

test('a second failure replaces the first', async () => {
  const v = await mount();
  v.save(failure());
  v.save(failure({ title: 'Still no' }));
  assert.match(v.q('.misprint')!.textContent!, /Still no/);
  assert.strictEqual(v.all('.misprint').length, 1);
});

test('the host\'s toasts draw here, and it\'s fine if there are none', async () => {
  const v = await mount();
  v.hostToast('Hello from the Maker');
  assert.strictEqual(v.q('.toast')!.textContent, 'Hello from the Maker');
  assert.strictEqual(v.q('.toast')!.getAttribute('role'), 'status');
});

test('no toast shows until there is one', async () => {
  const v = await mount();
  assert.strictEqual(v.q('.toast')!.hidden, true);
});

test('a toast goes away by itself', async () => {
  let hide: () => void = () => {};
  const v = await mount({ io: { after: (_ms, f) => { hide = f; return () => {}; } } });
  v.hostToast('Soon gone');
  hide();
  assert.strictEqual(v.q('.toast')!.hidden, true);
});

test('destroy lets go of the host and the page', async () => {
  const v = await mount();
  v.view.destroy();
  assert.strictEqual(v.unsub, 2);
  gone(v.q('.win'));
  destroy = null;
});

const dropEvent = (files: File[], over?: Element | null) => {
  const e = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { items: [], files, types: ['Files'] } });
  (over || document.body).dispatchEvent(e);
  return e;
};
const dragEvent = (type: string, types = ['Files']) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'dataTransfer', { value: { types } }); document.body.dispatchEvent(e); return e; };

test('a drag with files raises the veil, and text doesn\'t', async () => {
  const v = await mount();
  dragEvent('dragenter', ['text/plain']);
  assert.strictEqual(v.q('.veil')!.hidden, true);
  dragEvent('dragenter');
  assert.strictEqual(v.q('.veil')!.hidden, false);
  dragEvent('dragenter');
  dragEvent('dragleave');
  assert.strictEqual(v.q('.veil')!.hidden, false);
  dragEvent('dragleave');
  assert.strictEqual(v.q('.veil')!.hidden, true);
  assert.ok(dragEvent('dragover').defaultPrevented);
  dragEvent('dragenter');
  assert.ok(dropEvent([]).defaultPrevented);
  assert.strictEqual(v.q('.veil')!.hidden, true);
});

test('an image dropped with no buddy makes one', async () => {
  const v = await mount({ pets: [] });
  dropEvent([file('fern.png')]);
  await tick();
  assert.strictEqual(v.pet().name, 'fern');
});

test('images named after poses find their poses', async () => {
  const v = await mount();
  dropEvent([file('walk_1.png'), file('sit.png')]);
  await tick();
  assert.ok(v.pet().poses.walk && v.pet().poses.sit);
  assert.strictEqual(v.maker.state.pets.length, 1);
});

test('dropped on the tray, images are frames for what\'s in it', async () => {
  const v = await mount({ pets: [olive()] });
  v.pickPose('sit');
  dropEvent([file('cat.png')], v.q('.tray'));
  await tick();
  assert.strictEqual(v.pet().poses.sit!.frames[0]!.src, png('cat.png'));
  dropEvent([file('walk_9.png')], v.q('.tray'));
  await tick();
  assert.strictEqual(v.pet().poses.sit!.frames.length, 2);
});

test('on Look, an image dropped on the main image replaces it', async () => {
  const v = await mount();
  v.sheet('look');
  dropEvent([file('cat.png')], v.q('.look-art .art img'));
  await tick();
  assert.strictEqual(v.pet().base.src, png('cat.png'));
  assert.strictEqual(v.maker.state.pets.length, 1);
});

test('on Look, a named image dropped elsewhere goes by its name', async () => {
  const v = await mount();
  v.sheet('look');
  const before = v.pet().base.src;
  dropEvent([file('walk_1.png')], v.q('.bar'));
  await tick();
  assert.strictEqual(v.pet().base.src, before);
  assert.strictEqual(v.pet().poses.walk!.frames.length, 1);
  gone(v.q('.ask'));
});

test('on Look, an unnamed image dropped elsewhere asks', async () => {
  const v = await mount();
  v.sheet('look');
  const before = v.pet().base.src;
  dropEvent([file('cat.png')], v.q('.look-form'));
  await tick();
  assert.strictEqual(v.pet().base.src, before);
  assert.ok(v.q('.ask'));
});

test('an image with no pose in its name asks where it goes, and each answer does it', async () => {
  const v = await mount({ pets: [olive()] });
  v.pickPose('sit');
  dropEvent([file('cat.png')]);
  await tick();
  assert.match(v.q('.ask b')!.textContent!, /Where does cat\.png go\?/);
  assert.deepStrictEqual(v.words('.ask button'), ['Frames for Sit', 'New main image', 'A new buddy']);
  v.press('Frames for Sit', '.ask');
  await tick();
  assert.strictEqual(v.pet().poses.sit!.frames.length, 1);
  gone(v.q('.ask'));
  dropEvent([file('dog.png')]);
  await tick();
  v.press('New main image', '.ask');
  await tick();
  assert.strictEqual(v.pet().base.src, png('dog.png'));
  dropEvent([file('fox.png')]);
  await tick();
  v.press('A new buddy', '.ask');
  await tick();
  assert.strictEqual(v.maker.state.pets.length, 2);
});

test('several unnamed images can\'t be one main image', async () => {
  const v = await mount({ pets: [olive()] });
  dropEvent([file('a.png'), file('b.png')]);
  await tick();
  assert.match(v.q('.ask b')!.textContent!, /Where do these 2 go\?/);
  assert.deepStrictEqual(v.words('.ask button'), ['Frames for Stand', 'New buddies, one each']);
});

test('with a word picked, there\'s no pose to give frames to', async () => {
  const v = await mount();
  v.sheet(4);
  v.click('.say[data-sit="hello"]');
  dropEvent([file('cat.png')]);
  await tick();
  assert.deepStrictEqual(v.words('.ask button'), ['New main image', 'A new buddy']);
});

test('named and unnamed together: the named land, and the rest are reported', async () => {
  const v = await mount();
  dropEvent([file('walk_1.png'), file('cat.png')]);
  await tick();
  assert.ok(v.pet().poses.walk);
  assert.match(v.q('.toast')!.textContent!, /Skipped 1 with no pose in the name/);
  gone(v.q('.ask'));
});

test('a buddy file and a Shimeji set dropped come in as buddies', async () => {
  const v = await mount();
  const text = JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: { character: 'cq', name: 'Quill', base: { src: 'data:image/png;base64,AAAA', bb: BOX }, poses: {} } });
  dropEvent([file('quill.buddy', '', text)]);
  await tick();
  assert.strictEqual(v.pet().name, 'Quill');
  dropEvent(['shime1.png', 'shime2.png', 'shime3.png', 'shime4.png'].map(n => file(n)));
  await tick();
  v.press('A new buddy', '.ask');
  await tick();
  assert.strictEqual(v.maker.state.pets.length, 3);
});

test('anything else dropped says what can be', async () => {
  const v = await mount();
  dropEvent([file('notes.txt', 'text/plain')]);
  await tick();
  assert.match(v.q('.toast')!.textContent!, /Only images, buddy files and Shimeji folders/);
});

const pasteEvent = (f: File | null, over?: Element | null) => {
  const e = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: { items: f ? [{ type: f.type, getAsFile: () => f }] : [] } });
  (over || document.body).dispatchEvent(e);
  return e;
};

test('a pasted image makes a buddy when there is none', async () => {
  const v = await mount({ pets: [] });
  assert.ok(pasteEvent(file('clip.png')).defaultPrevented);
  await tick();
  assert.strictEqual(v.maker.state.pets.length, 1);
});

test('a pasted image asks where it goes on a sheet', async () => {
  const v = await mount({ pets: [olive()] });
  pasteEvent(file('clip.png'));
  await tick();
  assert.deepStrictEqual(v.words('.ask button'), ['Frames for Stand', 'New main image', 'A new buddy']);
  assert.strictEqual(v.pet().base.src, png('base'));
});

test('on Look a paste swaps the main image, and in a field it\'s just text', async () => {
  const v = await mount();
  v.sheet('look');
  pasteEvent(file('clip.png'));
  await tick();
  assert.strictEqual(v.pet().base.src, png('clip.png'));
  const before = v.pet().base.src;
  assert.strictEqual(pasteEvent(file('x.png'), v.q('[data-name]')).defaultPrevented, false);
  await tick();
  assert.strictEqual(v.pet().base.src, before);
  assert.strictEqual(pasteEvent(null).defaultPrevented, false);
});

test('a slow upload for a buddy no longer showing doesn\'t redraw over the one that is', async () => {
  const v = await mount({ pets: [olive(), buddy({ id: 'y', character: 'cy', name: 'Bo' })] });
  const first = v.pet();
  v.maker.pickPose('sit');
  const going = v.maker.addFrames(first, [file('a.png')]);
  v.maker.select('y');
  await going;
  await tick();
  assert.strictEqual(v.q('.who h1')!.textContent, 'Bo');
  assert.strictEqual(v.q('.tray h3')!.textContent, 'Stand / idle');
});

test('working shows while a file is being handled', async () => {
  const v = await mount({ pets: [] });
  const w = v.q('[data-working]')!, i = v.q<HTMLInputElement>('input[data-pick=buddies]')!;
  assert.strictEqual(w.hidden, true);
  Object.defineProperty(i, 'files', { value: [file('fern.png')], configurable: true });
  i.dispatchEvent(new Event('change'));
  assert.strictEqual(w.hidden, false);
  await tick();
  assert.strictEqual(w.hidden, true);
});

test('storage being gone doesn\'t stop anything', async () => {
  const v = await mount({ io: { store: () => { throw new Error('off'); } } });
  v.sheet(4);
  v.sheet('all');
  v.click('[data-b="dark"]');
  v.sheet('look');
  v.click('[data-theme-choice="light"]');
  assert.strictEqual(v.q('.resume') === null, true);
});

test('a blank line going moves the one being opened up with it', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['a', 'b', 'c'] } })] });
  v.sheet(4);
  v.click('.says .say[data-sit="hello"][data-i="0"]');
  v.type('');
  v.click('.says .say[data-sit="hello"][data-i="2"]');
  assert.deepStrictEqual(v.pet().lines!.hello, ['b', 'c']);
  assert.strictEqual(v.q<HTMLTextAreaElement>('.field')!.value, 'c');
  assert.deepStrictEqual(v.words('.says .say.on'), ['c']);
  v.click('.says .say[data-sit="hello"][data-i="0"]');
  assert.strictEqual(v.q<HTMLTextAreaElement>('.field')!.value, 'b');
});

test('a blank line above the one opened doesn\'t shift a line in another situation', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['a', 'b'], love: ['x', 'y'] } })] });
  v.sheet(4);
  v.click('.says .say[data-sit="hello"][data-i="0"]');
  v.type('');
  v.click('.says .say[data-sit="love"][data-i="1"]');
  assert.strictEqual(v.q<HTMLTextAreaElement>('.field')!.value, 'y');
});

test('a line below the blank one keeps its place, and a blank one with none below opens the same place', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['a', 'b', 'c'] } })] });
  v.sheet(4);
  v.click('.says .say[data-sit="hello"][data-i="2"]');
  v.type('');
  v.click('.says .say[data-sit="hello"][data-i="0"]');
  assert.strictEqual(v.q<HTMLTextAreaElement>('.field')!.value, 'a');
  assert.deepStrictEqual(v.pet().lines!.hello, ['a', 'b']);
});

test('moving on with nothing blank redraws nothing', async () => {
  const v = await mount({ pets: [olive()] });
  v.sheet(4);
  v.click('.says .say[data-sit="hello"][data-i="0"]');
  const art = v.q('.c[data-keys~="wave"] img');
  v.click('.say[data-sit="love"][data-i="0"]');
  same(v.q('.c[data-keys~="wave"] img'), art);
});

test('a reply that didn\'t read outlives a redraw', async () => {
  const v = await mount();
  v.sheet('kit');
  v.fill('[data-reply]', 'not json');
  v.press('Apply dialogue');
  v.click('[data-mode="text"]');
  assert.strictEqual(v.q<HTMLTextAreaElement>('[data-reply]')!.value, 'not json');
});

test('removing a line in the middle stays where it was', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['a', 'b', 'c'] } })] });
  v.sheet(4);
  v.click('.says .say[data-sit="hello"][data-i="1"]');
  v.press('Remove');
  assert.strictEqual(v.q<HTMLTextAreaElement>('.field')!.value, 'c');
  assert.match(v.q('.tape header span')!.textContent!, /Line 2 of 2/);
});

test('a line over the file\'s limit changes nothing, even past the field\'s own limit', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['a'] } })] });
  v.sheet(4);
  v.click('.says .say[data-sit="hello"]');
  v.type('x'.repeat(301));
  assert.deepStrictEqual(v.pet().lines!.hello, ['a']);
  assert.strictEqual(v.q('.pv')!.textContent, 'a');
});

test('the writer says which new line it is', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['a', 'b'] } })] });
  v.sheet(4);
  v.click('.say[data-add="hello"]');
  v.type('c');
  assert.match(v.q('.tape header span')!.textContent!, /Line 3 of 3/);
});

test('the countdown starts at 40 left', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['a'] } })] });
  v.sheet(4);
  v.click('.says .say[data-sit="hello"]');
  v.type('x'.repeat(259));
  assert.strictEqual(v.q('.count')!.textContent, '');
  v.type('x'.repeat(260));
  assert.strictEqual(v.q('.count')!.textContent, '40 left');
});

test('it says how shared art is, in plain words', async () => {
  const v = await mount();
  v.sheet(4);
  v.click('.say[data-sit="angry"]');
  assert.match(v.q('.knobs small')!.textContent!, /Shared: 1 other situation uses Angry\./);
  v.click('.say[data-sit="cry"]');
  assert.match(v.q('.knobs small')!.textContent!, /Only these words use Cry\./);
});

test('with exactly as many uses as show, there\'s no more to open', async () => {
  const v = await mount();
  v.sheet(4);
  v.pickPose('angry');
  assert.deepStrictEqual(v.words('.uf .lk'), ['Clicked too many times', 'Clicked again, still cross']);
});

test('the list of uses and a note close the way they opened', async () => {
  const v = await mount();
  v.click('[data-more-uses]');
  assert.ok(v.q('.uses-all'));
  v.click('[data-more-uses]');
  gone(v.q('.uses-all'));
  assert.strictEqual(v.named('and 2 more') !== undefined, true);
});

test('a Try says its own line, in the writer too', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['Yo'], love: ['Yay'] } })] });
  v.sheet(4);
  v.click('.say[data-sit="love"]');
  v.click('[data-t="wave"]');
  assert.strictEqual(v.q('.pv')!.textContent, 'Yo');
  v.click('[data-t="wave"]');
  v.click('[data-all]');
  v.press('Sit', '.allact');
  assert.strictEqual(v.q('.pv')!.textContent, 'Yay');
});

test('changing speed doesn\'t start anything that wasn\'t running', async () => {
  const v = await mount({ pets: [olive()], io: { moves: () => true } });
  v.pickPose('stand_up');
  v.fill('[data-k="Speed"]', '10');
  assert.strictEqual(v.clock.running, 0);
  assert.strictEqual(v.pet().poses.stand_up!.fps, 10);
  v.pickPose('walk');
  v.click('[data-play]');
  v.fill('[data-k="Speed"]', '10');
  assert.strictEqual(v.clock.running, 0);
});

test('a pose with one frame says why it has nothing to play', async () => {
  const v = await mount({ pets: [olive()] });
  v.pickPose('wave');
  assert.strictEqual(v.q('[data-play]')!.title, 'One frame, so there is nothing to play');
  v.pickPose('walk');
  assert.strictEqual(v.q('[data-play]')!.hasAttribute('title'), false);
});

test('the prompt tray has what that prompt needs', async () => {
  const v = await mount({ pets: [buddy({ kit: { appearance: 'round' } })] });
  v.sheet('kit');
  v.click('.pr[data-file="main"] .pr-pick');
  assert.deepStrictEqual(v.words('.tape header code'), ['main.png']);
  assert.strictEqual(v.all('.knobs [data-k="to-art"]').length, 0);
  assert.strictEqual(v.all('.tape header span').length, 0);
  v.click('.pr[data-file="walk_2"] .pr-pick');
  assert.strictEqual(v.q('.tape header span')!.textContent, 'Frame 2 of 2');
  assert.ok(v.named('Copy negative prompt', '.knobs'));
  v.click('.pr[data-file="sit"] .pr-pick');
  assert.strictEqual(v.all('.tape header span').length, 0);
  v.click('[data-mode="text"]');
  assert.strictEqual(v.named('Copy negative prompt', '.knobs'), undefined);
});

test('in the kit, one prompt is picked and its row says what it is', async () => {
  const v = await mount({ pets: [buddy({ kit: { appearance: 'round' } })] });
  v.sheet('kit');
  assert.strictEqual(v.all('.pr.on').length, 0);
  v.click('.pr[data-file="sit"] .pr-pick');
  assert.deepStrictEqual(v.all('.pr.on').map(r => r.dataset.file), ['sit']);
  assert.strictEqual(v.q('.pr[data-file="main"] b')!.textContent, 'Main image');
  assert.strictEqual(v.q('.pr[data-file="walk_1"] b')!.textContent, 'Walk');
  assert.strictEqual(v.q('.pr[data-file="walk_1"] small')!.textContent, ' frame 1 of 2');
  gone(v.q('.pr[data-file="sit"] small'));
});

test('a prompt\'s text only changes on the prompt being read', async () => {
  const v = await mount({ pets: [buddy({ kit: { appearance: 'round' } })] });
  v.sheet('kit');
  v.fill('[data-kit="appearance"]', 'square');
  gone(v.q('[data-prompt-text]'));
});

test('a prompt is only read in Prompt kit', async () => {
  const v = await mount({ pets: [buddy({ kit: { appearance: 'round' } })] });
  v.sheet('kit');
  v.click('.pr[data-file="sit"] .pr-pick');
  v.sheet('look');
  gone(v.q('[data-prompt-text]'));
  assert.strictEqual(v.q('.tray h3')!.textContent, 'Stand / idle');
  v.sheet('kit');
  v.click('.pr[data-file="sit"] .pr-pick');
  v.click('[data-mode="text"]');
  assert.ok(v.q('[data-prompt-text]'));
});

test('the kit\'s words are the right way round', async () => {
  const v = await mount({ pets: [buddy({ lines: Object.fromEntries(Object.keys(LINES).filter(k => k !== 'sleep').map(k => [k, ['a']])) })] });
  v.sheet('kit');
  assert.strictEqual(v.q('[data-mode="tags"]')!.textContent, 'Tags (Anima / SD)');
  assert.strictEqual(v.q('[data-stat]')!.textContent, "Using Ann's own lines for 33 of 33 situations.");
  v.click('[data-reset]');
  assert.match(v.q('.confirm')!.textContent!, /Ann's own lines will go/);
});

test('Look\'s words are the right way round, and it manages with no name or size', async () => {
  const v = await mount({ pets: [buddy({ name: undefined as unknown as string, size: undefined as unknown as number })] });
  v.sheet('look');
  assert.strictEqual(v.q('[data-faces="left"]')!.textContent, '◀ Left');
  assert.strictEqual(v.q('[data-theme-choice="dark"]')!.textContent, 'Dark');
  assert.strictEqual(v.q<HTMLInputElement>('[data-name]')!.value, '');
  assert.strictEqual(v.q<HTMLInputElement>('[data-size]')!.value, '120');
  assert.strictEqual(v.q('.rng.wide output')!.textContent, '120 px');
  v.fill('[data-name]', 'Bo');
  assert.strictEqual(v.q('.who h1')!.title, 'Bo');
  v.fill('[data-name]', '');
  assert.strictEqual(v.q('.who h1')!.textContent, 'No name');
  assert.strictEqual(v.q('.who h1')!.title, '');
});

test('frames can be told apart by a screen reader', async () => {
  const v = await mount({ pets: [olive()] });
  assert.ok(v.named('Frame 2'));
  assert.strictEqual(v.q('[data-fi="0"]')!.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(v.q('[data-fi="1"]')!.getAttribute('aria-pressed'), 'false');
  assert.strictEqual(v.q('[data-fi="1"] small')!.textContent, '2');
});

test('the frame slider starts where the strip is', async () => {
  const v = await mount({ pets: [buddy({ poses: { stand: pose(...Array.from({ length: 13 }, (_, i) => `f${i}`)) } })] });
  v.click('[data-fi="4"]');
  assert.strictEqual(v.q<HTMLInputElement>('.fs-go')!.value, '5');
});

test('opening a sheet closes what\'s floating, and frames land on what it picked', async () => {
  const v = await mount({ pets: [olive()] });
  v.click('[data-all]');
  v.sheet(2);
  gone(v.q('.allact'));
  await v.choose('frames', file('held.png'));
  assert.strictEqual(v.pet().poses.drag!.frames[0]!.src, png('held.png'));
});

test('a word that opens its sheet remembers it as the last one', async () => {
  const mem = memory();
  const v = await mount({ mem, pets: [buddy({ lines: { hello: ['a'] } })] });
  v.pickPose('wave');
  v.click('.uf .lk');
  assert.strictEqual(v.q('.spine .on')!.dataset.s, '4');
  v.view.destroy();
  const w = await mount({ mem, pets: [buddy({ lines: { hello: ['a'] } })] });
  assert.strictEqual(w.q('.resume')!.textContent, 'Back to Feelings');
});

test('a divider move is remembered as soon as it\'s made', async () => {
  const mem = memory();
  const v = await mount({ mem });
  v.sheet(1);
  v.q('.perf')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
  v.view.destroy();
  const w = await mount({ mem });
  w.sheet(1);
  assert.strictEqual(w.q('.perf')!.getAttribute('aria-valuenow'), '28');
});

test('the bar has the right things with and without a buddy', async () => {
  const v = await mount({ pets: [] });
  assert.ok(!v.shown(v.q('[data-save]')));
  assert.ok(v.shown(v.q('.fresh')));
  await v.choose('buddies', file('a.png'));
  assert.ok(v.shown(v.q('[data-save]')));
  assert.ok(!v.shown(v.q('.fresh')));
  assert.strictEqual(v.q('.who h1')!.title, 'a');
});

test('a name with none shows as such in the buddies menu', async () => {
  const v = await mount({ pets: [buddy({ name: '' }), buddy({ id: 'y', character: 'cy', name: 'Bo' })] });
  v.click('[data-who]');
  assert.deepStrictEqual(v.words('.in-window .pick'), ['No name', 'Bo']);
});

test('the buddies menu closes as its picker opens', async () => {
  const v = await mount();
  for (const words of ['From an image', 'Import buddy file', 'Import Shimeji folder']) {
    v.click('[data-who]');
    v.press(words, '.buddies');
    gone(v.q('.buddies'));
  }
});

test('the file pickers ask for what each wants', async () => {
  const v = await mount();
  const pick = (k: string) => v.q<HTMLInputElement>(`input[data-pick=${k}]`)!;
  assert.ok(pick('main').hidden);
  for (const k of ['buddies', 'frames', 'generated', 'shimeji']) assert.ok(pick(k).hasAttribute('multiple'), k);
  for (const k of ['main', 'buddyFile']) assert.ok(!pick(k).hasAttribute('multiple'), k);
  assert.ok(pick('shimeji').hasAttribute('webkitdirectory'));
  assert.ok(!pick('buddies').hasAttribute('webkitdirectory'));
  assert.strictEqual(pick('buddyFile').getAttribute('accept'), '.buddy,.json,application/json');
  assert.strictEqual(pick('frames').getAttribute('accept'), 'image/*');
});

test('with no buddy a dropped image makes exactly one', async () => {
  const v = await mount({ pets: [] });
  dropEvent([file('fern.png')]);
  await tick();
  assert.strictEqual(v.maker.state.pets.length, 1);
  gone(v.q('.ask'));
});

test('a named image dropped on the tray is a frame, and only that', async () => {
  const v = await mount({ pets: [olive()] });
  v.pickPose('sit');
  dropEvent([file('dance_1.png')], v.q('.tray'));
  await tick();
  assert.strictEqual(v.pet().poses.sit!.frames.length, 1);
  assert.strictEqual(v.pet().poses.dance!.frames.length, 2);
  assert.strictEqual(v.maker.openPose, 'sit');
});

test('with a word in the tray, a drop on it isn\'t frames', async () => {
  const v = await mount();
  v.sheet(4);
  v.click('.say[data-sit="hello"]');
  dropEvent([file('walk_1.png')], v.q('.tray'));
  await tick();
  assert.ok(v.pet().poses.walk);
});

test('on the main image, one image is the main image whatever its name, and several go by name', async () => {
  const v = await mount();
  v.sheet('look');
  dropEvent([file('walk_1.png')], v.q('.stage'));
  await tick();
  assert.strictEqual(v.pet().base.src, png('walk_1.png'));
  gone(v.q('.ask'));
  assert.strictEqual(v.pet().poses.walk, undefined);
  dropEvent([file('walk_1.png'), file('walk_2.png')], v.q('.stage'));
  await tick();
  assert.ok(v.pet().poses.walk);
});

test('something odd dropped with something good says nothing about the odd one', async () => {
  const v = await mount();
  dropEvent([file('notes.txt', 'text/plain'), file('walk_1.png')]);
  await tick();
  assert.doesNotMatch(v.q('.toast')!.textContent!, /Only images/);
  dropEvent([file('notes.txt', 'text/plain'), file('cat.png')]);
  await tick();
  assert.doesNotMatch(v.q('.toast')!.textContent!, /Only images/);
});

test('a paste before the Maker is ready does nothing', async () => {
  const v = await mount({ start: false });
  assert.ok(pasteEvent(file('x.png')).defaultPrevented);
  await tick();
  await v.maker.start();
  assert.strictEqual(v.maker.state.pets.length, 1);
});

test('the choice for a drop lands on its own pose, and closes without moving the keyboard', async () => {
  const v = await mount({ pets: [olive()] });
  v.pickPose('sit');
  dropEvent([file('cat.png')]);
  await tick();
  v.maker.pickPose('walk');
  v.press('Frames for Sit', '.ask');
  await tick();
  assert.strictEqual(v.pet().poses.sit!.frames.length, 1);
});

test('a pet with poses but empty frames counts as no frames', async () => {
  const v = await mount({ pets: [buddy({ poses: { walk: { frames: [], fps: 6, scale: 1 } } })] });
  assert.ok(v.q('.mk.slim'));
});

test('everyone\'s switches start from what\'s saved', async () => {
  const v = await mount({ store: memoryStore({ pets: [buddy()], started: true, bubbles: false, names: true, chatter: 'low' }) });
  const box = document.createElement('div');
  everyoneSettings(v.maker)(box);
  const words = (n: string) => [...box.querySelectorAll('button')].find(b => b.textContent === n)!;
  assert.strictEqual(words('Speech bubbles').getAttribute('aria-checked'), 'false');
  assert.strictEqual(words('Name tags').getAttribute('aria-checked'), 'true');
  assert.strictEqual(words('Low').getAttribute('aria-checked'), 'true');
});

test('destroy closes what\'s floating', async () => {
  const v = await mount();
  v.click('[data-all]');
  v.view.destroy();
  gone(v.q('.allact'));
  destroy = null;
});

test('with no buddy the tray isn\'t running anything', async () => {
  const v = await mount({ pets: [olive()], io: { moves: () => true } });
  assert.strictEqual(v.clock.running, 1);
  v.maker.remove();
  assert.strictEqual(v.clock.running, 0);
  assert.ok(v.shown(v.q('.first:not(.waiting)')));
});

test('lines with blanks between them: clicking "third" opens third, and typing changes third', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['first', '', 'third', '', 'fifth'] } })] });
  v.sheet('words');
  v.click('.says .say[data-sit="hello"][data-i="3"]');
  v.click('.says .say[data-sit="hello"][data-i="2"]');
  assert.strictEqual(v.q<HTMLTextAreaElement>('.field')!.value, 'third');
  v.type('THIRD');
  assert.deepStrictEqual(v.pet().lines!.hello, ['first', 'THIRD', 'fifth']);
});

test('clicking the blank line you\'re on leaves you on it', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['a', '', 'c'] } })] });
  v.sheet('words');
  v.click('.says .say[data-sit="hello"][data-i="1"]');
  v.click('.says .say[data-sit="hello"][data-i="1"]');
  assert.deepStrictEqual(v.pet().lines!.hello, ['a', '', 'c']);
  assert.strictEqual(v.q<HTMLTextAreaElement>('.field')!.value, '');
  v.type('b');
  assert.deepStrictEqual(v.pet().lines!.hello, ['a', 'b', 'c']);
});

test('Add a line with a blank above opens a truly new line', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['a', ''] } })] });
  v.sheet('words');
  v.click('.says .say[data-sit="hello"][data-i="1"]');
  v.press('Add a line', '.knobs');
  v.type('new');
  assert.deepStrictEqual(v.pet().lines!.hello, ['a', 'new']);
});

test('a blank line under the writer goes when a page opens, and the writer stays on a real line', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['a', ''] } })] });
  v.sheet('words');
  v.click('.says .say[data-sit="hello"][data-i="1"]');
  v.sheet('look');
  assert.deepStrictEqual(v.pet().lines!.hello, ['a']);
  assert.strictEqual(v.q<HTMLTextAreaElement>('.field')!.value, 'a');
  gone(v.q('.say.draft'));
});

/* A folder arrives a batch at a time, and this one waits to be told. */
function slowFolder(...files: File[]) {
  let release: () => void = () => {};
  const waiting = new Promise<void>(r => { release = r; });
  let sent = false;
  const entries = files.map(f => ({ isFile: true, fullPath: `/Moss/${f.name}`, file: (ok: (x: File) => void) => ok(f) }));
  const folder = { isFile: false, fullPath: '/Moss', createReader: () => ({ readEntries: (ok: (e: unknown[]) => void) => { void waiting.then(() => { ok(sent ? [] : entries); sent = true; }); } }) };
  const drop = (over?: Element | null) => {
    const e = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', { value: { items: [{ webkitGetAsEntry: () => folder }], files: [], types: ['Files'] } });
    (over || document.body).dispatchEvent(e);
  };
  return { drop, release };
}
const twoPets = () => [buddy({ id: 'a', character: 'ca', name: 'Ann' }), buddy({ id: 'b', character: 'cb', name: 'Bo' })];

test('a folder still being read lands on the buddy it was dropped on, when nothing has changed', async () => {
  const v = await mount({ pets: twoPets() }), slow = slowFolder(file('walk_1.png'));
  slow.drop();
  await tick();
  assert.strictEqual(v.pet().poses.walk, undefined);
  slow.release();
  await tick();
  assert.strictEqual(v.pet().poses.walk!.frames.length, 1);
});

test('a folder still being read when the buddy changes lands nowhere, and says so', async () => {
  const v = await mount({ pets: twoPets() }), slow = slowFolder(file('main.png'), file('walk_1.png'));
  const [a, b] = v.maker.state.pets as [MakerBuddy, MakerBuddy], srcA = a.base.src, srcB = b.base.src;
  slow.drop();
  await tick();
  v.maker.select('b');
  slow.release();
  await tick();
  assert.strictEqual(b.base.src, srcB);
  assert.strictEqual(a.base.src, srcA);
  assert.strictEqual(b.poses.walk, undefined);
  assert.strictEqual(a.poses.walk, undefined);
  assert.match(v.q('.toast')!.textContent!, /Nothing was added.*still on your disk/);
});

test('a folder still being read when the window closes changes nothing', async () => {
  const v = await mount({ pets: twoPets() }), slow = slowFolder(file('main.png'), file('walk_1.png'));
  const a = v.pet(), src = a.base.src;
  slow.drop();
  await tick();
  v.view.destroy();
  destroy = null;
  slow.release();
  await tick();
  assert.strictEqual(a.base.src, src);
  assert.strictEqual(a.poses.walk, undefined);
});

test('a choice left open closes when the buddy changes', async () => {
  const v = await mount({ pets: twoPets() });
  dropEvent([file('cat.png')]);
  await tick();
  assert.ok(v.q('.ask'));
  v.maker.select('b');
  gone(v.q('.ask'));
});

test('Use the defaults, cancelled, keeps the lines', async () => {
  const v = await mount({ pets: [buddy({ lines: { hello: ['a'] } })] });
  v.sheet(4);
  v.click('.say[data-sit="hello"]');
  v.click('[data-restore]');
  v.press('Cancel', '.confirm');
  assert.deepStrictEqual(v.pet().lines!.hello, ['a']);
});

test('Copy reads the prompt as it is now, in the row and in the tray', async () => {
  const v = await mount({ pets: [buddy({ kit: { appearance: 'round moss' } })] });
  v.sheet('kit');
  v.click('.pr[data-file="walk_1"] .pr-pick');
  v.fill('[data-kit="appearance"]', 'square rock');
  v.click('[data-copy="walk_1"]');
  v.press('Copy prompt');
  await tick();
  assert.match(v.copied[0]!, /square rock/);
  assert.match(v.copied[1]!, /square rock/);
  assert.doesNotMatch(v.copied.join(), /round moss/);
});

test('dropped Shimeji images ask first with a buddy open, and only then make one', async () => {
  const shime = () => ['shime1.png', 'shime2.png', 'shime3.png', 'shime4.png'].map(n => file(n));
  const v = await mount();
  dropEvent(shime());
  await tick();
  assert.strictEqual(v.maker.state.pets.length, 1);
  assert.deepStrictEqual(v.words('.ask button'), ['A new buddy', 'Not now']);
  v.press('Not now', '.ask');
  await tick();
  gone(v.q('.ask'));
  assert.strictEqual(v.maker.state.pets.length, 1);
  dropEvent(shime());
  await tick();
  v.press('A new buddy', '.ask');
  await tick();
  assert.strictEqual(v.maker.state.pets.length, 2);
});

test('dropped Shimeji images in an empty window just come in', async () => {
  const v = await mount({ pets: [] });
  dropEvent(['shime1.png', 'shime2.png', 'shime3.png', 'shime4.png'].map(n => file(n)));
  await tick();
  assert.strictEqual(v.maker.state.pets.length, 1);
  gone(v.q('.ask'));
});

test('every listener on the page goes when the view does', async () => {
  const added: unknown[][] = [];
  const spy = (t: EventTarget) => { const real = t.addEventListener.bind(t); t.addEventListener = ((type: string, f: EventListener, o?: AddEventListenerOptions | boolean) => { added.push([type, typeof o === 'object' ? o.signal : undefined]); real(type, f, o); }) as typeof t.addEventListener; return () => { t.addEventListener = real; }; };
  const undo = [spy(document), spy(window)];
  try {
    const v = await mount();
    v.view.destroy();
    destroy = null;
  } finally { for (const u of undo) u(); }
  const left = added.filter(([, signal]) => !(signal as AbortSignal | undefined)?.aborted).map(([type]) => type);
  assert.deepStrictEqual(left, []);
});

test('a popover stops listening when disposed', async () => {
  const host = document.createElement('div'), anchor = document.createElement('button');
  document.body.append(host, anchor);
  const pop = createPopover(host);
  pop.dispose();
  pop.show(document.createElement('div'), anchor);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  assert.strictEqual(host.children.length, 1);
});

test('looking at Prompt kit writes nothing into the buddy', async () => {
  const v = await mount();
  v.sheet('kit');
  v.sheet('all');
  assert.strictEqual(v.pet().kit, undefined);
});

test('reading a prompt in the tray writes nothing into the buddy', async () => {
  const kit = { appearance: 'round' };
  const v = await mount({ pets: [buddy({ kit })] });
  v.sheet('kit');
  v.click('.pr[data-file="walk_1"] .pr-pick');
  assert.deepStrictEqual(v.pet().kit, { appearance: 'round' });
});
