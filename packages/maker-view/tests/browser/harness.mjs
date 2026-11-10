/* Serves the view's test page and opens it in headless Chromium, with its CSP, its fonts and no network.
   Needs a Chromium that's already installed: set CHROME_PATH, or it looks in Playwright's cache. */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { build } from 'vite';

const HERE = path.dirname(fileURLToPath(import.meta.url)), VIEW = path.resolve(HERE, '../..'), REPO = path.resolve(VIEW, '../..');
const PEEL = path.join(REPO, 'packages/peel'), ART = path.join(REPO, 'packages/test-support/art');

function chrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  const found = fs.existsSync(cache) ? fs.readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => b.split('-')[1] - a.split('-')[1]) : [];
  if (found.length) return path.join(cache, found[0], 'chrome-linux64/chrome');
  throw new Error('no Chromium found: set CHROME_PATH');
}

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'";
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><title>Maker</title><link rel="stylesheet" href="maker.css"></head><body><div id="root"></div><script src="page.js"></script></body></html>`;
const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.woff2': 'font/woff2', '.png': 'image/png' };

export async function startHarness() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'maker-view-'));
  await build({
    root: VIEW, configFile: false, logLevel: 'error', publicDir: false,
    build: { outDir: out, emptyOutDir: false, minify: false, lib: { entry: path.join(HERE, 'page.ts'), formats: ['iife'], name: 'MakerPage', fileName: () => 'page.js' } }
  });
  const sheet = () => fs.readFileSync(path.join(PEEL, 'peel.css'), 'utf8') + '\n' + fs.readFileSync(path.join(VIEW, 'src/maker-view.css'), 'utf8');
  const server = http.createServer((q, a) => {
    const p = decodeURIComponent(q.url.split('?')[0]);
    const send = (type, body) => { a.writeHead(200, { 'content-type': type }); a.end(body); };
    if (p === '/' || p === '/maker.html') return send(MIME['.html'], PAGE);
    if (p === '/maker.css') return send(MIME['.css'], sheet());
    const f = p === '/page.js' ? path.join(out, 'page.js') : p === '/__sample.json' ? path.join(REPO, 'packages/test-support/fixtures/sample.json')
      : p.startsWith('/__art/') ? path.join(ART, p.slice(7)) : p.startsWith('/fonts/') ? path.join(PEEL, p) : null;
    if (!f || !fs.existsSync(f)) { a.writeHead(404); return a.end(); }
    send(MIME[path.extname(f)] || 'application/octet-stream', fs.readFileSync(f));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const ORIGIN = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: chrome(), args: ['--no-sandbox'] });

  /* Fails on anything that isn't this page's own. */
  async function open(boot, { w = 1180, h = 680, scale = 1, theme = 'dark', reduced = false, prepare } = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
    const errors = [], outside = [];
    await ctx.route('**/*', route => { const u = route.request().url(); if (u.startsWith(ORIGIN) || u.startsWith('data:')) return route.continue(); outside.push(u); errors.push('outside request ' + u); return route.abort(); });
    const page = await ctx.newPage();
    if (process.env.MAKER_TIMEOUT) page.setDefaultTimeout(+process.env.MAKER_TIMEOUT);
    page.on('pageerror', e => errors.push('pageerror ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console ' + m.text()); });
    await page.addInitScript(t => { try { if (t === 'light') localStorage.setItem('theme', 'light'); } catch { /* */ } }, theme);
    if (prepare) await prepare(page);
    await page.goto(`${ORIGIN}/maker.html`);
    const { act: _a, ...plain } = boot;
    await page.evaluate(b => H.boot(b), plain);
    if (!plain.hold) await page.waitForSelector('.win[data-ready="true"]');
    await settled(page);
    return { ctx, page, errors, outside };
  }
  return { open, settled, stop: async () => { await browser.close(); server.close(); fs.rmSync(out, { recursive: true, force: true }); }, ORIGIN };
}

export const settled = page => page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].filter(i => !i.closest('.fs-roll')).map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
});

/* Run in the page. Every speech bubble showing over art, and whether its tail points at her: out of an
   edge that faces her, from the half of that edge nearer her, with its tip over her, or leaning her way
   when she's off at a corner. She's level with a bubble along an axis while her middle is inside its
   middle half, and then either half is fine. */
export const TAILS = async () => {
  await Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})));
  const px = v => parseFloat(v) || 0, out = [];
  for (const b of document.querySelectorAll('.bub:not([hidden]), .live > .say')) {
    const art = b.matches('.bub') ? b.parentElement : b.parentElement.querySelector(':scope > .art');
    const where = `${b.matches('.bub') ? 'sticker' : b.closest('.tray.w') ? 'words tray' : 'pose tray'} "${b.textContent.trim().slice(0, 30)}"`;
    const s = getComputedStyle(b), t = getComputedStyle(b, '::after'), r = b.getBoundingClientRect(), a = art.getBoundingClientRect();
    if (t.display === 'none' || t.content === 'none') { out.push({ where, bad: 'no tail' }); continue; }
    /* the tail's corners on the page, from its box in the bubble's padding box and its clip-path */
    const x0 = r.left + px(s.borderLeftWidth) + px(t.left), y0 = r.top + px(s.borderTopWidth) + px(t.top), w = px(t.width), hh = px(t.height);
    const pts = [...t.clipPath.matchAll(/(-?[\d.]+)(%|px)?\s+(-?[\d.]+)(%|px)?/g)].map(m => ({
      x: x0 + (m[2] === '%' ? +m[1] / 100 * w : +m[1]), y: y0 + (m[4] === '%' ? +m[3] / 100 * hh : +m[3]) }));
    const outside = p => Math.max(r.left - p.x, p.x - r.right, r.top - p.y, p.y - r.bottom, 0);
    const tip = pts.reduce((x, p) => outside(p) > outside(x) ? p : x), base = pts.filter(p => outside(p) < .01);
    const at = { x: base.reduce((n, p) => n + p.x, 0) / (base.length || 1), y: base.reduce((n, p) => n + p.y, 0) / (base.length || 1) };
    const edge = tip.x < r.left ? 'left' : tip.x > r.right ? 'right' : tip.y > r.bottom ? 'bottom' : tip.y < r.top ? 'top' : 'none';
    const c = { x: (a.left + a.right) / 2, y: (a.top + a.bottom) / 2 }, mid = { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
    const facing = [c.x < r.left && 'left', c.x > r.right && 'right', c.y > r.bottom && 'bottom', c.y < r.top && 'top'].filter(Boolean);
    /* along the edge: x for top and bottom, y for left and right */
    const ax = edge === 'left' || edge === 'right' ? 'y' : 'x', half = (ax === 'x' ? r.width : r.height) / 4;
    const toward = Math.abs(c[ax] - mid[ax]) <= half || Math.sign(at[ax] - mid[ax]) === Math.sign(c[ax] - mid[ax]);
    /* straight across, the tip is over her. Off at a corner, it leans her way */
    const lo = ax === 'x' ? a.left : a.top, hi = ax === 'x' ? a.right : a.bottom, over = tip[ax] >= lo - 1 && tip[ax] <= hi + 1;
    const leans = Math.sign(tip[ax] - at[ax]) === Math.sign(c[ax] - at[ax]);
    /* the tail's white fill sits inside it, and a preview shows its bubble whole */
    const f = getComputedStyle(b, '::before'), fx = r.left + px(s.borderLeftWidth) + px(f.left), fy = r.top + px(s.borderTopWidth) + px(f.top);
    const filled = f.display === 'none' || f.content === 'none' || (fx >= x0 - .5 && fx + px(f.width) <= x0 + w + .5 && fy >= y0 - .5 && fy + px(f.height) <= y0 + hh + .5);
    const box = b.closest('.live')?.getBoundingClientRect(), whole = !box || (r.left >= box.left - .5 && r.right <= box.right + .5 && r.top >= box.top - .5 && r.bottom <= box.bottom + .5);
    const bad = !base.length || edge === 'none' ? 'no tip outside the bubble'
      : !whole ? 'bubble runs out of its preview' : !filled ? "tail's fill is outside the tail"
      : facing.length && !facing.includes(edge) ? `tail out of the ${edge} edge, she's ${facing.join(' and ')}`
      : !toward ? `tail in the ${edge} edge's half away from her`
      : facing.length > 1 ? (leans ? null : `tip leans away from her along ${ax}`)
      : !over ? `tip not over her along ${ax}` : null;
    out.push({ where, bad, edge, facing, at: { x: Math.round(at.x), y: Math.round(at.y) }, tip: { x: Math.round(tip.x), y: Math.round(tip.y) }, her: { x: Math.round(c.x), y: Math.round(c.y) }, bubble: [r.left, r.top, r.right, r.bottom].map(Math.round) });
  }
  return out;
};

