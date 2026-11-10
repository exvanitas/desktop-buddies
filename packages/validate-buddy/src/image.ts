/* An image's format, size and frame count, read from its bytes alone: no pixel is decoded. Each walk
   moves forward through bounded lengths, so it ends; sizes are checked against the caps as soon as
   they're known; anything truncated, malformed or followed by more bytes is refused. */
import { CAPS, type Caps } from './caps';

export type Format = 'png' | 'webp' | 'jpeg' | 'gif';
export interface Header { format: Format; width: number; height: number; frames: number }
export type Code = 'too-big' | 'zip' | 'folder' | 'symlink' | 'not-file' | 'unreadable' | 'not-utf8' | 'too-deep' | 'not-json' | 'reader'
  | 'base64' | 'not-image' | 'type-mismatch' | 'truncated' | 'malformed' | 'trailing' | 'too-wide' | 'too-many-frames' | 'too-many-segments'
  | 'image-pixels' | 'total-pixels' | 'internal';
export class Bad extends Error {
  code: Code;
  constructor(code: Code, message: string) { super(message); this.code = code; }
}
const bad = (code: Code, message: string): never => { throw new Bad(code, message); };

/* Bounds-checked reads: past the end is always `truncated`. */
class Bytes {
  b: Uint8Array;
  constructor(b: Uint8Array) { this.b = b; }
  get length() { return this.b.length; }
  need(at: number, n: number, what: string) { if (at < 0 || n < 0 || at + n > this.b.length) bad('truncated', `ends inside ${what}`); }
  u8(at: number, what = 'a header') { this.need(at, 1, what); return this.b[at]!; }
  u16le(at: number, what?: string) { return this.u8(at, what) | this.u8(at + 1, what) << 8; }
  u16be(at: number, what?: string) { return this.u8(at, what) << 8 | this.u8(at + 1, what); }
  u24le(at: number, what?: string) { return this.u16le(at, what) + this.u8(at + 2, what) * 0x10000; }
  u32le(at: number, what?: string) { return this.u24le(at, what) + this.u8(at + 3, what) * 0x1000000; }
  u32be(at: number, what?: string) { return this.u8(at, what) * 0x1000000 + (this.u8(at + 1, what) << 16 | this.u16be(at + 2, what)); }
  ascii(at: number, n: number) { this.need(at, n, 'a header'); return String.fromCharCode(...this.b.subarray(at, at + n)); }
  is(at: number, sig: string) { return at + sig.length <= this.b.length && this.ascii(at, sig.length) === sig; }
}

const STARTS = ['\x89PNG\r\n\x1a\n', '\xff\xd8\xff', 'GIF87a', 'GIF89a', 'RIFF'];
export function sniff(b: Uint8Array): Format | null {
  const r = new Bytes(b);
  if (r.is(0, '\x89PNG\r\n\x1a\n')) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (r.is(0, 'GIF87a') || r.is(0, 'GIF89a')) return 'gif';
  if (r.is(0, 'RIFF') && r.is(8, 'WEBP')) return 'webp';
  return null;
}

