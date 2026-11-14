/* The built Manager page in a real headless browser, against the real hub and client on the fake exe,
   with real art. It clicks through what a person would, checks it, and screenshots every state.
     pnpm test:manager [--shots=dir] [--only=word] [--perf]
   Needs a Chromium that's already installed: set CHROME_PATH, or it looks in Playwright's cache. */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { build } from 'vite';
import { playerBundle } from '../../player-bundle.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url)), DESKTOP = path.resolve(HERE, '../..'), REPO = path.resolve(DESKTOP, '../..');
const APP = path.join(DESKTOP, 'dist/app'), ART = path.join(REPO, 'packages/test-support/art');
const flag = name => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);
const SHOTS = flag('shots') || fs.mkdtempSync(path.join(os.tmpdir(), 'manager-shots-'));
const ONLY = flag('only'), PERF = process.argv.includes('--perf');
fs.mkdirSync(SHOTS, { recursive: true });

function chrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  const found = fs.existsSync(cache) ? fs.readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => b.split('-')[1] - a.split('-')[1]) : [];
  if (found.length) return path.join(cache, found[0], 'chrome-linux64/chrome');
  throw new Error('no Chromium found: set CHROME_PATH');
}

/* the fake hub, bundled for the page it runs in */
const HARNESS = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-hub-'));
await build({
  root: DESKTOP, configFile: false, logLevel: 'error', publicDir: false,
  build: { outDir: HARNESS, emptyOutDir: false, minify: false, lib: { entry: path.join(HERE, 'fake-hub.ts'), formats: ['iife'], name: 'FakeHub', fileName: () => 'hub.js' } }
});

/* the real Maker page's logic, with the Maker where this can reach it */
await build({
  root: DESKTOP, configFile: false, logLevel: 'error', publicDir: false, plugins: [playerBundle()],
  build: { outDir: HARNESS, emptyOutDir: false, minify: false, rollupOptions: { input: path.join(HERE, 'maker-page.ts'), output: { format: 'iife', entryFileNames: 'maker-page.js' } } }
});

