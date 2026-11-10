// @vitest-environment happy-dom
/* Close with the real view and the real dialog: what the third review found getting past them. */
import assert from '@buddies/test-support/dom-assert';
import { pack, write } from '@buddies/buddy-file';
import { afterEach, test } from 'vitest';
import { MAKER } from '../src/maker-window';
import { art, createDisk, hubOn, makerOn, manifestOf, png, small } from './maker-harness';

afterEach(() => { document.body.replaceChildren(); });

const tick = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r)); };
const whole = (exe: ReturnType<typeof createDisk>, id: string) => pack(manifestOf(exe, id), n => exe.files.get(`library/${id}/${n}`));
const image = (name: string) => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' });
function drop(target: EventTarget, dataTransfer: unknown) {
  const e = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: dataTransfer });
  target.dispatchEvent(e);
}
async function open() {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1'))), gates: (() => void)[] = [];
  const slow = { ...art, processBase: async (src: string) => { await new Promise<void>(g => { gates.push(g); }); return art.processBase(src); } };
  const page = await makerOn(r, 'c1', { dom: true, art: slow });
  await r.done();
  return { exe, r, page, gates };
}
const closeButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;

test('a drop onto the closing dialog itself reaches nothing', async () => {
  const { exe, r, page, gates } = await open();
  const before = page.maker.current()!.base.src;
  const hold = exe.hold('data_write');
  page.maker.setName('Renamed');
  closeButton().click();
  const dialog = document.querySelector('dialog.closing')!;
  assert.ok(dialog, 'the dialog is up');
  drop(dialog, { items: [], files: [image('main.png')], types: ['Files'] });
  await tick();
  gates.splice(0).forEach(g => g()); /* had it got in, its art would be done now */
  await tick();
  assert.strictEqual(page.maker.current()!.base.src, before, 'the main image is untouched');
  hold();
  await r.done();
  await tick();
  assert.ok(!exe.windows.has(page.label));
  assert.strictEqual(whole(exe, 'c1').name, 'Renamed');
});

test('a folder still being read when Close starts is waited for, all the way to its import landing', async () => {
  const { exe, r, page, gates } = await open();
  /* A folder whose one file comes back when the test says. */
  let giveFile = () => {};
  const file = image('main.png');
  const entry = { isFile: true, isDirectory: false, fullPath: '/Pip/main.png', file(done: (f: File) => void) { giveFile = () => done(file); } };
  const folder = { isFile: false, isDirectory: true, fullPath: '/Pip', createReader() { let sent = false; return { readEntries(done: (e: unknown[]) => void) { done(sent ? [] : [entry]); sent = true; } }; } };
  drop(document.body, { items: [{ webkitGetAsEntry: () => folder }], files: [], types: ['Files'] });
  await tick();
  const hold = exe.hold('data_write');
  page.maker.setName('Renamed');
  closeButton().click();
  await tick();
  giveFile(); /* the folder's file comes back after Close has started */
  await tick();
  hold();
  await r.done();
  await tick();
  assert.ok(exe.windows.has(page.label), 'not closed while the import is still running');
  gates.splice(0).forEach(g => g());
  await r.done();
  await tick();
  await r.done();
  assert.ok(!exe.windows.has(page.label), 'and once it lands, it closes');
  const disk = whole(exe, 'c1');
  assert.strictEqual(disk.name, 'Renamed');
  assert.strictEqual(disk.base.src, png('main.png'), 'with the folder\'s image in');
});

/* A rejection the real page logs. Vitest would call it a failure, so it's caught here and counted. */
function rejections() {
  const theirs = process.listeners('unhandledRejection'), caught: unknown[] = [];
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', e => { caught.push(e); });
  return { caught, restore() { process.removeAllListeners('unhandledRejection'); for (const l of theirs) process.on('unhandledRejection', l); } };
}

test('a drop whose quick part fails still waits for its slow part', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1'))), gates: (() => void)[] = [];
  const failing = {
    ...art,
    processBase: async (src: string) => { if (src === png('pic.png')) throw new Error('unreadable'); return art.processBase(src); },
    fromShimeji: async () => { await new Promise<void>(g => { gates.push(g); }); return null; }
  };
  const page = await makerOn(r, undefined, { dom: true, art: failing });
  await r.done();
  const seen = rejections();
  try {
    drop(document.body, { items: [], files: [1, 2, 3, 4].map(i => image(`shime${i}.png`)).concat(image('pic.png')), types: ['Files'] });
    await tick();
    assert.strictEqual(gates.length, 1, 'the Shimeji set is being made, and the other image has failed');
    closeButton().click();
    await r.done();
    await tick();
    assert.ok(exe.windows.has(page.label), 'one part failing doesn\'t end the drop\'s work');
    gates.splice(0).forEach(g => g());
    await tick();
    await r.done();
    await tick();
    assert.ok(!exe.windows.has(page.label), 'and once it all has, it closes');
    assert.strictEqual(seen.caught.length, 1, 'with the failure still showing');
  } finally { seen.restore(); }
});

test('art asked for once Close is under way isn\'t added, and the person is told', async () => {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1')));
  await makerOn(r, undefined, { dom: true });
  await r.done();
  const hold = exe.hold('window_close');
  closeButton().click();
  await r.done();
  await tick();
  document.querySelector<HTMLButtonElement>('[data-sample]')!.click(); /* inert stops this in a browser; here it gets through */
  await tick();
  assert.ok(document.body.textContent!.includes('The Maker is closing, so that wasn\'t added.'));
  hold();
});
