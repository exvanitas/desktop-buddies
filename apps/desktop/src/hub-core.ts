/* The hub: the one page that lives for the whole run. It owns the world, the tray menu, the
   overlays, the library and the Manager's window. The exe reports facts, the Manager sends
   commands, and this decides what to do with them. It knows nothing of pages or workers: the Shell,
   `send` and the wire come in, so tests can drive it. */
import { EXTENSION, newCharacter, read, saveName, write } from '@buddies/buddy-file';
import { canDo, type BuddyData } from '@buddies/engine';
import { badFile, broke, changedSinceDelete, changedSinceImport, gone, keptAsNew, lastEditLost, notDeleted, notExported, notOpened, notReadBack, notReady, notSaved, notSet, notStored, notWritten, reason, saveOpen, tooMany, tooManyWaiting, askGone, type Failure, type Problem } from './failures';
import type { Area, Message } from './host';
import { createBuddyMenu } from './buddy-menu';
import { createLibrary, type Prepared, type Shelved } from './library';
import { createReplies } from './api-replies';
import { API_ACTIONS, LIMITS, apiArg, createLocalApi, notRunning, validApp, type ApiAction } from './local-api';
import { PLAYS, type Answer, type ApiApp, type BuddyRow, type Command, type Exported, type HubState, type Imported, type MakerOpened, type MakerSaved, type Said } from './manager-api';
import { createMakerWindows } from './maker-window';
import { createManagerWindow } from './manager-window';
import { overlayRect } from './overlay-rect';
import { createRevisions } from './revisions';
import { randomStart } from './random-start';
import { MAX_COPIES, copyId, createRoster } from './roster';
import { changes, createScreens } from './screens';
import { MIN_API, text, type Monitor, type Opened, type Shell, type System, type WindowEntry } from './shell';
import { BUDDY, menu } from './tray';
import { exeWindows, type Seen, type WindowSource } from './window-source';
import { appsIn } from './window-terrain';
import type { Wire } from './wire';

export interface HubIO {
  shell: Shell; send(m: Message): void; seed(): Promise<string | null>; after(ms: number, f: () => void): void; wire: Wire<Said>;
  /* The right-click menu's own channel, so the overlays and the menu page don't hear the Manager's and
     the Maker's traffic, which can carry whole buddy files. The main wire if none. */
  menuWire?: Wire<Said>;
  /* the exe's tracker unless told otherwise */
  windows?: WindowSource;
  /* The clock the local API's limits go by, monotonic, and a plain wait, for a deadline that
     can't hang on the exe. */
  now?: () => number; wait?: (ms: number) => Promise<void>;
}
/* `n` tells this overlay window from any other the hub opened, on its monitor or before it.
   `trace`: log what the hit test makes of the cursor, for the smoke run's hunt. */
export interface OverlayBoot { me: Area; mode: string; n: number; trace?: boolean }

const SETTINGS = 'settings.json';
const RETRY_MS = 2000, RETRY_MAX_MS = 60000; /* what failed: try again, slower each time */
const MAX_FAILURES = 20;
/* noSeed: someone has deleted a buddy, so an empty library is what they want. walk: only there when
   false. exclude: apps to stay off, by exe name in lower case. api: only there when other apps may
   ask, and apiApps the person's answer for each app that has. */
interface Settings { out?: string[]; noSeed?: boolean; walk?: boolean; exclude?: string[]; api?: boolean; apiApps?: ApiApp[] }
const MAX_API_APPS = 100;
/* A start for a request has this long to write its reply, then it quits. */
const COLD_MS = 2000;
const OK: Answer<never> = { ok: true };
/* Files waiting on a question, or sent from outside and not looked at yet, are held in memory, so
   only so many, and so much. The size is in characters of the file's text, which for a buddy file
   is about its bytes: it's JSON with its images in base64. */
const MAX_WAITING = 50, MAX_WAITING_CHARS = 256e6;
/* These wait on a person or on a page, and the tray, monitors and imports can't wait for that. */
const OFF_QUEUE: ReadonlySet<Command['k']> = new Set(['export', 'maker', 'save-page']);

/* What the app takes from the exe's raw arguments. */
export function options(args: string[]) {
  const value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const n = Number(value('--buddies'));
  /* `api`: this launch is an app asking something, which a running app answers. */
  return { mode: value('--mode') || 'demo', copies: Number.isInteger(n) && n > 0 ? Math.min(n, MAX_COPIES) : null, trace: args.includes('--trace-hits'), manager: !args.includes('--no-manager'), api: apiArg(args) };
}
const label = (a: Pick<Area, 'i'>) => 'overlay' + a.i;
/* What a settings file says, or null if it makes no sense. */
function parsed(body: string): Settings | null {
  try {
    const s = JSON.parse(body) as Settings | null;
    const fine = s !== null && typeof s === 'object' && !Array.isArray(s) && (s.out === undefined || (Array.isArray(s.out) && s.out.every(id => typeof id === 'string')));
    if (!fine) return null;
    /* A bad exclude list costs that list, not who's out, and so does a bad list of apps. */
    return { ...s, exclude: Array.isArray(s.exclude) ? s.exclude.filter(a => typeof a === 'string').map(a => a.toLowerCase()) : [], api: s.api === true, apiApps: apiAppsIn(s.apiApps) };
  } catch { return null; }
}
/* Each app once, by its name in any case, with a real answer. */
function apiAppsIn(list: unknown): ApiApp[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>(), out: ApiApp[] = [];
  for (const a of list as Partial<ApiApp>[]) {
    if (!a || typeof a !== 'object' || !validApp(a.name) || typeof a.allow !== 'boolean' || seen.has(a.name.toLowerCase())) continue;
    seen.add(a.name.toLowerCase()); out.push({ name: a.name, allow: a.allow });
  }
  return out.slice(0, MAX_API_APPS);
}
/* What the log may say about a launch's arguments: counts, and which known flags were there. Never
   a value: arguments can hold paths and a request's text. */
const FLAGS = ['--app-dir', '--data-dir', '--log', '--seconds', '--devtools', '--mode', '--buddies', '--trace-hits', '--no-manager', '--api'];
export function argsSeen(args: string[]) {
  const flags = FLAGS.filter(f => args.includes(f));
  return `args ${args.length}, files ${args.filter(a => isBuddyFile(a)).length}, flags ${flags.length ? flags.join(' ') : 'none'}`;
}
/* The exe's own test for a file to open, which arrives as `open-file`. */
const isBuddyFile = (arg: string) => /\.buddy(\.json)?$/i.test(arg);
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const byName = (a: Shelved, b: Shelved) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1);