/* Called the moment a size is known, before anything else is read. */
function sized(w: number, h: number, caps: Caps) {
  if (!(w >= 1 && h >= 1)) bad('malformed', `says it is ${w} x ${h} px`);
  if (w > caps.side || h > caps.side) bad('too-wide', `is ${w} x ${h} px, more than ${caps.side} a side`);
}
function counted(frames: number, w: number, h: number, caps: Caps) {
  if (frames > caps.animFrames) bad('too-many-frames', `has ${frames} frames, more than ${caps.animFrames}`);
  if (w * h * frames > caps.imagePixels) bad('image-pixels', `is ${w} x ${h} px over ${frames} frames, more than ${caps.imagePixels} px`);
}
function segment(n: number, caps: Caps) { if (n > caps.segments) bad('too-many-segments', `has more than ${caps.segments} chunks or markers`); }

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Uint8Array, from: number, to: number) {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC[(c ^ b[i]!) & 255]! ^ c >>> 8;
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
function png(r: Bytes, caps: Caps): Header {
  let at = 8, w = 0, h = 0, color = 0, declared = 0, fctl = 0, idat = false, idatDone = false, palette = false, n = 0;
  for (;;) {
    segment(++n, caps);
    const len = r.u32be(at, 'a chunk header'), type = r.ascii(at + 4, 4);
    if (len > 0x7fffffff) bad('malformed', 'has a chunk longer than PNG allows');
    if (!/^[A-Za-z]{4}$/.test(type)) bad('malformed', 'has a chunk with no name');
    const data = at + 8, end = data + len;
    r.need(data, len + 4, `chunk ${type}`);
    if (crc32(r.b, at + 4, end) !== r.u32be(end)) bad('malformed', `chunk ${type} fails its checksum`);
    if (n === 1 && type !== 'IHDR') bad('malformed', 'does not start with IHDR');
    if (idat && type !== 'IDAT') idatDone = true;
    if (type === 'IHDR') {
      if (n !== 1) bad('malformed', 'has a second IHDR');
      if (len !== 13) bad('malformed', 'has an IHDR of the wrong length');
      w = r.u32be(data); h = r.u32be(data + 4);
      sized(w, h, caps);
      const depth = r.u8(data + 8);
      color = r.u8(data + 9);
      if (!PNG_DEPTHS[color]?.includes(depth)) bad('malformed', `has colour type ${color} at depth ${depth}`);
      if (r.u8(data + 10) || r.u8(data + 11) || r.u8(data + 12) > 1) bad('malformed', 'has an unknown compression, filter or interlace');
    } else if (type === 'acTL') {
      if (idat) bad('malformed', 'says it is animated after its image data');
      if (len !== 8) bad('malformed', 'has an acTL of the wrong length');
      if (declared) bad('malformed', 'has a second acTL');
      declared = r.u32be(data);
      if (!declared) bad('malformed', 'is animated with no frames');
      counted(declared, w, h, caps);
    } else if (type === 'fcTL') {
      /* a frame's own rectangle, which a decoder sizes its buffers from */
      if (!declared) bad('malformed', 'has a frame without saying it is animated');
      if (len !== 26) bad('malformed', 'has a frame control of the wrong length');
      const fw = r.u32be(data + 4), fh = r.u32be(data + 8), x = r.u32be(data + 12), y = r.u32be(data + 16);
      if (!fw || !fh || x + fw > w || y + fh > h) bad('malformed', `has a ${fw} x ${fh} frame at ${x},${y}, outside its ${w} x ${h} canvas`);
      if (r.u8(data + 24) > 2 || r.u8(data + 25) > 1) bad('malformed', 'has a frame with an unknown dispose or blend');
      if (++fctl > declared) bad('malformed', `has more frames than the ${declared} it says`);
    } else if (type === 'PLTE') {
      if (idat || palette) bad('malformed', 'has a palette out of place');
      if (!len || len % 3 || len > 768) bad('malformed', 'has a palette of the wrong length');
      palette = true;
    } else if (type === 'IDAT') {
      if (idatDone) bad('malformed', 'has its image data in two runs');
      if (color === 3 && !palette) bad('malformed', 'is indexed with no palette');
      idat = true;
    } else if (type === 'IEND') {
      if (!idat) bad('malformed', 'has no image data');
      if (len) bad('malformed', 'has an IEND with data');
      if (end + 4 !== r.length) bad('trailing', `has ${r.length - end - 4} bytes after its end`);
      if (declared && fctl !== declared) bad('malformed', `says ${declared} frames but has ${fctl}`);
      return { format: 'png', width: w, height: h, frames: declared || 1 };
    } else if (type[0]! < 'a') bad('malformed', `has an unknown critical chunk ${type}`);
    at = end + 4;
  }
}

/* The size a VP8 or VP8L bitstream says it is. */
function vp8(r: Bytes, fourcc: string, at: number, len: number): [number, number] {
  if (fourcc === 'VP8 ') {
    if (len < 10) bad('truncated', 'ends inside its VP8 header');
    if (r.u8(at) & 1) bad('malformed', 'does not start with a key frame');
    if (r.u8(at + 3) !== 0x9d || r.u8(at + 4) !== 0x01 || r.u8(at + 5) !== 0x2a) bad('malformed', 'has a VP8 frame with the wrong start code');
    return [r.u16le(at + 6) & 0x3fff, r.u16le(at + 8) & 0x3fff];
  }
  if (len < 5) bad('truncated', 'ends inside its VP8L header');
  if (r.u8(at) !== 0x2f) bad('malformed', 'has a VP8L frame with the wrong signature');
  const bits = r.u32le(at + 1);
  if (bits >>> 29) bad('malformed', 'has a VP8L version that does not exist');
  return [(bits & 0x3fff) + 1, (bits >>> 14 & 0x3fff) + 1];
}
/* RIFF chunks between from and to: fourcc, payload start and length. Pads to even. */
function* chunks(r: Bytes, from: number, to: number, caps: Caps, count: { n: number }) {
  let at = from;
  while (at < to) {
    segment(++count.n, caps);
    if (at + 8 > to) bad('truncated', 'ends inside a chunk header');
    const fourcc = r.ascii(at, 4), len = r.u32le(at + 4);
    if (at + 8 + len > to) bad('truncated', `ends inside chunk ${fourcc}`);
    yield { fourcc, at: at + 8, len };
    at += 8 + len + (len & 1);
  }
  if (at > to) bad('truncated', 'ends inside a chunk\'s padding');
}
const IMAGE = (fourcc: string) => fourcc === 'VP8 ' || fourcc === 'VP8L';
function webp(r: Bytes, caps: Caps): Header {
  const size = r.u32le(4);
  if (size + 8 > r.length) bad('truncated', `says it has ${size + 8} bytes but has ${r.length}`);
  if (size + 8 < r.length) bad('trailing', `has ${r.length - size - 8} bytes after its end`);
  const count = { n: 0 }, all = chunks(r, 12, r.length, caps, count);
  const first = all.next();
  if (first.done) bad('malformed', 'has no image');
  const { fourcc, at, len } = first.value!;
  if (IMAGE(fourcc)) {
    const [w, h] = vp8(r, fourcc, at, len);
    sized(w, h, caps);
    if (!all.next().done) bad('malformed', 'is a simple webp with more after its image');
    return { format: 'webp', width: w, height: h, frames: 1 };
  }
  if (fourcc !== 'VP8X') bad('malformed', `starts with chunk ${fourcc}, not an image`);
  if (len < 10) bad('truncated', 'ends inside its VP8X header');
  const animated = !!(r.u8(at) & 2), w = r.u24le(at + 4) + 1, h = r.u24le(at + 7) + 1;
  sized(w, h, caps);
  let frames = 0, still = 0, animHeader = false;
  for (const c of all) {
    if (c.fourcc === 'VP8X') bad('malformed', 'has a second canvas header');
    if (c.fourcc === 'ANIM') {
      if (animHeader || c.len !== 6) bad('malformed', 'has an ANIM that is not one of 6 bytes');
      animHeader = true;
    }
    else if (c.fourcc === 'ANMF') {
      if (!animated || !animHeader) bad('malformed', 'has a frame without saying it is animated');
      counted(++frames, w, h, caps);
      if (c.len < 16) bad('truncated', 'ends inside a frame header');
      const x = r.u24le(c.at) * 2, y = r.u24le(c.at + 3) * 2, fw = r.u24le(c.at + 6) + 1, fh = r.u24le(c.at + 9) + 1;
      if (x + fw > w || y + fh > h) bad('malformed', `has a ${fw} x ${fh} frame at ${x},${y}, outside its ${w} x ${h} canvas`);
      let pictured = false;
      for (const s of chunks(r, c.at + 16, c.at + c.len, caps, count)) {
        if (!IMAGE(s.fourcc)) continue;
        if (pictured) bad('malformed', 'has a frame with two images');
        const [iw, ih] = vp8(r, s.fourcc, s.at, s.len);
        if (iw !== fw || ih !== fh) bad('malformed', `has a frame that says ${fw} x ${fh} but holds ${iw} x ${ih}`);
        pictured = true;
      }
      if (!pictured) bad('malformed', 'has a frame with no image');
    } else if (IMAGE(c.fourcc)) {
      if (animated) bad('malformed', 'is animated but has a still image');
      if (++still > 1) bad('malformed', 'has two images');
      const [iw, ih] = vp8(r, c.fourcc, c.at, c.len);
      if (iw !== w || ih !== h) bad('malformed', `says ${w} x ${h} but holds ${iw} x ${ih}`);
    }
  }
  if (animated ? !frames : !still) bad('malformed', 'has no image');
  return { format: 'webp', width: w, height: h, frames: animated ? frames : 1 };
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
function jpeg(r: Bytes, caps: Caps): Header {
  let at = 2, w = 0, h = 0, scans = 0, n = 0;
  for (;;) {
    segment(++n, caps);
    if (r.u8(at, 'a marker') !== 0xff) bad('malformed', 'has bytes where a marker should be');
    while (r.u8(at, 'a marker') === 0xff) at++;
    const marker = r.u8(at++, 'a marker');
    if (marker === 0x00) bad('malformed', 'has an empty marker');
    if (marker === 0xd8) bad('malformed', 'starts twice');
    if (marker === 0xd9) {
      if (!w) bad('malformed', 'ends with no frame');
      if (!scans) bad('malformed', 'ends with no scan');
      if (at !== r.length) bad('trailing', `has ${r.length - at} bytes after its end`);
      return { format: 'jpeg', width: w, height: h, frames: 1 };
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const len = r.u16be(at, 'a segment length');
    if (len < 2) bad('malformed', 'has a segment too short to move past');
    r.need(at, len, 'a segment');
    const data = at + 2, end = at + len;
    if (SOF.has(marker)) {
      if (w) bad('malformed', 'has more than one frame');
      if (len < 8) bad('malformed', 'has a frame header too short');
      h = r.u16be(data + 1); w = r.u16be(data + 3);
      if (!h) bad('malformed', 'leaves its height for later');
      sized(w, h, caps);
      const parts = r.u8(data + 5);
      if (!parts || parts > 4 || len !== 8 + 3 * parts) bad('malformed', 'has a frame header that does not add up');
    }
    at = end;
    if (marker === 0xda) {
      if (!w) bad('malformed', 'has a scan before its frame');
      const parts = len >= 3 ? r.u8(data) : 0;
      if (!parts || parts > 4 || len !== 6 + 2 * parts) bad('malformed', 'has a scan header that does not add up');
      scans++;
      /* entropy-coded data runs to the next marker that isn't a stuffed zero or a restart */
      for (;;) {
        if (at >= r.length) bad('truncated', 'ends inside a scan');
        if (r.b[at] !== 0xff) { at++; continue; }
        const next = r.u8(at + 1, 'a scan');
        if (next >= 0xd0 && next <= 0xd7) segment(++n, caps);
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { at += 2; continue; }
        if (next === 0xff) { at++; continue; }
        break;
      }
    }
  }
}

function gif(r: Bytes, caps: Caps): Header {
  const w = r.u16le(6), h = r.u16le(8), flags = r.u8(10);
  sized(w, h, caps);
  let at = 13 + (flags & 0x80 ? 3 << ((flags & 7) + 1) : 0), frames = 0, n = 0;
  r.need(13, at - 13, 'its colour table');
  const blocks = () => { for (;;) { const size = r.u8(at++, 'a data block'); if (!size) return; segment(++n, caps); r.need(at, size, 'a data block'); at += size; } };
  for (;;) {
    segment(++n, caps);
    const kind = r.u8(at++, 'a block');
    if (kind === 0x3b) {
      if (!frames) bad('malformed', 'has no frames');
      if (at !== r.length) bad('trailing', `has ${r.length - at} bytes after its end`);
      return { format: 'gif', width: w, height: h, frames };
    }
    if (kind === 0x21) {
      const label = r.u8(at++, 'an extension');
      if (label === 0xf9 && r.u8(at, 'an extension') !== 4) bad('malformed', 'has a graphic control that is not 4 bytes');
      blocks();
      continue;
    }
    if (kind !== 0x2c) bad('malformed', `has an unknown block 0x${kind.toString(16)}`);
    counted(++frames, w, h, caps);
    const x = r.u16le(at), y = r.u16le(at + 2), fw = r.u16le(at + 4), fh = r.u16le(at + 6), f = r.u8(at + 8);
    if (!fw || !fh || x + fw > w || y + fh > h) bad('malformed', `has a ${fw} x ${fh} frame at ${x},${y}, outside its ${w} x ${h} screen`);
    at += 9 + (f & 0x80 ? 3 << ((f & 7) + 1) : 0);
    const code = r.u8(at++, 'a frame');
    if (code < 2 || code > 8) bad('malformed', 'has a frame with an impossible code size');
    blocks();
  }
}

/* Format, size and frames from the bytes, or a Bad saying why not. */
export function imageHeader(b: Uint8Array, caps: Caps = CAPS): Header {
  const format = sniff(b), r = new Bytes(b);
  const start = String.fromCharCode(...b.subarray(0, 12));
  if (!format && b.length < 12 && STARTS.some(s => s.startsWith(start) || start.startsWith(s))) return bad('truncated', 'ends inside its signature');
  if (!format) return bad('not-image', 'is not a png, webp, jpeg or gif');
  const h = format === 'png' ? png(r, caps) : format === 'webp' ? webp(r, caps) : format === 'jpeg' ? jpeg(r, caps) : gif(r, caps);
  counted(h.frames, h.width, h.height, caps);
  return h;
}
