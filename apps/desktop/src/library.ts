/* The buddy library on disk: library/<character>/buddy.json plus its images. Pages load images
   straight from there, so buddies hold URLs, not data. Each image is named by its bytes, so a name
   never holds anything else, a page can keep what it has loaded, and a save leaves alone what's
   already there. */
import { MANIFEST, imageNames, located, pack, read, readManifest, unpack, write, type Buddy } from '@buddies/buddy-file';
import { errorKind } from './log-safe';
import { inFlight } from './in-flight';
import { text, type Listed, type Shell } from './shell';

const ROOT = 'library';
const STAGING = '.incoming';
const OUTGOING = '.outgoing'; /* the old copy, for as long as a swap takes */
const TRASH = '.trash'; /* a deleted buddy, for as long as deleting takes */
/* How many writes or deletes a save keeps out at once. The exe does them one at a time, so the order
   that matters is kept by waiting: every image before the manifest, the manifest before the move or
   the deletes. Kept low, because each one out can hold one of the exe's worker threads. */
export const IN_FLIGHT = 4;
/* A save that takes this long says in the log where its time went: counts and times, no names. */
const TIMED_MS = 1000;
const hex = (b: ArrayBuffer) => [...new Uint8Array(b, 0, 16)].map(x => x.toString(16).padStart(2, '0')).join('');
export interface Shelved { id: string; name: string; buddy: Buddy }
/* A file that's been checked and is ready to go on disk. */
export interface Prepared { id: string; name: string; manifest: string; images: { name: string; bytes: Uint8Array }[] }

