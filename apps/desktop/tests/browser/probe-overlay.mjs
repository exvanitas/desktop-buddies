/* The end-to-end run's overlay probe in a real headless browser: what it tells, and what it never
   does, on the real view with the real overlay CSS. Part of pnpm test:manager, after the build.
   Needs a Chromium that's already installed: set CHROME_PATH, or it looks in Playwright's cache. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { build } from 'vite';

const HERE = path.dirname(fileURLToPath(import.meta.url)), DESKTOP = path.resolve(HERE, '../..'), REPO = path.resolve(DESKTOP, '../..');
const CSS = fs.readFileSync(path.join(DESKTOP, 'dist/app/style.css'), 'utf8');
const ART = fs.readFileSync(path.join(REPO, 'packages/test-support/art/olive/main.webp'));

function chrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  const found = fs.existsSync(cache) ? fs.readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => b.split('-')[1] - a.split('-')[1]) : [];
  if (found.length) return path.join(cache, found[0], 'chrome-linux64/chrome');
  throw new Error('no Chromium found: set CHROME_PATH');
}

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-overlay-'));
await build({
  root: DESKTOP, configFile: false, logLevel: 'error', publicDir: false,
  build: { outDir: OUT, emptyOutDir: false, minify: false, lib: { entry: path.join(HERE, 'probe-overlay-page.ts'), formats: ['iife'], name: 'ProbeOverlay', fileName: () => 'page.js' } }
});
const PAGE = fs.readFileSync(path.join(OUT, 'page.js'), 'utf8');
fs.rmSync(OUT, { recursive: true, force: true });

const browser = await chromium.launch({ headless: true, executablePath: chrome(), args: ['--no-sandbox'] });
const results = [];
const ok = (name, good, detail) => { results.push(!!good); console.log(`${good ? 'ok  ' : 'FAIL'} probe-overlay ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route('http://probe.test/**', async r => {
    const p = new URL(r.request().url()).pathname;
    if (p === '/') return r.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset=utf-8><style>${CSS}</style><body></body><script src="/page.js"></script>` });
    if (p === '/page.js') return r.fulfill({ contentType: 'text/javascript', body: PAGE });
    if (p === '/img/w-broken.webp') return r.fulfill({ contentType: 'image/webp', body: Buffer.from('not an image') });
    if (p === '/img/w-late.webp') await new Promise(d => setTimeout(d, 1200));
    if (p.startsWith('/img/')) return r.fulfill({ contentType: 'image/webp', body: ART });
    return r.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://probe.test/');
  await page.waitForFunction(() => !!window.ProbeOverlay);
  const line = await page.evaluate(() => window.ProbeOverlay.LINE);
  const want = `${Buffer.from('E2E Check').toString('hex')} ${Buffer.from(line).toString('hex')}`;
  const run = name => page.evaluate(n => window.ProbeOverlay.CASES[n](), name);
  const none = t => !t.said.length && !t.waves.length;

  let t = await run('shown');
  ok('shown: the line, byte for byte, once', t.said.length === 1 && t.said[0] === want, t);
  t = await run('mid_pop');
  ok('mid_pop: nothing while the bubble pops in from opacity 0, the line once it lands', t.early.said.length === 0 && t.said.length === 1, t);
  t = await run('image_fading_in');
  ok('image_fading_in: nothing while her image fades in, the line once it has', t.early.said.length === 0 && t.said.length === 1, t);
  t = await run('late_show');
  ok('late_show: told once an opacity 0 ancestor comes back', t.said.length === 1, t);
  for (const name of ['opacity_ancestor', 'detached', 'zero_size', 'offscreen', 'hidden_body', 'hidden_img', 'never_together', 'missing_pet']) {
    t = await run(name);
    ok(`${name}: nothing told`, none(t) && !t.cannot.length, t);
  }
  t = await run('wave');
  ok('wave: one wave', t.waves.length === 1, t);
  t = await run('wave_broken');
  ok('wave_broken: a wave by its file name only is none', t.waves.length === 0, t);
  t = await run('wave_late');
  ok('wave_late: none while it loads, one once it has', t.early.waves.length === 0 && t.waves.length === 1, t);
  t = await run('wave_hidden_pet');
  ok('wave_hidden_pet: none', t.waves.length === 0, t);
  t = await run('cannot');
  ok('cannot: no checkVisibility says so once and tells nothing', none(t) && t.cannot.length === 1, t);
} finally {
  await browser.close();
}
const failed = results.filter(r => !r).length;
console.log(`probe-overlay: ${results.length - failed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
