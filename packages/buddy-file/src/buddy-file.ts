/* .buddy.json: the one place a buddy file is read and written. Every import goes through read(),
 which throws on anything it doesn't know. A file is { app, version, buddy }. Version 2 added
 `character`, an id made once that stays with the character through export, import and copies. */
import { LIFTS, POSE, SITUATIONS, type Buddy, type ContentBox, type Frame, type ImageRef, type Kit, type Lift, type Pose, type PoseKey, type Signature } from './schema';

export const VERSION = 2;
/* Each of `lift`'s values is a share of her size, either way: 60 px at the usual 120, as far as a pose's own Lift goes. */
export const LIMIT = { file: 64e6, image: 8e6, frames: 120, name: 64, lines: 64, line: 300, kit: 4000, lift: .5 };
const IMAGE = /^data:image\/(png|webp|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const KIT: Record<keyof Kit, readonly string[] | 0> = { mode: ['tags', 'text'], appearance: 0, personality: 0, quality: 0, styleTags: 0, styleText: 0 };

const bad = (why: string): never => { throw new Error(why); };
type Fields = Record<string, unknown>;
const isObject = (v: unknown): v is Fields => v !== null && typeof v === 'object' && !Array.isArray(v);
function only(o: unknown, names: readonly string[], what: string): Fields {
  if (!isObject(o)) return bad(what + ' must be an object');
  for (const k of Object.keys(o)) if (!names.includes(k)) bad(`unknown field in ${what}: ${k}`);
  return o;
}
function num(v: unknown, lo: number, hi: number, what: string): number { if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return bad(what + ' is out of range'); return v; }
function str(v: unknown, max: number, what: string): string { if (typeof v !== 'string' || v.length > max) return bad(what + ' is not a short string'); return v; }
function image(v: unknown, what: string): string { if (typeof v !== 'string' || v.length > LIMIT.image || !IMAGE.test(v)) return bad(what + ' is not an image'); return v; }

function bb(b: unknown, what: string): ContentBox {
  const f = only(b, ['x0', 'y0', 'x1', 'y1'], what);
  const o: ContentBox = { x0: num(f.x0, 0, 1, what), y0: num(f.y0, 0, 1, what), x1: num(f.x1, 0, 1, what), y1: num(f.y1, 0, 1, what) };
  if (o.x0 > o.x1 || o.y0 > o.y1) bad(what + ' is inside out');
  return o;
}
type ImageCheck = (v: unknown, what: string) => string;
function frame(v: unknown, what: string, img: ImageCheck): Frame { const f = only(v, ['src', 'bb'], what); return { src: img(f.src, what), bb: bb(f.bb, what + ' box') }; }
function ref(v: unknown): ImageRef {
  const r = only(v, ['ow', 'oh', 'w', 'h', 'cx', 'by', 'side'], 'ref');
  const n = (x: unknown) => num(x, -1e5, 1e5, 'ref'); /* a sticker's ow and oh are -1 */
  return { ow: n(r.ow), oh: n(r.oh), w: n(r.w), h: n(r.h), cx: n(r.cx), by: n(r.by), side: n(r.side) };
}
function pose(key: string, v: unknown, img: ImageCheck): Pose {
  if (!Object.prototype.hasOwnProperty.call(POSE, key)) bad('unknown pose: ' + key);
  const p = only(v, ['frames', 'fps', 'scale'], key);
  if (!Array.isArray(p.frames) || p.frames.length > LIMIT.frames) return bad(key + ' has too many frames');
  const o: Pose = { frames: p.frames.map((f, i) => frame(f, `${key} frame ${i + 1}`, img)) };
  if (p.fps !== undefined) o.fps = num(p.fps, .1, 60, key + ' speed');
  if (p.scale !== undefined) o.scale = num(p.scale, .05, 10, key + ' scale');
  return o;
}
function lines(v: unknown): NonNullable<Buddy['lines']> {
  const l = only(v, Object.keys(SITUATIONS), 'lines');
  const o: Record<string, string[]> = {};
  for (const [k, list] of Object.entries(l)) {
    if (!Array.isArray(list) || list.length > LIMIT.lines) return bad(k + ' has too many lines');
    o[k] = list.map(s => str(s, LIMIT.line, k + ' line'));
  }
  return o;
}
/* The rule for a buddy's lines, for anything else that takes lines in: the Maker's reply box. */
export const checkLines = lines;

function kit(v: unknown): Kit {
  const k = only(v, Object.keys(KIT), 'kit');
  const o: Record<string, string> = {};
  for (const [key, value] of Object.entries(k)) {
    const known = KIT[key as keyof Kit];
    if (known && !known.includes(value as string)) bad('kit ' + key + ' is not known');
    o[key] = str(value, LIMIT.kit, 'kit ' + key);
  }
  return o;
}

/* Rebuilt in one order, whatever order the file had. A surface at 0 or -0 does nothing, so it goes,
   and so does a lift with nothing left. */
function lift(v: unknown): Lift | undefined {
  const l = only(v, LIFTS, 'lift'), o: Lift = {};
  for (const k of LIFTS) if (l[k] !== undefined) { const x = num(l[k], -LIMIT.lift, LIMIT.lift, `${k} lift`); if (x) o[k] = x; }
  return Object.keys(o).length ? o : undefined;
}

function signature(v: unknown): Signature {
  const f = only(v, ['weight', 'line'], 'signature'), o: Signature = {};
  if (f.weight !== undefined) o.weight = num(f.weight, 0, 5, 'signature weight');
  if (f.line !== undefined) o.line = str(f.line, LIMIT.line, 'signature line');
  return o;
}

/* Rebuilds a buddy field by field, so nothing unchecked survives. `img` is what counts as an image. */
export function check(v: unknown, img: ImageCheck = image): Buddy {
  const b = only(v, ['character', 'name', 'size', 'lift', 'faces', 'base', 'ref', 'poses', 'lines', 'kit', 'signature'], 'buddy');
  const o: Buddy = { base: frame(b.base, 'main image', img), poses: {} };
  if (b.character !== undefined) { if (typeof b.character !== 'string' || !ID.test(b.character)) return bad('character is not an id'); o.character = b.character; }
  if (b.name !== undefined) o.name = str(b.name, LIMIT.name, 'name');
  if (b.size !== undefined) o.size = num(b.size, 16, 512, 'size');
  if (b.lift !== undefined) { const l = lift(b.lift); if (l) o.lift = l; }
  if (b.faces !== undefined) { if (b.faces !== 'left' && b.faces !== 'right') return bad('faces is not left or right'); o.faces = b.faces; }
  if (b.ref !== undefined) o.ref = ref(b.ref);
  if (b.poses !== undefined) {
    if (!isObject(b.poses)) return bad('poses must be an object');
    for (const [k, p] of Object.entries(b.poses)) o.poses[k as PoseKey] = pose(k, p, img);
  }
  if (b.lines !== undefined) o.lines = lines(b.lines);
  if (b.kit !== undefined) o.kit = kit(b.kit);
  if (b.signature !== undefined) o.signature = signature(b.signature);
  return o;
}

export const newCharacter = () => 'c' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);

