/* The contract check's hub. It calls every command through the app's real client and logs a line
   per check. The driver (driver.ps1) does what a page can't: read window styles, move a real
   window, change the work area, launch a second instance, read the registry. There is no test
   code in the exe. A check that didn't run says SKIP, never PASS.

   The log is the channel out: `CHECK PASS|FAIL|SKIP name detail`, and `STEP n action json` asks
   the driver for something. Its answer comes back as the file driver/<n>.json. */
import { createShell, text, type Monitor, type Opened, type System, type WindowEntry, type WindowSnapshot } from '../src/shell';

const shell = createShell(window.__TAURI__);
class Skip extends Error {}
const skip = (why: string): never => { throw new Skip(why); };
const fail = (why: string): never => { throw new Error(why); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const say = (line: string) => shell.log(line);
function ok(v: unknown, why: string) { if (!v) fail(why); }
function same(a: unknown, b: unknown, what: string) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) fail(`${what}: got ${x}, want ${y}`); }
async function refused(p: Promise<unknown>, what: string) {
  let passed = false;
  try { await p; passed = true; } catch { /* the answer we want */ }
  if (passed) fail(what + ' was not refused');
}

async function check(name: string, f: () => Promise<unknown>) {
  try {
    const r = await f();
    await say(`CHECK PASS ${name} ${r ?? ''}`);
  } catch (e) {
    await say(`CHECK ${e instanceof Skip ? 'SKIP' : 'FAIL'} ${name} ${e instanceof Error ? e.message : e}`);
  }
}
const owner = (name: string, why: string) => say(`CHECK SKIP ${name} ${why}`);

async function until<T>(f: () => T | Promise<T>, ms: number, what: string): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v as NonNullable<T>;
    if (Date.now() > end) return fail('timed out waiting for ' + what);
    await sleep(50);
  }
}

/* asks the driver, and waits for its answer */
let stepN = 0;
async function step<T = Record<string, unknown>>(action: string, args: object = {}, ms = 30000): Promise<T> {
  const n = ++stepN, file = `driver/${n}.json`;
  await say(`STEP ${n} ${action} ${JSON.stringify(args)}`);
  const bytes = await until(() => shell.dataRead(file).catch(() => null), ms, `driver ${action}`);
  const r = JSON.parse(text(bytes)) as T & { error?: string };
  if (r.error) fail(`driver ${action}: ${r.error}`);
  return r;
}

/* the pages */
const channel = new BroadcastChannel('check');
const hello = new Set<string>(), replies = new Map<number, { value?: unknown; error?: string }>();
channel.onmessage = ({ data: m }) => { if (m.hello) hello.add(m.hello); if (m.reply) replies.set(m.reply, m); };
let askN = 0;
async function ask<T = unknown>(to: string, cmd: string, args?: object, ms = 8000): Promise<T> {
  const id = ++askN;
  channel.postMessage({ to, cmd, args, id });
  const r = await until(() => replies.get(id), ms, `${to} ${cmd}`);
  if (r.error) fail(r.error);
  return r.value as T;
}
const up = (label: string) => until(() => hello.has(label), 15000, label + ' to load');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const WEBP = 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const bytes = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const CAP = 64 * 1024 * 1024, MIB = 1024 * 1024;
const served = (p: string) => fetch(p).catch(() => null);
const contentType = async (p: string) => (await served(p))?.headers.get('content-type');

function imagePixel(src: string) {
  return new Promise<number[]>((done, no) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 1;
      const x = c.getContext('2d')!; x.drawImage(im, 0, 0);
      done([...x.getImageData(0, 0, 1, 1).data]);
    };
    im.onerror = () => no(new Error('image failed: ' + src));
    im.src = src;
  });
}

const events = {
  monitors: [] as Monitor[][], windows: [] as { at: number; s: WindowSnapshot }[], system: [] as System[], opened: [] as Opened[],
  second: [] as string[][], data: [] as string[], cursor: [] as { x: number; y: number; down: boolean; right: boolean }[]
};

