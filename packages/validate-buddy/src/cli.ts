/* validate-buddy [--json] <file>...: one plain line per problem, or one JSON report. Exit 0 when every
   file is clean, 1 when any has a problem, 2 on bad usage. A file is read only when it is one plain file,
   and never past the byte cap. The last part of its path is never a link; folders above it are followed
   as the system resolves them. A folder, device, pipe or zip is refused: a .buddy is one JSON file. */
import fs from 'node:fs';
import path from 'node:path';
import { CAPS, type Caps } from './caps';
import type { Code } from './image';
import { validate, type Problem } from './validate';

export interface FileReport { file: string; ok: boolean; bytes: number; images: number; pixels: number; ms: number; problems: Problem[] }
type Refusal = { code: Code; message: string };
const USAGE = 'usage: pnpm -s validate-buddy [--json] <file.buddy>...\n';
const unreadable = (e: unknown): Refusal => ({ code: 'unreadable', message: (e as NodeJS.ErrnoException)?.code ?? String(e) });

/* Size, then at most size + 1 bytes, through the open descriptor. */
function readFrom(fd: number, st: fs.Stats, cap: number): Uint8Array | Refusal {
  const now = fs.fstatSync(fd);
  /* the file opened is the file looked at, so a link swapped in between is caught here too, where
     O_NOFOLLOW doesn't exist (Windows) */
  if (now.dev !== st.dev || now.ino !== st.ino) return { code: 'symlink', message: 'changed between the look and the open' };
  if (!now.isFile()) return { code: 'not-file', message: 'is not a plain file' };
  if (now.size > cap) return { code: 'too-big', message: `is ${now.size} bytes, more than ${cap}` };
  /* it can grow while read: one byte over is enough to know */
  const buf = Buffer.alloc(now.size + 1);
  let got = 0, n: number;
  while (got < buf.length && (n = fs.readSync(fd, buf, got, buf.length - got, got)) > 0) got += n;
  if (got > cap) return { code: 'too-big', message: `is more than ${cap} bytes` };
  if (got > now.size) return { code: 'unreadable', message: 'grew while it was read' };
  return new Uint8Array(buf.buffer, buf.byteOffset, got);
}

/* The file's bytes, or why not. Never throws. */
export function readCapped(file: string, cap: number): Uint8Array | Refusal {
  let st: fs.Stats;
  try { st = fs.lstatSync(file); } catch (e) { return unreadable(e); }
  if (st.isSymbolicLink()) return { code: 'symlink', message: 'is a link; give the file itself' };
  if (st.isDirectory()) return { code: 'folder', message: 'is a folder; a .buddy is one file (Shimeji folders import in the app)' };
  if (!st.isFile()) return { code: 'not-file', message: 'is not a plain file' };
  let fd: number;
  /* no following a link swapped in since, and no waiting on a pipe, where the system has the flags */
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0)); }
  catch (e) { return unreadable(e); }
  let out: Uint8Array | Refusal;
  try { out = readFrom(fd, st, cap); } catch (e) { out = unreadable(e); }
  try { fs.closeSync(fd); } catch (e) { out = unreadable(e); }
  return out;
}

export function check(file: string, cwd: string, caps: Caps = CAPS): FileReport {
  const t = performance.now();
  const done = (r: Omit<FileReport, 'file' | 'ms'>): FileReport => ({ file, ...r, ms: Math.round(performance.now() - t) });
  const refused = (p: Refusal) => done({ ok: false, bytes: 0, images: 0, pixels: 0, problems: [{ code: p.code, where: '', message: p.message }] });
  try {
    const bytes = readCapped(path.resolve(cwd, file), caps.file);
    if (!(bytes instanceof Uint8Array)) return refused(bytes);
    const r = validate(bytes, caps);
    return done({ ok: r.ok, bytes: bytes.length, images: r.images, pixels: r.pixels, problems: r.problems });
  } catch (e) { return refused({ code: 'internal', message: String(e) }); }
}

const mb = (n: number) => (n / 1e6).toFixed(1);
export function run(args: string[], cwd: string): { code: number; out: string } {
  const json = args.includes('--json'), files = args.filter(a => a !== '--json');
  if (!files.length || files.some(f => f.startsWith('--'))) return { code: 2, out: USAGE };
  const reports = files.map(f => check(f, cwd));
  const code = reports.every(r => r.ok) ? 0 : 1;
  if (json) return { code, out: JSON.stringify({ files: reports }, null, 1) + '\n' };
  const lines = reports.flatMap(r => r.ok
    ? [`${r.file}: ok, ${r.images} images, ${mb(r.pixels)} Mpx, ${mb(r.bytes)} MB, ${r.ms} ms`]
    : r.problems.map(p => `${r.file}: ${p.where ? p.where + ': ' : ''}${p.message} [${p.code}]`));
  return { code, out: lines.join('\n') + '\n' };
}