function envelope(text: string) {
  if (typeof text !== 'string' || text.length > LIMIT.file) bad('too big');
  const d = only(JSON.parse(text), ['app', 'version', 'buddy'], 'file');
  if (d.app !== 'desktop-buddies') bad('not a buddy file');
  if (d.version !== 1 && d.version !== VERSION) bad('unknown version');
  return d;
}

/* A checked buddy from a file's text. Throws if it isn't one. Version 1 files upgrade here. */
export function read(text: string): Buddy {
  const d = envelope(text);
  const buddy = check(d.buddy);
  if (!buddy.character) { if (d.version === VERSION) bad('no character'); buddy.character = newCharacter(); }
  return buddy;
}
export function write(pet: Buddy & { id?: string }): string {
  const { id, ...buddy } = pet;
  return JSON.stringify({ app: 'desktop-buddies', version: VERSION, buddy });
}

/* What a buddy is saved as. Windows reads the part after the last dot, so only `.buddy` can have
   its own double-click. Older `.buddy.json` files still read the same. */
export const EXTENSION = 'buddy';
export function saveName(name?: string): string {
  const clean = (name || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/, '').trim();
  return `${clean || 'buddy'}.${EXTENSION}`;
}

/* A buddy on disk: the same file, with each image pulled out beside it and `src` holding its
   name. A .buddy file stays one portable file; unpack and pack go between the two. */