async function data() {
  await check('data.roundtrip', async () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    await shell.dataWrite('t/ñu í/all bytes.bin', all);
    same([...await shell.dataRead('t/ñu í/all bytes.bin')], [...all], 'bytes');
  });
  await check('data.big', async () => {
    const big = new Uint8Array(20e6).fill(7); big[19999999] = 9;
    const t = performance.now();
    await shell.dataWrite('t/big.bin', big);
    const back = await shell.dataRead('t/big.bin');
    ok(back.length === big.length && back[19999999] === 9, 'big file changed');
    await shell.dataDelete('t/big.bin');
    return `20 MB out and back in ${Math.round(performance.now() - t)} ms`;
  });
  await check('data.cap', async () => {
    await shell.dataWrite('t/keep.txt', 'old');
    await refused(shell.dataWrite('t/keep.txt', new Uint8Array(64 * 1024 * 1024 + 1)), 'a file over the cap');
    same(text(await shell.dataRead('t/keep.txt')), 'old', 'the old file');
    await shell.dataWrite('t/at-cap.bin', new Uint8Array(64 * 1024 * 1024));
    await shell.dataDelete('t/at-cap.bin');
  });
  await check('data.read_cap', async () => {
    await step('sized', { file: 't/over.bin', bytes: CAP + 1 });
    await refused(shell.dataRead('t/over.bin'), 'a file over the cap');
    await step('sized', { file: 't/at.bin', bytes: CAP });
    same((await shell.dataRead('t/at.bin')).length, CAP, 'a file at the cap');
    await shell.dataDelete('t/over.bin'); await shell.dataDelete('t/at.bin');
  });
  /* The file crosses the cap while it's being read. Whether a read lands on the moment it crosses
     is luck, so this shows no read ever comes back over. The exact limit has a unit test. */
  await check('data.read_growing', async () => {
    const file = 't/grow.bin';
    await step('sized', { file, bytes: 60 * MIB });
    let growing = true, reads = 0, refusals = 0, largest = 0;
    const grown = step('grow', { file, to: CAP + 8 * MIB }).finally(() => { growing = false; });
    while (growing) {
      const r = await shell.dataRead(file).catch(() => null);
      if (!r) { refusals++; continue; }
      reads++; largest = Math.max(largest, r.length);
      ok(r.length <= CAP, `a read of ${r.length} bytes`);
    }
    await grown;
    await refused(shell.dataRead(file), 'the grown file');
    await shell.dataDelete(file);
    return `${reads} reads up to ${largest} bytes, ${refusals} refused while it grew`;
  });
  await check('data.list', async () => {
    const l = await shell.dataList('t');
    ok(l.some(e => e.name === 'keep.txt' && !e.dir && e.size === 3 && e.modified > 0), 'file entry');
    ok(l.some(e => e.name === 'ñu í' && e.dir), 'folder entry');
    ok((await shell.dataList('')).some(e => e.name === 't'), 'the root lists');
    await refused(shell.dataList('nothing-here'), 'a missing folder');
  });
  await check('data.move', async () => {
    await shell.dataWrite('t/a.txt', 'a'); await shell.dataWrite('t/b.txt', 'b');
    await refused(shell.dataMove('t/a.txt', 't/b.txt'), 'a move over a file');
    await shell.dataMove('t/a.txt', 't/moved/c.txt');
    same(text(await shell.dataRead('t/moved/c.txt')), 'a', 'moved file');
    await refused(shell.dataRead('t/a.txt'), 'the old name');
  });
  await check('data.move_race', async () => {
    const N = 8, ROUNDS = 15, each = <T>(f: (i: number) => T) => Array.from({ length: N }, (_, i) => f(i));
    for (let round = 0; round < ROUNDS; round++) {
      await Promise.all(each(i => shell.dataWrite(`t/race/s${i}`, String(i))));
      const r = await Promise.allSettled(each(i => shell.dataMove(`t/race/s${i}`, 't/race/to')));
      const won = r.flatMap((x, i) => x.status === 'fulfilled' ? [i] : []);
      same(won.length, 1, `winners in round ${round} (${won})`);
      same(text(await shell.dataRead('t/race/to')), String(won[0]), `the file at the name in round ${round}`);
      same((await shell.dataList('t/race')).length, N, `files left in round ${round}`);
      await shell.dataDelete('t/race');
    }
    return `${ROUNDS} rounds of ${N} moves to one name`;
  });
  await check('data.delete', async () => {
    await shell.dataDelete('t/moved');
    await refused(shell.dataRead('t/moved/c.txt'), 'a deleted file');
    await shell.dataDelete('t/never-was');
    await refused(shell.dataDelete(''), 'deleting the whole folder');
  });
  await check('data.refused', async () => {
    const bad = ['../x', '..\\x', 'a/../../x', 'C:\\Windows\\win.ini', 'C:/Windows/win.ini', '\\\\localhost\\c$\\x', '/Windows/win.ini', 'a:b', 't/keep.txt:stream', 'nul', 'con.txt', 'x.', 'x '];
    for (const p of bad) {
      await refused(shell.dataRead(p), 'read ' + p);
      await refused(shell.dataWrite(p, 'x'), 'write ' + p);
      await refused(shell.dataDelete(p), 'delete ' + p);
      await refused(shell.dataList(p), 'list ' + p);
      await refused(shell.dataMove(p, 'x'), 'move from ' + p);
      await refused(shell.dataMove('t/keep.txt', p), 'move to ' + p);
    }
    return `${bad.length} paths on 6 commands`;
  });
  await check('data.changed', async () => {
    events.data.length = 0;
    await shell.dataWrite('t/ev.txt', 'x'); await shell.dataDelete('t/ev.txt');
    await until(() => events.data.filter(p => p === 't/ev.txt').length === 2, 3000, 'data-changed');
  });
}

async function library() {
  await shell.dataWrite('library/t/a.png', bytes(PNG));
  await shell.dataWrite('library/t/b.webp', bytes(WEBP));
  await shell.dataWrite('secret.txt', 'not served');
  await check('library.canvas', async () => { same((await imagePixel('library/t/a.png'))[3], 255, 'alpha read from the canvas'); });
  await check('library.query', async () => {
    await imagePixel('library/t/a.png?v=12345');
    await imagePixel('library/t/b.webp?v=1#x');
  });
  await check('library.type', async () => { same((await fetch('library/t/b.webp')).headers.get('content-type'), 'image/webp', 'content type'); });
  await check('library.images_only', async () => {
    await shell.dataWrite('library/t/evil.png', '<!doctype html><script>document.title = "ran"</script>');
    await shell.dataWrite('library/t/plain.png', '<script>document.title = "ran"</script>');
    await shell.dataWrite('library/t/evil.html', bytes(PNG));
    await shell.dataWrite('library/t/evil.svg', '<svg xmlns="http://www.w3.org/2000/svg" onload="document.title = 1"/>');
    await shell.dataWrite('library/t/buddy.json', '{}');
    for (const p of ['evil.png', 'plain.png', 'evil.html', 'evil.svg', 'buddy.json']) {
      const r = await served('library/t/' + p);
      ok(!r?.ok, `${p} served as ${r?.headers.get('content-type')}`);
    }
    same((await imagePixel('library/t/a.png'))[3], 255, 'a real image beside them');
    same(await contentType('library/t/a.png'), 'image/png', 'its type');
  });
  await check('library.formats', async () => {
    const sig = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0));
    const files: [string, Uint8Array | string, string][] = [
      ['s.png', sig('\x89PNG\r\n\x1a\n'), 'image/png'], ['s.jpg', sig('\xff\xd8\xff'), 'image/jpeg'], ['s.gif', sig('GIF89a'), 'image/gif'],
      ['s.webp', sig('RIFF\0\0\0\0WEBP'), 'image/webp'],
      /* the bytes are what's served, so a signature with a page after it has to stay an image */
      ['poly.png', sig('\x89PNG\r\n\x1a\n<script>document.title = "ran"</script>'), 'image/png']
    ];
    for (const [name, content, type] of files) {
      await shell.dataWrite('library/t/' + name, content);
      same(await contentType('library/t/' + name), type, name);
    }
  });
  await check('library.only', async () => {
    for (const p of ['secret.txt', 'library/../secret.txt', 'library/%2e%2e/secret.txt', 'library/..%5csecret.txt']) {
      const r = await fetch(p).then(x => x.text().then(t => (x.ok ? t : '')), () => '');
      ok(!r.includes('not served'), p + ' reached the data folder');
    }
    ok(!(await fetch('library/t/none.png').then(x => x.ok, () => false)), 'a missing image');
  });
}