const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.woff2': 'font/woff2', '.png': 'image/png' };
/* What the exe's asset provider does for the app folder. library/ is routed to the fake exe below. */
const server = http.createServer((q, a) => {
  const p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/__hub.html') { a.writeHead(200, { 'content-type': 'text/html' }); return a.end('<!doctype html><meta charset=utf-8><title>hub</title><script src="__hub.js"></script>'); }
  const f = p === '/__hub.js' ? path.join(HARNESS, 'hub.js') : p === '/maker.js' ? path.join(HARNESS, 'maker-page.js') : p === '/__sample.json' ? path.join(REPO, 'packages/test-support/fixtures/sample.json') : p.startsWith('/__art/') ? path.join(ART, p.slice(7)) : path.join(APP, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { a.writeHead(404); return a.end(); }
  const headers = { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' };
  if (p === '/manager.css' && cssOverride) { a.writeHead(200, headers); return a.end(cssOverride(fs.readFileSync(f, 'utf8'))); }
  a.writeHead(200, headers); a.end(fs.readFileSync(f));
});
let cssOverride = null;
await new Promise(r => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const results = [];
const ok = (name, good, detail) => { results.push([!!good, name]); console.log(`${good ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); };

const browser = await chromium.launch({ headless: true, executablePath: chrome(), args: ['--no-sandbox'] });

const art = f => `/__art/${f}`;
const SIXTEEN = [
  ['Olive', 'olive/main.webp', 1], ['Pip', 'pip/main.webp', 2], ['Pudding', 'pudding/main.webp', 0], ['Sprout', 'sprout/main.webp', 0],
  ['Barty', 'derived/barty.webp', 0], ['Tower', 'derived/tower.webp', 1], ['Loaf', 'derived/loaf.webp', 0], ['Bit', 'derived/bit.webp', 0],
  ['Bluebell', 'derived/bluebell.webp', 0], ['Mint', 'derived/mint.webp', 0], ['Kumquat', 'derived/kumquat.webp', 1], ['Matcha', 'derived/matcha.webp', 0],
  ['Radish', 'derived/radish.webp', 0], ['Tide', 'derived/tide.webp', 0], ['Ube', 'derived/ube.webp', 1]
].map(([name, f, out]) => ({ name, art: art(f), out }));
const HARD = [
  { name: 'Separate parts', art: art('test/parts.webp'), out: 1 },
  { name: 'Soft edges', art: art('test/soft.webp'), out: 1 },
  { name: 'Part far away', art: art('test/far.webp'), out: 1 }
];
const LIBRARY = {
  none: { buddies: [] },
  one: { buddies: [{ ...SIXTEEN[1], out: 0 }] },
  oneOut: { buddies: [{ ...SIXTEEN[0], out: 1 }] },
  mixed: { buddies: SIXTEEN },
  allOut: { buddies: [...SIXTEEN.slice(0, 9).map(b => ({ ...b, out: b.out || 1 })), ...HARD] },
  copies: { buddies: SIXTEEN.slice(0, 6).map((b, i) => ({ ...b, out: [1, 2, 3, 0, 5, 12][i] })) },
  few: { buddies: SIXTEEN.slice(0, 4) },
  names: {
    buddies: [
      ['Bartholomew Thistlewick the Fourth of Little Upper Downing', 'derived/barty.webp', 0],
      ['Supercalifragilisticexpialidociousnessly', 'derived/loaf.webp', 2],
      ['ぷりんちゃんとおともだちのながいなまえのバディ', 'pudding/main.webp', 0],
      ['小苹果', 'derived/kumquat.webp', 1],
      ['보리 찐빵', 'derived/matcha.webp', 0],
      ['ليلى الصغيرة', 'derived/mint.webp', 1],
      ['Ёжик в тумане', 'derived/radish.webp', 0],
      ['Żółć Ñandú', 'derived/tide.webp', 0],
      ['हिंदी नाम', 'derived/ube.webp', 0],
      ['🐙 Octo', 'derived/bluebell.webp', 0]
    ].map(([name, f, out]) => ({ name, art: art(f), out }))
  }
};

async function open(library, { w = 760, h = 580, theme = 'dark', reduced = false, extra = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const hub = await ctx.newPage();
  const lines = [], calls = [];
  await ctx.route('**/library/**', async route => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname.slice(1)), body = await hub.evaluate(f => H.file(f), p);
    if (!body) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(p)] || 'image/jpeg', body: Buffer.from(body, 'base64') });
  });
  hub.on('pageerror', e => lines.push('hub pageerror ' + e.message));
  await hub.goto(`${ORIGIN}/__hub.html`);
  const ids = await hub.evaluate(o => H.boot(o), { ...library, ...extra });
  const page = await ctx.newPage();
  await page.addInitScript(t => {
    window.__TAURI__ = { core: { invoke: async (cmd, args) => { console.log('EXE ' + JSON.stringify({ cmd, args })); } }, event: { listen: async () => {} } };
    if (t === 'light') localStorage.setItem('theme', 'light');
  }, theme);
  page.on('pageerror', e => lines.push('pageerror ' + e.message));
  page.on('console', m => {
    const t = m.text();
    if (!t.startsWith('EXE ')) { if (m.type() === 'error') lines.push('console ' + t); return; }
    const c = JSON.parse(t.slice(4));
    if (c.cmd === 'log_line') lines.push(c.args.line); else calls.push(c);
  });
  await page.goto(`${ORIGIN}/manager.html`);
  return { ctx, hub, page, ids, lines, calls };
}
const ready = async page => { await page.waitForSelector('.win[data-ready="true"]'); await settled(page); };
const settled = page => page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })));
  for (let i = 0; i < 40 && document.querySelector('.st.out .art:not(:has(.cutline))'); i++) await new Promise(r => setTimeout(r, 25));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
});
/* What must hold in every state, at every size. */
async function sane(r, label) {
  const f = await r.page.evaluate(() => {
    const inside = e => { const b = e.getBoundingClientRect(); return b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight; };
    return {
      wide: document.documentElement.scrollWidth > innerWidth,
      sheet: (s => s && s.scrollWidth > s.clientWidth)(document.querySelector('.sheet')),
      popped: [...document.querySelectorAll('.pop > *')].every(inside),
      lost: [...document.querySelectorAll('.st:not([hidden]) .art')].filter(a => !a.closest('.st').classList.contains('out') && !a.querySelector('img').naturalWidth).length
    };
  });
  ok(`${label}: nothing runs off the window`, !f.wide && !f.sheet && f.popped, f);
  ok(`${label}: every image loaded`, f.lost === 0, f.lost);
  const bad = r.lines.filter(l => /\b(error|rejected|pageerror)\b/.test(l));
  ok(`${label}: no errors or CSP lines`, !bad.length, bad.slice(0, 4).join(' | ') || undefined);
}

/* every state, at both sizes and in both themes */
const SIZES = [[760, 580], [560, 440]], THEMES = ['dark', 'light'];
const APPS = ['chrome.exe', 'code.exe', 'discord.exe', 'explorer.exe', 'a-very-long-program-name-that-will-not-fit-in-the-panel-at-all.exe', 'notepad.exe', 'slack.exe', 'spotify.exe', 'steam.exe', 'windowsterminal.exe'];
const dropEvent = (page, type) => page.evaluate(t => {
  const d = new DataTransfer(); d.items.add(new File(['{}'], 'a.buddy'));
  document.body.dispatchEvent(new DragEvent(t, { dataTransfer: d, bubbles: true, cancelable: true }));
}, type);
const bad = (name = 'broken.buddy') => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from('{"app":"nope"}') });
/* Her own file, as she'd be exported, changed by `edit`: what a person opens to update her. */
async function fileOf(r, name, edit = b => b) {
  const content = await r.hub.evaluate(async id => { const e = H.exe(); e.dialog = true; await H.client().exportBuddy(id); return e.saved.at(-1).content; }, r.ids[name]);
  const f = JSON.parse(content);
  f.buddy = edit(f.buddy);
  return JSON.stringify(f);
}
const picked = (name, body) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(body) });
/* A file for Pip that would replace her, picked in the Manager: the question is up. `also`: one
   for Olive behind it. */
async function replacing(r, { also = false, ...more } = {}) {
  const files = [picked('pip-v2.buddy', await fileOf(r, 'Pip', b => ({ ...b, lines: { chat: ['A new line'] }, ...more })))];
  if (also) files.push(picked('olive-new.buddy', await fileOf(r, 'Olive', b => ({ ...b, name: 'Olive New' }))));
  await r.page.setInputFiles('input[data-pick=file]', files);
  await r.page.waitForSelector('.replace');
}
const tooMany = (r, id) => r.hub.evaluate(async i => { for (let n = 0; n < 40; n++) if (!(await H.client().callAnother(i)).ok) return; }, id);

const STATES = {
  empty: { library: LIBRARY.none },
  one: { library: LIBRARY.one },
  'one-out': { library: LIBRARY.oneOut },
  mixed: { library: LIBRARY.mixed },
  'all-out': { library: LIBRARY.allOut },
  copies: { library: LIBRARY.copies },
  'menu-corner': { library: LIBRARY.mixed, async act({ page }) {
    await page.evaluate(() => { const s = document.querySelector('.sheet'); s.scrollTop = s.scrollHeight; });
    await page.waitForTimeout(60);
    const dots = page.locator('.st .dots');
    await dots.nth(await dots.count() - 1).click();
  } },
  'menu-out': { library: LIBRARY.few, async act({ page }) { await page.locator('.st .dots').nth(1).click(); } },
  'delete-confirm': { library: LIBRARY.mixed, async act({ page }) {
    await page.locator('.st .dots').nth(1).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
  } },
  failures: { library: LIBRARY.few, async act(r) {
    await r.page.setInputFiles('input[data-pick=file]', [bad()]);
    await r.page.waitForSelector('.misprint');
    await tooMany(r, r.ids.Pip);
    await r.page.waitForFunction(() => document.querySelectorAll('.misprint').length === 2);
  } },
  'failures-many': { library: LIBRARY.mixed, async act(r) {
    await r.page.setInputFiles('input[data-pick=file]', ['one', 'two', 'three', 'four', 'five'].map(n => bad(n + '.buddy')));
    await r.page.waitForFunction(() => document.querySelectorAll('.misprint').length === 2 && /3 more/.test(document.querySelector('.more')?.textContent));
  } },
  'not-ready': { library: LIBRARY.few, extra: { stuck: true }, async act({ page }) { await page.waitForTimeout(650); }, wait: false },
  drag: { library: LIBRARY.few, async act({ page }) { await dropEvent(page, 'dragenter'); } },
  'drag-empty': { library: LIBRARY.none, async act({ page }) { await dropEvent(page, 'dragenter'); } },
  settings: { library: LIBRARY.few, async act({ page }) { await page.getByRole('button', { name: 'Settings' }).click(); } },
  'settings-apps': { library: LIBRARY.few, extra: { apps: APPS }, async act({ page }) { await page.getByRole('button', { name: 'Settings' }).click(); } },
  replace: { library: LIBRARY.few, act: r => replacing(r) },
  'replace-renamed': { library: LIBRARY.few, act: r => replacing(r, { name: 'Pip, the new one with a much longer name', also: true }).then(() => r.page.waitForFunction(() => / 1 more/.test(document.querySelector('.replace')?.textContent || ''))) },
  'replace-done': { library: LIBRARY.few, async act(r) {
    await replacing(r);
    await r.page.waitForTimeout(450);
    await r.page.keyboard.press('Enter');
    await r.page.waitForSelector('.note:not([hidden])');
  } },
  'import-choice': { library: LIBRARY.few, async act({ page }) { await page.getByRole('button', { name: 'Import' }).first().click(); } },
  names: { library: LIBRARY.names },
  find: { library: LIBRARY.mixed, async act({ page }) { await page.getByLabel('Find a buddy').fill('ra'); } },
  'find-none': { library: LIBRARY.mixed, async act({ page }) { await page.getByLabel('Find a buddy').fill('nobody at all'); } }
};

for (const [name, s] of Object.entries(STATES)) {
  if (ONLY && !name.includes(ONLY)) continue;
  for (const [w, h] of SIZES) for (const theme of THEMES) {
    const r = await open(s.library, { w, h, theme, extra: s.extra });
    if (s.wait !== false) await ready(r.page);
    await s.act?.(r);
    if (s.wait !== false) await settled(r.page);
    const label = `${name} ${w}x${h} ${theme}`;
    await r.page.screenshot({ path: path.join(SHOTS, `${name}-${w}x${h}-${theme}.png`) });
    await sane(r, label);
    await r.ctx.close();
  }
}

/* what a person does, clicked for real */
if (!ONLY || ONLY === 'clicks') {
  const statusOf = (page, n) => page.locator('.st').nth(n).locator('.s').textContent();
  const text = (page, sel) => page.locator(sel).allTextContents();

  { /* the page and the fonts */
    const r = await open(LIBRARY.mixed); await ready(r.page);
    const f = await r.page.evaluate(async () => { await document.fonts.ready; return { lexend: document.fonts.check('13px Lexend'), puff: document.fonts.check('500 13.5px DynaPuff'), faces: [...document.fonts].map(x => x.family + ':' + x.status), name: getComputedStyle(document.querySelector('.st b')).fontFamily.split(',')[0], body: getComputedStyle(document.body).fontFamily.split(',')[0] }; });
    ok('both fonts load from the app folder', f.lexend && f.puff && f.faces.every(x => /loaded/.test(x)) && f.name === 'DynaPuff' && f.body === 'Lexend', f);
    ok('a title bar with drag regions, minimize and close, and no maximize', await r.page.evaluate(() => {
      const b = document.querySelector('.bar'), l = [...document.querySelectorAll('.wc button')].map(x => x.getAttribute('aria-label'));
      return b.hasAttribute('data-tauri-drag-region') && b.querySelector('.grow').hasAttribute('data-tauri-drag-region') && l.join() === 'Minimize,Close';
    }));
    const csp = await r.page.evaluate(() => document.querySelector('meta[http-equiv]').content);
    ok('the CSP has no unsafe-inline and no wide default', !/unsafe/.test(csp) && /default-src 'none'/.test(csp), csp);
    await r.page.getByRole('button', { name: 'Minimize' }).click();
    await r.page.getByRole('button', { name: 'Close', exact: true }).click();
    await r.page.waitForTimeout(50);
    ok('minimize and close reach the exe', JSON.stringify(r.calls) === JSON.stringify([{ cmd: 'plugin:window|minimize', args: { label: 'manager' } }, { cmd: 'window_close', args: { label: 'manager' } }]), r.calls);
    await r.ctx.close();
  }
  { /* cut lines: library paths and data URLs, every hard case */
    const r = await open(LIBRARY.allOut); await ready(r.page);
    const lines = await r.page.evaluate(() => [...document.querySelectorAll('.st')].map(st => ({ name: st.querySelector('b').textContent, shape: st.querySelector('.cutline')?.dataset.line, loops: st.querySelectorAll('.cutline .cut-dots').length, dots: [...st.querySelectorAll('.cutline .cut-dots')].map(p => +p.getAttribute('pathLength')) })));
    ok('everyone out has one traced line from a library path', lines.every(l => l.shape === 'traced' && l.dots.every(Number.isInteger)), lines.map(l => `${l.name} ${l.shape} ${l.loops}`).join(', '));
    ok('the far part keeps its own loop', lines.find(l => l.name === 'Part far away').loops === 2);
    ok('the separate part sits inside one line', lines.find(l => l.name === 'Separate parts').loops === 1);
    const src = await r.page.locator('.st img').first().getAttribute('src');
    ok('a row\'s image is a library path, named by its bytes', /^library\/\w+\/[0-9a-f]{32}\.(png|webp|jpg|gif)$/.test(src), src);
    await r.ctx.close();

    const d = await open(LIBRARY.allOut, { extra: { dataRows: 4 } }); await ready(d.page);
    const got = await d.page.evaluate(() => [...document.querySelectorAll('.st')].slice(0, 4).map(st => [st.querySelector('img').src.slice(0, 15), st.querySelector('.cutline')?.dataset.line]));
    ok('a data URL row bakes too, under the page\'s CSP', got.every(([s, l]) => s.startsWith('data:image/') && l === 'traced'), got);
    await sane(d, 'data rows');
    await d.ctx.close();
  }
  { /* a line that can't be read */
    const r = await open(LIBRARY.few, {});
    await ready(r.page);
    await r.ctx.route('**/library/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('not a picture') }));
    await r.hub.evaluate(() => H.client().call(H.state().buddies[2].id));
    /* the image is cached by URL, so it reaches the bake through a fresh window */
    await r.page.reload(); await r.page.waitForSelector('.win[data-ready="true"]');
    await r.page.waitForSelector('.st:nth-child(3) .cutline');
    const shape = await r.page.locator('.st').nth(2).locator('.cutline').getAttribute('data-line');
    ok('an unreadable image still gets a rounded rectangle line', shape === 'unread', shape);
    await r.ctx.close();
  }
  { /* call, dismiss, and the movement */
    const r = await open(LIBRARY.few); await ready(r.page);
    const first = r.page.locator('.st').nth(2);
    ok('at home, the button says Call', (await first.locator('.btn').textContent()) === 'Call');
    await first.locator('.btn').click();
    await r.page.waitForFunction(() => document.querySelectorAll('.st')[2].classList.contains('out'));
    const moving = await r.page.evaluate(() => document.getAnimations().length);
    ok('call moves', moving > 0, moving);
    await r.page.evaluate(() => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = 110; } });
    await r.page.screenshot({ path: path.join(SHOTS, 'peel-call-mid.png') });
    await r.page.evaluate(() => { for (const a of document.getAnimations()) a.play(); });
    await r.page.waitForTimeout(420);
    ok('call settles as the spot it left', await statusOf(r.page, 2) === 'On desktop' && await first.locator('.cutline').count() === 1 && await r.page.evaluate(() => !document.querySelector('.fly') && !document.querySelector('mask')));
    await first.locator('.art').click();
    await r.page.waitForFunction(() => !document.querySelectorAll('.st')[2].classList.contains('out'));
    ok('dismiss from the art runs it back', await r.page.evaluate(() => document.getAnimations().length > 0 && !!document.querySelectorAll('.st')[2].querySelector('.cutline')));
    await r.page.evaluate(() => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = 130; } });
    await r.page.screenshot({ path: path.join(SHOTS, 'peel-dismiss-mid.png') });
    await r.page.evaluate(() => { for (const a of document.getAnimations()) a.play(); });
    await r.page.waitForTimeout(420);
    ok('dismiss settles as a sticker', await statusOf(r.page, 2) === 'At home' && await first.locator('.cutline').count() === 0 && await first.locator('img.cut').count() === 1);
    await first.locator('.art').dblclick();
    await r.page.waitForTimeout(150);
    ok('a double-click is one call', await statusOf(r.page, 2) === 'On desktop', await statusOf(r.page, 2));
    await r.page.waitForTimeout(420);
    const names = () => text(r.page, '.st b');
    const before = await names();
    await r.page.locator('.st').nth(3).locator('.btn').click();
    await r.page.waitForFunction(() => document.querySelectorAll('.st')[3].classList.contains('out'));
    ok('the order never changes', JSON.stringify(await names()) === JSON.stringify(before));
    await sane(r, 'call and dismiss');
    await r.ctx.close();

    const q = await open(LIBRARY.few, { reduced: true }); await ready(q.page);
    await q.page.locator('.st').nth(2).locator('.btn').click();
    await q.page.waitForFunction(() => document.querySelectorAll('.st')[2].classList.contains('out'));
    ok('with reduced motion nothing moves', await q.page.evaluate(() => document.getAnimations().length === 0 && !document.querySelector('.fly')));
    await q.page.locator('.st').nth(1).locator('.art').hover();
    const lift = await q.page.locator('.st').nth(2).locator('.art img').evaluate(i => getComputedStyle(i).transform);
    ok('and hovering lifts nothing', lift === 'none', lift);
    await q.ctx.close();
  }
  { /* hover */
    const r = await open(LIBRARY.few); await ready(r.page);
    const art = r.page.locator('.st').nth(2).locator('.art');
    await art.hover(); await r.page.waitForTimeout(220);
    const m = await art.locator('img').evaluate(i => new DOMMatrix(getComputedStyle(i).transform));
    ok('hover lifts 3 px and tilts 1.5 degrees', Math.abs(m.f + 3) < .01 && Math.abs(Math.atan2(m.b, m.a) * 180 / Math.PI + 1.5) < .01, [m.f, Math.atan2(m.b, m.a) * 180 / Math.PI]);
    await r.ctx.close();
  }
  { /* the menu */
    const r = await open(LIBRARY.copies); await ready(r.page);
    const words = () => text(r.page, '.menu button');
    const dots = name => r.page.locator(`.st:has(b:text-is("${name}")) .dots`);
    await dots('Sprout').click();
    ok('at home: no Call another, and Edit', JSON.stringify(await words()) === JSON.stringify(['Talks', 'Edit', 'Export to a file', 'Delete']), await words());
    await r.page.keyboard.press('Escape');
    ok('Escape closes it, and the keyboard is back on its button', await r.page.locator('.menu').count() === 0 && await dots('Sprout').evaluate(b => b === document.activeElement));
    await dots('Pip').click();
    ok('copies: Bring here, the chase her art has, Call another and Dismiss one', JSON.stringify(await words()) === JSON.stringify(['Bring here', 'Chase my mouse', 'Call another', 'Dismiss one', 'Talks', 'Edit', 'Export to a file', 'Delete']), await words());
    const rule = await r.page.locator('.menu [role=separator]').evaluateAll(els => els.map(e => [e.nextElementSibling?.textContent, e.getBoundingClientRect().height]));
    ok('a line before Talks and before her file, drawn', JSON.stringify(rule) === JSON.stringify([['Talks', 1], ['Edit', 1]]), rule);
    ok('Talks is a ticked switch', await r.page.locator('.menu [role=menuitemcheckbox]').evaluate(b => b.textContent === 'Talks' && b.getAttribute('aria-checked') === 'true' && getComputedStyle(b, '::after').content !== 'none'));
    await r.page.mouse.click(5, 22);
    ok('an outside click closes it', await r.page.locator('.menu').count() === 0);
    await dots('Olive').click();
    ok('one copy: Call another and no Dismiss one', !(await words()).includes('Dismiss one') && (await words()).includes('Call another'));
    await r.page.keyboard.press('Escape');
    const pip = r.page.locator('.st:has(b:text-is("Pip"))'), says = async t => { await pip.locator(`.s:text-is("${t}")`).waitFor(); return true; };
    await dots('Pip').click();
    await r.page.getByRole('menuitem', { name: 'Call another' }).click();
    ok('Call another adds a copy, and there\'s still one line', await says('3 on desktop') && await pip.locator('.cutline').count() === 1 && await r.page.locator('.menu').count() === 0);
    await dots('Pip').click();
    await r.page.getByRole('menuitem', { name: 'Dismiss one' }).click();
    ok('Dismiss one takes one', await says('2 on desktop'));
    await pip.locator('.btn').click();
    ok('Dismiss takes every copy', await says('At home'));
    await dots('Olive').click();
    await r.page.getByRole('menuitem', { name: 'Export to a file' }).click();
    await r.page.waitForTimeout(100);
    ok('Export goes to the hub', await r.hub.evaluate(() => H.exe().saved.length) === 1);
    await r.ctx.close();
  }
  { /* a long sheet */
    const r = await open(LIBRARY.mixed); await ready(r.page);
    await r.page.locator('.st .dots').first().click();
    await r.page.evaluate(() => { document.querySelector('.sheet').scrollTop = 60; });
    await r.page.waitForTimeout(50);
    ok('scrolling closes a menu', await r.page.locator('.menu').count() === 0);
    await r.ctx.close();
  }
  { /* delete */
    const r = await open(LIBRARY.one); await ready(r.page);
    await r.page.locator('.st .dots').click();
    await r.page.getByRole('menuitem', { name: 'Delete' }).click();
    ok('Delete asks first, and names the buddy', /Delete Pip\?/.test(await r.page.locator('.confirm').textContent()) && /can't be undone/.test(await r.page.locator('.confirm').textContent()));
    ok('Cancel has the keyboard', await r.page.locator('.confirm .go').evaluate(b => b.textContent === 'Cancel' && b === document.activeElement));
    await r.page.keyboard.press('Enter');
    await r.page.waitForTimeout(50);
    ok('Enter cancels, and nothing is deleted', await r.page.locator('.confirm').count() === 0 && await r.page.locator('.st').count() === 1);
    await r.page.locator('.st .dots').click();
    await r.page.getByRole('menuitem', { name: 'Delete' }).click();
    await r.page.mouse.click(5, 22);
    ok('a click away cancels', await r.page.locator('.confirm').count() === 0 && await r.page.locator('.st').count() === 1);
    await r.hub.evaluate(() => H.exe().failNext('data_delete', 'the disk said no'));
    await r.page.locator('.st .dots').click();
    await r.page.getByRole('menuitem', { name: 'Delete' }).click();
    await r.page.locator('.confirm .bad').click();
    await r.page.waitForSelector('.misprint');
    ok('a failed delete offers Try again here', await r.page.locator('.misprint .go').textContent() === 'Try again', await r.page.locator('.misprint').textContent());
    await r.page.reload(); await ready(r.page);
    ok('a new window can\'t retry what it didn\'t send, so it only offers Clear', await r.page.locator('.misprint .go').count() === 0 && await r.page.locator('.misprint .btn').count() === 1);
    await r.page.locator('.misprint .btn').click();
    await r.page.waitForFunction(() => !document.querySelector('.misprint'));
    await r.hub.evaluate(() => H.exe().failNext('data_delete', 'the disk said no'));
    await r.page.locator('.st .dots').click();
    await r.page.getByRole('menuitem', { name: 'Delete' }).click();
    await r.page.locator('.confirm .bad').click();
    await r.page.waitForSelector('.misprint .go');
    await r.page.locator('.misprint .go').click();
    await r.page.waitForSelector('.welcome:not([hidden])');
    ok('Try again deletes, and the last buddy leaves the empty sheet', await r.page.locator('.st').count() === 0 && await r.page.locator('.misprint').count() === 0);
    await sane(r, 'after delete');
    await r.ctx.close();
  }
  { /* import */
    const r = await open(LIBRARY.few); await ready(r.page);
    const good = await r.hub.evaluate(async () => { const b = await (await fetch('/__sample.json')).text(); return b; });
    await r.page.setInputFiles('input[data-pick=file]', [{ name: 'olive.buddy', mimeType: 'application/octet-stream', buffer: Buffer.from(good) }]);
    await r.page.waitForFunction(() => document.querySelectorAll('.st').length === 5);
    const order = await text(r.page, '.st b');
    ok('a picked file comes in, in the hub\'s order', order.join() === [...order].sort().join() && order.filter(n => n === 'Olive').length === 2, order);
    await r.page.evaluate(body => {
      const d = new DataTransfer(); d.items.add(new File([body], 'second.buddy'));
      document.body.dispatchEvent(new DragEvent('dragenter', { dataTransfer: d, bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: d, bubbles: true, cancelable: true }));
    }, '{"nope":1}');
    await r.page.waitForSelector('.misprint');
    ok('a drop comes in through the same door, and the veil goes', /second didn't come in/.test(await r.page.locator('.misprint').textContent()) && await r.page.locator('.veil').isHidden());
    let chooser = r.page.waitForEvent('filechooser');
    await r.page.locator('.misprint .go').click();
    let c = await chooser;
    ok('Pick another file reopens the picker', c.isMultiple() && await r.page.locator('.misprint').count() === 1);
    await c.setFiles([bad('third.buddy')]);
    await r.page.waitForFunction(() => /third/.test(document.querySelector('.misprint')?.textContent));
    ok('picking clears the old failure', await r.page.locator('.misprint').count() === 1);
    await r.page.locator('.misprint .btn:not(.go)').click();
    await r.page.getByRole('button', { name: 'Import' }).first().click();
    ok('Import offers a file or Shimeji images', (await text(r.page, '.menu button')).join() === 'A .buddy file,Shimeji images');
    ok('and says a whole folder can be dragged in', /drag the whole folder in/.test(await r.page.locator('.import-tip').textContent()));
    chooser = r.page.waitForEvent('filechooser');
    await r.page.getByRole('menuitem', { name: 'Shimeji images' }).click();
    c = await chooser;
    /* a folder picker is what makes the browser ask "Upload N files to this site?" */
    ok('the Shimeji choice opens a plain picker of images, not a folder picker', c.isMultiple() && await c.element().evaluate(i => !i.webkitdirectory && i.accept === 'image/*'));
    await r.ctx.close();
  }
  { /* real files on disk, through the real pickers and the real art */
    const r = await open(LIBRARY.few); await ready(r.page);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-files-'));
    const png = await r.hub.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#c0f'; x.fillRect(16, 8, 32, 48); return c.toDataURL('image/png').split(',')[1]; });
    fs.mkdirSync(`${dir}/Mochi/img`, { recursive: true }); fs.mkdirSync(`${dir}/Mochi/conf`); fs.mkdirSync(`${dir}/Empty`);
    for (const n of [1, 2, 3, 4]) fs.writeFileSync(`${dir}/Mochi/img/shime${n}.png`, Buffer.from(png, 'base64'));
    fs.writeFileSync(`${dir}/Mochi/conf/actions.xml`, '<x/>'); fs.writeFileSync(`${dir}/Empty/readme.txt`, 'x'); fs.writeFileSync(`${dir}/bad.buddy`, '{"app":"nope"}');
    /* every image in its img folder, and something else picked with them, which is passed over */
    fs.writeFileSync(`${dir}/Mochi/img/icon.png`, Buffer.from(png, 'base64'));
    await r.page.setInputFiles('input[data-pick=shimeji]', fs.readdirSync(`${dir}/Mochi/img`).map(n => `${dir}/Mochi/img/${n}`));
    const mochi = r.page.locator('.st', { hasText: 'Shimeji' });
    await mochi.waitFor();
    ok('real Shimeji images come in through the picker, called Shimeji, and at home', /At home/.test(await mochi.textContent()), await mochi.textContent());
    ok('and land in the library', await r.hub.evaluate(() => { const c = H.state().buddies.find(b => b.name === 'Shimeji'); return !!c && !!H.file(`library/${c.id}/buddy.json`); }));
    ok('its image loads from the library', await mochi.locator('img').evaluate(i => new Promise(done => { if (i.complete) done(i.naturalWidth > 0); else { i.onload = () => done(true); i.onerror = () => done(false); } })));
    ok('the other image picked with them is passed over', await r.page.locator('.misprint').count() === 0);
    await r.page.setInputFiles('input[data-pick=shimeji]', `${dir}/Mochi/img/icon.png`);
    await r.page.waitForSelector('.misprint');
    ok('images with no shime1.png say so', /Shimeji didn't come in/.test(await r.page.locator('.misprint').textContent()) && /No shime1\.png in that folder\./.test(await r.page.locator('.misprint').textContent()), await r.page.locator('.misprint').textContent());
    await r.page.setInputFiles('input[data-pick=file]', `${dir}/bad.buddy`);
    const misprint = r.page.locator('.misprint', { hasText: "bad didn't come in" });
    await misprint.waitFor();
    ok('a bad file through the picker says so', /That isn't a buddy file\./.test(await misprint.textContent()), await misprint.textContent());
    await r.ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  { /* the switches */
    const r = await open(LIBRARY.few); await ready(r.page);
    for (const [name, key] of [['Hide all', 'hidden'], ['Pause', 'paused'], ['Start with Windows', 'autostart']]) {
      const b = r.page.getByRole('switch', { name });
      await b.click();
      await r.page.waitForFunction(n => [...document.querySelectorAll('.tg')].find(x => x.textContent === n).getAttribute('aria-checked') === 'true', name);
      ok(`${name} sets it in the hub`, await r.hub.evaluate(k => H.state()[k], key));
    }
    await r.ctx.close();
  }
  { /* Find */
    const r = await open(LIBRARY.few); await ready(r.page);
    ok('few buddies: no Find, and the name of the app', await r.page.locator('.search').isHidden() && await r.page.locator('.title').isVisible());
    await r.ctx.close();
    const m = await open(LIBRARY.mixed); await ready(m.page);
    await m.page.getByLabel('Find a buddy').fill('RA');
    const seen = () => m.page.evaluate(() => [...document.querySelectorAll('.st:not([hidden]) b')].map(b => b.textContent));
    ok('Find filters by name, whatever the case', (await seen()).join() === 'Radish', await seen());
    await m.page.getByLabel('Find a buddy').press('Escape');
    ok('Escape clears it', (await seen()).length === 15);
    await m.ctx.close();
  }
  { /* theme */
    const r = await open(LIBRARY.few); await ready(r.page);
    ok('dark by default', await r.page.evaluate(() => document.documentElement.dataset.theme) === 'dark');
    await r.page.getByRole('button', { name: 'Settings' }).click();
    await r.page.getByRole('radio', { name: 'Light' }).click();
    await r.page.waitForTimeout(40);
    const panel = await r.page.locator('.panel').count();
    await r.page.keyboard.press('Escape');
    await r.page.reload(); await ready(r.page);
    ok('Theme stays open, and survives a new window', panel === 1 && await r.page.evaluate(() => document.documentElement.dataset.theme) === 'light');
    await r.ctx.close();
  }
  { /* Walk on windows */
    const r = await open(LIBRARY.few, { extra: { apps: APPS } }); await ready(r.page);
    await r.page.getByRole('button', { name: 'Settings' }).click();
    const fits = await r.page.evaluate(() => {
      const p = document.querySelector('.panel').getBoundingClientRect(), a = document.querySelector('.apps');
      return { inside: p.top >= 0 && p.bottom <= innerHeight && p.right <= innerWidth, scrolls: a.scrollHeight > a.clientHeight, wide: a.scrollWidth <= a.clientWidth };
    });
    ok('ten apps stay inside the window, scroll, and a long name is cut', fits.inside && fits.scrolls && fits.wide, fits);
    await r.page.evaluate(() => { document.querySelector('.apps').scrollTop = 40; });
    await r.page.waitForTimeout(40);
    ok('scrolling the list leaves the panel open', await r.page.locator('.panel').count() === 1);
    await r.page.getByRole('switch', { name: 'Stay off discord.exe' }).click();
    await r.page.waitForFunction(() => document.querySelector('[aria-label="Stay off discord.exe"]').getAttribute('aria-checked') === 'true');
    await r.page.getByRole('switch', { name: 'Walk on windows' }).click();
    await r.page.waitForFunction(() => document.querySelector('[aria-label="Walk on windows"]').getAttribute('aria-checked') === 'false');
    ok('both switches reach the hub and come back, and the list goes quiet', await r.page.evaluate(() => [...document.querySelectorAll('.apps button')].every(b => b.disabled)) && await r.page.getByRole('switch', { name: 'Stay off discord.exe' }).getAttribute('aria-checked') === 'true');
    await r.ctx.close();
  }
  { /* Open .buddy files */
    const r = await open(LIBRARY.few); await ready(r.page);
    await r.page.getByRole('button', { name: 'Settings' }).click();
    const name = 'Open .buddy files with Desktop Buddies', b = r.page.getByRole('switch', { name });
    const order = await r.page.evaluate(n => {
      const at = el => [...document.querySelectorAll('.panel *')].indexOf(el);
      return [at(document.querySelector('[role=radiogroup]')), at(document.querySelector(`[aria-label="${n}"]`)), at(document.querySelector('[aria-label="Walk on windows"]'))];
    }, name);
    ok('Open .buddy files: off at first, under Theme and above Walk on windows', await b.getAttribute('aria-checked') === 'false' && order[0] >= 0 && order[0] < order[1] && order[1] < order[2], order);
    const fits = await r.page.evaluate(() => { const p = document.querySelector('.panel').getBoundingClientRect(); return p.top >= 0 && p.bottom <= innerHeight && p.right <= innerWidth; });
    ok('and the panel stays inside the window', fits);
    await b.click();
    await r.page.waitForFunction(n => document.querySelector(`[aria-label="${n}"]`).getAttribute('aria-checked') === 'true', name);
    ok('on reaches the exe and comes back', await r.hub.evaluate(() => H.state().files && H.exe().fileAssoc));
    await b.click();
    await r.page.waitForFunction(n => document.querySelector(`[aria-label="${n}"]`).getAttribute('aria-checked') === 'false', name);
    ok('off reaches the exe and comes back', await r.hub.evaluate(() => !H.state().files && !H.exe().fileAssoc));
    await r.ctx.close();
  }
  { /* getting ready */
    const r = await open(LIBRARY.few, { extra: { stuck: true } });
    await r.page.waitForSelector('.win[data-ready="false"]');
    const f = await r.page.evaluate(() => ({
      calm: document.querySelector('.waiting').textContent,
      off: [...document.querySelectorAll('.bar .btn, .st button, .tg')].every(b => b.disabled),
      window: [...document.querySelectorAll('.wc button')].every(b => !b.disabled),
      failures: document.querySelectorAll('.misprint').length
    }));
    ok('not ready: calm, controls off, no failure, and the window still works', f.calm === 'Getting ready' && f.off && f.window && f.failures === 0, f);
    await r.ctx.close();
  }
}

/* The bake, timed on the test art, and checked against the Python stand-in's own output. */
if (!ONLY || ONLY === 'bake' || PERF) {
  const r = await open(LIBRARY.none);
  const py = JSON.parse(fs.readFileSync(path.join(ART, 'outlines.js'), 'utf8').match(/window\.OUTLINES=(.*);\s*$/s)[1]);
  const list = [['olive', art('olive/main.webp')], ['pip', art('pip/main.webp')], ['pudding', art('pudding/main.webp')], ['tower', art('derived/tower.webp')], ['loaf', art('derived/loaf.webp')], ['test-parts', art('test/parts.webp')], ['test-soft', art('test/soft.webp')], ['test-far', art('test/far.webp')]];
  for (const [key, url] of list) {
    const t = await r.hub.evaluate(u => H.bakeTimes(u), url), mine = t.loops.map(l => Math.round(l.scaled)), theirs = py[key]?.loops.map(l => Math.round(l.len));
    console.log(`bake ${key.padEnd(11)} ${t.natural.join('x').padEnd(8)} shown ${t.shown.join('x').padEnd(7)} first ${t.first.toFixed(1)} ms, then ${t.whole.toFixed(1)} ms (read ${t.read.toFixed(1)}, core ${t.core.toFixed(1)}), ${t.shape}, loops ${mine} vs python ${theirs}`);
    ok(`bake ${key}: same loops as the Python stand-in`, mine.length === theirs?.length, [mine, theirs]);
  }
  await r.ctx.close();
}

/* 200 buddies: how long until the sheet is up, and what scrolling costs. Software rendering here, so
   a real GPU can only do better. */
if (PERF) {
  const many = n => ({ buddies: Array.from({ length: n }, (_, i) => ({ ...SIXTEEN[i % 15], name: `${SIXTEEN[i % 15].name} ${i}`, out: i % 4 === 0 ? 1 : 0 })) });
  async function measure(label, lib, css) {
    cssOverride = css;
    const r = await open(lib);
    const m = await r.page.evaluate(async () => {
      const nav = performance.getEntriesByType('navigation')[0].startTime, t0 = performance.now();
      while (!document.querySelector('.win[data-ready="true"]')) await new Promise(q => setTimeout(q, 5));
      const dom = performance.now();
      await new Promise(q => requestAnimationFrame(() => requestAnimationFrame(q)));
      const painted = performance.now();
      await Promise.all([...document.images].filter(i => i.loading !== 'lazy').map(i => i.complete ? null : new Promise(q => { i.onload = i.onerror = q; })));
      const images = performance.now();
      while (document.querySelector('.st.out .art:not(:has(.cutline))')) await new Promise(q => setTimeout(q, 10));
      const lines = performance.now();
      const fcp = performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint')?.startTime;
      const s = document.querySelector('.sheet'), gaps = [];
      s.scrollTop = 0;
      await new Promise(q => setTimeout(q, 300));
      let last = performance.now();
      const step = s.scrollHeight / 180;
      for (let i = 0; i < 180; i++) {
        await new Promise(q => requestAnimationFrame(q));
        const t = performance.now(); gaps.push(t - last); last = t;
        s.scrollTop += step;
      }
      gaps.sort((a, b) => a - b);
      return { waited: t0 - nav, fcp, dom, painted, images, lines, p50: gaps[90], p95: gaps[171], worst: gaps[179], over33: gaps.filter(g => g > 33.4).length, height: s.scrollHeight, count: document.querySelectorAll('.st').length };
    });
    /* A rAF loop doesn't wait for raster, and a screenshot does. */
    const shots = [];
    for (let i = 1; i <= 10; i++) {
      await r.page.evaluate(k => { const s = document.querySelector('.sheet'); s.scrollTop = (s.scrollHeight - s.clientHeight) * k; }, i / 10);
      const t = performance.now();
      await r.page.screenshot({ path: path.join(SHOTS, `perf-scroll.png`) });
      shots.push(performance.now() - t);
    }
    shots.sort((a, b) => a - b);
    m.paint = shots[5];
    console.log(`${label}: painting a new screenful takes ${m.paint.toFixed(0)} ms, as a screenshot`);
    console.log(`${label}: ${m.count} stickers, sheet ${m.height} px tall. FCP ${m.fcp?.toFixed(0)} ms, on the page ${m.dom.toFixed(0)}, painted ${m.painted.toFixed(0)}, images ${m.images.toFixed(0)}, lines ${m.lines.toFixed(0)}. Scroll frames: p50 ${m.p50.toFixed(1)} ms, p95 ${m.p95.toFixed(1)}, worst ${m.worst.toFixed(1)}, ${m.over33} of 180 over 33 ms`);
    await r.ctx.close();
    cssOverride = null;
    return m;
  }
  await measure('15 buddies', many(15));
  await measure('200 buddies', many(200));
  await measure('200 buddies, no die-cut filter', many(200), css => css + '\n.cut { filter: none !important; }');
}

/* A file that would replace someone, every way in, clicked for real. */
if (!ONLY || ONLY === 'replace') {
  const r = await open(LIBRARY.few); await ready(r.page);
  const names = () => r.page.locator('.st b').allTextContents();
  const heading = () => r.page.locator('.replace b').textContent();
  const gone = () => r.page.waitForFunction(() => !document.querySelector('.replace'));
  const disk = id => r.hub.evaluate(i => JSON.parse(atob(H.file(`library/${i}/buddy.json`))).buddy.name, id);
  const before = await names();

  await r.page.setInputFiles('input[data-pick=file]', [picked('pip-v2.buddy', await fileOf(r, 'Pip', b => ({ ...b, name: 'Pip Two' })))]);
  await r.page.waitForSelector('.replace');
  const words = await r.page.locator('.replace p').textContent();
  ok('replace: a file for someone here asks, by her name, and changes nothing yet', await heading() === 'Replace Pip with this file?' && /It calls her Pip Two\./.test(words) && JSON.stringify(await names()) === JSON.stringify(before) && await disk(r.ids.Pip) === 'Pip', words);
  ok('replace: Replace has the keyboard', await r.page.evaluate(() => document.activeElement?.textContent === 'Replace' && !!document.activeElement.closest('.replace')));
  await r.page.keyboard.press('Escape');
  await gone();
  ok('replace: Escape imports nothing', JSON.stringify(await names()) === JSON.stringify(before) && await disk(r.ids.Pip) === 'Pip' && (await r.hub.evaluate(() => H.state().replacing.length)) === 0);

  await r.page.setInputFiles('input[data-pick=file]', [picked('pip-v2.buddy', await fileOf(r, 'Pip', b => ({ ...b, name: 'Pip Two' })))]);
  await r.page.waitForSelector('.replace');
  await r.page.keyboard.press('Enter');
  await r.page.waitForTimeout(100);
  ok('replace: an Enter the moment it shows answers nothing', !!await r.page.locator('.replace').count() && await disk(r.ids.Pip) === 'Pip');
  await r.page.waitForTimeout(450);
  await r.page.keyboard.press('Enter');
  await r.page.waitForSelector('.note:not([hidden])');
  ok('replace: Enter on Replace replaces her, and a note says she was', await r.page.locator('.note').textContent() === 'Pip was replaced.' && (await names()).includes('Pip Two') && !(await names()).includes('Pip') && await disk(r.ids.Pip) === 'Pip Two');
  await r.page.screenshot({ path: path.join(SHOTS, 'replace-note.png') });

  await r.page.setInputFiles('input[data-pick=file]', [picked('olive-again.buddy', await fileOf(r, 'Olive', b => ({ ...b, name: 'Olive Again' })))]);
  await r.page.waitForSelector('.replace');
  await r.page.waitForTimeout(450);
  await r.page.locator('.replace').getByRole('button', { name: 'Keep both' }).click();
  await r.page.waitForFunction(() => document.querySelectorAll('.st').length === 5);
  ok('replace: Keep both adds the file beside her, and the new one has the keyboard', (await names()).includes('Olive') && (await names()).includes('Olive Again') && await disk(r.ids.Olive) === 'Olive' && await r.page.evaluate(() => document.activeElement?.closest('.st')?.querySelector('b')?.textContent === 'Olive Again'));

  await r.hub.evaluate(c => H.exe().emit('open-file', { name: 'sprout.buddy', content: c }), await fileOf(r, 'Sprout', b => ({ ...b, name: 'Sprout 2' })));
  await r.page.waitForSelector('.replace');
  ok('replace: a file sent from outside asks in the open Manager', await heading() === 'Replace Sprout with this file?' && await disk(r.ids.Sprout) === 'Sprout');
  await r.page.locator('.replace').getByRole('button', { name: 'Close, and import nothing' }).click();
  await gone();
  ok('replace: closing it imports nothing', await disk(r.ids.Sprout) === 'Sprout' && !(await names()).includes('Sprout 2'));

  await r.page.setInputFiles('input[data-pick=file]', [picked('pudding.buddy', await fileOf(r, 'Pudding'))]);
  await r.page.waitForFunction(() => /up to date/.test(document.querySelector('.note:not([hidden])')?.textContent || ''));
  ok('replace: her own file again says she\'s up to date, and asks nothing', await r.page.locator('.note').textContent() === 'Pudding is already up to date.' && !await r.page.locator('.replace').count());

  await r.page.setInputFiles('input[data-pick=file]', [picked('a.buddy', await fileOf(r, 'Pudding', b => ({ ...b, name: 'Pudding 2' }))), picked('b.buddy', await fileOf(r, 'Sprout', b => ({ ...b, name: 'Sprout 3' })))]);
  await r.page.waitForSelector('.replace');
  ok('replace: two at once ask one at a time, saying one more', await heading() === 'Replace Pudding with this file?' && / 1 more after this\./.test(await r.page.locator('.replace').textContent()));
  await r.page.waitForTimeout(450);
  await r.page.keyboard.press('Enter');
  await r.page.keyboard.press('Enter');
  await r.page.waitForFunction(() => /Sprout/.test(document.querySelector('.replace b')?.textContent || ''));
  await r.page.waitForTimeout(150);
  ok('replace: a second Enter right after doesn\'t answer the next one', await disk(r.ids.Pudding) === 'Pudding 2' && await disk(r.ids.Sprout) === 'Sprout' && await heading() === 'Replace Sprout with this file?');
  await r.page.keyboard.press('Escape');
  await gone();

  await r.page.setInputFiles('input[data-pick=file]', [picked('c.buddy', await fileOf(r, 'Pudding', b => ({ ...b, name: 'Pudding 3' })))]);
  await r.page.waitForSelector('.replace');
  await r.page.waitForTimeout(450);
  await r.page.locator('.replace').getByRole('button', { name: 'Keep both' }).focus();
  await r.hub.evaluate(c => H.exe().emit('open-file', { name: 'd.buddy', content: c }), await fileOf(r, 'Sprout', b => ({ ...b, name: 'Sprout 4' })));
  await r.page.waitForFunction(() => / 1 more/.test(document.querySelector('.replace')?.textContent || ''));
  ok('replace: another file waiting behind leaves the keyboard on Keep both', await r.page.evaluate(() => document.activeElement?.textContent) === 'Keep both');
  await r.page.keyboard.press('Escape');
  await r.page.waitForFunction(() => /Sprout/.test(document.querySelector('.replace b')?.textContent || ''));
  await r.page.waitForTimeout(450);
  await r.page.keyboard.press('Escape');
  await gone();

  await r.page.setInputFiles('input[data-pick=file]', [picked('e.buddy', await fileOf(r, 'Pudding', b => ({ ...b, name: 'Pudding 5' })))]);
  await r.page.waitForSelector('.replace');
  await r.page.keyboard.down('Enter');
  await r.page.waitForTimeout(500);
  await r.page.keyboard.down('Enter'); /* the same press, repeating */
  await r.page.waitForTimeout(100);
  ok('replace: holding Enter answers nothing, however long', await disk(r.ids.Pudding) === 'Pudding 2' && !!await r.page.locator('.replace').count());
  await r.page.keyboard.up('Enter');
  await r.page.keyboard.press('Enter');
  await r.page.waitForFunction(() => !document.querySelector('.replace'));
  ok('replace: a fresh press after letting go does', await disk(r.ids.Pudding) === 'Pudding 5');

  await r.page.setInputFiles('input[data-pick=file]', [picked('f.buddy', await fileOf(r, 'Pudding', b => ({ ...b, name: 'Pudding 6' })))]);
  await r.page.waitForSelector('.replace');
  await r.page.evaluate(() => document.activeElement?.blur());
  await r.page.keyboard.down('Enter');
  await r.page.keyboard.down('Enter'); /* held on nothing, its keyup still to come */
  await r.page.waitForTimeout(450);
  await r.page.locator('.replace').getByRole('button', { name: 'Replace' }).click();
  await r.page.waitForFunction(() => !document.querySelector('.replace'));
  ok('replace: a key held down elsewhere never blocks the mouse', await disk(r.ids.Pudding) === 'Pudding 6');
  await r.page.keyboard.up('Enter');
  await sane(r, 'replace');
  await r.ctx.close();
}

/* The Maker's page and its saving in a real browser: real canvases, a real BroadcastChannel, a real
   pagehide and the real CSP. No look here: the view has its own check. */
if (!ONLY || ONLY === 'maker') {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 680 } });
  const hub = await ctx.newPage(), lines = [], off = [], calls = [];
  ctx.on('request', q => { if (!q.url().startsWith(ORIGIN) && !q.url().startsWith('data:')) off.push(q.url()); });
  await ctx.route('**/library/**', async route => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname.slice(1)), body = await hub.evaluate(f => H.file(f), p);
    if (!body) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(p)] || 'image/jpeg', body: Buffer.from(body, 'base64') });
  });
  hub.on('pageerror', e => lines.push('hub pageerror ' + e.message));
  await hub.goto(`${ORIGIN}/__hub.html`);
  const ids = await hub.evaluate(o => H.boot(o), LIBRARY.oneOut), id = Object.values(ids)[0];
  const opened = async boot => {
    const page = await ctx.newPage();
    await page.addInitScript(b => {
      window.__BUDDIES__ = b;
      window.__TAURI__ = { core: { invoke: async (cmd, args) => { console.log('EXE ' + JSON.stringify({ cmd, args })); } }, event: { listen: async () => {} } };
    }, boot);
    page.on('pageerror', e => lines.push('pageerror ' + e.message));
    page.on('console', m => {
      const t = m.text();
      if (t.startsWith('EXE ')) { const c = JSON.parse(t.slice(4)); if (c.cmd === 'log_line') lines.push(c.args.line); else calls.push(c); return; }
      if (m.type() === 'error') lines.push('console ' + t);
    });
    await page.goto(`${ORIGIN}/maker.html`);
    /* The page's CSP refuses waitForFunction's polling. */
    const up = await page.evaluate(() => new Promise(done => {
      const gave = setTimeout(() => done(false), 20000);
      const look = () => window.M && M.maker.state ? M.settled().then(() => { clearTimeout(gave); done(true); }) : setTimeout(look, 20);
      look();
    }));
    if (!up) throw new Error(`the Maker page didn't start: ${lines.slice(-5).join(' | ')}`);
    return page;
  };
  const onDisk = c => hub.evaluate(i => { const f = H.exe().files.get(`library/${i}/buddy.json`); return f ? JSON.parse(new TextDecoder().decode(f)).buddy : null; }, c);
  const flushed = page => page.evaluate(() => { M.maker.saveNow(); return M.store.flush(); });

  const page = await opened({ n: 0, id, label: 'maker-smoke' });
  const clicked = async name => { await page.getByRole('button', { name, exact: true }).click({ timeout: 8000 }); };
  ok('maker: the page opens with her', await page.evaluate(i => M.maker.current()?.character === i && M.maker.state.pets.length === 1 && document.title === 'Desktop Buddies Maker', id));
  const quiet = await hub.evaluate(() => { H.exe().calls.length = 0; });
  await page.waitForTimeout(1500);
  ok('maker: opening writes nothing', await hub.evaluate(() => !H.exe().calls.some(c => /^data_(write|move|delete)$/.test(c.cmd))), quiet);

  await page.evaluate(() => M.maker.setName('Real'));
  await page.waitForTimeout(1500);
  ok('maker: an edit autosaves over the real channel', (await onDisk(id))?.name === 'Real');

  /* Real art, through the real canvas, all the way into the library. */
  const made = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); x.fillStyle = '#c0f'; x.fillRect(32, 16, 64, 96);
    await M.maker.addFromSrc(c.toDataURL('image/png'), 'Painted');
    await M.maker.addSample('pip');
    M.maker.saveNow();
    await M.store.flush();
    return M.maker.state.pets.map(p => p.character);
  });
  ok('maker: canvas art and a sample both save', made.length === 3 && (await onDisk(made[1]))?.name === 'Painted' && !!(await onDisk(made[2])), made);
  await page.evaluate(i => M.maker.select(M.maker.state.pets.find(p => p.character === i).id), id);

  /* Export desktop page: the real build, with its player and re-encoded images. */
  await page.evaluate(() => M.host.exportPage());
  await hub.waitForFunction(() => H.exe().saved.length > 0, null, { timeout: 30000 });
  const html = await hub.evaluate(() => { const s = H.exe().saved.at(-1); return { name: s.name, filters: s.filters, length: s.content.length, player: s.content.includes('BuddyPlayer.start'), noKit: !s.content.includes('"kit"') }; });
  ok('maker: Export desktop page goes to the dialog with the player in it', html.name === 'desktop-buddies.html' && html.player && html.filters[0].extensions[0] === 'html', html);

  /* The Manager offers it now, and its buttons reach the hub's real command. */
  const manager = await ctx.newPage();
  await manager.addInitScript(() => { window.__TAURI__ = { core: { invoke: async () => {} }, event: { listen: async () => {} } }; });
  await manager.goto(`${ORIGIN}/manager.html`);
  await manager.waitForSelector('.win[data-ready="true"]');
  /* Each Maker window the hub opens has a label of its own. */
  const windowsOpened = () => hub.evaluate(() => H.exe().calls.filter(c => c.cmd === 'window_open' && c.args.spec.page === 'maker.html').map(c => c.args.spec.boot));
  const closeMakers = () => hub.evaluate(() => { for (const [l, w] of H.exe().windows) if (w.page === 'maker.html') H.exe().windows.delete(l); });
  await manager.getByRole('button', { name: 'New buddy' }).first().click();
  await hub.waitForTimeout(200);
  ok('maker: New buddy is offered, and opens it empty', (await windowsOpened()).some(b => !('id' in b) && /^maker-/.test(b.label)), await windowsOpened());
  await closeMakers();
  await manager.locator('.st:has(b:text-is("Real")) .dots').click();
  await manager.locator('.menu button:text-is("Edit")').click();
  await hub.waitForTimeout(200);
  ok('maker: Edit is offered, and opens her', (await windowsOpened()).some(b => b.id === id), await windowsOpened());
  await closeMakers();
  await manager.close();

  /* The real view's own buttons, with the real mouse. */
  const packed = await page.evaluate(i => M.store.ask({ k: 'maker-open', id: i }), id);
  await hub.evaluate(text => { const b = JSON.parse(text); b.buddy.name = 'Replaced'; const body = JSON.stringify(b); return H.client().importFiles([{ name: 'r.buddy', path: 'r.buddy', size: body.length, text: async () => body, url: async () => '' }]).then(([a]) => H.client().answerReplace(a.value.asked, 'replace')); }, packed.value.file); /* it asks first, and the person says Replace */
  await page.evaluate(() => M.maker.setName('Mine'));
  await clicked('Keep as a new buddy');
  await page.waitForTimeout(400);
  const kept = await page.evaluate(i => M.maker.state.pets.find(p => p.name === 'Mine' && p.character !== i)?.character, id);
  ok('maker: Keep as a new buddy is a real button that keeps both', !!kept && (await onDisk(kept))?.name === 'Mine' && (await onDisk(id))?.name === 'Replaced', kept);
  await page.evaluate(i => M.maker.select(M.maker.state.pets.find(p => p.character === i).id), kept);

  await page.locator('.spine [data-s="kit"]').click();
  await page.locator('[data-reply]').fill('not json');
  await page.getByRole('button', { name: 'Apply dialogue' }).click();
  await page.waitForTimeout(3500); /* the toast has gone by now */
  const why = page.locator('[data-reply-why]');
  ok('maker: a refused reply stays explained beside the box', await why.isVisible() && /Couldn't read that/.test(await why.textContent()), await why.textContent());
  await page.locator('[data-reply]').fill('still not json');
  ok('maker: and stops when the box changes', !await why.isVisible());

  /* Close stops input, whatever tries to get past it. */
  const box = await page.locator('[data-reply]').boundingBox();
  const typedBefore = await page.locator('[data-reply]').inputValue();
  const pasted = () => page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = c.height = 32; c.getContext('2d').fillRect(4, 4, 24, 24);
    const blob = await new Promise(done => c.toBlob(done, 'image/png')), d = new DataTransfer();
    d.items.add(new File([blob], 'pasted.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: d, bubbles: true, cancelable: true }));
    document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: d, bubbles: true, cancelable: true }));
  });
  const baseNow = () => page.evaluate(() => M.maker.current().base.src);
  const base = await baseNow();
  await page.locator('[data-reply]').blur();
  await hub.evaluate(() => { window.freeWrite = H.exe().hold('data_write'); });
  await page.evaluate(() => M.maker.setName('Held'));
  await clicked('Close');
  ok('maker: Close stops the page with a real modal', await page.evaluate(() => document.querySelector('dialog.closing')?.matches(':modal') && document.getElementById('root').closest('[inert]') === null));
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.type('typed while closing');
  ok('maker: while closing, the real mouse and keyboard reach nothing', await page.locator('[data-reply]').inputValue() === typedBefore);
  await pasted();
  await page.waitForTimeout(400);
  ok('maker: and a paste or a drop from outside is refused', await baseNow() === base && await page.locator('.pop > *').count() === 0 && await page.locator('.placed').isHidden());
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100); /* a second Escape can't be refused, so it comes straight back */
  ok('maker: Escape doesn\'t get out of it', await page.evaluate(() => document.querySelector('dialog.closing')?.matches(':modal')));
  await page.waitForTimeout(5200);
  await page.screenshot({ path: path.join(SHOTS, 'maker-closing.png') });
  await clicked('Keep editing');
  ok('maker: Keep editing puts it all back', await page.evaluate(() => !document.querySelector('dialog.closing')));
  await hub.evaluate(() => window.freeWrite());
  await page.locator('[data-reply]').fill('typed after');
  ok('maker: and the real keyboard works again', await page.locator('[data-reply]').inputValue() === 'typed after');
  await page.waitForTimeout(1500);
  ok('maker: and it saves again', (await onDisk(kept))?.name === 'Held', (await onDisk(kept))?.name);
  await pasted();
  await page.waitForTimeout(400);
  ok('maker: and a paste gets through again, which shows it was the close that stopped it', await page.locator('.placed').isVisible());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);

  await hub.evaluate(() => { window.stopFull = H.exe().failUntil('data_write', 'disk full', () => true); });
  await page.evaluate(() => M.maker.setName('Unsavable'));
  await clicked('Close');
  await clicked('Close anyway');
  await page.waitForTimeout(200);
  ok('maker: Close anyway is a real button, and it closes', calls.some(c => c.cmd === 'window_close'), calls.filter(c => c.cmd === 'window_close'));
  await hub.evaluate(() => window.stopFull());
  await page.close();
  const after = await opened({ n: 99, id }); /* as the hub opens one: it knows what's already been asked */

  /* A window that closes with an edit waiting. */
  await after.evaluate(() => M.maker.setName('Last Words'));
  await after.close();
  await hub.waitForTimeout(800);
  ok('maker: a real pagehide gets the waiting edit to the hub', (await onDisk(id))?.name === 'Last Words', (await onDisk(id))?.name);

  /* Big buddies over the real channel, with a second window listening as the Manager would. How much
     a closing page gets out is the browser's call, so past the small one this only reports it: what
     has to hold is that she's whole either way. */
  const listener = await opened({ n: 99 });
  for (const images of [1, 3, 8]) {
    const big = await opened({ n: 99 });
    const sizes = await big.evaluate(async n => {
      const noise = () => { let s = ''; const a = new Uint8Array(3 << 14); while (s.length < 7400000) { crypto.getRandomValues(a); s += btoa(String.fromCharCode(...a)).replace(/=+$/, ''); } return `data:image/png;base64,iVBORw0KGgo${s.slice(11, 7400000 - 7400000 % 4)}`; };
      const bb = { x0: 0, y0: 0, x1: 1, y1: 1 }, frames = Array.from({ length: n }, () => ({ src: noise(), bb }));
      const p = M.maker.addPet({ name: 'Big', base: frames[0], poses: { walk: { frames: frames.slice(1) } } }, true);
      const a = performance.now(); M.maker.saveNow(); const first = await M.store.flush(), b = performance.now();
      M.maker.setName('Bigger');
      const c = performance.now(); M.maker.saveNow(); const again = await M.store.flush(), d = performance.now();
      return { mb: +(JSON.stringify(p).length / 1e6).toFixed(1), first, firstMs: Math.round(b - a), again, againMs: Math.round(d - c), character: p.character };
    }, images);
    ok(`maker: ${sizes.mb} MB saves over the real channel`, sizes.first && sizes.again && (await onDisk(sizes.character))?.name === 'Bigger', sizes);
    await big.evaluate(() => M.maker.setName('Bigger Still'));
    await big.close();
    await hub.waitForTimeout(6000);
    const after = (await onDisk(sizes.character))?.name;
    ok(`maker: a real pagehide at ${sizes.mb} MB leaves her whole`, after === 'Bigger Still' || after === 'Bigger', `its last edit ${after === 'Bigger Still' ? 'got there' : 'was lost'}`);
    if (images === 1) ok('maker: a real pagehide carries a big image\'s worth', after === 'Bigger Still', after);
  }
  await listener.close();

  const wrong = lines.filter(l => /\b(error|rejected|pageerror)\b/.test(l));
  ok('maker: no errors or CSP lines', !wrong.length, wrong.slice(0, 4).join(' | ') || undefined);
  ok('maker: nothing asked for off this machine', !off.length, off.slice(0, 4).join(' | ') || undefined);
  await ctx.close();
}

