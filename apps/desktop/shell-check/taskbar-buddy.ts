/* The test buddy for taskbar-check.ps1: no one's art, a solid square of one colour that's easy to find
   in a screenshot, with a floor lift deep enough that part of her is drawn over a taskbar at the
   bottom of the screen. Node builtins only, so it runs as it is:
     node apps/desktop/shell-check/taskbar-buddy.ts > apps/desktop/shell-check/taskbar-check.buddy
   tests/taskbar-buddy.test.ts checks the committed file is what this makes. */
import { deflateSync } from 'node:zlib';

/* Her colour, and how far a screen pixel may be from it and still count as her. */
export const COLOUR = { r: 255, g: 0, b: 200 };
export const TOLERANCE = 24;
/* Her size in CSS pixels, and her floor lift as a share of it: 56 px into the floor at 100%, more
   than a Windows 11 taskbar's 48. */
export const SIZE = 160, FLOOR_LIFT = -.35;
const SIDE = 32;

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
}
/* A SIDE x SIDE PNG of one opaque colour. */
export function squarePng(c = COLOUR) {
  const head = new Uint8Array(13), v = new DataView(head.buffer);
  v.setUint32(0, SIDE); v.setUint32(4, SIDE);
  head.set([8, 6, 0, 0, 0], 8); /* 8 bits, RGBA */
  const raw = new Uint8Array(SIDE * (1 + SIDE * 4));
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) raw.set([c.r, c.g, c.b, 255], y * (1 + SIDE * 4) + 1 + x * 4);
  const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/* The .buddy file's text. */
export function taskbarBuddy() {
  const src = 'data:image/png;base64,' + Buffer.from(squarePng()).toString('base64');
  return JSON.stringify({
    app: 'desktop-buddies', version: 2,
    buddy: { character: 'ctaskbarcheck', name: 'Taskbar check', size: SIZE, faces: 'right', lift: { floor: FLOOR_LIFT }, base: { src, bb: { x0: 0, y0: 0, x1: 1, y1: 1 } }, poses: {} }
  });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!)) process.stdout.write(taskbarBuddy() + '\n');