/* The exe's contract. API 2's own checks say SKIP on API 1. */
let api = 1;
const needs2 = () => { if (api < 2) skip('API 1 has no such thing'); };
const CAN = ['raise', 'tool-overlays', 'window-focus-spec', 'window-closed', 'focus-restores', 'save-atomic', 'save-owner', 'quit-wait'];

async function info() {
  await check('info', async () => {
    const i = await shell.info();
    api = i.api;
    ok(i.api === 1 || i.api === 2, `a known api: ${i.api}`);
    same(i.platform, 'windows', 'platform');
    if (i.api >= 2) same(i.can, CAN, 'what it can do');
    ok(i.version && i.dataDir, 'version and data folder');
    ok(i.args.includes('--marker') && i.args.includes('passed'), 'raw arguments');
    return `api ${i.api} version ${i.version}`;
  });
  await check('monitors.shape', async () => {
    const m = await shell.monitors();
    ok(m.length >= 1, 'a monitor');
    same(m.filter(x => x.primary).length, 1, 'primary monitors');
    for (const x of m) ok(x.name && x.scale > 0 && x.w > 0 && x.h > 0 && x.full.w >= x.w && x.full.h >= x.h, 'a whole monitor');
    return JSON.stringify(m);
  });
  await check('system', async () => {
    const s = await shell.system();
    ok(['normal', 'fullscreen', 'presentation', 'busy', 'away'].includes(s.userState), 'a known state');
    same([typeof s.onBattery, typeof s.saver], ['boolean', 'boolean'], 'flags');
    return JSON.stringify(s);
  });
  await check('open_external.refused', async () => {
    for (const u of ['http://example.com', 'file:///C:/Windows/win.ini', 'javascript:alert(1)', 'calc.exe', 'ms-settings:']) await refused(shell.openExternal(u), u);
  });
  await check('open_external.https', async () => {
    const before = await step<{ count: number }>('browsers');
    await shell.openExternal('https://example.com/');
    const r = await until(async () => { const a = await step<{ count: number }>('browsers'); return a.count > before.count ? a : null; }, 8000, 'a browser').catch(() => null);
    await step('close-browsers');
    if (!r) skip('the call succeeded, but no browser process could be seen');
  });
  await check('tray.set', async () => {
    await shell.traySet({ tooltip: 'check', icon: 'icon.png', items: [{ label: 'Sub', items: [{ id: 'a', label: 'A', checked: true }, { separator: true }, { id: 'b', label: 'B', enabled: false }] }, { id: 'c', label: 'C' }] });
    await shell.traySet({ items: [] });
  });
  await check('tray.refused', async () => {
    await refused(shell.traySet({ items: [{ id: 'shell:quit', label: 'Stay' }] }), 'an item posing as Quit');
    await refused(shell.traySet({ items: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] }), 'a repeated id');
    await refused(shell.traySet({ icon: '../icon.png' }), 'an icon outside the app folder');
    await refused(shell.traySet({ icon: 'none.png' }), 'a missing icon');
  });
}

async function launchFiles() {
  await check('take_opened', async () => {
    const f = await shell.takeOpened();
    same(f.map(x => [x.name, x.content]), [['launch.buddy', 'from launch']], 'files from launch');
    same(await shell.takeOpened(), [], 'a second read');
  });
  await check('second_launch', async () => {
    events.second.length = 0; events.opened.length = 0;
    const r = await step<{ exit: number; ms: number }>('second', { args: ['--again', 'rel.buddy', 'x.buddy.json', 'huge.buddy', 'missing.buddy'] });
    same(r.exit, 0, 'its exit code');
    await until(() => events.opened.length === 4, 6000, 'open-file');
    ok(events.second[0]?.includes('--again'), 'second-launch args');
    const by = (n: string) => events.opened.find(f => f.name === n)!;
    same(by('rel.buddy').content, 'relative', 'a path relative to the second launch');
    same(by('x.buddy.json').content, 'double', 'a .buddy.json');
    same(by('huge.buddy').error, 'too big', 'the size cap');
    ok(by('missing.buddy').error, 'a missing file');
    return `second process gone in ${r.ms} ms`;
  });
}

const OVERLAY = 'check-overlay', WINDOW = 'check-window';
const facts = (title: string) => step<{ found: boolean; x: number; y: number; w: number; h: number; transparent: boolean; layered: boolean; topmost: boolean; noactivate: boolean; visible: boolean; frameless: boolean; frame: string; hit: boolean; hwnd: number; icon: boolean; tool: boolean; appwindow: boolean }>('facts', { title });

