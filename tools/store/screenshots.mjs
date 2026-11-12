#!/usr/bin/env node
/* The Store's screenshots, from the real app pages in headless Chromium, with a buddy file as the only
   buddy. Each is a 1920x1080 PNG: a 1080p display at 150% scaling, so the pages are 1280x720 CSS
   pixels, as the app's own windows would be there.

     pnpm store:shots [--sample <file>] [--out <dir>] [--theme dark|light] [--only <word>] [--seed <n>] [--at <ms>] [--verbose]

   --sample  the buddy in them. By default the repo's code-drawn sample, the same one
             tools/store/sample-buddy.mjs puts on a release.
   --out     where the PNGs go. By default docs/store/screenshots.
   --theme   the Manager's and the Maker's theme. Dark by default, as the app starts.
   --seed, --at  the desktop shot's moment. Another buddy may need another one: --verbose prints
             what each copy is doing and saying, to choose by.

   The desktop is drawn: a plain wallpaper, a taskbar and three windows with no words in them, at the
   places the fake exe reports to the real hub. The world runs on a seeded random and a stepped clock,
   so the same buddy gives the same pictures. A buddy with animated images is refused, since those play
   on the browser's own clock. Built pages go in apps/desktop/dist/store-shots for the run only. Needs `pnpm --filter @buddies/desktop build` first
   (pnpm store:shots does it), and a Chromium that's already installed: set CHROME_PATH, or it looks
   in Playwright's cache. */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { build } from 'vite';
import { playerBundle } from '../../apps/desktop/player-bundle.ts';
import { animatedImages } from './animated.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DESKTOP = path.join(REPO, 'apps/desktop'), BROWSER = path.join(DESKTOP, 'tests/browser'), APP = path.join(DESKTOP, 'dist/app');
const flag = n => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const SAMPLE = path.resolve(flag('sample') || path.join(REPO, 'packages/test-support/fixtures/sample.json'));
const OUT = path.resolve(flag('out') || path.join(REPO, 'docs/store/screenshots'));
const THEME = flag('theme') || 'dark', ONLY = flag('only');
/* the desktop shot's moment: her world's seed, and how long it has run. Chosen by eye for the sample,
   with --verbose, which prints where each copy is and what she says. */
const SEED = +(flag('seed') || 31), AT = +(flag('at') || 7000);
if (!fs.existsSync(path.join(APP, 'manager.html'))) throw new Error('no app build: run pnpm --filter @buddies/desktop build');
/* A picture that moves by itself plays on the browser's clock, not the world's, so it would never shoot the same twice. */
const moving = animatedImages(fs.readFileSync(SAMPLE, 'utf8'));
if (moving.length) {
  console.error(`${path.basename(SAMPLE)} has animated images (${moving.slice(0, 3).join(', ')}${moving.length > 3 ? ', ...' : ''}). Screenshots need still ones: save those frames as plain PNG or WebP.`);
  process.exit(1);
}

function chrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  const found = fs.existsSync(cache) ? fs.readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => b.split('-')[1] - a.split('-')[1]) : [];
  if (found.length) return path.join(cache, found[0], 'chrome-linux64/chrome');
  throw new Error('no Chromium found: set CHROME_PATH');
}

/* Built pages for this run, in the desktop app's ignored dist folder, gone when it ends however it ends. */
const HARNESS = path.join(DESKTOP, 'dist/store-shots');
let server = null, browser = null, ORIGIN = '';

/* the scene, and the real Maker page's logic with the Maker where this can reach it, as the Manager check builds them */
async function setUp() {
  fs.rmSync(HARNESS, { recursive: true, force: true });
  await build({
    root: DESKTOP, configFile: false, logLevel: 'error', publicDir: false,
    build: { outDir: HARNESS, emptyOutDir: false, minify: false, lib: { entry: path.join(BROWSER, 'store-scene.ts'), formats: ['iife'], name: 'StoreScene', fileName: () => 'scene.js' } }
  });
  await build({
    root: DESKTOP, configFile: false, logLevel: 'error', publicDir: false, plugins: [playerBundle()],
    build: { outDir: HARNESS, emptyOutDir: false, minify: false, rollupOptions: { input: path.join(BROWSER, 'maker-page.ts'), output: { format: 'iife', entryFileNames: 'maker-page.js' } } }
  });
  server = http.createServer(serve);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  ORIGIN = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: chrome(), args: ['--no-sandbox'] });
}

