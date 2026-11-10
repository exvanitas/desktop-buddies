/* Image headers read from bytes alone: real images give their size, and lying or broken ones are refused
   with a reason, never an uncaught error. */
import assert from 'node:assert';
import { test } from 'vitest';
import { Bad, CAPS, imageHeader, type Code } from '../src/index';
import { REAL } from './real-images';
import * as m from './make';

const refused = (b: Uint8Array, code: Code | Code[], caps = CAPS) => {
  let got: unknown;
  try { imageHeader(b, caps); } catch (e) { got = e; }
  assert.ok(got instanceof Bad, `expected a refusal, got ${got instanceof Error ? got.message : 'a header'}`);
  const codes = ([] as Code[]).concat(code);
  assert.ok(codes.includes(got.code), `expected ${codes.join(' or ')}, got ${got.code}: ${got.message}`);
};

test('real images give their format, size and frames', () => {
  const want: [keyof typeof REAL, string, number, number, number][] = [
    ['png', 'png', 3, 2, 1], ['apng', 'png', 4, 3, 3], ['jpeg', 'jpeg', 3, 2, 1], ['jpegProgressive', 'jpeg', 5, 4, 1],
    ['webpLossy', 'webp', 3, 2, 1], ['webpLossless', 'webp', 3, 2, 1], ['webpAlpha', 'webp', 3, 2, 1], ['webpAnimated', 'webp', 4, 3, 3],
    ['gif', 'gif', 3, 2, 1], ['gifAnimated', 'gif', 4, 3, 3]
  ];
  for (const [name, format, width, height, frames] of want) {
    assert.deepStrictEqual(imageHeader(m.bytes(REAL[name])), { format, width, height, frames }, name);
  }
});

test('crafted images of each kind read', () => {
  assert.deepStrictEqual(imageHeader(m.png(2048, 2048)), { format: 'png', width: 2048, height: 2048, frames: 1 });
  assert.deepStrictEqual(imageHeader(m.riff(m.vp8l(7, 9))), { format: 'webp', width: 7, height: 9, frames: 1 });
  assert.deepStrictEqual(imageHeader(m.riff(m.vp8(7, 9))), { format: 'webp', width: 7, height: 9, frames: 1 });
  assert.deepStrictEqual(imageHeader(m.riff(m.vp8x(8, 8, 2), m.anim(), m.anmf(4, 4), m.anmf(4, 4, 4, 4))), { format: 'webp', width: 8, height: 8, frames: 2 });
  assert.deepStrictEqual(imageHeader(m.jpeg(640, 480)), { format: 'jpeg', width: 640, height: 480, frames: 1 });
  assert.deepStrictEqual(imageHeader(m.gif(5, 5, [{}, { w: 2, h: 2, x: 3, y: 3 }])), { format: 'gif', width: 5, height: 5, frames: 2 });
});

test('bytes that are none of the four are refused: svg, html, zip, nothing', () => {
  for (const s of ['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', '<script>alert(1)</script>', 'PK\x03\x04', '', 'GIF8']) {
    refused(new Uint8Array(m.ascii(s)), ['not-image', 'truncated']);
  }
});

test('huge dimensions in a tiny file are refused before any pixel', () => {
  const tiny: [string, Uint8Array][] = [
    ['png wide', m.png(100000, 1)], ['png tall', m.png(1, 2049)], ['png max', m.png(0x7fffffff, 0x7fffffff)],
    ['webp vp8x', m.riff(m.vp8x(16384, 16384), m.vp8l(16384, 16384))], ['webp vp8l', m.riff(m.vp8l(16384, 1))], ['webp vp8', m.riff(m.vp8(3000, 10))],
    ['jpeg', m.jpeg(65535, 65535)], ['gif', m.gif(65535, 65535)]
  ];
  for (const [name, b] of tiny) { assert.ok(b.length < 200, name); refused(b, 'too-wide'); }
});