async function overlays(work: Monitor) {
  const place = { x: work.x + 100, y: work.y + 100, w: 600, h: 400 };
  await check('overlay.open', async () => {
    await shell.windowOpen({ kind: 'overlay', label: 'ov1', page: 'page.html', title: OVERLAY, boot: { label: 'ov1', hello: 'é"</script>' }, ...place });
    await up('ov1');
    const p = await ask<{ boot: { hello: string }; origin: string }>('ov1', 'ping');
    same(p.boot.hello, 'é"</script>', 'boot data');
    return p.origin;
  });
  await check('overlay.styles', async () => {
    const f = await facts(OVERLAY);
    ok(f.found && f.visible, 'a visible window');
    same([f.x, f.y, f.w, f.h], [place.x, place.y, place.w, place.h], 'its place');
    same([f.transparent, f.layered, f.topmost, f.noactivate, f.frameless], [true, true, true, true, true], 'transparent layered topmost noactivate frameless');
  });
  await check('overlay.clickthrough', async () => { same((await facts(OVERLAY)).hit, false, 'the mouse landing on it'); });
  await check('capture.take', async () => {
    await ask('ov1', 'capture', { on: true });
    const f = await facts(OVERLAY);
    same([f.transparent, f.hit], [false, true], 'transparent and hit');
    await ask('ov1', 'capture', { on: false });
    same((await facts(OVERLAY)).transparent, true, 'transparent after giving it back');
  });
  await check('capture.renewed', async () => {
    await ask('ov1', 'capture', { on: true }); await ask('ov1', 'renew', { on: true });
    await sleep(3000);
    same((await facts(OVERLAY)).transparent, false, 'transparent while renewing');
  });
  await check('overlay.noactivate', async () => {
    const before = await ask<number>('ov1', 'presses');
    const r = await step<{ same: boolean; before: number; after: number; skipped?: string }>('click', { x: place.x + 200, y: place.y + 200 });
    if (r.skipped) skip(r.skipped);
    await until(async () => (await ask<number>('ov1', 'presses')) > before, 3000, 'the page to see the press');
    same(r.same, true, 'the foreground window staying as it was');
    ok(events.cursor.some(c => c.down), 'the press in the cursor stream');
    await step('right-click', { x: place.x + 220, y: place.y + 200 });
    await until(() => events.cursor.some(c => c.right), 3000, 'the right button in the cursor stream');
    return `foreground ${r.before} before and after`;
  });
  await check('capture.lease', async () => {
    await ask('ov1', 'renew', { on: false });
    const t = performance.now();
    await until(async () => (await facts(OVERLAY)).transparent, 5000, 'click-through to come back');
    return `back after ${Math.round(performance.now() - t)} ms`;
  });
  /* Turning it on and off at once must not leave the window taking the mouse with no lease. Giving
     it back only touches the window if there's a lease, so that's the state this catches. Whether
     a round lands in the old gap is luck, which is why there are many. */
  await check('capture.storm', async () => {
    const ROUNDS = 150;
    for (let round = 0; round < ROUNDS; round++) {
      await ask('ov1', 'storm', { count: 6 });
      await ask('ov1', 'capture', { on: false });
      same((await facts(OVERLAY)).transparent, true, `transparent with no lease, after round ${round}`);
    }
    await ask('ov1', 'storm', { count: 2001 }, 20000);
    await until(async () => (await facts(OVERLAY)).transparent, 4000, 'click-through after a long storm');
    await ask('ov1', 'capture', { on: true });
    same((await facts(OVERLAY)).transparent, false, 'transparent when held after the storm');
    await ask('ov1', 'capture', { on: false });
    same((await facts(OVERLAY)).transparent, true, 'transparent when given back after the storm');
    return `${ROUNDS} rounds`;
  });
  await check('capture.dead_page', async () => {
    await ask('ov1', 'capture', { on: true });
    same((await facts(OVERLAY)).transparent, false, 'transparent while held');
    await ask('ov1', 'renew', { on: false }); await ask('ov1', 'hang');
    await until(async () => (await facts(OVERLAY)).transparent, 5000, 'the lease to run out on a hung page');
  });
  await check('capture.refused', async () => { await refused(shell.capture(true), 'capture from the hub'); });
  await check('window.close_hung', async () => {
    await shell.windowClose('ov1');
    await until(async () => !(await facts(OVERLAY)).found, 8000, 'the hung overlay to go');
  });
  hello.clear();
  await shell.windowOpen({ kind: 'overlay', label: 'ov2', page: 'page.html', title: OVERLAY, boot: { label: 'ov2' }, ...place });
  await up('ov2');
  await check('window.place', async () => {
    const to = { x: place.x + 50, y: place.y + 60, w: 500, h: 300 };
    await shell.windowPlace('ov2', to);
    await until(async () => { const f = await facts(OVERLAY); return f.x === to.x && f.y === to.y && f.w === to.w && f.h === to.h; }, 4000, 'the new place');
  });
  await check('nav.refused', async () => {
    for (const url of ['http://example.com/', 'file:///C:/Windows/win.ini', 'http://tauri.localhost.example.com/']) await ask('ov2', 'go', { url });
    await sleep(1200);
    same((await ask<{ origin: string }>('ov2', 'ping')).origin, 'http://tauri.localhost', 'the page staying local');
  });
  await check('nav.https_to_browser', async () => {
    const before = await step<{ count: number }>('browsers');
    await ask('ov2', 'go', { url: 'https://example.com/' });
    await sleep(1500);
    same((await ask<{ origin: string }>('ov2', 'ping')).origin, 'http://tauri.localhost', 'the page staying local');
    const after = await step<{ count: number }>('browsers');
    await step('close-browsers');
    if (after.count <= before.count) skip('the page stayed local, but no browser process could be seen');
  });
  await check('nav.popup', async () => {
    same(await ask('ov2', 'popup', { url: 'http://example.com/' }), 'null', 'window.open');
    await sleep(500);
    same((await ask<{ origin: string }>('ov2', 'ping')).origin, 'http://tauri.localhost', 'the page staying local');
  });
  await check('sound.no_gesture', async () => { same(await ask('ov2', 'sound'), 'running', 'an AudioContext with no click'); });
}

