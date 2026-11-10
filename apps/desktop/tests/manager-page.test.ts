/* The Manager's page as files: what it ships, and what its CSP forbids. */
import assert from 'node:assert';
import fs from 'node:fs';
import { test } from 'vitest';

test('no browser confirm is used', () => {
  for (const f of fs.readdirSync(new URL('../src/manager/', import.meta.url))) assert.doesNotMatch(fs.readFileSync(new URL(`../src/manager/${f}`, import.meta.url), 'utf8'), /\b(window\.)?confirm\(/, f);
});

test('the page\'s CSP stays tight', () => {
  const html = fs.readFileSync(new URL('../public/manager.html', import.meta.url), 'utf8');
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)![1]!;
  assert.doesNotMatch(csp, /unsafe|\*/);
  assert.match(csp, /default-src 'none'/);
  assert.match(html, /<script src="manager\.js"><\/script>/, 'smoke.ps1 adds its probe after this tag');
});

test('nothing in the view can trip that CSP with a style attribute', () => {
  for (const f of [...fs.readdirSync(new URL('../src/manager/', import.meta.url)).map(n => `manager/${n}`), 'manager-view.ts']) {
    assert.doesNotMatch(fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'), /style:|setAttribute\('style'|innerHTML/, f);
  }
});

test('the fonts and their licenses ship with the app', () => {
  const PEEL = '../../../packages/peel/';
  for (const f of ['lexend.woff2', 'lexend-OFL.txt', 'dynapuff.woff2', 'dynapuff-OFL.txt']) assert.ok(fs.existsSync(new URL(`${PEEL}fonts/${f}`, import.meta.url)), f);
  const css = fs.readFileSync(new URL(`${PEEL}peel.css`, import.meta.url), 'utf8');
  assert.match(css, /url\(fonts\/lexend\.woff2\)/);
  assert.match(css, /url\(fonts\/dynapuff\.woff2\)/);
  assert.doesNotMatch(css + fs.readFileSync(new URL('../public/manager.css', import.meta.url), 'utf8'), /https?:/);
});