test('png: lying headers and broken chunks', () => {
  const ok = m.png(4, 4);
  refused(m.cat(m.PNG_SIG, m.chunk('IDAT', []), m.ihdr(4, 4), m.chunk('IEND', [])), 'malformed'); // IHDR not first
  refused(m.cat(m.PNG_SIG, m.chunk('IHDR', [0, 0, 0, 4, 0, 0, 0, 4, 8, 6, 0, 0]), m.chunk('IEND', [])), 'malformed'); // 12-byte IHDR
  refused(m.png(0, 4), 'malformed');
  refused(m.cat(m.PNG_SIG, m.chunk('IHDR', [0, 0, 0, 4, 0, 0, 0, 4, 7, 6, 0, 0, 0]), m.chunk('IDAT', [1]), m.chunk('IEND', [])), 'malformed'); // depth 7
  refused(m.cat(m.PNG_SIG, m.chunk('IHDR', [0, 0, 0, 4, 0, 0, 0, 4, 8, 6, 0, 0, 0], 1234), m.chunk('IEND', [])), 'malformed'); // bad crc
  refused(m.cat(m.PNG_SIG, m.ihdr(4, 4), m.chunk('IEND', [])), 'malformed'); // no IDAT
  refused(m.cat(m.PNG_SIG, m.ihdr(4, 4), m.chunk('IDAT', [1]), m.chunk('ZZZZ', []), m.chunk('IEND', [])), 'malformed'); // unknown critical chunk
  refused(m.cat(m.PNG_SIG, m.ihdr(4, 4), m.chunk('IDAT', [1])), 'truncated'); // no IEND
  refused(ok.slice(0, ok.length - 20), 'truncated'); // cut in IDAT
  refused(m.cat(ok.slice(0, 33), [0x7f, 0xff, 0xff, 0xff], m.ascii('IDAT')), 'truncated'); // length past the end
  refused(m.png(4, 4, { after: [0, 1, 2] }), 'trailing');
  refused(m.png(4, 4, { extra: [m.actl(100000)] }), 'too-many-frames');
  refused(m.png(2048, 2048, { extra: [m.actl(5)] }), 'image-pixels');
});

test('webp: lying headers and broken chunks', () => {
  const ok = m.riff(m.vp8l(4, 4));
  const lie = (b: Uint8Array, at: number, v: number) => { const c = b.slice(); c[at] = v; return c; };
  refused(lie(ok, 4, ok[4]! + 8), 'truncated'); // RIFF size says more than there is
  refused(m.cat(ok, [0, 0]), 'trailing');
  refused(m.riff(m.wchunk('VP8L', [0x2e, 0, 0, 0, 0])), 'malformed'); // bad signature
  refused(m.riff(m.wchunk('VP8L', [0x2f, 0, 0, 0, 0xe0])), 'malformed'); // version 7
  refused(m.riff(m.wchunk('VP8 ', [0x50, 1, 0, 0x9d, 1, 0x2b, 4, 0, 4, 0])), 'malformed'); // start code
  refused(m.riff(m.wchunk('VP8 ', [0x51, 1, 0, 0x9d, 1, 0x2a, 4, 0, 4, 0])), 'malformed'); // not a key frame
  refused(m.riff(m.wchunk('ICCP', [1, 2])), 'malformed'); // no image chunk first
  refused(m.riff(m.vp8x(3, 2)), 'malformed'); // extended, no image
  refused(m.riff(m.vp8x(3, 2), m.vp8l(100, 100)), 'malformed'); // canvas says 3x2, image 100x100
  refused(m.riff(m.vp8x(8, 8, 2), m.anim(), m.anmf(4, 4, 6, 0)), 'malformed'); // frame past the canvas
  refused(m.riff(m.vp8x(8, 8, 2), m.anim(), m.anmf(4, 4, 0, 0, m.vp8l(5, 5))), 'malformed'); // frame says 4x4, holds 5x5
  refused(m.riff(m.vp8x(8, 8), m.anmf(4, 4)), 'malformed'); // frames without the animation flag
  refused(m.riff(m.vp8l(4, 4), m.vp8l(4, 4)), 'malformed'); // simple file with more after
  const cut = m.riff(m.vp8x(8, 8, 2), m.anim(), m.anmf(4, 4));
  refused(cut.slice(0, cut.length - 6), 'truncated');
  const short = m.cat(m.ascii('RIFF'), [100, 0, 0, 0], m.ascii('WEBPVP8L'), [200, 0, 0, 0], [0x2f]); // chunk size past the end
  refused(m.cat(short.slice(0, 4), [short.length - 8, 0, 0, 0], short.slice(8)), 'truncated');
});