/* The right-click menu's page, built, against the real hub on the fake exe over the real channels:
   placed at its own size, the first item focused with no help from the window's focus, the
   keyboard, Esc, a choice made once, a click elsewhere, Delete's question, and a list cut to the
   room there is. The page is opened after the right-click, as the exe opens its window, and the
   window's own focus comes first, as it does when the exe makes it. The hub hides the window: the
   page never does. */
if (!ONLY || ONLY === 'menu') {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 420 } });
    const hub = await ctx.newPage(), lines = [], calls = [];
    hub.on('pageerror', e => lines.push('hub pageerror ' + e.message));
    await hub.goto(`${ORIGIN}/__hub.html`);
    const ids = await hub.evaluate(o => H.boot(o), { buddies: [{ ...SIXTEEN[0], out: 1 }, { ...SIXTEEN[1], out: 2 }] });
    await hub.evaluate(id => H.ask(id), ids.Olive);
    /* the exe opens the page with its window's label as its boot */
    const label = await hub.waitForFunction(() => H.menuLabel()).then(h => h.jsonValue());
    const page = await ctx.newPage();
    await page.addInitScript(([t, l]) => {
      window.__BUDDIES__ = { label: l };
      window.__TAURI__ = { core: { invoke: async (cmd, args) => { console.log('EXE ' + JSON.stringify({ cmd, args })); } }, event: { listen: async () => {} } };
      if (t === 'light') localStorage.setItem('theme', 'light');
      /* the window took the foreground as it was made, before there was a menu to draw */
      addEventListener('DOMContentLoaded', () => dispatchEvent(new Event('focus')));
    }, [theme, label]);
    page.on('pageerror', e => lines.push('pageerror ' + e.message));
    page.on('console', m => {
      const t = m.text();
      if (!t.startsWith('EXE ')) { if (m.type() === 'error') lines.push('console ' + t); return; }
      const c = JSON.parse(t.slice(4));
      if (c.cmd === 'log_line') lines.push(c.args.line); else calls.push(c);
    });
    await page.goto(`${ORIGIN}/buddy-menu.html`);
    const said = `menu ${theme}`;
    const menuCalls = () => hub.evaluate(() => H.menuCalls());
    /* shown by the exe, then the focus comes to the page as Windows would bring it */
    const shown = () => hub.waitForFunction(() => H.menu() && !H.menu().hidden, null, { timeout: 5000 })
      .then(async () => { await page.evaluate(() => dispatchEvent(new Event('focus'))); return true; }, () => false);
    const hidden = () => hub.waitForFunction(() => H.menu()?.hidden, null, { timeout: 5000 }).then(() => true, () => false);
    const focused = () => page.evaluate(() => document.activeElement?.textContent);
    const words = () => page.evaluate(() => [...document.querySelectorAll('.menu-win button')].map(b => b.textContent));
    const shot = name => page.locator('.menu-win').screenshot({ path: path.join(SHOTS, `${name}-${theme}.png`), omitBackground: true });
    const copies = id => hub.evaluate(i => H.state().buddies.find(b => b.id === i)?.copies, id);
    const ask = async id => { await hub.evaluate(i => H.ask(i), id); return shown(); };

    ok(`${said}: shown after the right-click`, await shown(), await menuCalls());
    await page.evaluate(() => document.fonts.ready);
    const win = await hub.evaluate(() => H.menu()), box = await page.evaluate(() => { const r = document.querySelector('.menu-win').getBoundingClientRect(); return { w: Math.ceil(r.width), h: Math.ceil(r.height) }; });
    ok(`${said}: placed beside her, at the size of what it drew`, win.x === 660 && win.y === 450 && win.w === box.w && win.h === box.h, { win, box });
    ok(`${said}: opened hidden, then placed, shown and focused`, (await menuCalls()).join() === 'window_open,window_place,window_show,window_focus', await menuCalls());
    ok(`${said}: her own list, from the Manager's`, (await words()).join() === 'Chase my mouse,Call another,Dismiss,Talks,Edit,Export to a file,Delete', await words());
    ok(`${said}: the first item has the focus, though the window's focus came before it was drawn`, await focused() === 'Chase my mouse', await focused());
    await hub.waitForFunction(() => H.exe().logs.some(l => /^menu \d+ focused \d+ ms after the right-click/.test(l)), null, { timeout: 3000 }).catch(() => {});
    ok(`${said}: counted shown once the page said it has the keyboard`, await hub.evaluate(() => H.exe().logs.some(l => /^menu \d+ focused \d+ ms after the right-click/.test(l))));
    ok(`${said}: the page shows and hides nothing itself`, !calls.some(c => /^window_(show|hide|focus|place)$/.test(c.cmd)), calls.map(c => c.cmd));
    const room = await page.evaluate(() => getComputedStyle(document.querySelector('.menu')).maxHeight);
    ok(`${said}: its list has the work area's room and no more`, room === '1020px', room);
    await shot('right-click-menu');
    await page.keyboard.press('ArrowUp');
    ok(`${said}: arrows wrap to the end`, await focused() === 'Delete', await focused());
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await shot('right-click-menu-keys');
    await page.keyboard.press('Enter');
    await hub.waitForFunction(id => H.state()?.buddies.find(b => b.id === id)?.status === 'home', ids.Olive, { timeout: 5000 }).catch(() => {});
    ok(`${said}: Enter on Dismiss dismisses her, and the hub hides the window`, await copies(ids.Olive) === 0 && await hidden(), await copies(ids.Olive));

    ok(`${said}: another right-click shows it again, in the same window`, await ask(ids.Pip) && (await menuCalls()).filter(c => c === 'window_open').length === 1);
    ok(`${said}: with copies, Bring here and Dismiss one`, (await words()).join() === 'Bring here,Chase my mouse,Call another,Dismiss one,Dismiss,Talks,Edit,Export to a file,Delete', await words());
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Call another'); b.click(); b.click(); });
    await hidden(); await hub.waitForTimeout(200);
    ok(`${said}: two quick clicks on a choice do it once`, await copies(ids.Pip) === 3, await copies(ids.Pip));

    await ask(ids.Pip);
    await page.keyboard.press('Escape');
    await page.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent === 'Call another').click());
    ok(`${said}: Esc closes it, and a click after it does nothing`, await hidden() && await copies(ids.Pip) === 3, await copies(ids.Pip));

    await ask(ids.Pip);
    await page.evaluate(() => dispatchEvent(new Event('blur')));
    ok(`${said}: a click elsewhere closes it`, await hidden());

    await ask(ids.Pip);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[role="alertdialog"]');
    await hub.waitForTimeout(150);
    ok(`${said}: Delete asks first, Cancel focused`, await focused() === 'Cancel', await focused());
    const asked = await hub.evaluate(() => H.menu()), qbox = await page.evaluate(() => { const r = document.querySelector('.menu-win').getBoundingClientRect(); return { w: Math.ceil(r.width), h: Math.ceil(r.height) }; });
    ok(`${said}: the window is placed again at the question's size`, asked.w === qbox.w && asked.h === qbox.h, { asked, qbox });
    await shot('right-click-delete');
    await page.keyboard.press('Escape');
    ok(`${said}: Esc on the question deletes nothing`, await hidden() && (await hub.evaluate(() => H.state().buddies.length)) === 2);

    const wrong = lines.filter(l => /\b(error|rejected|pageerror)\b/.test(l));
    ok(`${said}: no errors or CSP lines`, !wrong.length, wrong.slice(0, 4).join(' | ') || undefined);
    await ctx.close();
  }
}

await browser.close();
server.close();
const failed = results.filter(r => !r[0]);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. Screenshots in ${SHOTS}`);
for (const [, n] of failed) console.log('FAIL ' + n);
process.exit(failed.length ? 1 : 0);
