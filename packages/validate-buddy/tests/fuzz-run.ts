/* Mutates valid files and validates each. Run by fuzz.test.ts in its own Node with a heap cap and a
   time limit, so a hang or a runaway allocation fails the test instead of the machine.
     node fuzz-child.mjs <seed> <cases> [seed files...]
   Prints one JSON line: cases, uncaught throws, internal errors, the slowest case, peak RSS. */
import fs from 'node:fs';
import { validate, type Report } from '../src/index';
import * as m from './make';

const [seedArg = '1', casesArg = '2000', ...seeds] = process.argv.slice(2);
let s = Number(seedArg) >>> 0 || 1;
const rand = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2 ** 32; };
const int = (n: number) => Math.floor(rand() * n);

/* the pieces to mutate: each data URL's type and bytes, inside a file shape */
type Image = { type: string; bytes: Uint8Array };
const asImages = (urls: string[]): Image[] => urls.map(u => ({ type: u.slice(11, u.indexOf(';')), bytes: m.bytes(u.slice(u.indexOf(',') + 1)) }));
const sources: { images: Image[]; text?: Uint8Array }[] = [{ images: asImages(m.REAL_URLS) }];
for (const f of seeds) {
  const text = fs.readFileSync(f), d = JSON.parse(text.toString('utf8'));
  const urls = [d.buddy.base.src, ...Object.values(d.buddy.poses as Record<string, { frames: { src: string }[] }>).flatMap(p => p.frames.map(x => x.src))];
  sources.push({ images: asImages([...new Set(urls)]), text });
}

const TYPES = ['png', 'webp', 'jpeg', 'gif'];
const EXTREMES = [0, 1, 0xff, 0x7fffffff, 0xffffffff, 0x80000000, 0xffff, 0x10000];
function mutate(b: Uint8Array): Uint8Array {
  let o = b.slice();
  for (let n = 1 + int(4); n--;) {
    const at = int(o.length || 1);
    switch (int(7)) {
      case 0: o[at] = int(256); break;
      case 1: o[at] = o[at]! ^ (1 << int(8)); break;
      case 2: { const v = EXTREMES[int(EXTREMES.length)]!; for (let i = 0; i < 4 && at + i < o.length; i++) o[at + i] = v >>> (8 * (rand() < .5 ? i : 3 - i)) & 255; break; }
      case 3: o = o.slice(0, at); break;
      case 4: { const len = int(64); o = m.cat(o.slice(0, at), o.slice(at, at + len), o.slice(at)); break; }
      case 5: o = m.cat(o.slice(0, at), Array.from({ length: int(16) }, () => int(256)), o.slice(at)); break;
      case 6: { const len = int(32); o = m.cat(o.slice(0, at), o.slice(at + len)); break; }
    }
  }
  return o;
}

let throws = 0, internal = 0, slowest = 0, clean = 0;
const seen: Record<string, number> = {};
const cases = Number(casesArg);
for (let i = 0; i < cases; i++) {
  const src = sources[int(sources.length)]!;
  let file: Uint8Array;
  if (src.text && rand() < .1) file = mutate(src.text);
  else {
    const images = src.images.map(x => ({ ...x }));
    for (let k = 1 + int(3); k--;) { const j = int(images.length); images[j] = { ...images[j]!, bytes: mutate(images[j]!.bytes) }; }
    if (rand() < .1) { const j = int(images.length); images[j] = { ...images[j]!, type: TYPES[int(4)]! }; }
    file = rand() < .1 ? mutate(m.file(images.map(x => m.url(x.type, x.bytes)))) : m.file(images.map(x => m.url(x.type, x.bytes)));
  }
  const t = performance.now();
  let r: Report;
  try { r = validate(file); }
  catch (e) { throws++; console.error('threw:', (e as Error).message); continue; }
  slowest = Math.max(slowest, performance.now() - t);
  if (r.ok) clean++;
  for (const p of r.problems) { seen[p.code] = (seen[p.code] ?? 0) + 1; if (p.code === 'internal') { internal++; console.error('internal:', p.where, p.message); } }
}
console.log(JSON.stringify({ cases, throws, internal, clean, slowestMs: Math.round(slowest), peakRssMb: Math.round(process.resourceUsage().maxRSS / 1024), seen }));
