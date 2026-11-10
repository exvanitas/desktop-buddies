/* Whole files, as hostile as they come: every problem is named, and nothing is thrown. */
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { CAPS, validate, type Code, type Report } from '../src/index';
import { sha256 } from '../src/sha256';
import { REAL } from './real-images';
import * as m from './make';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const codes = (r: Report) => r.problems.map(p => p.code);
const fails = (r: Report, code: Code) => {
  assert.strictEqual(r.ok, false, 'expected problems');
  assert.ok(codes(r).includes(code), `expected ${code}, got ${JSON.stringify(r.problems)}`);
  assert.ok(!codes(r).includes('internal'), JSON.stringify(r.problems));
};
const enc = (s: string) => new TextEncoder().encode(s);
const PNG = m.url('png', REAL.png);

test('a file with every kind of real image is clean, and counts its images once each', () => {
  const r = validate(m.file([...m.REAL_URLS, PNG, PNG]));
  assert.deepStrictEqual(r.problems, []);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.images, m.REAL_URLS.length);
  /* stills: three 3x2 webps, a 3x2 png, jpeg and gif, a 5x4 jpeg; three animated 4x3 images of 3 frames */
  assert.strictEqual(r.pixels, 6 * 6 + 20 + 3 * 36);
});

test('the transition slots are clean', () => {
  const poses = Object.fromEntries(['roll', 'stand_up_from_sleep', 'stand_up_from_sprawl', 'stand_up_from_dizzy', 'stand_up_from_knocked_out', 'sit_down', 'fall_asleep']
    .map(k => [k, { frames: [{ src: PNG, bb: { x0: 0, y0: 0, x1: 1, y1: 1 } }], fps: 6 }]));
  const r = validate(enc(m.text({ character: 'c123', name: 'Pip', base: { src: PNG, bb: { x0: 0, y0: 0, x1: 1, y1: 1 } }, poses })));
  assert.deepStrictEqual(r.problems, []);
});

/* A build may ship no seed. */
test('the seed a build ships, if any, and the sample tests use, are clean', () => {
  for (const f of ['../../../apps/desktop/public/seed.json', '../../test-support/fixtures/sample.json'].map(f => path.resolve(HERE, f)).filter(f => fs.existsSync(f))) assert.deepStrictEqual(validate(fs.readFileSync(f)).problems, [], f);
  assert.ok(fs.existsSync(path.resolve(HERE, '../../test-support/fixtures/sample.json')));
});

test('oversize: refused on its byte count before anything is parsed', () => {
  const caps = { ...CAPS, file: 1000 };
  const r = validate(new Uint8Array(1001).fill(0x5b), caps);
  assert.deepStrictEqual(codes(r), ['too-big']);
  assert.deepStrictEqual(codes(validate(enc(m.text(m.buddy([PNG]), { pad: ' '.repeat(2000) })), caps)), ['too-big']);
});

test('deep JSON is refused before JSON.parse, and brackets in strings do not count', () => {
  assert.deepStrictEqual(codes(validate(enc('['.repeat(100000)))), ['too-deep']);
  let deep: object = {};
  for (let i = 0; i < 20; i++) deep = { a: deep };
  fails(validate(enc(m.text(m.buddy([PNG], { kit: deep })))), 'too-deep');
  const r = validate(enc(m.text(m.buddy([PNG], { name: '[[[[[[[[[[[[[[[[[[[[{{{{{{{{{{{{{{\\"[[[[[[[[[[' }))));
  assert.deepStrictEqual(r.problems, []);
});

test('not UTF-8: a stray byte, an overlong slash, an encoded surrogate', () => {
  const t = enc(m.text(m.buddy([PNG], { name: 'XX' })));
  const at = Buffer.from(t).indexOf('XX');
  for (const pair of [[0xff, 0x41], [0xc0, 0xaf], [0xed, 0xa0]]) {
    const b = t.slice(); b[at] = pair[0]!; b[at + 1] = pair[1]!;
    assert.deepStrictEqual(codes(validate(b)), ['not-utf8']);
  }
});

test('not JSON, or not a buddy', () => {
  assert.deepStrictEqual(codes(validate(enc('{"app":'))), ['not-json']);
  fails(validate(enc(JSON.stringify({ app: 'other', version: 2, buddy: {} }))), 'reader');
});

