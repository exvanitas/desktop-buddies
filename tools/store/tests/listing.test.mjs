/* docs/store/listing.md against Partner Center's limits, so an edit that runs over fails here and not
   in Partner Center. The limits are Microsoft's, from the pages listed at the bottom of the listing. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DOC = path.join(REPO, 'docs/store/listing.md');
const text = fs.readFileSync(DOC, 'utf8');

/* The first ```text box under a ### heading, or under a later box of the same section when `nth` says. */
function box(heading, nth = 0) {
  const at = text.indexOf(`\n### ${heading}\n`);
  if (at < 0) throw new Error(`no section ${heading}`);
  const next = text.indexOf('\n#', at + 5), section = text.slice(at, next < 0 ? undefined : next);
  const boxes = [...section.matchAll(/```text\n([\s\S]*?)\n```/g)].map(m => m[1]);
  if (!boxes[nth]) throw new Error(`no box ${nth} in ${heading}`);
  return boxes[nth];
}
const lines = s => s.split('\n');
const chars = s => [...s].length;

describe('the Store listing', () => {
  it('fits each text field', () => {
    expect(box('Product name')).toBe('Desktop Buddies');
    expect(chars(box('Description'))).toBeLessThanOrEqual(10000);
    expect(chars(box('Short description'))).toBeLessThanOrEqual(270);
    expect(chars(box('Copyright and trademark info'))).toBeLessThanOrEqual(200);
    expect(chars(box('Additional license terms'))).toBeLessThanOrEqual(10000);
    expect(chars(box('Developed by'))).toBeLessThanOrEqual(255);
  });

  it('keeps links out of the description, as Microsoft asks', () => {
    expect(box('Description')).not.toMatch(/https?:|www\./);
  });

  it('has at most 20 features of 200 characters, with no bullets', () => {
    const f = lines(box('Product features'));
    expect(f.length).toBeLessThanOrEqual(20);
    for (const l of f) { expect(chars(l)).toBeLessThanOrEqual(200); expect(l).not.toMatch(/^\s*[-*•]/); }
  });

  it('has at most 7 keywords, each under 30 characters, 21 words in all', () => {
    const k = lines(box('Keywords'));
    expect(k.length).toBeLessThanOrEqual(7);
    for (const l of k) expect(chars(l)).toBeLessThanOrEqual(30);
    expect(k.join(' ').split(/\s+/).length).toBeLessThanOrEqual(21);
  });

  it('captions every screenshot it lists, in 200 characters, and each is a 1920x1080 PNG', () => {
    const rows = [...text.matchAll(/^\| `(screenshots\/[^`]+\.png)` \| (.+) \|$/gm)];
    const captions = lines(box('Screenshots'));
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.length).toBeLessThanOrEqual(10);
    expect(captions).toEqual(rows.map(r => r[2]));
    for (const [, file, caption] of rows) {
      expect(chars(caption)).toBeLessThanOrEqual(200);
      const png = fs.readFileSync(path.join(path.dirname(DOC), file));
      expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1920, 1080]);
    }
  });

  it('gives a support contact that is a URL, never an email', () => {
    expect(box('Support contact info')).toMatch(/^https:\/\/github\.com\/[^\s@]+$/);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});