async function windows() {
  await check('window.open', async () => {
    await shell.windowOpen({ kind: 'window', label: 'w1', page: 'page.html', title: WINDOW, boot: { label: 'w1' }, width: 640, height: 480, minWidth: 300, minHeight: 200, center: true, decorations: false, resizable: true, shadow: true, skipTaskbar: false });
    await up('w1');
    const f = await facts(WINDOW);
    ok(f.found && f.visible, 'a visible window');
    same([f.frameless, f.noactivate, f.topmost], [true, false, false], `${f.frame}: frameless noactivate topmost`);
  });
  await check('window.refused', async () => {
    const spec = { kind: 'window', label: 'w1', page: 'page.html' } as const;
    await refused(shell.windowOpen(spec), 'a label in use');
    await refused(shell.windowOpen({ ...spec, label: 'hub' }), 'the hub label');
    await refused(shell.windowOpen({ ...spec, label: 'w2', page: '../page.html' }), 'a page outside the app');
    await refused(shell.windowOpen({ ...spec, label: 'w2', page: 'https://example.com/' }), 'a remote page');
    await refused(shell.windowClose('none'), 'closing nothing');
    await refused(shell.windowIcon('w1', '../icon.png'), 'an icon outside the app');
  });
  await check('window.hide_show', async () => {
    await shell.windowHide('w1'); await until(async () => !(await facts(WINDOW)).visible, 3000, 'hidden');
    await shell.windowShow('w1'); await until(async () => (await facts(WINDOW)).visible, 3000, 'shown');
  });
  await check('window.focus', async () => {
    await shell.windowFocus('w1');
    await until(async () => (await step<{ hwnd: number }>('foreground')).hwnd === (await facts(WINDOW)).hwnd, 3000, 'the foreground');
  });
  await check('window.icon', async () => {
    await shell.windowIcon('w1', 'icon.png');
    await until(async () => (await facts(WINDOW)).icon, 3000, 'an icon on the window');
  });
  await check('window.titlebar', async () => {
    await ask('w1', 'titlebar', { what: 'toggleMaximize' });
    await until(() => ask('w1', 'maximized'), 3000, 'maximized');
    await ask('w1', 'titlebar', { what: 'unmaximize' });
    await ask('w1', 'titlebar', { what: 'minimize' });
    await shell.windowShow('w1');
    let error = '';
    await ask('w1', 'titlebar', { what: 'startDragging' }).catch(e => { error = String(e); });
    ok(!/not allowed/i.test(error), 'dragging is granted: ' + error);
  });
  await check('window.minimize_call', async () => {
    await shell.windowMinimize('w1');
    await until(() => shell.windowMinimized('w1'), 3000, 'minimized');
    await shell.windowShow('w1');
  });
  await check('sound.second_window', async () => { same(await ask('w1', 'sound'), 'running', 'an AudioContext with no click'); });
  await check('window.close_page', async () => {
    await ask('w1', 'titlebar', { what: 'close' }).catch(() => null);
    await until(async () => !(await facts(WINDOW)).found, 4000, 'the window to go');
  });
}

/* API 2: overlays as tool windows that stay so, kept on top, windows that open without the
   keyboard, a word when any window goes, and focus that restores. */
async function next(work: Monitor) {
  const place = { x: work.x + 120, y: work.y + 120, w: 600, h: 400 }, TOOL = 'check-tool', TOP = 'check-on-top';
  const closed: string[] = [];
  if (api >= 2) await shell.on('window-closed', e => { closed.push(e.label); });
  await check('api2.overlay_tool_window', async () => {
    needs2();
    await shell.windowOpen({ kind: 'overlay', label: 'tool', page: 'page.html', title: TOOL, boot: { label: 'tool' }, ...place });
    await up('tool');
    const f = await facts(TOOL);
    same([f.tool, f.appwindow, f.noactivate, f.transparent, f.topmost], [true, false, true, true, true], 'tool, no app window, noactivate, transparent, topmost');
  });
  /* tao rebuilds the whole extended style on each of these, which is what wiped a bit set by hand. */
  await check('api2.tool_window_lasts', async () => {
    needs2();
    for (let round = 0; round < 5; round++) {
      await ask('tool', 'capture', { on: true });
      let f = await facts(TOOL);
      same([f.tool, f.noactivate, f.transparent], [true, true, false], `held, round ${round}`);
      await ask('tool', 'capture', { on: false });
      await shell.windowHide('tool'); await shell.windowShow('tool');
      f = await facts(TOOL);
      same([f.tool, f.noactivate, f.transparent, f.visible], [true, true, true, true], `given back, hidden and shown, round ${round}`);
    }
    await shell.windowPlace('tool', place);
    same((await facts(TOOL)).tool, true, 'after a place');
  });
  await check('api2.tool_window_click_keeps_focus', async () => {
    needs2();
    await ask('tool', 'capture', { on: true }); await ask('tool', 'renew', { on: true });
    const r = await step<{ same: boolean; skipped?: string }>('click', { x: place.x + 200, y: place.y + 200 });
    await ask('tool', 'renew', { on: false }); await ask('tool', 'capture', { on: false });
    if (r.skipped) skip(r.skipped);
    same(r.same, true, 'the foreground window staying as it was');
  });
  await check('api2.raise', async () => {
    needs2();
    await shell.windowOpen({ kind: 'window', label: 'top', page: 'page.html', title: TOP, boot: { label: 'top' }, width: 200, height: 150, decorations: false, alwaysOnTop: true, skipTaskbar: true, focused: false });
    await up('top');
    const ov = (await facts(TOOL)).hwnd, top = (await facts(TOP)).hwnd;
    await shell.raise(true);
    const other = await step<{ hwnd: number }>('testwin', { title: 'check-raise-other', x: place.x + 40, y: place.y + 40, w: 300, h: 200 });
    const rounds: number[] = [];
    for (let round = 0; round < 3; round++) {
      const front = await step<{ hwnd: number }>('on-top', { hwnd: other.hwnd });
      const t = performance.now();
      await until(async () => {
        const o = (await step<{ order: number[] }>('zorder', { hwnds: [top, ov, other.hwnd] })).order;
        return JSON.stringify(o) === JSON.stringify([top, ov, other.hwnd]);
      }, 3000, 'the menu, then the overlay, back above an always-on-top window');
      rounds.push(Math.round(performance.now() - t));
      same((await step<{ hwnd: number }>('foreground')).hwnd, front.hwnd, 'the foreground left as it was');
    }
    const f = await facts(TOOL);
    same([f.x, f.y, f.w, f.h], [place.x, place.y, place.w, place.h], 'the overlay not moved or resized');
    await shell.raise(false);
    await step('on-top', { hwnd: other.hwnd });
    await sleep(2500);
    same((await step<{ order: number[] }>('zorder', { hwnds: [ov, other.hwnd] })).order, [other.hwnd, ov], 'nothing raised once off');
    await step('close', { hwnd: other.hwnd });
    return `back on top after ${rounds.join(', ')} ms`;
  });
  await check('api2.window_unfocused', async () => {
    needs2();
    const before = await step<{ hwnd: number }>('foreground');
    await shell.windowOpen({ kind: 'window', label: 'quiet', page: 'page.html', title: 'check-quiet', boot: { label: 'quiet' }, width: 300, height: 200, focused: false, focusable: false });
    await up('quiet');
    await sleep(500);
    same((await step<{ hwnd: number }>('foreground')).hwnd, before.hwnd, 'the foreground');
    same((await facts('check-quiet')).noactivate, true, 'focusable: false');
  });
  await check('api2.window_closed', async () => {
    needs2();
    closed.length = 0;
    await shell.windowClose('quiet');
    await step('close', { hwnd: (await facts(TOP)).hwnd });
    await shell.windowClose('tool');
    await until(() => ['quiet', 'top', 'tool'].every(l => closed.includes(l)), 5000, 'window-closed for each');
    return closed.join(' ');
  });
  await check('api2.focus_restores', async () => {
    needs2();
    await shell.windowOpen({ kind: 'window', label: 'mini', page: 'page.html', title: 'check-mini', boot: { label: 'mini' }, width: 300, height: 200 });
    await up('mini');
    await shell.windowMinimize('mini');
    await until(() => shell.windowMinimized('mini'), 3000, 'minimized');
    await shell.windowFocus('mini');
    await until(async () => !(await shell.windowMinimized('mini')), 3000, 'restored');
    await until(async () => (await step<{ hwnd: number }>('foreground')).hwnd === (await facts('check-mini')).hwnd, 3000, 'the foreground');
    await shell.windowClose('mini');
  });
}

