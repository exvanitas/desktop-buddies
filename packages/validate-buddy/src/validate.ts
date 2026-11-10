/* A .buddy file's bytes, checked as hostile data: the byte cap, UTF-8, JSON depth, then the app's own
   read(), then every image's header from its bytes. Nothing is run or drawn, and nothing throws: each
   problem comes back named, with where it is. */
import { read, type Buddy } from '@buddies/buddy-file';
import { CAPS, type Caps } from './caps';
import { Bad, imageHeader, type Code } from './image';
import { sha256 } from './sha256';

export interface Problem { code: Code; where: string; message: string }
export interface Report { ok: boolean; problems: Problem[]; images: number; pixels: number }

/* Deepest bracket nesting outside strings, stopping as soon as it passes the cap. A close with nothing
   open isn't JSON, which JSON.parse says next. */
function tooDeep(text: string, cap: number) {
  let depth = 0, inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) { if (c === 0x5c) i++; else if (c === 0x22) inString = false; }
    else if (c === 0x22) inString = true;
    else if (c === 0x7b || c === 0x5b) { if (++depth > cap) return true; }
    else if ((c === 0x7d || c === 0x5d) && --depth < 0) return false;
  }
  return false;
}

const B64 = new Int16Array(128).fill(-1);
[...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].forEach((c, i) => { B64[c.charCodeAt(0)] = i; });
function base64(s: string): Uint8Array {
  if (s.length % 4) throw new Bad('base64', 'is not whole base64');
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0, out = new Uint8Array(s.length / 4 * 3 - pad);
  for (let i = 0, o = 0; i < s.length; i += 4) {
    let n = 0;
    for (let j = i; j < i + 4; j++) {
      const v = j < s.length - pad ? B64[s.charCodeAt(j)] ?? -1 : 0;
      if (v < 0) throw new Bad('base64', 'is not base64');
      n = n << 6 | v;
    }
    out[o++] = n >> 16 & 255;
    if (o < out.length) out[o++] = n >> 8 & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/* Every frame's image, named as read() names them. */
function frames(b: Buddy): [string, string][] {
  const out: [string, string][] = [['main image', b.base.src]];
  for (const [key, p] of Object.entries(b.poses)) p!.frames.forEach((f, i) => out.push([`${key} frame ${i + 1}`, f.src]));
  return out;
}

const ZIP = [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]];
const UTF8 = new TextDecoder('utf-8', { fatal: true });

export function validate(bytes: Uint8Array, caps: Caps = CAPS): Report {
  const problems: Problem[] = [];
  const report = (images = 0, pixels = 0): Report => ({ ok: !problems.length, problems, images, pixels });
  const stop = (code: Code, message: string, where = '') => { problems.push({ code, where, message }); return report(); };
  try {
    if (bytes.length > caps.file) return stop('too-big', `is ${bytes.length} bytes, more than ${caps.file}`);
    if (ZIP.some(sig => sig.every((x, i) => bytes[i] === x))) return stop('zip', 'is a zip; a .buddy is one JSON file');
    let text: string;
    try { text = UTF8.decode(bytes); } catch { return stop('not-utf8', 'is not UTF-8 text'); }
    if (tooDeep(text, caps.depth)) return stop('too-deep', `nests deeper than ${caps.depth}`);
    let buddy: Buddy;
    try { buddy = read(text); }
    catch (e) { return stop(e instanceof SyntaxError ? 'not-json' : 'reader', e instanceof Error ? e.message : String(e)); }

    const seen = new Set<string>();
    let pixels = 0;
    for (const [where, src] of frames(buddy)) {
      const key = sha256(src);
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const declared = src.slice(11, src.indexOf(';')), h = imageHeader(base64(src.slice(src.indexOf(',') + 1)), caps);
        if (h.format !== declared) problems.push({ code: 'type-mismatch', where, message: `says ${declared} but its bytes are ${h.format}` });
        pixels += h.width * h.height * h.frames;
      } catch (e) {
        problems.push(e instanceof Bad ? { code: e.code, where, message: e.message } : { code: 'internal', where, message: String(e) });
      }
    }
    if (pixels > caps.totalPixels) problems.push({ code: 'total-pixels', where: '', message: `has ${pixels} px across its images, more than ${caps.totalPixels}` });
    return report(seen.size, pixels);
  } catch (e) {
    return stop('internal', String(e));
  }
}