test('webp and gif frame-count bombs', () => {
  const frames = Array.from({ length: 5000 }, () => m.anmf(2, 2));
  refused(m.riff(m.vp8x(2, 2, 2), m.anim(), ...frames), 'too-many-frames');
  refused(m.gif(1, 1, Array.from({ length: 10000 }, () => ({}))), 'too-many-frames');
  refused(m.gif(2048, 2048, Array.from({ length: 100 }, () => ({ w: 1, h: 1 }))), 'image-pixels');
  refused(m.riff(m.vp8x(2048, 2048, 2), m.anim(), ...Array.from({ length: 100 }, () => m.anmf(2, 2))), 'image-pixels');
});

test('jpeg: lying headers and marker loops', () => {
  refused(m.cat([0xff, 0xd8], m.sos(), [1, 2], [0xff, 0xd9]), 'malformed'); // scan before frame
  refused(m.cat([0xff, 0xd8], m.sof(4, 4), m.sof(4, 4), m.sos(), [1], [0xff, 0xd9]), 'malformed'); // two frames
  refused(m.cat([0xff, 0xd8], m.sof(4, 0), m.sos(), [1], [0xff, 0xd9]), 'malformed'); // height from DNL
  refused(m.cat([0xff, 0xd8], m.seg(0xc0, [8, 0, 4, 0, 4, 3, 1, 0x11, 0]), m.sos(), [1], [0xff, 0xd9]), 'malformed'); // 3 parts, 1 described
  refused(m.cat([0xff, 0xd8, 0xff, 0xfe, 0, 0], m.sof(4, 4)), 'malformed'); // length 0 makes no progress
  refused(m.cat([0xff, 0xd8, 0xff, 0xfe, 0, 1], m.sof(4, 4)), 'malformed'); // length 1
  refused(m.cat([0xff, 0xd8, 0xff, 0xd8], m.sof(4, 4)), 'malformed'); // second start
  refused(m.cat([0xff, 0xd8], new Array(100000).fill(0xff)), 'truncated'); // fill bytes forever
  refused(m.cat([0xff, 0xd8], m.seg(0xe0, [0, 0]), [0x00, 0x00]), 'malformed'); // not a marker
  refused(m.cat([0xff, 0xd8], m.sof(4, 4), m.sos(), [1, 2, 3]), 'truncated'); // scan never ends
  refused(m.cat([0xff, 0xd8], m.sof(4, 4), [0xff, 0xfe, 0x00, 0x40, 1]), 'truncated'); // segment past the end
  refused(m.jpeg(4, 4, { before: Array.from({ length: 70000 }, () => [0xff, 0xfe, 0, 2]).flat() }), 'too-many-segments');
  refused(m.jpeg(4, 4, { after: [0x12] }), 'trailing');
  refused(m.cat([0xff, 0xd8], m.sof(4, 4), [0xff, 0xd9]), 'malformed'); // ends with no scan
});

test('gif: lying headers and broken blocks', () => {
  refused(m.gif(0, 4), 'malformed');
  refused(m.gif(4, 4, [{ x: 2, w: 4 }]), 'malformed'); // frame past the screen
  refused(m.gif(4, 4, []), 'malformed'); // no frames
  const ok = m.gif(4, 4);
  refused(ok.slice(0, ok.length - 1), 'truncated'); // no trailer
  refused(ok.slice(0, 20), 'truncated');
  refused(m.cat(ok.slice(0, ok.length - 1), [0x99, 0x3b]), 'malformed'); // unknown block
  refused(m.gif(4, 4, [{}], [0, 0]), 'trailing');
  refused(m.cat(ok.slice(0, 19), Array.from({ length: 70000 }, () => [0x21, 0xfe, 0]).flat(), ok.slice(19)), 'too-many-segments');
});

/* Review 1: the gate bounds every size a decoder allocates from, frame counts agree with what's there,
   and cheap impossibilities are refused. */