/* The wallpaper and the drawn windows. Only the overlay's own CSS draws her. */
const DESK_CSS = `
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
#desk { position: fixed; inset: 0; background: radial-gradient(120% 90% at 20% 10%, #8fb8c9 0%, #5d7fa6 45%, #3f4f7d 100%); }
#desk::after { content: ''; position: absolute; inset: 0; background: radial-gradient(60% 50% at 85% 85%, rgba(255, 214, 170, .35), transparent 70%); }
.win { position: absolute; box-sizing: border-box; border-radius: 8px; background: #f7f7f5; box-shadow: 0 12px 32px rgba(10, 20, 40, .35), 0 0 0 1px rgba(0, 0, 0, .12); overflow: hidden; }
.win .bar { height: 32px; background: #e9e9e6; display: flex; justify-content: flex-end; align-items: center; gap: 18px; padding: 0 16px; }
.win .bar i { width: 10px; height: 10px; border-radius: 2px; border: 1.5px solid #9a9a96; }
.win .body { padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; }
.win .body b { display: block; height: 12px; border-radius: 6px; background: #dcdcd8; }
.taskbar { position: absolute; z-index: 50; background: rgba(28, 32, 44, .88); display: flex; justify-content: center; align-items: center; gap: 10px; }
.taskbar i { width: 28px; height: 28px; border-radius: 6px; background: rgba(255, 255, 255, .22); }
.own { position: absolute; z-index: 60; border-radius: 8px; box-shadow: 0 16px 40px rgba(10, 20, 40, .45); }
#root { position: fixed; z-index: 100; pointer-events: none; }`;
const SCENE = `<!doctype html><html><head><meta charset=utf-8><title>scene</title><style>${fs.readFileSync(path.join(APP, 'style.css'), 'utf8')}\n${DESK_CSS}</style></head><body><div id="desk"></div><div id="root"></div><script src="__scene.js"></script></body></html>`;

const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.woff2': 'font/woff2', '.png': 'image/png' };
function serve(q, a) {
  const p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/__scene.html') { a.writeHead(200, { 'content-type': MIME['.html'] }); return a.end(SCENE); }
  const f = p === '/__scene.js' ? path.join(HARNESS, 'scene.js') : p === '/maker.js' ? path.join(HARNESS, 'maker-page.js') : path.join(APP, p);
  if (!f.startsWith(APP + path.sep) && f !== path.join(HARNESS, 'scene.js') && f !== path.join(HARNESS, 'maker-page.js')) { a.writeHead(404); return a.end(); }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { a.writeHead(404); return a.end(); }
  a.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); a.end(fs.readFileSync(f));
}

/* 1080p at 150%: physical pixels for the world, CSS pixels for pages */
const SCREEN = { w: 1920, h: 1080, scale: 1.5, taskbar: 72 };
const NOTES = { x: 150, y: 330, w: 780, h: 560, exe: 'notes.exe' }, PAINT = { x: 1020, y: 210, w: 780, h: 600, exe: 'paint.exe' }, MUSIC = { x: 560, y: 640, w: 760, h: 300, exe: 'music.exe' };
/* front to back */
const WINDOWS = [NOTES, PAINT, MUSIC];
const VERBOSE = process.argv.includes('--verbose');
const problems = [];