/* Run in the page. Every speech bubble showing over art, and how its words sit: inside it, a word broken
   only when it alone is wider than the bubble, and a sticker's bubble inside its sticker, where nothing
   cuts it off and it covers no row above. */
export const WRAPS = () => {
  const found = [];
  for (const b of document.querySelectorAll('.bub:not([hidden]), .live > .say')) {
    const where = `${b.matches('.bub') ? 'sticker' : b.closest('.tray.w') ? 'words tray' : 'pose tray'} "${b.textContent.trim().slice(0, 30)}"`;
    const s = getComputedStyle(b), r = b.getBoundingClientRect(), wide = b.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
    const pen = document.createElement('canvas').getContext('2d'), broken = [];
    const walk = document.createTreeWalker(b, NodeFilter.SHOW_TEXT), range = document.createRange();
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      pen.font = getComputedStyle(t.parentElement).font;
      for (const m of t.textContent.matchAll(/\S+/g)) {
        range.setStart(t, m.index); range.setEnd(t, m.index + m[0].length);
        const tops = new Set([...range.getClientRects()].map(q => Math.round(q.top)));
        if (tops.size > 1 && pen.measureText(m[0]).width <= wide) broken.push(m[0]);
      }
    }
    const spot = b.closest('.c')?.querySelector('.spot')?.getBoundingClientRect();
    /* a long line in the words tray scrolls inside its own box, so the text is measured against that */
    const inner = b.querySelector(':scope > span');
    range.selectNodeContents(inner || b);
    const box = (inner || b).getBoundingClientRect(), text = range.getBoundingClientRect();
    const out = text.left < box.left - 1 || text.right > box.right + 1 || (!inner && (text.top < r.top - 1 || text.bottom > r.bottom + 1));
    const bad = out ? 'words run out of it'
      : broken.length ? `broken mid-word: ${broken.join(', ')}`
      : spot && r.top < spot.top - .5 ? `out of its sticker by ${Math.round(spot.top - r.top)} px` : null;
    found.push({ where, bad, lines: Math.round(text.height / parseFloat(s.lineHeight)), bubble: [r.left, r.top, r.right, r.bottom].map(Math.round) });
  }
  return found;
};