export const MANIFEST = 'buddy.json';
export interface ImageFile { name: string; bytes: Uint8Array }
export interface Unpacked { manifest: string; images: ImageFile[] }

declare function atob(s: string): string;
declare function btoa(s: string): string;
const EXT = { png: 'png', webp: 'webp', jpeg: 'jpg', gif: 'gif' };
const MIME: Record<string, string> = { png: 'png', webp: 'webp', jpg: 'jpeg', gif: 'gif' };
const IMAGE_FILE = /^[a-z0-9_-]{1,80}\.(png|webp|jpg|gif)$/;

function imageFile(v: unknown, what: string): string { if (typeof v !== 'string' || !IMAGE_FILE.test(v)) return bad(what + ' is not an image file'); return v; }
function toBytes(data: string): Uint8Array {
  const bin = atob(data), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function toData(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
/* Every frame in a buddy, named for where it is. */
function frames(b: Buddy): [string, Frame][] {
  const out: [string, Frame][] = [['base', b.base]];
  for (const [key, p] of Object.entries(b.poses)) p.frames.forEach((f, i) => out.push([`${key}-${i}`.toLowerCase(), f]));
  return out;
}
const copy = (b: Buddy): Buddy => JSON.parse(JSON.stringify(b)) as Buddy;

/* The format the bytes are, whatever a file declared. The native shell only serves these four,
   by the same signatures: anything else served from the library could load as a page. */
function format(b: Uint8Array): keyof typeof EXT | null {
  const has = (sig: string | number[], at = 0) => [...sig].every((c, i) => b[at + i] === (typeof c === 'string' ? c.charCodeAt(0) : c));
  if (has([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (has([0xff, 0xd8, 0xff])) return 'jpeg';
  if (has('GIF87a') || has('GIF89a')) return 'gif';
  if (has('RIFF') && has('WEBP', 8)) return 'webp';
  return null;
}

/* Refuses an image whose bytes aren't one of the four, and names each file for what it really is:
   a `.png` that's really webp is a fair upload. The same image used twice is one file. */
export function unpack(buddy: Buddy): Unpacked {
  const b = copy(buddy), names = new Map<string, string>(), images: ImageFile[] = [];
  for (const [name, f] of frames(b)) {
    let file = names.get(f.src);
    if (!file) {
      const bytes = toBytes(f.src.slice(f.src.indexOf(',') + 1)), type = format(bytes);
      if (!type) return bad(name + ' is not a png, webp, jpeg or gif');
      file = `${name}.${EXT[type]}`;
      names.set(f.src, file);
      images.push({ name: file, bytes });
    }
    f.src = file;
  }
  return { manifest: write(b), images };
}
/* A checked buddy from a manifest, with `src` still the file names. */
export function readManifest(text: string): Buddy {
  const buddy = check(envelope(text).buddy, imageFile);
  if (!buddy.character) bad('no character');
  return buddy;
}
/* The buddy as one portable thing again. Throws if an image is missing. */
export function pack(manifest: string, image: (name: string) => Uint8Array | undefined): Buddy {
  const b = readManifest(manifest);
  for (const [, f] of frames(b)) {
    const bytes = image(f.src);
    if (!bytes) return bad('missing image ' + f.src);
    f.src = `data:image/${MIME[f.src.split('.').pop()!]};base64,${toData(bytes)}`;
  }
  return check(b);
}
/* The image files a manifest's buddy names, once each. */
export const imageNames = (buddy: Buddy) => [...new Set(frames(buddy).map(([, f]) => f.src))];
/* The buddy with each image's name turned into a URL. */
export function located(buddy: Buddy, url: (name: string) => string): Buddy {
  const b = copy(buddy);
  for (const [, f] of frames(b)) f.src = url(f.src);
  return b;
}
