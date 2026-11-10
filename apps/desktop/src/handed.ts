/* Files handed to the Manager, by a drop or by <input type=file>, sorted into what to do with each.
   Folders arrive as files with paths. Nothing here reads a file's contents. */
import { noShime1, wrongKind, type Problem } from './failures';

export interface Handed {
  name: string;
  path: string; /* with its folders when it came in one, like Mochi/img/shime1.png */
  size: number;
  text(): Promise<string>;
  url(): Promise<string>; /* as an image's src */
}
export type Job =
| { k: 'file'; file: Handed }
| { k: 'shimeji'; folder: string; files: Handed[] }
| { k: 'refused'; problem: Problem };

const BUDDY = /\.buddy(\.json)?$/i, JSON_FILE = /\.json$/i, SHIME = /^shime\d+\.png$/i, IMAGE = /\.(png|webp|jpe?g|gif)$/i;
const NAME_MAX = 64;

const dirOf = (f: Handed) => f.path.split('/').slice(0, -1).join('/');
/* Shimeji keep their art in a folder called img, so the name is usually the one above. */
function folderName(dir: string) {
  const parts = dir.split('/').filter(Boolean), last = parts[parts.length - 1] || '';
  const name = /^img$/i.test(last) ? parts[parts.length - 2] || '' : last;
  return (name || 'Shimeji').slice(0, NAME_MAX);
}
/* Packs keep spare art in folders under the real one, such as img/unused. */
const spare = (dir: string, dirs: string[]) => dirs.some(d => d !== dir && dir.startsWith(d + '/'));

function sortFolder(top: string, files: Handed[]): Job[] {
  const jobs: Job[] = files.filter(f => BUDDY.test(f.name)).map(file => ({ k: 'file', file }));
  const byDir = new Map<string, Handed[]>();
  for (const f of files) if (SHIME.test(f.name)) byDir.set(dirOf(f), [...byDir.get(dirOf(f)) || [], f]);
  const dirs = [...byDir.keys()];
  for (const dir of dirs) if (!spare(dir, dirs)) jobs.push({ k: 'shimeji', folder: folderName(dir), files: byDir.get(dir)! });
  return jobs.length ? jobs : [{ k: 'refused', problem: noShime1(top) }];
}

export function sortHanded(files: Handed[]): Job[] {
  const jobs: Job[] = [], tops = new Map<string, Handed[]>(), shimes: Handed[] = [];
  for (const f of files) {
    const top = f.path.includes('/') ? f.path.split('/')[0]! : '';
    if (top) tops.set(top, [...tops.get(top) || [], f]);
    else if (BUDDY.test(f.name) || JSON_FILE.test(f.name)) jobs.push({ k: 'file', file: f });
    else if (SHIME.test(f.name)) shimes.push(f);
    else jobs.push({ k: 'refused', problem: wrongKind(f.name, IMAGE.test(f.name)) });
  }
  if (shimes.length) jobs.push({ k: 'shimeji', folder: 'Shimeji', files: shimes });
  for (const [top, group] of tops) jobs.push(...sortFolder(top, group));
  return jobs;
}

function dataUrl(f: Blob) {
  return new Promise<string>((done, fail) => {
    const r = new FileReader();
    r.onload = () => done(r.result as string);
    r.onerror = () => fail(r.error);
    r.readAsDataURL(f);
  });
}
export const fromFile = (f: File, path = f.webkitRelativePath || f.name): Handed => ({ name: f.name, path, size: f.size, text: () => f.text(), url: () => dataUrl(f) });
/* From <input type=file>, with or without webkitdirectory. */
export const fromInput = (list: Iterable<File>) => [...list].map(f => fromFile(f));

async function walk(entry: FileSystemEntry, out: Handed[]) {
  if (entry.isFile) {
    const f = await new Promise<File>((done, fail) => (entry as FileSystemFileEntry).file(done, fail));
    out.push(fromFile(f, entry.fullPath.replace(/^\//, '')));
    return;
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  /* It hands over a batch at a time, until one comes back empty. */
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((done, fail) => reader.readEntries(done, fail));
    if (!batch.length) return;
    for (const e of batch) await walk(e, out);
  }
}
/* A drop's items only last until the event ends, so call this straight away. */
export function fromDrop(dropped: Pick<DataTransfer, 'items' | 'files'>): Promise<Handed[]> {
  const entries = [...dropped.items].map(i => i.webkitGetAsEntry()).filter(e => e !== null);
  if (!entries.length) return Promise.resolve(fromInput(dropped.files));
  return (async () => {
    const out: Handed[] = [];
    for (const e of entries) await walk(e, out);
    return out;
  })();
}

/* Makes `target` take drops. Without this, a dropped file is a navigation. */
export function takeDrops(target: EventTarget, f: (files: Handed[]) => void) {
  target.addEventListener('dragover', e => e.preventDefault());
  target.addEventListener('drop', e => {
    e.preventDefault();
    const dropped = (e as DragEvent).dataTransfer;
    if (dropped) void fromDrop(dropped).then(f);
  });
}