async function scene(o) {
  const ctx = await browser.newContext({ viewport: { width: SCREEN.w / SCREEN.scale, height: SCREEN.h / SCREEN.scale }, deviceScaleFactor: SCREEN.scale });
  const page = await ctx.newPage();
  const watch = (p, who) => {
    p.on('pageerror', e => problems.push(`${o.name} ${who}: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') problems.push(`${o.name} ${who}: ${m.text()}`); });
  };
  ctx.on('request', q => { if (!q.url().startsWith(ORIGIN) && !q.url().startsWith('data:')) problems.push(`${o.name}: outside request`); });
  await ctx.route('**/library/**', async route => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname.slice(1)), body = await page.evaluate(f => S.file(f), p);
    if (!body) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(p)] || 'image/jpeg', body: Buffer.from(body, 'base64') });
  });
  watch(page, 'scene');
  await page.goto(`${ORIGIN}/__scene.html`);
  const id = await page.evaluate(b => S.boot(b), { sample: fs.readFileSync(SAMPLE, 'utf8'), copies: o.copies ?? 1, screen: SCREEN, windows: o.windows ?? WINDOWS, api: o.api, seed: o.seed ?? 7 });
  /* An app page in the same profile, so it reaches the same hub. */
  const appPage = async (file, size, boot, theme = THEME) => {
    const p = await ctx.newPage();
    await p.setViewportSize(size);
    /* Still, so a picture never catches a preview between frames. */
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await p.addInitScript(([t, b]) => {
      window.__TAURI__ = { core: { invoke: async () => {} }, event: { listen: async () => {} } };
      if (b) window.__BUDDIES__ = b;
      if (t === 'light') localStorage.setItem('theme', 'light');
    }, [theme, boot]);
    watch(p, file);
    await p.goto(`${ORIGIN}/${file}`);
    return p;
  };
  return { ctx, page, id, appPage };
}

/* Fonts, images and the cut lines in, and two frames drawn. */
const settled = p => p.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })));
  for (let i = 0; i < 40 && document.querySelector('.st.out .art:not(:has(.cutline))'); i++) await new Promise(r => setTimeout(r, 25));
  await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
});
/* The page's CSP refuses waitForFunction's polling, so the Maker is waited for from inside. */
const makerUp = p => p.evaluate(() => new Promise(done => {
  const gave = setTimeout(() => done(false), 20000);
  const look = () => window.M && M.maker.state ? M.settled().then(() => { clearTimeout(gave); done(true); }) : setTimeout(look, 20);
  look();
}));
/* A page's picture once two shots a moment apart agree, so nothing still settling gets in. */
async function asImage(p) {
  await p.evaluate(() => Promise.all([...document.images].map(i => i.decode().catch(() => {}))));
  let last = await p.screenshot();
  for (let i = 0; i < 20; i++) {
    await p.waitForTimeout(250);
    const now = await p.screenshot();
    if (now.equals(last)) return 'data:image/png;base64,' + now.toString('base64');
    last = now;
  }
  throw new Error('a page kept changing: nothing still to shoot');
}
async function shoot(s, file) {
  if (VERBOSE) console.log(JSON.stringify(await s.page.evaluate(() => [S.where(), [...document.querySelectorAll('.db-bubble:not([hidden])')].map(b => b.textContent)])));
  await settled(s.page);
  await s.page.screenshot({ path: path.join(OUT, file) });
  await s.ctx.close();
}

/* Her in the Maker on one sheet, with nobody out, so nothing on the desktop covers it. */
async function maker(theme, sheet) {
  const s = await scene({ name: 'maker', copies: 0 });
  const m = await s.appPage('maker.html', { width: 1180, height: 680 }, { n: 0, id: s.id, label: 'maker-store' }, theme);
  if (!await makerUp(m)) throw new Error("the Maker page didn't start");
  await m.locator(`.spine [data-s="${sheet}"]`).first().click();
  await settled(m);
  await s.page.evaluate(src => S.showWindow(src, { x: 50, y: 6, w: 1180, h: 680 }), await asImage(m));
  return s;
}

/* The Manager's and Settings' moments are chosen by eye too: her on the window beside the Manager, not
   over it. */
const SHOTS = {
  '01-manager.png': async () => {
    const s = await scene({ name: 'manager', seed: 5 });
    const m = await s.appPage('manager.html', { width: 760, height: 580 });
    await m.waitForSelector('.win[data-ready="true"]'); await settled(m);
    await s.page.evaluate(src => S.showWindow(src, { x: 470, y: 46, w: 760, h: 580 }), await asImage(m));
    await s.page.evaluate(() => S.run(9000));
    return s;
  },
  /* Feelings: her poses with their lines, and what she says when */
  '02-maker.png': () => maker(THEME, 4),
  '03-desktop.png': async () => {
    const s = await scene({ name: 'desktop', copies: 3, seed: SEED });
    await s.page.evaluate(ms => S.run(ms), AT);
    return s;
  },
  '04-settings.png': async () => {
    const s = await scene({ name: 'settings', seed: 4, api: ['Focus Timer'] });
    const m = await s.appPage('manager.html', { width: 760, height: 580 });
    await m.waitForSelector('.win[data-ready="true"]');
    await m.getByRole('button', { name: 'Settings' }).click();
    await settled(m);
    await s.page.evaluate(src => S.showWindow(src, { x: 470, y: 46, w: 760, h: 580 }), await asImage(m));
    await s.page.evaluate(() => S.run(6000));
    return s;
  },
  /* the light theme, on All words: everything she says. Hanging around's step icons load in either of two
     orders, so a picture of it isn't the same twice. */
  '05-maker-light.png': () => maker('light', 'words')
};

try {
  await setUp();
  fs.mkdirSync(OUT, { recursive: true });
  for (const [file, make] of Object.entries(SHOTS)) {
    if (ONLY && !file.includes(ONLY)) continue;
    await shoot(await make(), file);
    console.log(`${file}`);
  }
} finally {
  await browser?.close(); server?.close();
  fs.rmSync(HARNESS, { recursive: true, force: true });
}
if (problems.length) { console.error(problems.slice(0, 10).join('\n')); process.exitCode = 1; }