test('unknown fields are refused by the app\'s own reader', () => {
  const r = validate(enc(m.text(m.buddy([PNG], { script: 'alert(1)' }))));
  fails(r, 'reader');
  assert.match(r.problems[0]!.message, /unknown field in buddy: script/);
  fails(validate(enc(m.text(m.buddy([PNG]), { extra: 1 }))), 'reader');
});

test('an svg in a data URL is refused, by its type or by its bytes', () => {
  const svg = m.b64(new Uint8Array(m.ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')));
  fails(validate(m.file([`data:image/svg+xml;base64,${svg}`])), 'reader');
  fails(validate(m.file([PNG, m.url('png', svg)])), 'not-image');
  fails(validate(m.file(['https://example.com/a.png'])), 'reader');
});

test('the declared type must be what the bytes are', () => {
  const r = validate(m.file([PNG, m.url('png', REAL.gif)]));
  fails(r, 'type-mismatch');
  assert.strictEqual(r.problems[0]!.where, 'walk frame 1');
  fails(validate(m.file([m.url('webp', REAL.jpeg)])), 'type-mismatch');
});

test('each image problem is named for where it is, and all are listed', () => {
  const r = validate(m.file([PNG, m.url('png', m.png(5000, 5000)), m.url('gif', m.gif(1, 1, Array.from({ length: 500 }, () => ({})))), m.url('jpeg', m.jpeg(4, 4).slice(0, 20))]));
  assert.deepStrictEqual(r.problems.map(p => [p.where, p.code]), [['walk frame 1', 'too-wide'], ['walk frame 2', 'too-many-frames'], ['walk frame 3', 'truncated']]);
});

test('base64 that the reader lets through but is not whole is refused', () => {
  fails(validate(m.file([`data:image/png;base64,${REAL.png.replace(/=+$/, '')}A`])), 'base64');
});

test('a pixel budget across every image in the file', () => {
  const caps = { ...CAPS, totalPixels: 2048 * 2048 * 3 };
  const big = (i: number) => m.url('png', m.png(2048, 2048, { extra: [m.chunk('tEXt', m.ascii(`n${i}`))] }));
  assert.deepStrictEqual(validate(m.file([big(1), big(2), big(3)]), caps).problems, []);
  assert.deepStrictEqual(codes(validate(m.file([big(1), big(2), big(3), big(4)]), caps)), ['total-pixels']);
  assert.deepStrictEqual(validate(m.file([big(1), big(1), big(1), big(1)]), caps).problems, []); // the same image is one image
});

test('a zip is not a .buddy', () => {
  assert.deepStrictEqual(codes(validate(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0]))), ['zip']);
});

/* Review 1: V8 hashes a string over 16,383 characters by its length alone, so a Set of equal-length data
   URLs compares their contents on every lookup. Linear time means 4x the images take about 4x as long. */
test('the dedupe key is SHA-256, as node computes it, across block edges', () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 128, 1000, 70001]) {
    const s = Array.from({ length: n }, (_, i) => String.fromCharCode(32 + (i * 7) % 95)).join('');
    assert.strictEqual(sha256(s), createHash('sha256').update(s, 'latin1').digest('hex'), `length ${n}`);
  }
});

test('many distinct images of one length are counted in linear time', () => {
  const images = (n: number) => Array.from({ length: n }, (_, i) =>
    m.url('png', m.png(1, 1, { extra: [m.chunk('tEXt', m.ascii(`k\0${'x'.repeat(12500)}${String(i).padStart(6, '0')}`))] })));
  const time = (files: Uint8Array) => Math.min(...[0, 1].map(() => { const t = performance.now(); validate(files); return performance.now() - t; }));
  const small = m.fileAcross(images(400)), big = m.fileAcross(images(1600));
  const r = validate(big);
  assert.deepStrictEqual(r.problems, []);
  assert.strictEqual(r.images, 1600);
  const ratio = time(big) / time(small);
  assert.ok(ratio < 9, `4x the images took ${ratio.toFixed(1)}x as long`);
  /* About 3 s alone; a full run on a busy machine needs room. The ratio is what's judged, not the time. */
}, 60000);