test('apng: every frame control is whole, inside the canvas, and counted as declared', () => {
  const ok = m.png(4, 4, { extra: [m.actl(2), m.fctl(0, 4, 4)], post: [m.fctl(1, 2, 2, 2, 2), m.fdat(2)] });
  assert.deepStrictEqual(imageHeader(ok), { format: 'png', width: 4, height: 4, frames: 2 });
  refused(m.png(1, 1, { extra: [m.actl(1), m.chunk('fcTL', [])] }), 'malformed'); // empty frame control
  refused(m.png(1, 1, { extra: [m.actl(1), m.fctl(0, 0xffffffff, 0xffffffff)] }), ['malformed', 'too-wide']); // huge frame, 1x1 canvas
  refused(m.png(4, 4, { extra: [m.actl(1), m.fctl(0, 2, 2, 3, 0)] }), 'malformed'); // frame past the canvas
  refused(m.png(4, 4, { extra: [m.actl(2), m.fctl(0, 4, 4)] }), 'malformed'); // says 2 frames, has 1
  refused(m.png(4, 4, { extra: [m.actl(1), m.fctl(0, 4, 4)], post: [m.fctl(1, 4, 4), m.fdat(2)] }), 'malformed'); // says 1, has 2
  refused(m.png(4, 4, { extra: [m.fctl(0, 4, 4)] }), 'malformed'); // a frame without acTL
  refused(m.png(4, 4, { extra: [m.actl(1), m.fctl(0, 4, 4, 0, 0, 3)] }), 'malformed'); // dispose 3
});

test('png: indexed colour needs its palette, and image data is one run', () => {
  refused(m.cat(m.PNG_SIG, m.ihdr(4, 4, 8, 3), m.chunk('IDAT', [1]), m.chunk('IEND', [])), 'malformed');
  assert.ok(imageHeader(m.cat(m.PNG_SIG, m.ihdr(4, 4, 8, 3), m.chunk('PLTE', [0, 0, 0]), m.chunk('IDAT', [1]), m.chunk('IEND', []))));
  refused(m.cat(m.PNG_SIG, m.ihdr(4, 4), m.chunk('IDAT', [1]), m.chunk('tEXt', m.ascii('a\0b')), m.chunk('IDAT', [2]), m.chunk('IEND', [])), 'malformed');
});

test('webp: one canvas header, and ANIM is whole', () => {
  refused(m.riff(m.vp8x(1, 1, 2), m.wchunk('ANIM', []), m.anmf(1, 1)), 'malformed');
  refused(m.riff(m.vp8x(1, 1), m.vp8x(16777216, 16777216), m.vp8l(1, 1)), 'malformed');
});

test('jpeg: a scan header is as long as its parts need', () => {
  refused(m.cat([255, 216], m.sof(1, 1), m.seg(0xda, []), [255, 217]), 'malformed');
  refused(m.cat([255, 216], m.sof(1, 1), m.seg(0xda, [2, 1, 0, 0, 63, 0]), [1, 255, 217]), 'malformed'); // 2 parts, 1 described
});

test('gif: LZW code size 2 to 8, and a graphic control of 4 bytes', () => {
  for (const v of [1, 9, 10, 11]) { const b = m.gif(1, 1); b[37] = v; refused(b, 'malformed'); }
  const ok = m.gif(1, 1);
  refused(m.cat(ok.slice(0, 19), [0x21, 0xf9, 0x00], ok.slice(27)), 'malformed');
});

test('the segment cap counts gif sub-blocks and jpeg restarts too', () => {
  const ok = m.gif(1, 1);
  refused(m.cat(ok.slice(0, 19), [0x21, 0xfe], Array.from({ length: 70000 }, () => [1, 0x41]).flat(), [0], ok.slice(19)), 'too-many-segments');
  refused(m.jpeg(4, 4, { scan: Array.from({ length: 70000 }, (_, i) => [0x12, 0xff, 0xd0 + i % 8]).flat() }), 'too-many-segments');
});

test('the one-image pixel cap holds for stills of every kind', () => {
  const caps = { ...CAPS, imagePixels: 1 };
  for (const name of ['png', 'jpeg', 'webpLossy', 'webpLossless', 'webpAlpha', 'gif'] as const) refused(m.bytes(REAL[name]), 'image-pixels', caps);
});
