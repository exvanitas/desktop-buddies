/* Builders for crafted images and files. Each image format is put together here from its parts, with
   node's own crc32 and deflate, so the tests don't lean on the code they test. */
import { crc32, deflateSync } from 'node:zlib';
import { POSES } from '@buddies/buddy-file';
import { REAL } from './real-images';

export const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'));
export const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
export const ascii = (s: string) => [...s].map(c => c.charCodeAt(0));
export function cat(...parts: (Uint8Array | number[])[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const u32be = (n: number) => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];
const u32le = (n: number) => [n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255];
const u24le = (n: number) => [n & 255, n >>> 8 & 255, n >>> 16 & 255];
const u16le = (n: number) => [n & 255, n >>> 8 & 255];
const u16be = (n: number) => [n >>> 8 & 255, n & 255];

/* PNG */
export const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export function chunk(type: string, data: number[] | Uint8Array, crc?: number) {
  const body = cat(ascii(type), data);
  return cat(u32be(data.length), body, u32be(crc ?? crc32(body)));
}
export const ihdr = (w: number, h: number, depth = 8, color = 6) => chunk('IHDR', [...u32be(w), ...u32be(h), depth, color, 0, 0, 0]);
export function png(w: number, h: number, o: { extra?: Uint8Array[]; idat?: Uint8Array; post?: Uint8Array[]; after?: number[] } = {}) {
  const idat = o.idat ?? deflateSync(Buffer.alloc(Math.min(h, 4) * (1 + Math.min(w, 4) * 4)));
  return cat(PNG_SIG, ihdr(w, h), ...(o.extra ?? []), chunk('IDAT', idat), ...(o.post ?? []), chunk('IEND', []), o.after ?? []);
}
export const actl = (frames: number) => chunk('acTL', [...u32be(frames), ...u32be(0)]);
/* an APNG frame control: sequence, size, offset, delay 1/10, dispose, blend */
export const fctl = (seq: number, w: number, h: number, x = 0, y = 0, dispose = 0, blend = 0) =>
  chunk('fcTL', [...u32be(seq), ...u32be(w), ...u32be(h), ...u32be(x), ...u32be(y), 0, 1, 0, 10, dispose, blend]);
export const fdat = (seq: number) => chunk('fdAT', [...u32be(seq), ...deflateSync(Buffer.alloc(2))]);

/* WebP */
export function riff(...chunks: Uint8Array[]) {
  const body = cat(ascii('WEBP'), ...chunks);
  return cat(ascii('RIFF'), u32le(body.length), body);
}
export function wchunk(fourcc: string, data: Uint8Array | number[]) {
  return cat(ascii(fourcc), u32le(data.length), data, data.length & 1 ? [0] : []);
}
export const vp8l = (w: number, h: number) => {
  const bits = (w - 1) | (h - 1) << 14 | 1 << 28;
  return wchunk('VP8L', [0x2f, ...u32le(bits), 0, 0, 0]);
};
export const vp8 = (w: number, h: number) => wchunk('VP8 ', [0x50, 0x01, 0x00, 0x9d, 0x01, 0x2a, ...u16le(w), ...u16le(h), 0, 0]);
export const vp8x = (w: number, h: number, flags = 0) => wchunk('VP8X', [flags, 0, 0, 0, ...u24le(w - 1), ...u24le(h - 1)]);
export const anim = () => wchunk('ANIM', [0, 0, 0, 0, 0, 0]);
export const anmf = (w: number, h: number, x = 0, y = 0, frame = vp8l(w, h)) =>
  wchunk('ANMF', [...u24le(x / 2), ...u24le(y / 2), ...u24le(w - 1), ...u24le(h - 1), 100, 0, 0, 0, ...frame]);

/* JPEG: segments with their markers */
export const seg = (marker: number, data: number[]) => [0xff, marker, ...u16be(data.length + 2), ...data];
export const sof = (w: number, h: number, marker = 0xc0) => seg(marker, [8, ...u16be(h), ...u16be(w), 1, 1, 0x11, 0]);
export const sos = () => seg(0xda, [1, 1, 0, 0, 63, 0]);
export function jpeg(w: number, h: number, o: { before?: number[]; scan?: number[]; after?: number[] } = {}) {
  return cat([0xff, 0xd8], o.before ?? [], sof(w, h), sos(), o.scan ?? [0x12, 0x34, 0xff, 0x00, 0x56], [0xff, 0xd9], o.after ?? []);
}

/* GIF */
export function gif(w: number, h: number, frames: { x?: number; y?: number; w?: number; h?: number }[] = [{}], after: number[] = []) {
  const out = [...ascii('GIF89a'), ...u16le(w), ...u16le(h), 0x80, 0, 0, 0, 0, 0, 255, 255, 255];
  for (const f of frames) out.push(0x21, 0xf9, 4, 0, 0, 0, 0, 0, 0x2c, ...u16le(f.x ?? 0), ...u16le(f.y ?? 0), ...u16le(f.w ?? w), ...u16le(f.h ?? h), 0, 2, 2, 0x44, 0x01, 0);
  return cat(out, [0x3b], after);
}

/* A .buddy file whose main image is the first, and the rest are walk frames. */
const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
export const url = (type: string, b: Uint8Array | string) => `data:image/${type};base64,${typeof b === 'string' ? b : b64(b)}`;
export function buddy(images: string[], extra: Record<string, unknown> = {}) {
  const [base, ...rest] = images;
  return { character: 'c123', name: 'Pip', base: { src: base, bb: box }, poses: rest.length ? { walk: { frames: rest.map(src => ({ src, bb: box })) } } : {}, ...extra };
}
export const text = (b: unknown, o: object = {}) => JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: b, ...o });
export const file = (images: string[], extra?: Record<string, unknown>) => new TextEncoder().encode(text(buddy(images, extra)));
/* As many images as wanted: the main image, then 120 to a pose. */
export function fileAcross(images: string[]) {
  const [base, ...rest] = images, poses: Record<string, unknown> = {};
  for (let i = 0; i < rest.length; i += 120) poses[POSES[i / 120]!.key] = { frames: rest.slice(i, i + 120).map(src => ({ src, bb: box })) };
  return new TextEncoder().encode(text({ character: 'c123', name: 'Pip', base: { src: base, bb: box }, poses }));
}

/* Every real image, as the data URL a Maker would write. */
export const REAL_URLS = [
  url('png', REAL.png), url('jpeg', REAL.jpeg), url('jpeg', REAL.jpegProgressive), url('webp', REAL.webpLossy),
  url('webp', REAL.webpLossless), url('webp', REAL.webpAlpha), url('webp', REAL.webpAnimated), url('gif', REAL.gif),
  url('gif', REAL.gifAnimated), url('png', REAL.apng)
];