async function worker() {
  const port = new SharedWorker('worker.js', { name: 'check' }).port; port.start();
  const askWorker = () => new Promise<{ id: string; ticks: number; age: number }>(done => { port.onmessage = e => done(e.data); port.postMessage('ask'); });
  await check('worker.survives', async () => {
    const seen = await ask<{ id: string; ticks: number }>('ov2', 'worker');
    same((await askWorker()).id, seen.id, 'one worker for hub and overlay');
    await shell.windowClose('ov2');
    await until(async () => !(await facts(OVERLAY)).found, 8000, 'the last overlay to go');
    await sleep(2500);
    const after = await askWorker();
    same(after.id, seen.id, 'the same worker with every overlay gone');
    ok(after.ticks > seen.ticks, 'its timer running');
    hello.clear();
    await shell.windowOpen({ kind: 'overlay', label: 'ov3', page: 'page.html', title: OVERLAY, boot: { label: 'ov3' }, x: 200, y: 200, w: 300, h: 200 });
    await up('ov3');
    same((await ask<{ id: string }>('ov3', 'worker')).id, seen.id, 'a new overlay finding the same worker');
    await shell.windowClose('ov3');
  });
  await check('hub.hidden_rate', async () => {
    let ticks = 0; const timer = setInterval(() => { ticks++; }, 50);
    const a = await askWorker(), t = performance.now();
    await sleep(5000);
    const b = await askWorker(), s = (performance.now() - t) / 1000;
    clearInterval(timer);
    const rate = (b.ticks - a.ticks) / s;
    ok(rate > 25, `worker timer at ${rate.toFixed(1)}/s`);
    return `hidden hub, no overlays: worker ${rate.toFixed(1)}/s, hub timer ${(ticks / s).toFixed(1)}/s, visibility ${document.visibilityState}`;
  });
  const soak = Number(await shell.info().then(i => i.args[i.args.indexOf('--soak') + 1]));
  await check('hub.soak', async () => {
    if (!soak) skip('needs the soak input on the workflow');
    const a = await askWorker();
    await sleep(soak * 1000);
    const b = await askWorker(), rate = (b.ticks - a.ticks) / ((b.age - a.age) / 1000);
    ok(rate > 25, `worker timer at ${rate.toFixed(1)}/s after ${soak} s`);
    events.cursor.length = 0;
    await step('cursor', { x: 321, y: 123 });
    const t = performance.now();
    await until(() => events.cursor.some(c => c.x === 321 && c.y === 123), 3000, 'a cursor event in the hidden hub');
    return `after ${soak} s hidden: worker ${rate.toFixed(1)}/s, cursor event in ${Math.round(performance.now() - t)} ms`;
  });
}