/* Run in the page. What's run off the window, whose words are cut short, and what's too faint to read. */
export const MEASURE = () => {
  const parse = c => { const m = /rgba?\(([^)]+)\)/.exec(c) || /color\(srgb ([^)]+)\)/.exec(c); if (!m) return null; const srgb = c.startsWith('color'); const n = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: srgb ? n[0] * 255 : n[0], g: srgb ? n[1] * 255 : n[1], b: srgb ? n[2] * 255 : n[2], a: n[3] ?? 1 }; };
  const over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
  const backOf = e => { const stack = []; for (let n = e; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; } } let out = { r: 255, g: 255, b: 255, a: 1 }; for (const c of stack.reverse()) out = over(c, out); return out; };
  const seen = e => { for (let n = e; n; n = n.parentElement) { const s = getComputedStyle(n); if (n.hidden || s.display === 'none' || s.visibility === 'hidden') return false; } return e.getClientRects().length > 0; };
  const name = e => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').join('.') : ''} "${(e.textContent || '').trim().slice(0, 40)}"`;
  const off = [], clipped = [], faint = [];
  if (document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight) off.push(`page ${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}`);
  for (const e of document.querySelectorAll('.win *, .pop *, .toast')) {
    if (!seen(e)) continue;
    const r = e.getBoundingClientRect();
    if (e.matches('button, input, textarea, h1, h2, h3, p, b, small, output') && (r.right > innerWidth + .5 || r.left < -.5 || r.bottom > innerHeight + .5 || r.top < -.5)) {
      let scrolled = false; for (let n = e.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n); if (/auto|scroll/.test(o.overflowY + o.overflowX)) { scrolled = true; break; } }
      if (!scrolled) off.push(name(e));
    }
    const own = [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
    if (!own.length) continue;
    /* cut by this box */
    const s = getComputedStyle(e);
    if ((s.overflowX !== 'visible' || s.textOverflow === 'ellipsis') && !/auto|scroll/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 1 && !e.title) clipped.push(name(e));
    /* cut by a box around it */
    const range = document.createRange();
    for (const t of own) {
      range.selectNodeContents(t);
      const b = range.getBoundingClientRect();
      for (let n = e; n && n !== document.body; n = n.parentElement) {
        const o = getComputedStyle(n);
        if (/auto|scroll/.test(o.overflowY + o.overflowX)) break;
        if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
        const c = n.getBoundingClientRect();
        if (b.right > c.right + 1 || b.bottom > c.bottom + 1 || b.left < c.left - 1 || b.top < c.top - 1) { if (!e.title && !n.title) clipped.push(`${name(e)} by ${n.tagName.toLowerCase()}.${n.className}`); break; }
      }
    }
    if (e.disabled || e.closest('[disabled]')) continue;
    const fg = parse(s.color); if (!fg) continue;
    const back = backOf(e), got = ratio(over({ ...fg, a: fg.a * +s.opacity }, back), back);
    const big = parseFloat(s.fontSize) >= 18.66 || (parseFloat(s.fontSize) >= 14 && +s.fontWeight >= 700);
    if (got < (big ? 3 : 4.5)) faint.push(`${name(e)} ${got.toFixed(2)}`);
  }
  return { off: [...new Set(off)], clipped: [...new Set(clipped)], faint: [...new Set(faint)] };
};
