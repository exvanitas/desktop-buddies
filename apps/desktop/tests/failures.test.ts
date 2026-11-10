/* Plain words for what `read` and `unpack` say. Real bad files go through the real checks, so a
   reason that changes there fails here. */
import assert from 'node:assert';
import fs from 'node:fs';
import { LIMIT, read, unpack, write, type Buddy } from '@buddies/buddy-file';
import { test } from 'vitest';
import { badFile, noShime1, reason, stem } from '../src/failures';

const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const good: Buddy = { character: 'c1', name: 'Pip', base: { src: PNG, bb: box }, poses: {} };
const file = (buddy: unknown, more: object = {}) => JSON.stringify({ app: 'desktop-buddies', version: 2, buddy, ...more });
const said = (text: string) => { try { unpack(read(text)); } catch (e) { return reason(e); } throw new Error('that file was fine: ' + text.slice(0, 80)); };
const words = (text: string) => badFile('mochi.buddy', said(text));

const DEV = /undefined|null\b|JSON|object|\bfield\b|manifest|\bschema\b|\bid\b.*\bis not\b|\[object/i;

const CASES: [string, string, RegExp, RegExp][] = [
  ['not JSON', 'not json at all', /damaged, or it isn't a buddy file/, /Pick a \.buddy file/],
  ['cut off', file(good).slice(0, 40), /damaged/, /Pick a \.buddy file/],
  ['an array', '[]', /isn't a buddy file/, /Pick a \.buddy file/],
  ['some other app', JSON.stringify({ app: 'nope', version: 2, buddy: good }), /isn't a buddy file/, /Pick a \.buddy file/],
  ['some other JSON', '{"hello":1}', /isn't a buddy file/, /Pick a \.buddy file/],
  ['a newer version', JSON.stringify({ app: 'desktop-buddies', version: 3, buddy: good }), /newer version/, /Update Desktop Buddies/],
  ['too big', 'x'.repeat(LIMIT.file + 1), /over the 64 MB limit/, /Remove some frames/],
  ['no character', file({ ...good, character: undefined }), /missing the id/, /save it again/],
  ['a bad character', file({ ...good, character: 'no spaces' }), /missing the id/, /save it again/],
  ['a pose from the future', file({ ...good, poses: { moonwalk: { frames: [] } } }), /parts this version/, /Update/],
  ['a field from the future', file({ ...good, sparkle: 1 }), /parts this version/, /Update/],
  ['a script for an image', file({ ...good, base: { src: 'x" onerror="1', bb: box } }), /Its main image isn't a PNG, WebP, JPEG or GIF/, /Replace that image/],
  ['a frame that isn\'t an image', file({ ...good, poses: { walk: { frames: [{ src: 'nope', bb: box }] } } }), /Its walk frame 1 isn't/, /Replace that image/],
  ['bytes that aren\'t an image', file({ ...good, poses: { walk: { frames: [{ src: 'data:image/png;base64,AAAA', bb: box }] } } }), /Its walk frame 1 isn't/, /Replace that image/],
  ['too many frames', file({ ...good, poses: { walk: { frames: Array.from({ length: LIMIT.frames + 1 }, () => ({ src: PNG, bb: box })) } } }), /Its walk has more than 120 frames/, /save it again/],
  ['too many lines', file({ ...good, lines: { chat: Array.from({ length: LIMIT.lines + 1 }, () => 'hi') } }), /Its chat lines go past the limit/, /save it again/],
  ['a number out of range', file({ ...good, size: 9999 }), /may be damaged/, /Pick a \.buddy file/],
  ['a box inside out', file({ ...good, base: { src: PNG, bb: { x0: 1, y0: 0, x1: 0, y1: 1 } } }), /may be damaged/, /Pick a \.buddy file/]
];
for (const [name, text, why, fix] of CASES) {
  test(`${name}: says what happened and what to do`, () => {
    const p = words(text);
    assert.match(p.why, why);
    assert.match(p.fix, fix);
    assert.strictEqual(p.title, "mochi didn't come in");
    assert.strictEqual(p.file, 'mochi.buddy');
    assert.strictEqual(p.kind, 'import');
    assert.doesNotMatch(`${p.title} ${p.why} ${p.fix}`, DEV);
  });
}

test('a file that passes really does pass: the cases above aren\'t failing for some other reason', () => {
  assert.strictEqual(read(write(good)).name, 'Pip');
  assert.ok(unpack(read(file(good))).images.length);
});

/* Every reason `read` can give, straight from its source. A new one has to be added here, which
   means someone decides what it says. */
test('every reason buddy-file can give is either worded or known to be a general one', () => {
  const src = fs.readFileSync(new URL('../../../packages/buddy-file/src/buddy-file.ts', import.meta.url), 'utf8');
  const literals = [...src.matchAll(/\bbad\((['`])(.+?)\1/g)].map(m => m[2]!);
  const worded = /^(too big|not a buddy file|unknown version|no character|character is not an id|unknown pose: |unknown field in .*)$/;
  const general = /^(missing image |kit |poses must be an object|faces is not left or right)/;
  assert.deepStrictEqual(literals.filter(l => !worded.test(l) && !general.test(l)), []);
  assert.ok(literals.length >= 8, literals.join('; '));
});

test('what the exe says about a file it couldn\'t read', () => {
  assert.match(badFile('x.buddy', 'not text').why, /damaged/);
  assert.match(badFile('x.buddy', 'not a file').why, /folder, not a file/);
  assert.match(badFile('x.buddy', 'too big').why, /64 MB/);
  assert.match(badFile('x.buddy', 'The system cannot find the file specified.').why, /may be damaged/);
});

test('the prototypes\' example, word for word', () => {
  const p = noShime1('Mochi');
  assert.strictEqual(p.title, "Mochi didn't come in");
  assert.strictEqual(p.why, 'No shime1.png in that folder.');
  assert.match(p.fix, /^Pick the folder with the numbered images in it\./);
  assert.strictEqual(p.file, 'Mochi (folder)');
  assert.strictEqual(p.again, 'Pick another folder');
});

test('a file is called what a person would call it', () => {
  assert.strictEqual(stem('mochi.buddy'), 'mochi');
  assert.strictEqual(stem('mochi.buddy.json'), 'mochi');
  assert.strictEqual(stem('Mochi.BUDDY.JSON'), 'Mochi');
  assert.strictEqual(stem('notes.txt'), 'notes');
  assert.strictEqual(stem('.buddy'), '.buddy');
});
