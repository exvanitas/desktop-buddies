/* The screenshots refuse a sample whose pictures move by themselves. Each format, moving and still. */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { animatedImages, isAnimated } from '../animated.mjs';
import { DEFAULT_FROM } from '../sample-buddy.mjs';

const u32be = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u32le = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const pngChunk = (type, data = Buffer.alloc(0)) => Buffer.concat([u32be(data.length), Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
const png = moving => Buffer.concat([
  Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), pngChunk('IHDR', Buffer.alloc(13)),
  ...moving ? [pngChunk('acTL', Buffer.alloc(8))] : [], pngChunk('IDAT', Buffer.alloc(4)), pngChunk('IEND')
]);
const riff = (type, data) => Buffer.concat([Buffer.from(type, 'latin1'), u32le(data.length), data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
const webp = (flags, ...chunks) => { const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), riff('VP8X', Buffer.from([flags, 0, 0, 0, 0, 0, 0, 0, 0, 0])), ...chunks]); return Buffer.concat([Buffer.from('RIFF', 'latin1'), u32le(body.length), body]); };
const gifFrame = Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 0, 0]);
const gif = frames => Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([1, 0, 1, 0, 0, 0, 0]), Buffer.from([0x21, 0xf9, 4, 0, 0, 0, 0, 0]), ...Array(frames).fill(gifFrame), Buffer.from([0x3b])]);

describe('animated images', () => {
  it('tells moving PNG, WebP and GIF from still ones', () => {
    expect(isAnimated(png(true))).toBe(true);
    expect(isAnimated(png(false))).toBe(false);
    expect(isAnimated(webp(0x02, riff('ANIM', Buffer.alloc(6))))).toBe(true);
    expect(isAnimated(webp(0, riff('VP8L', Buffer.alloc(5))))).toBe(false);
    expect(isAnimated(gif(2))).toBe(true);
    expect(isAnimated(gif(1))).toBe(false);
  });

  it('finds none in the repo sample, and names where one is', () => {
    const text = fs.readFileSync(DEFAULT_FROM, 'utf8');
    expect(animatedImages(text)).toEqual([]);
    const f = JSON.parse(text);
    f.buddy.base.src = 'data:image/gif;base64,' + gif(3).toString('base64');
    expect(animatedImages(JSON.stringify(f))).toEqual(['buddy.base.src']);
  });
});
