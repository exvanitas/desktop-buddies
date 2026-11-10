/* DESIGN.md's worked-out contrast, from the tokens the pages really ship, and the same sums for what's new
   in the Maker. The browser check measures rendered text as well. Text needs 4.5, shapes need 3. */
import assert from 'node:assert';
import fs from 'node:fs';
import { test } from 'vitest';

const css = fs.readFileSync(new URL('../../peel/peel.css', import.meta.url), 'utf8');
const view = fs.readFileSync(new URL('../src/maker-view.css', import.meta.url), 'utf8');
const block = (re: RegExp) => Object.fromEntries([...re.exec(css)![1]!.matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,8})/g)].map(m => [m[1]!, m[2]!]));
const dark = block(/:root \{([\s\S]*?)\n\}/), light = { ...dark, ...block(/:root\[data-theme="light"\] \{([\s\S]*?)\n\}/) };
const backing = { dark: /\.mk\[data-back="dark"\] \{ --bk: (#\w+); --bk-ink: (#\w+); --bk-dim: (#\w+);/.exec(view)!.slice(1) as [string, string, string] };

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16), part = (v: number) => { const c = v / 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
  return .2126 * part(n >> 16 & 255) + .7152 * part(n >> 8 & 255) + .0722 * part(n & 255);
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number]; return (x + .05) / (y + .05); };
const near = (got: number, want: number, what: string) => assert.ok(Math.abs(got - want) <= .06, `${what}: ${got.toFixed(2)} isn't ${want}`);

test('the ratios in DESIGN.md still hold', () => {
  const table: [string, string, string, number, number][] = [
    ['text on sheet', 'cream', 'sheet', 12.3, 10.3], ['dim on sheet', 'dim', 'sheet', 6.6, 5.7], ['dim on window back', 'dim', 'back', 7.9, 4.8],
    ['faint on window back', 'faint', 'back', 4.8, 4.8], ['status when out', 'out-ink', 'sheet', 8.4, 5.4], ['warn on sheet', 'warn', 'sheet', 7.6, 5.1],
    ['dots on sheet', 'dot', 'sheet', 9.5, 4.6], ['dots on pad', 'dot', 'pad', 3.9, 6.1]
  ];
  for (const [what, fg, bg, d, l] of table) {
    near(ratio(dark[fg]!, dark[bg]!), d, `${what}, dark`);
    near(ratio(light[fg]!, light[bg]!), l, `${what}, light`);
  }
});

test('the Maker\'s own surfaces reach 4.5 in both themes', () => {
  for (const [name, t] of [['dark', dark], ['light', light]] as const) {
    const pairs: [string, string, string][] = [
      ['title on window back', t.cream!, t.back!], ['dim on window back', t.dim!, t.back!],
      ['word in the tray', t.cream!, t['sheet-2']!], ['dim in the tray', t.dim!, t['sheet-2']!],
      ['chip in the tray', t.cream!, t.chip!], ['chip on hover', t.cream!, t['edge-2']!],
      ['on a Go button', t.ink!, t.sun!], ['on a Go button, hover', t.ink!, t['sun-up']!],
      ['paper ink', t['paper-ink']!, t.paper!], ['paper dim', t['paper-dim']!, t.paper!],
      ['failed save, on its sheet', t.warn!, t.sheet!], ['its why and fix', t.dim!, t.sheet!],
      ['first step, on the pad', t.cream!, t.pad!], ['tip on the first sheet', t.dim!, t.sheet!],
      ['a toast', t.back!, t.cream!], ['a menu', t.cream!, t['sheet-2']!], ['a bad button in a confirm', t.warn!, t['sheet-2']!]
    ];
    for (const [what, fg, bg] of pairs) assert.ok(ratio(fg, bg) >= 4.5, `${what}, ${name}: ${ratio(fg, bg).toFixed(2)}`);
  }
});

test('the dark backing reads, whatever the theme', () => {
  const [bk, ink, dim] = backing.dark;
  assert.ok(ratio(ink, bk) >= 4.5);
  assert.ok(ratio(dim, bk) >= 4.5);
});

test('a bubble and a white field read on any backing', () => {
  assert.ok(ratio('#2a2040', '#ffffff') >= 4.5);
  assert.ok(ratio('#6a5f80', '#ffffff') >= 4.5);
});