export function createHub({ shell, send, seed, after, wire, menuWire, windows = exeWindows(shell), now = () => performance.now(), wait = sleep }: HubIO) {
  const note = (line: string) => { shell.log(line).catch(() => {}); }; /* a log that can't be written has nowhere to say so */
  /* The exe's contract, known once the hub starts. API 2 adds what docs/native-shell-design.md says. */
  let exeApi = MIN_API;
  const newer = () => exeApi >= 2;
  const library = createLibrary(shell, note), screens = createScreens(), roster = createRoster(), manager = createManagerWindow(shell, newer);
  const revisions = createRevisions();
  const makers = createMakerWindows({ shell, post: m => wire.post(m), after, refuse: p => refuse(p), note, newer });
  const closing = new Set<string>(); /* Maker windows that have said they're going, so nobody's there to ask */
  /* What each closing window's last save of a buddy came to: saved as this revision, kept beside
     her, or a failure the Manager was told of. Each is for that file. */
  const lastWords = new Map<string, { file: string; rev?: number; kept?: true; failed?: string }>();
  let shelf: Shelved[] = [], wanted: Area[] = [], copies: number | null = null, mode = 'demo', trace = false;
  let screensNow: Monitor[] = []; /* the exe's latest list, which the right-click menu is placed by */
  const applied = new Map<number, Area>(); /* the overlays that really are open, and where */
  /* each open overlay's window number, and the last one given: from a random 52-bit start, not the
     clock, which can step back, so a hub started again doesn't reuse one an overlay from before has */
  const windowOf = new Map<number, number>();
  let lastWindow = randomStart();
  const concealed = new Set<number>(); /* those of them that really are hidden */
  let retry = RETRY_MS, retrying = false, stocked = false, started = false;
  let hidden = false, paused = false, away = false, autostart = false;
  /* API 2: whether the hub wants overlays kept on top, and what the exe last said yes to. One call
     at a time, so a late answer can't undo a later wish. null: nothing yet, or the last call failed. */
  let raiseWant: boolean | null = null, raiseSent: boolean | null = null, raiseBusy = false;
  /* Wanted and not done yet, tried with everything else until it is. */
  let wantManager = false, unsaved = false, trayStale = false;
  const unread = new Map<string, string | null>(); /* imported and not read back yet, with the failure that says so */
  /* Who's out has been restored. Until then nothing changes it, so nothing can be saved over it. */
  let restored = false, waitFailure: string | null = null;
  let noSeed = false, failures: Failure[] = [], failed = 0, saving = false;
  let walk = true, exclude: string[] = [], apps: string[] = [], seen: WindowEntry[] = [], lastSeq = 0;
  let watching: boolean | null = null; /* null: nobody knows, so the next reconcile says which */
  /* The local API: on, what the person said about each app, and the apps waiting on them. */
  let apiOn = false, apiApps: ApiApp[] = [], asking: string[] = [];
  /* Files that would replace someone, until the person says, so a Manager that closes loses
     nothing. A restart drops them, and the file can be opened again. `rev` is the her that was
     asked about, so a save since isn't replaced, and `was` her name then, or null if she couldn't
     be read. `failed`: the last answer's failure, which the next answer clears. */
  interface Waiting { ask: string; id: string; was: string | null; called: string; file: Opened; call: boolean; rev: number; failed?: string }
  let waiting: Waiting[] = [];
  /* Question ids count on from a random start, as revisions do, so a page's answer to a question
     from before a restart can't be taken for one this run asked. */
  const firstAsk = randomStart();
  let asked = firstAsk;
  const ours = (ask: string) => { const n = /^r(\d+)$/.exec(ask) ? Number(ask.slice(1)) : NaN; return n > firstAsk && n <= asked; };
  /* Files queued and not looked at yet, sent from outside or by a page: they count against the same
     limits. */
  let inbound = 0, inboundChars = 0;
  const room = (chars: number) => waiting.length + inbound < MAX_WAITING && waiting.reduce((n, q) => n + q.file.content.length, inboundChars + chars) <= MAX_WAITING_CHARS;

  /* Monitor changes and imports arrive whenever they like, and opening a window takes time, so
     work goes through one at a time. */
  let queue = Promise.resolve();
  const later = (f: () => Promise<void>) => { queue = queue.then(f).catch(e => note(`hub error ${e}`)); return queue; };
  const queued = <T>(f: () => Promise<T>) => new Promise<T>((done, fail) => { void later(() => f().then(done, fail)); });

  const data = (b: Shelved, id = b.id): BuddyData => ({ ...b.buddy, id });
  function pets(): BuddyData[] {
    if (mode === 'empty') return [];
    if (copies !== null) return shelf.length ? Array.from({ length: copies }, (_, i) => data(shelf[0]!, 'b' + i)) : [];
    return shelf.flatMap(b => Array.from({ length: roster.count(b.id) }, (_, i) => data(b, copyId(b.id, i))));
  }
  const sendPets = () => send({ k: 'pets', pets: pets() });

  /* The tray and the Manager both read this, so they can't tell different stories. */
  const rows = (): BuddyRow[] => shelf.map(b => {
    const n = roster.count(b.id);
    return { id: b.id, name: b.name, image: b.buddy.base.src, status: n ? 'out' : 'home', copies: n, can: PLAYS.filter(a => canDo(b.buddy, a)), rev: revisions.of(b.id) };
  });
  const replacing = () => waiting.map(q => ({ ask: q.ask, id: q.id, name: shelf.find(b => b.id === q.id)?.name ?? q.was ?? q.called, called: q.called, file: q.file.name }));
  const state = (): HubState => ({ ready: stocked, buddies: rows(), hidden, paused, autostart, walk, exclude, apps, maker: true, failures, api: { on: apiOn, apps: apiApps, asking }, replacing: replacing() });
  const publish = () => wire.post({ k: 'state', state: state() });
  /* Her row from a copy's world id. With --buddies every copy is the first buddy. */
  const rowOf = (copy: string) => rows().find(r => r.id === (copies !== null ? shelf[0]?.id : copy.split('~')[0])) ?? null;
  const buddyMenu = createBuddyMenu({ shell, post: m => (menuWire ?? wire).post(m), note, after, row: rowOf, maker: () => true, monitors: () => screensNow,
    quiet: () => hidden || paused, run: (cmd, n) => { void answer(`menu-${n}`, cmd); }, newer });
  async function tray() {
    await shell.traySet({
      tooltip: 'Desktop Buddies', icon: 'tray.png',
      items: menu({ buddies: rows().map(b => ({ id: b.id, name: b.name, out: b.status === 'out' })), hidden, paused, autostart })
    });
    trayStale = false;
  }
  async function saveSettings() {
    await shell.dataWrite(SETTINGS, JSON.stringify({ out: roster.list(), ...(noSeed ? { noSeed } : {}), ...(walk ? {} : { walk }), ...(exclude.length ? { exclude } : {}), ...(apiOn ? { api: true } : {}), ...(apiApps.length ? { apiApps } : {}) } satisfies Settings));
    unsaved = false;
  }
  /* No file is a first run, and nothing else is. A read says nothing structured about why it failed,
     so the listing decides, and either one failing throws, to be tried again. A file that reads but
     makes no sense won't improve on a retry: it counts as read, and the defaults apply. Those don't
     seed, because it may have said the library is meant to be empty. */
  async function loadSettings(): Promise<Settings> {
    if (!(await shell.dataList('')).some(e => e.name === SETTINGS)) return {};
    const s = parsed(text(await shell.dataRead(SETTINGS)));
    if (s) return s;
    note('settings file is damaged: using defaults, and seeding nothing');
    return { noSeed: true };
  }
  const pauseWorld = () => send({ k: 'pause', on: paused || away || hidden });

  /* Windows skip the queue, which an import can hold for seconds: a window that moves can't wait
     for that. The host keeps only the latest. */
  const feed = () => send({ k: 'windows', list: walk ? seen : [], exclude });
  function windowsSeen({ seq, list }: Seen) {
    if (seq <= lastSeq) return; /* an old tracker thread can still be sending */
    lastSeq = seq;
    if (!walk) return; /* one on its way when the switch went off */
    seen = list; feed();
    const now = appsIn(list);
    if (now.join() !== apps.join()) { apps = now; publish(); }
  }
  /* The tracker runs only while it can matter. Settings come first, because they can say no. If we
     can't see windows, there are no windows. A stopped tracker's list isn't kept either, though the
     world keeps it through a pause, and the first snapshot of the next watch replaces it. What a
     source says when it fails stays out of the log, because it could name an app. */
  const wantWindows = () => restored && started && walk && !hidden && !paused && !away && pets().length > 0;
  async function watchWindows(on: boolean) {
    try { await windows.watch(on); }
    catch {
      if (on) { seen = []; feed(); }
      throw new Error(`windows watch ${on ? 'on' : 'off'} failed`);
    }
    watching = on;
    if (!on) seen = [];
    note(`windows watch ${on ? 'on' : 'off'}`);
  }

  async function openOverlay(a: Area) {
    const n = ++lastWindow;
    await shell.windowOpen({ kind: 'overlay', label: label(a), page: 'overlay.html', boot: { me: a, mode, n, ...(trace ? { trace } : {}) } satisfies OverlayBoot, ...overlayRect(a) });
    applied.set(a.i, a); windowOf.set(a.i, n); concealed.delete(a.i);
    note(`overlay ${a.i} up`);
  }
  /* The world keeps its connection until the window has really gone, because a monitor that comes
     back before a failed close is retried has to find its overlay still joined. */
  async function closeOverlay(a: Area) {
    await shell.windowClose(label(a));
    applied.delete(a.i); concealed.delete(a.i);
    send({ k: 'leave', i: a.i, n: windowOf.get(a.i)! });
    note(`overlay ${a.i} closed`);
  }
  async function placeOverlay(a: Area) {
    await shell.windowPlace(label(a), overlayRect(a));
    applied.set(a.i, a);
  }
  async function showOverlay(a: Area) {
    if (hidden) { await shell.windowHide(label(a)); concealed.add(a.i); }
    else { await shell.windowShow(label(a)); concealed.delete(a.i); }
  }

  /* Works from what's really there towards what's wanted, so whatever fails is still to do. One
     failure doesn't stop the rest. True when it all worked. */
  async function reconcile() {
    let ok = true;
    const attempt = (p: Promise<void>) => p.catch(e => { ok = false; note(`hub error ${e}`); });
    const c = changes([...applied.values()], wanted);
    for (const a of c.close) await attempt(closeOverlay(a));
    for (const a of c.place) await attempt(placeOverlay(a));
    for (const a of c.open) await attempt(openOverlay(a));
    for (const a of applied.values()) if (hidden !== concealed.has(a.i)) await attempt(showOverlay(a));
    if (wantManager) await attempt(manager.raise().then(() => { wantManager = false; }));
    for (const id of unread.keys()) await attempt(readBack(id).then(() => { trayStale = true; sendPets(); publish(); }));
    /* After anything above that can change who's out. */
    const want = wantWindows();
    if (want !== watching) await attempt(watchWindows(want));
    if (unsaved) await attempt(saveSettings());
    if (trayStale) await attempt(tray());
    return ok;
  }

  /* Reads settings, recovers and seeds the library, reads the library, and restores who's out, as
     one step that's tried again whole. Seeding only follows settings that really were read, a
     recovery that worked and a listing that really was empty. What can be read is shown either way.
     Who's out is restored once the settings and the shelf are both in, and it stays restored with
     someone not back yet, because the list names them. A list that has to be guessed from the shelf
     waits for the recovery, because whoever comes first may be the one not back. True when it's
     done. */
  async function stock() {
    let ok = true;
    const attempt = (p: Promise<void>) => p.catch(e => { ok = false; note(`library not ready: ${e}`); });
    let settings: Settings | null = null, recovered = false;
    if (!restored) await attempt(loadSettings().then(s => { settings = s; noSeed ||= !!s.noSeed; walk = s.walk !== false; exclude = s.exclude ?? []; apiOn = !!s.api; apiApps = s.apiApps ?? []; }));
    await attempt((async () => {
      await library.recover();
      recovered = true;
      if ((restored || settings) && !noSeed && await library.empty()) {
        /* A build may ship no first buddy: then the Manager's empty state is the first run. */
        const file = await seed();
        if (file === null) note('no buddy to seed in this build: the library starts empty');
        else note(`library seeded with ${await library.add(file)}`);
      }
    })());
    await attempt((async () => {
      await reload();
      if (!settings) return;
      const { out } = settings as Settings;
      roster.load(out ?? shelf.slice(0, 1).map(b => b.id));
      if (out || recovered) { restored = true; forget(waitFailure); }
    })());
    if (ok) roster.keep(new Set([...shelf.map(b => b.id), ...unread.keys()]));
    return ok;
  }

  /* Everything that's still to do, tried until it's done. The library is only tried again on the
     timer, so a monitor event can't hurry a disk that's failing. */
  async function catchUp(timer = false) {
    if (timer && !stocked) { stocked = await stock(); sendPets(); trayStale = true; publish(); }
    if (await reconcile() && stocked) { retry = RETRY_MS; return; }
    if (retrying) return;
    retrying = true;
    after(retry, () => { retrying = false; void later(() => catchUp(true)); });
    retry = Math.min(retry * 2, RETRY_MAX_MS);
  }

  /* The world hears first, so an overlay that opens finds the world it expects. It starts with the
     first real list, which may come long after the hub does: at autostart with the display asleep
     there are no monitors yet. A list with none is a display waking up or going off, not a real
     desk. */
  async function monitors(list: Monitor[]) {
    if (list.length) {
      screensNow = list;
      const next = screens.areas(list), c = changes(wanted, next);
      wanted = next;
      if (!started) { started = true; send({ k: 'start', all: next, pets: pets() }); pauseWorld(); }
      else if (c.open.length || c.close.length || c.place.length) send({ k: 'monitors', all: next });
    } else note(started ? 'monitors: empty list ignored' : 'no monitors yet: waiting for them');
    await catchUp();
  }

  async function reload() { shelf = (await library.list()).sort(byName); }
  const forget = (failure?: string | null) => { failures = failures.filter(f => f.id !== failure); };
  /* One buddy changed. Reading all of them for that is slow with 200, and `list` skips what it
     can't read, so only this can say a buddy really was read. */
  async function readBack(id: string) {
    const b = await library.get(id);
    shelf = [...shelf.filter(x => x.id !== id), b].sort(byName);
    forget(unread.get(id));
    unread.delete(id);
  }

  /* The end of every change: everyone hears, and what can't be applied now gets retried. */
  async function changed() { trayStale = true; publish(); await catchUp(); }
  async function outChanged(): Promise<Answer<never>> { unsaved = true; await changed(); return OK; }
  /* Failures are kept for whoever opens the Manager next, because the one that asked may be gone. */
  function refuse(p: Problem) {
    const failure = { ...p, id: `f${++failed}` };
    failures = [...failures, failure].slice(-MAX_FAILURES);
    /* The title holds a buddy's or a file's name, so only the kind and why go in the log. */
    note(`refused: ${p.kind}: ${p.why}`);
    publish();
    return { ok: false as const, failure };
  }
  /* Anything that changes who's out goes through this. Said once, and gone when it's ready. */
  const whenRestored = async <T>(f: () => Promise<Answer<T>>): Promise<Answer<T>> => {
    if (restored) return f();
    forget(waitFailure);
    const a = refuse(notReady());
    waitFailure = a.failure.id;
    return a;
  };
  const withBuddy = async <T>(id: string, f: (b: Shelved) => Promise<Answer<T>>): Promise<Answer<T>> => {
    const b = shelf.find(x => x.id === id);
    return b ? f(b) : refuse(gone(id));
  };

  /* A new copy is on disk: read her back, or keep trying to. */
  async function landed(id: string) {
    await readBack(id).catch(e => { note(`library: couldn't read ${id} back: ${e}`); if (!unread.has(id)) unread.set(id, null); });
  }

  /* Which of her is there now, or null for nobody. */
  const revNow = (id: string) => shelf.some(b => b.id === id) || unread.has(id) ? revisions.of(id) : null;
  /* Is she in the library, read or not? The disk decides, not the shelf. Yes if it can't tell. */
  const there = async (id: string) => shelf.some(b => b.id === id) || unread.has(id) || await library.present(id).catch(() => true);
  /* Never a file's name or what it holds: only why, in the hub's own words. */
  const importFailed = (_: Opened, p: Problem, why: string) => { note(`import failed: ${why}`); return refuse(p); };
  const unreadable = (e: string) => ['too big', 'not text', 'not a file'].includes(e) ? e : 'unreadable';

  /* `rev` null, on a retry: nobody was there, so someone there now is refused. Anything else is a
     first try, whatever an old page calls it, and if she's there it asks first. Nothing on the
     channel replaces her without the question: the pages on it are the app's own, since it's a
     same-origin BroadcastChannel that nothing outside the app folder can join. */
  async function importFile(f: Opened, call: boolean, rev: null | 'ask'): Promise<Answer<Imported>> {
    if (f.error) return importFailed(f, badFile(f.name, f.error), unreadable(f.error));
    let p: Prepared;
    try { p = library.prepare(f.content); } catch (e) { return importFailed(f, badFile(f.name, reason(e)), 'not a buddy file'); }
    if (await there(p.id)) return rev === null ? importFailed(f, changedSinceImport(f.name), 'she changed since') : ask(f, p, call);
    return put(f, p, call);
  }
  /* On disk, then read back. `lost`: the disk wouldn't take it, so nothing changed. */
  async function put(f: Opened, p: Prepared, call: boolean, lost = () => {}): Promise<Answer<Imported>> {
    let replaced: boolean;
    try { replaced = await library.store(p); } catch (e) { lost(); return { ...importFailed(f, notStored(f.name), reason(e)), rev: revNow(p.id) }; }
    revisions.changed(p.id);
    await landed(p.id);
    if (call && restored && !roster.count(p.id)) { roster.add(p.id); unsaved = true; }
    sendPets();
    await changed();
    /* It's on disk and it keeps being tried, but nobody can see it, so it isn't a success yet. */
    if (unread.has(p.id)) {
      forget(unread.get(p.id));
      note('import failed: not read back');
      const a = refuse(notReadBack(f.name));
      unread.set(p.id, a.failure.id);
      return a;
    }
    note(`imported as ${p.id}`);
    return { ok: true, value: { id: p.id, name: p.name, replaced } };
  }

  /* She's there, so the person says first. The same file again is the question already asked, and
     a file she already is changes nothing, if she can be seen: one not read back yet is asked
     about, so a Replace can store her again. */
  async function ask(f: Opened, p: Prepared, call: boolean): Promise<Answer<Imported>> {
    const value = (more: Partial<Imported>): Answer<Imported> => ({ ok: true, value: { id: p.id, name: p.name, replaced: false, ...more } });
    const twin = waiting.find(q => q.id === p.id && q.file.content === f.content);
    if (twin) { twin.call ||= call; note('import is already asked about'); return value({ asked: twin.ask }); }
    if (shelf.some(b => b.id === p.id) && !unread.has(p.id) && await library.same(p)) {
      note(`import: ${p.id} is up to date`);
      if (call && restored && !roster.count(p.id)) { roster.add(p.id); sendPets(); await outChanged(); }
      return value({ upToDate: true });
    }
    if (!room(f.content.length)) return importFailed(f, tooManyWaiting(f.name), 'too many waiting');
    const q: Waiting = { ask: `r${++asked}`, id: p.id, was: shelf.find(b => b.id === p.id)?.name ?? null, called: p.name, file: { name: f.name, content: f.content }, call, rev: revisions.of(p.id) };
    waiting = [...waiting, q];
    note(`import asks before it replaces ${p.id}`);
    publish();
    return value({ asked: q.ask });
  }
  /* Only a question still waiting can be answered, once. Replace is refused if she changed since it
     asked; if she was deleted, nothing newer is lost, so she comes in from the file. Keep both adds
     the file as a new buddy, as keepBeside does for the Maker. A disk that wouldn't take it asks
     again, so the file isn't lost. */
  async function answerReplace({ ask: id, how }: Extract<Command, { k: 'replace' }>): Promise<Answer<Imported>> {
    if (!ours(id)) { note('replace: a question from before this run'); return how === 'none' ? OK : refuse(askGone()); }
    const q = waiting.find(x => x.ask === id);
    if (!q) return OK;
    /* Only the one the Manager shows. */
    if (q !== waiting[0]) { note(`replace ${q.id}: not the question shown`); return OK; }
    waiting = waiting.filter(x => x !== q);
    forget(q.failed);
    note(`replace ${q.id}: ${how}`);
    if (how === 'none') { publish(); return OK; }
    let lost = false;
    const again = () => { lost = true; };
    let a: Answer<Imported>;
    if (how === 'both') {
      const f = { name: q.file.name, content: write({ ...read(q.file.content), character: newCharacter() }) };
      a = await put(f, library.prepare(f.content), q.call, again);
    } else {
      if (await there(q.id) && revisions.of(q.id) !== q.rev) return importFailed(q.file, changedSinceImport(q.file.name), 'she changed since it asked');
      a = await put(q.file, library.prepare(q.file.content), q.call, again);
      /* Her own Replace isn't a change behind another question's back. */
      if (!lost) for (const x of waiting) if (x.id === q.id && x.rev === q.rev) x.rev = revisions.of(q.id);
    }
    if (lost && !a.ok) { waiting = [{ ...q, failed: a.failure.id }, ...waiting]; publish(); }
    return a;
  }

  /* Every file waits its turn, and past the limit it's refused at the door, whoever sent it, so a
     flood while the disk is slow can't pile up in memory. A refusal is the failure, not a promise. */
  function admit<T>(f: Opened, job: () => Promise<T>): Promise<T> | Answer<never> {
    const chars = f.content?.length ?? 0;
    if (!room(chars)) return importFailed(f, tooManyWaiting(f.name), 'too many waiting');
    inbound++; inboundChars += chars;
    return queued(() => { inbound--; inboundChars -= chars; return job(); });
  }
  /* One sent from outside that's refused at the door shows the Manager, as any failure of one does. */
  function arrived(f: Opened) {
    if (admit(f, () => launched(f)) instanceof Promise) return;
    if (!wantManager) { wantManager = true; void later(catchUp); }
  }
  /* A file from outside, with no window open to say what's wrong with it, or to ask. */
  async function launched(f: Opened) {
    const a = await importFile(f, true, 'ask');
    note(`launch: a file, ${!a.ok ? 'failed' : a.value?.asked ? 'asks first' : 'imported'}`);
    if (a.ok && !a.value?.asked) return;
    wantManager = true;
    await catchUp();
  }

  /* Once someone has deleted a buddy, an empty library is what they want. That has to be on disk
     before the folder goes, or a stop in between seeds the first buddy over it. A stop after this just leaves
     the buddy there. False if it can't be made to last. */
  async function keepEmpty() {
    if (noSeed) return true;
    noSeed = true;
    try { await saveSettings(); return true; }
    catch (e) { noSeed = false; note(`delete failed: settings: ${reason(e)}`); return false; }
  }

  async function setHidden(on: boolean) {
    hidden = on;
    if (on) buddyMenu.close();
    await changed();
    pauseWorld();
    return OK;
  }

  /* The Maker's window, with the buddy to edit or none for a new one. This runs outside the queue,
     because a window asked to flush needs the queue for its own save. */
  function openMaker(id?: string): Promise<Answer> {
    if (id !== undefined && !shelf.some(b => b.id === id)) return Promise.resolve(refuse(gone(id)));
    return makers.request(id);
  }

  async function makerOpen(id: string): Promise<Answer<MakerOpened>> {
    const b = shelf.find(x => x.id === id);
    if (!b) return { ok: false, failure: { ...gone(id), id: 'open' } };
    try { return { ok: true, value: { file: await library.packed(id), rev: revisions.of(id) } }; }
    catch (e) { note(`maker open failed: ${id}: ${reason(e)}`); return { ok: false, failure: { ...notOpened(b.name), id: 'open' } }; }
  }

  /* An edit from the Maker, by the import's way to the disk. Refused if she changed since the window
     last heard, checked before anything is read or touched. She's looked for on disk, because the
     shelf skips what couldn't be read. A window that's open shows its own failures. If it has gone,
     which can happen at any point in here, so it's asked at each exit, nobody's left to ask: what
     it sent is kept beside her if it can be, and the Manager hears what became of it. */
  async function makerSave(c: Extract<Command, { k: 'maker-save' }>): Promise<Answer<MakerSaved>> {
    /* A window's last word repeats what may already be on its way. The same file again is done with
       if it was kept beside her, or saved with nothing changing her since. Anything else is decided
       afresh: a replacement since means it's kept beside her, and a failure is tried again. */
    const key = `${c.session}\n${c.id}`, last = lastWords.get(key);
    if (last?.file === c.file && (last.kept || (last.rev !== undefined && last.rev === revisions.of(c.id)))) { note(`maker save: ${c.id} again from a closing window, already dealt with`); return { ok: true }; }
    let kept = false;
    const answer = await decideSave(c, () => { kept = true; });
    if (!closing.has(c.session)) return answer;
    if (answer.ok && answer.value && 'rev' in answer.value) dealt(key, { file: c.file, rev: answer.value.rev });
    else if (kept) dealt(key, { file: c.file, kept: true });
    else if (!answer.ok) dealt(key, { file: c.file, failed: answer.failure.id });
    return answer;
  }
  /* What the Manager was told about a file failing before is no longer so once that same file has
     landed, or failed again and says so itself. A different edit leaves it showing. */
  function dealt(key: string, word: { file: string; rev?: number; kept?: true; failed?: string }) {
    const before = lastWords.get(key);
    lastWords.set(key, word);
    if (before?.failed && before.file === word.file) { forget(before.failed); publish(); }
  }
  async function decideSave({ id, name, file, rev, session }: Extract<Command, { k: 'maker-save' }>, kept: () => void): Promise<Answer<MakerSaved>> {
    const windowGone = () => closing.has(session);
    const no = (p: Problem) => { note(`maker save refused: ${p.why}`); return windowGone() ? refuse(lastEditLost(name)) : { ok: false as const, failure: { ...p, id: 'save' } }; };
    if (!stocked) return no(notReady());
    let there: boolean;
    try { there = await library.present(id); }
    catch (e) { note(`maker save failed: ${id}: ${reason(e)}`); return no(notWritten(name)); }
    if (!revisions.accepts(id, rev, session, there)) {
      const conflict = there ? 'replaced' : 'deleted';
      note(`maker save refused: ${id} was ${conflict}`);
      return windowGone() ? keepBeside(name, file, kept) : { ok: true, value: { conflict } };
    }
    let p: Prepared;
    try { p = library.prepare(file); } catch (e) { return no(notSaved(name, reason(e))); }
    if (p.id !== id) return no(broke('Saving'));
    try { await library.store(p); }
    catch (e) { note(`maker save failed: ${id}: ${reason(e)}`); return no(notWritten(name)); }
    const next = revisions.saved(id, session);
    await landed(id);
    sendPets();
    await changed();
    /* She's saved. It keeps trying to read her back, and the Manager's list says so meanwhile. */
    if (unread.has(id)) {
      forget(unread.get(id));
      unread.set(id, refuse(notReadBack(name)).failure.id);
    }
    note(`maker saved ${id}${windowGone() ? ' from a closing window' : ''}`);
    return { ok: true, value: { rev: next } };
  }
  async function keepBeside(name: string, file: string, kept: () => void): Promise<Answer<MakerSaved>> {
    try {
      const copy = library.prepare(write({ ...read(file), character: newCharacter() }));
      await library.store(copy);
      revisions.changed(copy.id);
      await landed(copy.id);
      await changed();
      kept();
      return refuse(keptAsNew(name));
    } catch (e) { note(`maker save failed: ${reason(e)}`); return refuse(lastEditLost(name)); }
  }

  /* As with a buddy's file, the dialog stays open as long as someone leaves it. */
  /* On API 2 the dialog belongs to the window that asked, so it stays in front of it. */
  const ownedBy = (owner?: string) => newer() && owner ? { owner } : {};
  async function savePage({ name, content, owner }: Extract<Command, { k: 'save-page' }>): Promise<Answer<Exported>> {
    if (saving) return refuse(saveOpen(name));
    saving = true;
    try {
      const done = await shell.saveAs({ name: saveName(name).replace(new RegExp(`\\.${EXTENSION}$`), '.html'), filters: [{ name: 'Web page', extensions: ['html'] }], ...ownedBy(owner), content });
      note(`page export ${done ? 'saved' : 'cancelled'}`);
      return { ok: true, value: { saved: done } };
    } catch (e) { note(`page export failed: ${reason(e)}`); return refuse(notExported(name, 'save')); }
    finally { saving = false; }
  }

  /* Try on my screen, and the small reactions an edit causes. Only `call` can bring her out. */
  const makerTry = ({ id, action, call }: Extract<Command, { k: 'maker-try' }>) => whenRestored(async () => {
    if (!shelf.some(b => b.id === id)) return call ? refuse(gone(id)) : OK;
    if (!roster.count(id)) {
      if (!call) return OK;
      roster.add(id); sendPets();
      await outChanged();
    }
    send({ k: 'act', id, a: action });
    return OK;
  });

  /* Every overlay closed and opened again, since the exe sets always on top only as one opens, then
     everyone out drops in where the cursor is. The world keeps them through it. An overlay that won't
     close carries on as it was, and one that won't open is tried again like any other. */
  async function bringEveryone(): Promise<Answer> {
    for (const a of [...applied.values()]) await closeOverlay(a).catch(e => note(`hub error ${e}`));
    await catchUp();
    const out = pets();
    for (const p of out) send({ k: 'bring', id: p.id });
    note(`brought ${out.length} here, overlays reopened`);
    return OK;
  }
  /* Every copy of her, if she's out. */
  const copiesOf = (id: string) => Array.from({ length: roster.count(id) }, (_, i) => copyId(id, i));
  /* What every copy of her does, from the Manager or another app. */
  const actOn = (id: string, a: string) => { for (const copy of copiesOf(id)) send({ k: 'act', id: copy, a }); };

  /* Other apps on this PC. They can only read who's here and ask for what API_ACTIONS and a line
     allow, and nothing they send changes a buddy, the library or settings. An app's name is
     whatever it says, so it's matched in any case, and the answer goes by the name first asked. */
  const same = (a: string) => (b: string) => a.toLowerCase() === b.toLowerCase();
  const api = createLocalApi({
    now, note,
    on: () => apiOn, ready: () => restored && stocked, paused: () => paused, hidden: () => hidden,
    consent: app => { const a = apiApps.find(x => same(app)(x.name)); return a ? a.allow ? 'allow' : 'deny' : undefined; },
    /* Nothing kept is ever dropped to make room: at capacity, nobody new is asked. */
    ask(app) {
      if (asking.some(same(app))) return 'asked';
      if (apiApps.length + asking.length >= MAX_API_APPS) return 'full';
      if (asking.length >= LIMITS.asking) return 'busy';
      asking = [...asking, app];
      publish();
      void later(showManager);
      return 'asked';
    },
    buddies: () => shelf.map(b => ({ id: b.id, name: b.name, out: roster.count(b.id) > 0, copies: roster.count(b.id), can: API_ACTIONS.filter(a => canDo(b.buddy, a)) })),
    act: (id: string, a: ApiAction) => actOn(id, a),
    say: (id, text, app) => { if (roster.count(id)) send({ k: 'say', id: copyId(id, 0), text, from: app }); }
  });
  const replies = createReplies({ shell, note });
  /* Never throws, and never opens the Manager unless there's an app to ask about. */
  function apiLaunch(raw: string) {
    try { const r = api.handle(raw); if (r) void replies.write(r); }
    catch (e) { note(`api: hub error ${e}`); }
  }

  /* What the Manager can ask for. The tray's items come through here too, except Bring everyone here,
     which any page on the channel could otherwise send. */
  const commands: { [K in Command['k']]: (c: Extract<Command, { k: K }>) => Promise<Answer> } = {
    call: ({ id }) => whenRestored(() => withBuddy(id, async () => {
      if (roster.count(id)) return OK;
      roster.add(id); sendPets();
      return outChanged();
    })),
    another: ({ id }) => whenRestored(() => withBuddy(id, async b => {
      if (!roster.add(id)) return refuse(tooMany(b.name, MAX_COPIES));
      sendPets();
      return outChanged();
    })),
    'dismiss-one': ({ id }) => whenRestored(() => withBuddy(id, async () => {
      const copy = roster.drop(id); if (copy === null) return OK;
      send({ k: 'dismiss', id: copy });
      return outChanged();
    })),
    dismiss: ({ id }) => whenRestored(() => withBuddy(id, async () => {
      for (const copy of roster.clear(id)) send({ k: 'dismiss', id: copy });
      return outChanged();
    })),
    bring: ({ id }) => withBuddy(id, async () => {
      for (const copy of copiesOf(id)) send({ k: 'bring', id: copy });
      return OK;
    }),
    act: ({ id, action }) => withBuddy(id, async () => { actOn(id, action); return OK; }),
    import: c => importFile({ name: c.name, content: c.content }, !!c.call, c.rev),
    replace: answerReplace,
    export: ({ id, owner }) => exportBuddy(id, owner),
    delete: ({ id, rev }) => whenRestored(() => withBuddy(id, async b => {
      if (rev !== revisions.of(id)) return refuse(changedSinceDelete(b.name));
      if (!await keepEmpty()) return refuse(notDeleted(b.name, 'settings'));
      try { await library.remove(id); }
      catch (e) { note(`delete failed: ${id}: ${reason(e)}`); return refuse(notDeleted(b.name, 'files')); }
      for (const copy of roster.clear(id)) send({ k: 'dismiss', id: copy });
      revisions.changed(id);
      shelf = shelf.filter(x => x.id !== id);
      forget(unread.get(id));
      unread.delete(id);
      note(`deleted ${id}`);
      return outChanged();
    })),
    hide: ({ on }) => setHidden(on),
    pause: async ({ on }) => { paused = on; if (on) buddyMenu.close(); pauseWorld(); await changed(); return OK; },
    autostart: async ({ on }) => {
      try { autostart = await shell.autostart(on); }
      catch (e) { note(`autostart failed: ${reason(e)}`); return refuse(notSet('Start with Windows')); }
      await changed();
      return OK;
    },
    /* Either way the tracker is told again, so turning it on is a new watch with a first snapshot,
       even if the stop never got through. */
    walk: ({ on }) => whenRestored(async () => {
      if (on === walk) return OK;
      walk = on; seen = []; watching = null;
      feed();
      return outChanged();
    }),
    exclude: ({ app, on }) => whenRestored(async () => {
      const name = app.toLowerCase(), others = exclude.filter(a => a !== name);
      exclude = on ? [...others, name].sort() : others;
      if (seen.length) feed(); /* with no list yet, it goes with the first snapshot */
      return outChanged();
    }),
    api: ({ on }) => whenRestored(async () => {
      if (on === apiOn) return OK;
      apiOn = on;
      if (!on) asking = [];
      return outChanged();
    }),
    /* Only an app that's waiting can be answered, and by the name it asked with. */
    'api-answer': ({ app, allow }) => whenRestored(async () => {
      const name = asking.find(same(app));
      if (name === undefined) return OK;
      asking = asking.filter(a => a !== name);
      apiApps = [...apiApps.filter(a => !same(name)(a.name)), { name, allow }];
      return outChanged();
    }),
    'api-forget': ({ app }) => whenRestored(async () => {
      apiApps = apiApps.filter(a => !same(app)(a.name));
      return outChanged();
    }),
    maker: ({ id }) => openMaker(id),
    'maker-open': ({ id }) => makerOpen(id),
    'maker-save': makerSave,
    'maker-try': makerTry,
    'save-page': savePage,
    report: async ({ problem }) => { note('import failed: a page couldn\'t read a file'); return refuse(problem); },
    clear: async ({ id }) => { failures = id ? failures.filter(f => f.id !== id) : []; publish(); return OK; }
  };
  /* async, so a command nobody knows is answered as broken, not left hanging */
  const run = async (c: Command) => commands[c.k](c as never);

  /* Only reading the buddy holds the queue. The dialog stays open for as long as someone leaves it,
     and the tray, monitors and imports can't wait for that. */
  async function exportBuddy(id: string, owner?: string): Promise<Answer<Exported>> {
    const packed = await queued(() => withBuddy<{ name: string; file: string }>(id, async b => {
      if (saving) return refuse(saveOpen(b.name));
      saving = true; /* before anything waits, so a second dialog can't start in the gap */
      try { return { ok: true, value: { name: b.name, file: await library.packed(id) } }; }
      catch (e) { saving = false; note(`export failed: ${id}: ${reason(e)}`); return refuse(notExported(b.name, 'read')); }
    }));
    if (!packed.ok) return packed;
    const { name, file } = packed.value!;
    try {
      const done = await shell.saveAs({ name: saveName(name), filters: [{ name: 'Buddy file', extensions: [EXTENSION] }], ...ownedBy(owner), content: file });
      note(`export ${done ? 'saved' : 'cancelled'}: ${id}`);
      return { ok: true, value: { saved: done } };
    } catch (e) { note(`export failed: ${id}: ${reason(e)}`); return refuse(notExported(name, 'save')); }
    finally { saving = false; }
  }

  /* Whoever asked may have gone by the time it's done, and the work finishes regardless. */
  async function answer(id: string, c: Command) {
    /* An import's name is a file's, and stays out. */
    note(`manager ${c.k} ${'id' in c ? c.id || '' : 'name' in c && c.k !== 'import' ? c.name : ''}`.trimEnd());
    const work = OFF_QUEUE.has(c.k) ? run(c)
      : c.k === 'import' ? Promise.resolve(admit(c, () => run(c)))
      : queued(() => run(c));
    const done = await work.catch((e: unknown) => { note(`hub error ${e}`); return refuse(broke(c.k)); });
    wire.post({ k: 'done', id, answer: done });
  }
  function heard(m: Said) {
    if (m.k === 'hello') publish();
    else if (m.k === 'do') void answer(m.id, m.cmd);
    else if (m.k === 'maker-hello' || m.k === 'maker-left') makers.heard(m);
    /* Not through the queue: what it sent before this is still in there, and has to know. */
    else if (m.k === 'maker-leaving') closing.add(m.session);
    else if (m.k.startsWith('menu-')) buddyMenu.heard(m);
  }

  async function showManager() { wantManager = true; await catchUp(); }

  async function trayChoice(id: string) {
    if (id.startsWith(BUDDY)) {
      const b = id.slice(BUDDY.length);
      if (!restored) return note('tray: still getting ready');
      await run(roster.count(b) ? { k: 'dismiss', id: b } : { k: 'call', id: b });
    }
    else if (id === 'manager') await showManager();
    else if (id === 'bring') await bringEveryone();
    else if (id === 'hide') await run({ k: 'hide', on: !hidden });
    else if (id === 'pause') await run({ k: 'pause', on: !paused });
    else if (id === 'autostart') await run({ k: 'autostart', on: !autostart });
    else if (id === 'library') await shell.openDataFolder();
    else note(`tray: unknown item ${id}`);
  }
  /* A checked item ticks itself when clicked, so one that changed nothing has to be put right. */
  async function trayItem(id: string) {
    await trayChoice(id);
    await tray().catch(() => { trayStale = true; return catchUp(); });
  }
  function system(s: System) {
    const now = s.userState === 'away';
    if (now !== away) { away = now; note(`user ${now ? 'away' : 'back'}`); pauseWorld(); void later(catchUp); }
    /* API 2: buddies are kept on top while nothing is full screen, so a game or a presentation never
       has them pushed over it. */
    if (newer()) { raiseWant = s.userState === 'normal'; void sendRaise(); }
  }
  async function sendRaise() {
    if (raiseBusy) return;
    raiseBusy = true;
    try {
      while (raiseWant !== null && raiseWant !== raiseSent) {
        const on = raiseWant;
        try { await shell.raise(on); raiseSent = on; }
        catch (e) { raiseSent = null; note(`raise failed: ${reason(e)}`); break; }
      }
    } finally { raiseBusy = false; }
  }

  async function start() {
    const info = await shell.info();
    if (info.api < MIN_API) {
      note(`this app needs exe api ${MIN_API}, and the exe has ${info.api}`);
      await shell.traySet({ tooltip: 'Desktop Buddies needs a newer exe' });
      return;
    }
    exeApi = info.api;
    note(`exe api ${info.api}`);
    const o = options(info.args);
    /* Another app asked, and nothing was running to answer: say so and go, with nothing opened,
       read, seeded or called out. */
    if (o.api !== null) {
      const r = notRunning(o.api);
      const work = (r ? replies.write(r) : Promise.resolve()).catch(e => note(`api: hub error ${e}`));
      const late = await Promise.race([work.then(() => false), wait(COLD_MS).then(() => true)]);
      note(`api: started by a request, so not running${r ? '' : ', no reply'}${late ? ', and it ran out of time' : ''}`);
      await shell.quit();
      return;
    }
    ({ mode, copies, trace } = o);

    /* Listening starts inside the queue's first job, so nothing an event queues can run ahead of
       it. It has to start before take_opened, or a file sent as an event would be missed. */
    await later(async () => {
      wire.listen(heard);
      menuWire?.listen(m => { if (m.k.startsWith('menu-')) buddyMenu.heard(m); });
      await shell.on('cursor', c => send({ k: 'cursor', ...c }));
      await shell.on('monitors', list => { void later(() => monitors(list)); });
      await shell.on('tray', e => { void later(() => trayItem(e.id)); });
      await shell.on('tray-click', () => { void later(showManager); });
      await shell.on('system', system);
      try { await windows.listen(windowsSeen); } catch { note('windows listen failed'); }
      await shell.on('open-file', arrived);
      if (newer()) await shell.on('window-closed', e => makers.closed(e.label));
      await shell.on('second-launch', e => {
        const asked = apiArg(e.args);
        if (asked !== null) return apiLaunch(asked);
        note(`second launch: ${argsSeen(e.args)}`);
        if (!e.args.some(isBuddyFile)) void later(showManager);
      });

      stocked = await stock();
      autostart = await shell.autostart();
      system(await shell.system());
      trayStale = true;
      await monitors(await shell.monitors());
      const opened = await shell.takeOpened();
      for (const f of opened) await launched(f);
      /* The Manager opens with the app. Not at sign-in, which is the only way Start with Windows runs
         it, since its Run entry carries no flag. A file at launch has its own way. */
      if (o.manager && !autostart && !opened.length && !info.args.some(isBuddyFile)) await showManager();
      publish();
      note(`hub up: ${wanted.length} monitors, ${shelf.length} in the library, ${pets().length} out`);
    });
  }

  return { start, get settled() { return queue; } };
}