async function tracker() {
  const TITLE = 'check-private-title';
  const a = await step<{ hwnd: number }>('testwin', { title: TITLE + '-a', x: 300, y: 300, w: 500, h: 400 });
  const b = await step<{ hwnd: number }>('testwin', { title: TITLE + '-b', x: 420, y: 340, w: 500, h: 400 });
  const entry = (s: WindowSnapshot, h: number): WindowEntry | undefined => s.list.find(w => w.id === h);
  await check('tracker.listed', async () => {
    const s = await until(async () => { const n = await shell.windowsNow(); return entry(n, a.hwnd) && entry(n, b.hwnd) ? n : null; }, 5000, 'both windows');
    for (const h of [a.hwnd, b.hwnd]) {
      const w = entry(s, h)!, d = await step<{ x: number; y: number; w: number; h: number }>('bounds', { hwnd: h });
      same([w.x, w.y, w.w, w.h], [d.x, d.y, d.w, d.h], 'bounds against DWM');
      ok(w.exe.toLowerCase().includes('powershell') || w.exe.toLowerCase().includes('pwsh'), 'the exe name: ' + w.exe);
      ok(w.class.length > 0, 'a class name');
    }
    return `${s.list.length} windows`;
  });
  await check('tracker.order', async () => {
    const order = await step<{ order: number[] }>('zorder', { hwnds: [a.hwnd, b.hwnd] });
    const s = await shell.windowsNow();
    same(s.list.filter(w => w.id === a.hwnd || w.id === b.hwnd).map(w => w.id), order.order, 'order against EnumWindows');
    same(s.list.map(w => w.z), s.list.map((_, i) => i), 'z counting down the list');
  });
  await check('tracker.no_titles', async () => {
    const s = await shell.windowsNow();
    ok(!JSON.stringify(s).includes(TITLE), 'a title in the payload');
    same(Object.keys(s.list[0]!).sort(), ['class', 'exe', 'h', 'id', 'layered', 'max', 'tool', 'topmost', 'w', 'x', 'y', 'z'], 'entry fields');
  });
  await check('tracker.own_windows', async () => {
    await shell.windowOpen({ kind: 'overlay', label: 'ov4', page: 'page.html', title: OVERLAY, boot: { label: 'ov4' }, x: 900, y: 100, w: 200, h: 200 });
    const f = await until(async () => { const x = await facts(OVERLAY); return x.found ? x : null; }, 6000, 'the overlay');
    ok(!entry(await shell.windowsNow(), f.hwnd), 'our overlay in the list');
    await shell.windowClose('ov4');
  });
  await shell.windowsWatch(true);
  await check('tracker.move', async () => {
    await until(() => events.windows.length > 0, 2000, 'the first snapshot');
    events.windows.length = 0;
    const m = await step<{ at: number }>('move', { hwnd: a.hwnd, x: 350, y: 320 });
    const seen = await until(() => events.windows.find(e => { const w = entry(e.s, a.hwnd); return w && Math.abs(w.x - 350) < 20; }), 4000, 'the move');
    const ms = seen.at - m.at;
    ok(ms < 500, `seen after ${ms} ms`);
    return `seen after ${ms} ms`;
  });
  await check('tracker.minimize', async () => {
    const m = await step<{ at: number }>('minimize', { hwnd: a.hwnd });
    const gone = await until(() => events.windows.find(e => e.at >= m.at - 50 && !entry(e.s, a.hwnd)), 4000, 'it to leave the list');
    const r = await step<{ at: number }>('restore', { hwnd: a.hwnd });
    await until(() => events.windows.find(e => e.at >= r.at - 50 && entry(e.s, a.hwnd)), 4000, 'it to come back');
    return `gone after ${gone.at - m.at} ms`;
  });
  await check('tracker.close', async () => {
    const m = await step<{ at: number }>('close', { hwnd: b.hwnd });
    const gone = await until(() => events.windows.find(e => e.at >= m.at - 50 && !entry(e.s, b.hwnd)), 5000, 'it to leave the list');
    return `gone after ${gone.at - m.at} ms`;
  });
  await check('tracker.quiet', async () => {
    await sleep(500);
    events.windows.length = 0;
    await sleep(3000);
    return `${events.windows.length} snapshots in 3 s of nothing happening`;
  });
  await check('tracker.watch_off', async () => {
    await shell.windowsWatch(false);
    await sleep(300);
    events.windows.length = 0;
    await step('move', { hwnd: a.hwnd, x: 500, y: 400 });
    await sleep(1500);
    same(events.windows.length, 0, 'snapshots after stopping');
  });
  await step('close', { hwnd: a.hwnd });
}

async function mouse() {
  await check('cursor.event', async () => {
    events.cursor.length = 0;
    const r = await step<{ skipped?: string }>('cursor', { x: 77, y: 88 });
    if (r.skipped) skip(r.skipped);
    await until(() => events.cursor.some(c => c.x === 77 && c.y === 88), 3000, 'the cursor event');
    ok(events.cursor.every(c => typeof c.down === 'boolean' && typeof c.right === 'boolean'), 'button fields');
  });
}

async function workArea(first: Monitor) {
  await check('monitors.event', async () => {
    events.monitors.length = 0;
    const r = await step<{ how: string }>('workarea', { bottom: 123 });
    const m = await until(() => events.monitors.find(l => l.some(x => x.primary && (x.h !== first.h || x.y !== first.y))), 6000, 'the new work area');
    await step('workarea-restore');
    await until(() => events.monitors.some(l => l.some(x => x.primary && x.h === first.h && x.y === first.y)), 6000, 'the old work area');
    return `through ${r.how}: ${JSON.stringify(m.find(x => x.primary))}`;
  });
}

