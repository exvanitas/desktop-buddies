/* Files arriving by a drop, and what each is for. A dropped folder arrives as entries to walk. */
import { poseFromFile } from '@buddies/maker-core';

const BUDDY = /\.(buddy|json)$/i, SHIME = /shime\d+\.png$/i;

export interface Sorted { buddyFiles: File[]; shimeji: File[]; named: File[]; unnamed: File[]; other: File[] }
/* Four or more Shimeji frames are a Shimeji set, as in maker.addFiles. */
export function sortFiles(files: File[]): Sorted {
  const out: Sorted = { buddyFiles: [], shimeji: [], named: [], unnamed: [], other: [] };
  const shime = files.filter(f => SHIME.test(f.name)), isSet = shime.length >= 4;
  for (const f of files) {
    if (BUDDY.test(f.name)) out.buddyFiles.push(f);
    else if (isSet && SHIME.test(f.name)) out.shimeji.push(f);
    else if (!/^image\//.test(f.type)) out.other.push(f);
    else if (poseFromFile(f.name)) out.named.push(f);
    else out.unnamed.push(f);
  }
  return out;
}

async function walk(entry: FileSystemEntry, out: File[]) {
  if (entry.isFile) {
    const f = await new Promise<File>((done, fail) => (entry as FileSystemFileEntry).file(done, fail));
    /* so a Shimeji set can be named after its folder */
    Object.defineProperty(f, 'webkitRelativePath', { value: entry.fullPath.replace(/^\//, '') });
    out.push(f);
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
export function filesOfDrop(dropped: Pick<DataTransfer, 'items' | 'files'>): Promise<File[]> {
  const entries = [...dropped.items || []].map(i => i.webkitGetAsEntry?.()).filter(e => !!e) as FileSystemEntry[];
  if (!entries.length) return Promise.resolve([...dropped.files]);
  return (async () => {
    const out: File[] = [];
    for (const e of entries) await walk(e, out);
    return out;
  })();
}

/* Whether a drag with files is over the window, and the drop itself. `who` says which buddy it's for. A drag crosses every element
   inside, so only its way in and out count. Text and links being dragged aren't drops. */
export function watchDrops(target: Document, dragging: (on: boolean) => void, took: (read: () => Promise<File[]>, where: EventTarget | null, from: string | null) => void, signal: AbortSignal, who: () => string | null) {
  let depth = 0;
  const hasFiles = (e: Event) => [...(e as DragEvent).dataTransfer?.types || []].includes('Files');
  const set = (n: number) => { const was = depth > 0; depth = n; if (was !== depth > 0) dragging(depth > 0); };
  target.addEventListener('dragenter', e => { if (hasFiles(e)) set(depth + 1); }, { signal });
  target.addEventListener('dragleave', e => { if (hasFiles(e)) set(Math.max(0, depth - 1)); }, { signal });
  target.addEventListener('dragover', e => { e.preventDefault(); }, { signal });
  target.addEventListener('drop', e => {
    e.preventDefault(); set(0);
    const dropped = (e as DragEvent).dataTransfer;
    /* A folder takes a while to read, and a lot can change. It belongs to the buddy it was dropped on. */
    const from = who();
    /* Handed over still unread, so whoever takes it can count the reading as part of the work. */
    if (dropped) took(() => filesOfDrop(dropped), e.target, from);
  }, { signal });
}