/* `most`: how many writes or deletes a save keeps out, IN_FLIGHT unless a test compares. */
export function createLibrary(shell: Shell, note: (line: string) => void, now: () => number = () => performance.now(), most = IN_FLIGHT) {
  /* A folder's entries, none if it isn't there yet. It's looked for in its parent, because a failed
     listing must never read as empty: that's how a saved copy gets seeded over. */
  async function entries(dir = ROOT): Promise<Listed[]> {
    const cut = dir.lastIndexOf('/'), parent = cut < 0 ? await shell.dataList('') : await entries(dir.slice(0, cut));
    return parent.some(e => e.dir && e.name === dir.slice(cut + 1)) ? shell.dataList(dir) : [];
  }
  const has = async (dir: string, name: string) => (await entries(dir)).some(e => e.name === name);

  async function get(id: string): Promise<Shelved> {
    const b = readManifest(text(await shell.dataRead(`${ROOT}/${id}/${MANIFEST}`)));
    if (b.character !== id) throw new Error(`folder ${id} holds ${b.character}`);
    return { id, name: b.name || 'Buddy', buddy: located(b, name => `${ROOT}/${id}/${name}`) };
  }

  /* One bad folder doesn't lose the rest. */
  async function list(): Promise<Shelved[]> {
    const out: Shelved[] = [];
    for (const e of await entries()) {
      if (!e.dir || e.name.startsWith('.')) continue;
      try { out.push(await get(e.name)); }
      catch (err) { note(`library: skipped ${e.name}: ${errorKind(err)}`); }
    }
    return out;
  }

  /* Finishes a swap that stopped. A move is one step, so a home that's there is whole, and the old
     copy is done with. With no home, the old copy goes back. */
  async function settle(id: string) {
    const old = `${ROOT}/${OUTGOING}/${id}`;
    if (!await has(`${ROOT}/${OUTGOING}`, id)) return;
    if (await has(ROOT, id)) await shell.dataDelete(old);
    else await shell.dataMove(old, `${ROOT}/${id}`);
  }

  /* For the start of a run: anything a crash interrupted. Throws if a copy is still waiting, and
     it's safe to call again. */
  async function recover() {
    let waiting = 0;
    for (const e of await entries(`${ROOT}/${OUTGOING}`)) {
      await settle(e.name).catch(err => { waiting++; note(`library: couldn't recover ${e.name}: ${err}`); });
    }
    await shell.dataDelete(`${ROOT}/${STAGING}`).catch(err => note(`library: couldn't clear staging: ${err}`));
    await shell.dataDelete(`${ROOT}/${TRASH}`).catch(err => note(`library: couldn't clear ${TRASH}: ${err}`));
    if (waiting) throw new Error(`${waiting} still waiting in ${OUTGOING}`);
  }

  /* Is she on disk, whole or waiting to go back, whether or not she could be read? Throws if it can't tell. */
  const present = async (id: string) => await has(ROOT, id) || await has(`${ROOT}/${OUTGOING}`, id);

  /* A copy waiting to go back is a library, whatever else is missing. */
  async function empty() {
    return (await entries()).every(e => !e.dir || e.name.startsWith('.')) && !(await entries(`${ROOT}/${OUTGOING}`)).length;
  }

  /* Takes a file's text. Throws if it isn't a buddy, and touches nothing. */
  function prepare(file: string): Prepared {
    const buddy = read(file);
    return { id: buddy.character!, name: buddy.name || 'Buddy', ...unpack(buddy) };
  }

  /* The images under their names by bytes, and the manifest that uses them. The same bytes twice
     are one file. */
  async function named({ manifest, images }: Prepared) {
    const names = new Map<string, string>(), files = new Map<string, Uint8Array>();
    const digests = await Promise.all(images.map(f => crypto.subtle.digest('SHA-256', f.bytes as Uint8Array<ArrayBuffer>)));
    images.forEach((f, i) => {
      const name = hex(digests[i]!) + f.name.slice(f.name.lastIndexOf('.'));
      names.set(f.name, name);
      files.set(name, f.bytes);
    });
    return { manifest: write(located(readManifest(manifest), n => names.get(n)!)), files };
  }

  /* A buddy who's home is changed in place: the images she doesn't have yet, then her manifest,
     whose one rename is the moment the new copy takes over, then what she no longer uses. A stop
     before the manifest leaves the old copy whole, and after it the new one, and what's left over
     goes at the next save. A new buddy is written aside and moved in, because a folder with no
     manifest isn't a buddy. True if it replaced a buddy. */
  async function store(p: Prepared): Promise<boolean> {
    const t = trace(), home = `${ROOT}/${p.id}`;
    try {
      const { manifest, files } = await named(p);
      t.to('settling');
      await settle(p.id);
      if (!await has(ROOT, p.id)) {
        const stage = `${ROOT}/${STAGING}/${p.id}`;
        t.to('clearing staging');
        await shell.dataDelete(stage);
        await t.writes([...files], ([name, bytes]) => shell.dataWrite(`${stage}/${name}`, bytes));
        t.to('the manifest');
        await shell.dataWrite(`${stage}/${MANIFEST}`, manifest);
        t.to('the move');
        await shell.dataMove(stage, home);
        t.done();
        return false;
      }
      t.to('listing');
      const there = await shell.dataList(home), size = new Map(there.map(e => [e.name, e.size]));
      await t.writes([...files].filter(([name, bytes]) => size.get(name) !== bytes.length), ([name, bytes]) => shell.dataWrite(`${home}/${name}`, bytes));
      t.to('the manifest');
      await shell.dataWrite(`${home}/${MANIFEST}`, manifest);
      /* A WebView can hold a file open, and then Windows won't delete it. That waits for the next save. */
      let left = 0, why = '';
      t.to('deleting');
      await inFlight(there.filter(e => e.name !== MANIFEST && !files.has(e.name)), most, e => shell.dataDelete(`${home}/${e.name}`).catch(err => { left++; why = String(err); }));
      if (left) note(`library: ${left} old files of ${p.id} left for the next save: ${why}`);
      t.done();
      return true;
    } finally { t.end(); }
  }

  /* Where a save's time goes, step by step, and each image write's round trip. Said once it's over,
     if it took long enough to ask about, and asked for while it runs by `busy`, so a save that never
     ends can say where it is. Counts and times only. */
  const running = new Set<{ now(): string }>();
  function trace() {
    const start = now(), steps: string[] = [], each: number[] = [], out = new Map<number, number>();
    let step = 'hashing', since = start, of = 0, calls = 0;
    const ms = Math.round;
    const to = (next: string) => { const t = now(); steps.push(`${step} ${ms(t - since)}`); step = next; since = t; };
    const me = {
      now() {
        const t = now(), oldest = Math.min(t, ...out.values());
        return `${step} for ${ms(t - since)} ms` + (step === 'writing' ? `, ${each.length} of ${of} written, ${out.size} out, the oldest for ${ms(t - oldest)} ms` : '');
      }
    };
    running.add(me);
    return {
      to,
      async writes<T>(items: T[], f: (item: T) => Promise<unknown>) {
        to('writing'); of = items.length;
        await inFlight(items, most, async item => {
          const n = calls++, b = now(); out.set(n, b);
          try { await f(item); } finally { out.delete(n); }
          each.push(now() - b);
        });
      },
      done() {
        to('');
        const all = now() - start;
        if (all < TIMED_MS) return;
        const sorted = each.sort((a, b) => a - b), at = (q: number) => ms(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0);
        note(`library: a save took ${ms(all)} ms: ${steps.join(', ')}; ${each.length} images, ${most} at a time, each ${at(0.5)} median, ${at(0.9)} p90, ${at(1)} most`);
      },
      end() { running.delete(me); }
    };
  }
  /* What each save still running is doing now. */
  const busy = () => [...running].map(r => r.now());

  /* Is she on disk exactly as this file would put her? Images are named by their bytes, so the same
     manifest names the same images, and each of those has to be there at its size. A file damaged
     without changing its size isn't caught: that would take reading and hashing every image. False
     if it can't tell. */
  async function same(p: Prepared) {
    try {
      const home = `${ROOT}/${p.id}`, { manifest, files } = await named(p);
      if (text(await shell.dataRead(`${home}/${MANIFEST}`)) !== manifest) return false;
      const size = new Map((await shell.dataList(home)).map(e => [e.name, e.size]));
      return [...files].every(([name, bytes]) => size.get(name) === bytes.length);
    } catch { return false; }
  }

  async function add(file: string): Promise<string> {
    const p = prepare(file);
    await store(p);
    return p.id;
  }

  /* One move takes it out of the library, so a stop partway can't leave half a buddy on the shelf.
     What's left in the trash goes at the next start. */
  async function remove(id: string) {
    const trash = `${ROOT}/${TRASH}/${id}`;
    await settle(id);
    await shell.dataDelete(trash);
    await shell.dataMove(`${ROOT}/${id}`, trash);
    await shell.dataDelete(trash).catch(err => note(`library: ${id} left in ${TRASH}: ${err}`));
  }

  /* The buddy as one portable file's text, from the files her manifest names. It goes through
     `read` first, so nothing leaves that can't come back in: repeated frames are one image on disk,
     and can pass the limit once packed. */
  async function packed(id: string): Promise<string> {
    const dir = `${ROOT}/${id}`, manifest = text(await shell.dataRead(`${dir}/${MANIFEST}`)), images = new Map<string, Uint8Array>();
    for (const name of imageNames(readManifest(manifest))) images.set(name, await shell.dataRead(`${dir}/${name}`));
    const file = write(pack(manifest, name => images.get(name)));
    read(file);
    return file;
  }

  return { list, get, add, prepare, store, remove, packed, recover, empty, present, same, busy };
}
export type Library = ReturnType<typeof createLibrary>;