async function registry() {
  const run = () => step<{ value: string | null }>('reg-run');
  const assoc = () => step<{ ext: string | null; command: string | null }>('reg-assoc');
  await check('autostart', async () => {
    same(await shell.autostart(), false, 'off to begin with');
    same((await run()).value, null, 'the Run value');
    same(await shell.autostart(true), true, 'set');
    const v = (await run()).value;
    ok(v && /desktop-buddies\.exe"$/.test(v), 'the Run value: ' + v);
    same(await shell.autostart(), true, 'read back');
    same(await shell.autostart(false), false, 'cleared');
    same((await run()).value, null, 'the Run value after');
  });
  await check('file_assoc', async () => {
    same(await shell.fileAssoc(), false, 'off to begin with');
    same(await shell.fileAssoc(true), true, 'set');
    const r = await assoc();
    same(r.ext, 'dev.exvanitas.desktop-buddies.buddy', 'the .buddy key');
    ok(r.command && /desktop-buddies\.exe" "%1"$/.test(r.command), 'the open command: ' + r.command);
    events.opened.length = 0;
    await step('shell-open', { file: 'double-click.buddy' });
    await until(() => events.opened.some(f => f.name === 'double-click.buddy' && f.content === 'clicked'), 8000, 'the file opened through the association');
    same(await shell.fileAssoc(false), false, 'cleared');
    same(await assoc(), { ext: null, command: null }, 'the keys after');
  });
}

async function dialogs() {
  await check('save_as.cancel', async () => {
    const p = shell.saveAs({ name: 'check-cancel.txt', filters: [{ name: 'Text', extensions: ['txt'] }], content: 'x' });
    const r = await step<{ found: boolean }>('dialog', { action: 'cancel' });
    if (!r.found) skip('no dialog could be seen on the runner');
    same(await p, false, 'the answer');
  });
  await check('save_as.save', async () => {
    const p = shell.saveAs({ name: 'check-save.txt', content: 'saved through the dialog' });
    const r = await step<{ found: boolean; content?: string }>('dialog', { action: 'ok', file: 'check-save.txt' });
    if (!r.found) skip('no dialog could be seen on the runner');
    same(await p, true, 'the answer');
    const c = await step<{ content: string }>('saved-file', { file: 'check-save.txt' });
    same(c.content, 'saved through the dialog', 'the file');
  });
  /* API 2: the dialog belongs to the window named, and the file is replaced whole, keeping what the
     old one was, with nothing left beside it. */
  await check('api2.save_as_owner', async () => {
    needs2();
    await shell.windowOpen({ kind: 'window', label: 'asker', page: 'page.html', title: 'check-asker', boot: { label: 'asker' }, width: 400, height: 300 });
    await up('asker');
    await step('plant', { where: 'files', name: 'check-owned.txt', content: 'old' });
    const p = shell.saveAs({ name: 'check-owned.txt', owner: 'asker', content: 'owned' });
    const r = await step<{ found: boolean; owner: number; typed: boolean; confirmed: boolean; seen?: string }>('dialog', { action: 'ok', where: 'files', file: 'check-owned.txt', confirm: true });
    if (!r.found) skip('no dialog could be seen on the runner');
    /* The outcome is what counts: whether a replace prompt came up, and was answered, is only told. */
    ok(r.typed, `the path typed into the dialog (replace prompt answered: ${r.confirmed}${r.seen ? `; no Yes found, saw: ${r.seen}` : ''})`);
    same(await Promise.race([p, sleep(15000).then(() => 'no answer in 15 s')]), true, `the answer (replace prompt answered: ${r.confirmed}${r.seen ? `; saw: ${r.seen}` : ''})`);
    same(r.owner, (await facts('check-asker')).hwnd, 'the dialog\'s owner');
    const f = await step<{ content: string; attrs: string }>('peek', { where: 'files', name: 'check-owned.txt', remove: true });
    same(f.content, 'owned', 'the file');
    ok(/NotContentIndexed/.test(f.attrs), `the old file's attributes kept by the replace: ${f.attrs}`);
    same((await step<{ names: string[] }>('list', { where: 'files' })).names.filter(n => n.startsWith('.~')), [], 'no temp file left');
    await shell.windowClose('asker');
  });
  await check('open_data_folder', async () => {
    await shell.openDataFolder();
    const s = await until(async () => (await shell.windowsNow()).list.find(w => w.class === 'CabinetWClass'), 6000, 'Explorer').catch(() => null);
    if (!s) return skip('the call succeeded, but no Explorer window could be seen');
    await step('close', { hwnd: s.id });
  });
}

async function main() {
  addEventListener('error', e => { void say(`CHECK FAIL page.error ${e.message}`); });
  addEventListener('unhandledrejection', e => { void say(`CHECK FAIL page.rejected ${e.reason}`); });
  await shell.on('monitors', m => { events.monitors.push(m); });
  await shell.on('windows', s => { events.windows.push({ at: Date.now(), s }); });
  await shell.on('system', s => { events.system.push(s); });
  await shell.on('open-file', f => { events.opened.push(f); });
  await shell.on('second-launch', e => { events.second.push(e.args); });
  await shell.on('data-changed', e => { events.data.push(e.path); });
  await shell.on('cursor', c => { events.cursor.push(c); if (events.cursor.length > 500) events.cursor.shift(); });
  await shell.on('quitting', q => {
    void say('quitting seen by the hub');
    /* API 2: the run waits for this page. The driver looks for the file written after the wait. */
    if (q) void (async () => {
      await shell.quitWait();
      await say('quit wait asked');
      await sleep(1500);
      await shell.dataWrite('quit-held.txt', 'held');
      await shell.quitReady();
    })();
  });
  const [first] = (await shell.monitors()).filter(m => m.primary);

  /* A section that breaks says so, and the rest still run. */
  const sections: [string, () => Promise<void>][] = [
    ['info', info], ['data', data], ['library', library], ['launch', launchFiles], ['mouse', mouse], ['overlays', () => overlays(first!)],
    ['windows', windows], ['next', () => next(first!)], ['worker', worker], ['tracker', tracker], ['work_area', () => workArea(first!)], ['registry', registry], ['dialogs', dialogs]
  ];
  for (const [name, f] of sections) await f().catch(e => say(`CHECK FAIL section.${name} ${e}`));

  await owner('system.event', 'the session state never changes on a runner, so only the read is proven');
  await owner('owner.smart_app_control', 'only the real PC can say');
  await owner('owner.tray_clicks', 'no way to click the tray on a runner');
  await owner('owner.monitor_unplug', 'one fixed display on a runner');
  await owner('owner.feel', 'needs a person');
  await say('DONE');
  await shell.quit();
}
void main().catch(e => say(`CHECK FAIL main ${e}`));
