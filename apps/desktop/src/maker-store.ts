/* The Maker's store in the app: the hub keeps the library, and this keeps the page's side of it.
   `state.pets` holds only who was opened in this window. Each buddy has a slot that remembers what's
   on disk, as text. `send` is the one way anything goes to the hub: it reads the newest state, gives
   a copy her own character, and sends what really differs, one write at a time per buddy. The state
   is the newest edit, so what's waiting is never a stale copy. A failure changes nothing here, and
   the edit stays in the state. */
import { newCharacter, read, write } from '@buddies/buddy-file';
import { DEFAULT_KIT, type MakerBuddy, type MakerState, type MakerStore, type Saved } from '@buddies/maker-core';
import { changedElsewhere, notOpened, silent, type Problem } from './failures';
import type { Answer, Command, MakerOpened, MakerSaved, Said } from './manager-api';
import type { Wire } from './wire';

export const QUIET_MS = 1000; /* after the last change */
export const CEILING_MS = 10000; /* from the first change, however busy the window stays */
const ANSWER_MS = 30000;

/* What the view is told. Also in packages/maker-view, which this has to keep matching. */
export interface SaveAction { label: string; run(): void }
export type SaveState =
  | { kind: 'saved' } | { kind: 'saving' }
  | { kind: 'failed'; title: string; why: string; fix: string; actions?: SaveAction[] };

export interface HubStoreIO {
  wire: Wire<Said>;
  /* unique to this window */
  session: string;
  /* who this window opened with, if anyone */
  open?: string;
  /* Runs `f` after `ms`, and returns what cancels it. */
  after(ms: number, f: () => void): () => void;
  /* anything else the hub says */
  heard?(m: Said): void;
  /* Asks maker-core for whatever it's holding back on its own pause. */
  handOver?(): void;
}

const ordered = (_: string, v: unknown) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)) : v;
/* A buddy, to compare with what's on disk. Reading a kit fills in its defaults on the buddy and the
   order of keys depends on what was edited last, and neither is an edit. */
export function canon({ id: _, ...p }: MakerBuddy) {
  return JSON.stringify({ ...p, kit: { ...DEFAULT_KIT, ...p.kit } }, ordered);
}

interface Write { text: string; late: boolean }
interface Slot {
  /* the text on disk, and the revision it is. Nothing yet for a buddy with no library entry. */
  base: string | null; rev: number | null;
  /* the write that's out, and whether it has been out so long the window was told */
  out: Write | null;
  /* the text that failed, which isn't sent again until it changes or someone asks */
  refused: string | null;
  failure: Problem | null; conflict: 'deleted' | 'replaced' | null;
  /* her id in this window's state */
  pet: string; name: string;
  /* made in this window, not opened in it, and whether Undo has taken her back since */
  made: boolean; undone?: true;
}
const fresh = (pet: string, name: string, made = false): Slot => ({ base: null, rev: null, out: null, refused: null, failure: null, conflict: null, pet, name, made });
const pending = (s: Slot) => !!s.out && !s.out.late;
interface Shown { problem: Problem; actions: SaveAction[] }

export function createHubStore(io: HubStoreIO) {
  const slots = new Map<string, Slot>(), waiting = new Map<string, (a: Answer) => void>(), onWorking = new Map<string, () => void>(), watchers = new Set<(s: SaveState) => void>();
  const saves: ((clean: boolean) => void)[] = [], flushes: ((clean: boolean) => void)[] = [], idlers: (() => void)[] = [];
  let latest: MakerState | null = null, sent = 0, dirty = false, gonePage = false, paused = false, discarding = false, handles = 0;
  let stop: (() => void) | null = null, cap: (() => void) | null = null;
  /* Writes sent and not answered, however late. A reply timeout lets the next edit go, but the
     write is still out there until its answer comes. */
  let unanswered = 0;
  let notice: Shown | null = null, told: SaveState = { kind: 'saved' };
  /* A window's name for a buddy, which is never her character: that can change under her, and the
     buddy she was copied from can come back to this window. */
  const handle = () => `h${++handles}`;

  const named = (p: MakerBuddy) => p.name || 'Buddy';
  const stopTimers = () => { stop?.(); stop = null; cap?.(); cap = null; };
  function waitQuiet() { stop?.(); stop = io.after(QUIET_MS, () => { stop = null; send(); }); }
  function waitCeiling() { cap ??= io.after(CEILING_MS, () => { cap = null; send(); }); }

  /* `working`: the hub says it's still on this one and getting somewhere. */
  function post<T>(cmd: Command, done: (a: Answer<T>) => void, working?: () => void) {
    const id = `${io.session}:${++sent}`;
    waiting.set(id, a => { waiting.delete(id); onWorking.delete(id); done(a as Answer<T>); });
    if (working) onWorking.set(id, working);
    io.wire.post({ k: 'do', id, cmd });
  }
  /* A wait for an answer that starts again each time the hub says it's getting somewhere. */
  function patience(ms: number, gaveUp: () => void) {
    let cancel = io.after(ms, gaveUp);
    return { stop: () => cancel(), again: () => { cancel(); cancel = io.after(ms, gaveUp); } };
  }
  /* For anything else than a save, which is allowed to answer late. */
  function ask<T>(cmd: Command, ms = ANSWER_MS) {
    return new Promise<Answer<T>>(done => {
      const wait = ms ? patience(ms, () => done({ ok: false, failure: { ...silent('Desktop Buddies'), id: 'silent' } })) : null;
      post<T>(cmd, a => { wait?.stop(); done(a); }, wait?.again);
    });
  }
  io.wire.listen(m => {
    if (m.k === 'done') waiting.get(m.id)?.(m.answer);
    else if (m.k === 'working') onWorking.get(m.id)?.();
    else io.heard?.(m);
  });

  function status(): SaveState {
    const bad = [...slots.values()].find(s => s.failure);
    const failed = bad?.failure ? { problem: bad.failure, actions: actionsFor(bad) } : notice;
    if (failed) {
      const { title, why, fix } = failed.problem, { actions } = failed;
      return { kind: 'failed', title, why, fix, ...(actions.length ? { actions } : {}) };
    }
    return dirty || stop || [...slots.values()].some(pending) ? { kind: 'saving' } : { kind: 'saved' };
  }
  function actionsFor(s: Slot): SaveAction[] {
    if (s.conflict) return [{ label: 'Keep as a new buddy', run: () => keepAsNew(s) }];
    return s.failure?.again ? [{ label: s.failure.again, run: () => { void flush(); } }] : [];
  }
  function tell() {
    const now = status();
    if (JSON.stringify(now) === JSON.stringify(told)) return;
    told = now;
    for (const f of watchers) f(now);
  }

  function attempt(slot: Slot, text: string, cmd: Command) {
    const mine: Write = { text, late: false };
    slot.out = mine;
    /* A reply can be lost, so this doesn't wait for ever. The next edit or a retry can go, and the
       hub takes it, because the last thing written to her was this window's own. */
    /* While the hub says it's getting somewhere, the wait starts again: a slow disk isn't a lost reply. */
    const wait = patience(ANSWER_MS, () => {
      mine.late = true;
      /* Nobody knows what's on disk now, so whatever's next goes, even if it's what she was. */
      if (slot.out === mine) { slot.base = null; slot.failure = silent('Saving'); slot.refused = text; }
      tell(); settle();
    });
    unanswered++;
    post<MakerSaved>(cmd, a => {
      if (--unanswered === 0) for (const f of idlers.splice(0)) f();
      wait.stop();
      const current = slot.out === mine;
      /* An older write answering late changes nothing: the one that replaced it will say what's so. */
      if (current) {
        slot.out = null;
        if (!a.ok) { slot.failure = a.failure; slot.refused = text; }
        else if (a.value && 'conflict' in a.value) { slot.conflict = a.value.conflict; slot.failure = changedElsewhere(slot.name, a.value.conflict); slot.refused = text; }
        else { slot.base = text; slot.failure = null; slot.refused = null; if (a.value) slot.rev = a.value.rev; }
      }
      for (const [c, s] of slots) if (!s.out && !latest?.pets.some(p => p.character === c)) drop(c, s);
      if (dirty && !stop) send();
      else { tell(); settle(); }
    }, () => { if (!mine.late) wait.again(); });
  }

  /* The one way out. `force` tries again what failed, and `leaving` is a page's last word: nothing it
     sends can be answered, and an answer already on its way may never come, so everything not yet
     confirmed goes again, refused or out or not. The hub knows a repeat when it sees one. */
  function send({ force = false, leaving = false } = {}) {
    stopTimers();
    const S = latest; if (!S || gonePage || (paused && !leaving)) return;
    dirty = false;
    const here = new Set<string>();
    for (const p of S.pets) {
      /* Two with one character would share a folder: a file brought in twice, say. A later one is her own buddy. */
      if (!p.character || here.has(p.character)) p.character = newCharacter();
      here.add(p.character);
    }
    for (const [c, s] of slots) if (!here.has(c) && !s.out) drop(c, s);
    for (const p of S.pets) {
      const c = p.character!;
      if (!slots.has(c)) slots.set(c, fresh(p.id, named(p), true));
      const slot = slots.get(c)!;
      slot.pet = p.id; slot.name = named(p);
      if (slot.conflict && !leaving) continue;
      if (pending(slot) && !leaving) { dirty = true; continue; }
      const text = canon(p);
      /* What's on disk is only known while nothing's out. With a write unanswered, a last word sends
         her as she is, even if that's what the disk had before. */
      if (text === slot.base && !(leaving && slot.out)) { slot.failure = null; slot.refused = null; continue; }
      if (text === slot.refused && !force && !leaving) continue;
      attempt(slot, text, { k: 'maker-save', id: c, name: slot.name, file: write(p), rev: slot.rev, session: io.session });
    }
    tell(); settle();
  }

  /* She's left this window, and stays in the library, unless she was made here and Undo took her
     back: then she goes from the library too, as the very her this window saved. The hub refuses
     that once anything else has changed her. One the library has nothing of, or that changed
     elsewhere, is left alone. */
  function drop(c: string, s: Slot) {
    slots.delete(c);
    if (!s.made || !s.undone || s.rev === null || s.conflict || gonePage) return;
    post({ k: 'delete', id: c, rev: s.rev }, () => {});
  }

  /* Everyone waiting to hear hears, once nothing's left out there. */
  function settle() {
    const all = [...slots.values()];
    if (all.some(pending)) return;
    const clean = !all.some(s => s.failure || s.out);
    for (const f of flushes.splice(0)) f(clean);
    if (!stop && !dirty) for (const f of saves.splice(0)) f(clean);
  }

  /* Sends what differs now, with whatever maker-core is holding on its own pause, and whatever failed
     before, and says when it has all been answered: true if it's all on disk. Waits as long as the hub
     has to answer, which starts again each time it says it's working. An edit made after this is the next autosave's, and Close stops input first. */
  function flush(): Promise<boolean> {
    if (!latest) return Promise.resolve(true);
    if (gonePage || paused) return Promise.resolve(false);
    io.handOver?.();
    return new Promise<boolean>(done => { flushes.push(done); send({ force: true }); });
  }

  /* The page is going and can't wait. The hub hears first, so anything of this window's it hasn't
     got to yet is handled as if nobody's left to ask, which is now true. */
  function lastGasp() {
    if (!latest || discarding) return;
    io.wire.post({ k: 'maker-leaving', session: io.session });
    send({ leaving: true });
    gonePage = true;
  }

  /* Nothing goes out for now, as Close waits for image work: what's half done isn't sent. A last word
     still can. Taken back, what's waiting goes. */
  function pause(on: boolean) {
    paused = on;
    if (!on && dirty) send();
  }
  /* Someone chose to leave without saving, which isn't so until the window has gone. Till then it's
     only held back. */
  function discard(on: boolean) { discarding = on; if (on) paused = true; }

  function keepAsNew(slot: Slot) {
    const S = latest, p = S?.pets.find(x => x.id === slot.pet); if (!p) return;
    p.character = newCharacter(); /* her old slot goes with the next send */
    void flush();
  }

  function adopt(id: string, a: MakerOpened, pet: string): MakerBuddy {
    const buddy = read(a.file), p: MakerBuddy = { ...buddy, id: pet };
    slots.set(id, { ...fresh(pet, named(p)), base: canon(p), rev: a.rev });
    return p;
  }
  function failedOpen(a: Answer<MakerOpened>, what: string, again?: () => void) {
    const problem: Problem = a.ok ? notOpened(what) : a.failure;
    notice = { problem, actions: again ? [{ label: 'Try again', run: again }] : [] };
    tell();
  }
  /* Her file from the hub, or null if the status now says why not. Never rejects: a load that fails
     in maker-core opens an empty Maker, with nothing saying why. */
  async function fetched(id: string, pet: string, again?: () => void): Promise<MakerBuddy | null> {
    const a = await ask<MakerOpened>({ k: 'maker-open', id });
    try {
      if (a.ok && a.value) { notice = null; const p = adopt(id, a.value, pet); tell(); return p; }
    } catch { /* her file came back wrong, which is the failure below */ }
    failedOpen(a, id, again);
    return null;
  }

  const same = (S: MakerState) => S.pets.every(p => !!p.character && slots.get(p.character)?.base === canon(p));

  /* Marked now, and gone from the library once her slot goes, after any write still out. */
  function takeBack(pets: MakerBuddy[]) {
    for (const p of pets) { const slot = p.character ? slots.get(p.character) : undefined; if (slot?.made && slot.pet === p.id) slot.undone = true; }
  }
  const store: MakerStore = {
    takeBack,
    async load(): Promise<Saved> {
      const ids = latest ? [...slots].map(([c, s]) => [c, s.pet] as const) : io.open ? [[io.open, handle()] as const] : [];
      const each = await Promise.all(ids.map(([c, pet]) => fetched(c, pet)));
      return { started: true, pets: each.filter((p): p is MakerBuddy => !!p) };
    },
    /* Resolves once it's on disk, and rejects if it can't be. The view hears the words from onSave. */
    save(state) {
      /* Opening calls this straight away, and nothing has changed, so nothing should say Saving. */
      if (!latest && same(state)) { latest = state; return Promise.resolve(); }
      latest = state;
      notice = null;
      dirty = true;
      waitQuiet();
      tell();
      return new Promise<boolean>(done => { saves.push(done); settle(); }).then(clean => { if (!clean) throw new Error('not saved'); });
    }
  };

  return {
    ...store, takeBack, flush, lastGasp, pause, discard,
    /* Nothing waiting to go and nothing out. */
    settled: () => !dirty && !stop && !cap && ![...slots.values()].some(pending),
    /* When every write sent has been answered, however late. */
    idle: () => new Promise<void>(done => { if (unanswered) idlers.push(done); else done(); }),
    /* Something changed, maybe an edit, maybe a panel: telling those apart means comparing, which is
       too slow to do each time on a big buddy. A change holds back a write that's waiting, but none
       of them can put it off past the ceiling, and that's when typing with no pauses gets compared. */
    touched() {
      waitCeiling();
      if (stop) waitQuiet();
    },
    /* Her for this window: the one it holds, or a fresh read. */
    async open(id: string, again?: () => void) {
      const had = slots.get(id) && latest?.pets.find(p => p.character === id);
      return had || fetched(id, handle(), again);
    },
    /* The character a pet in this window goes by, which is what the hub knows her as. */
    characterOf: (pet: string) => latest?.pets.find(p => p.id === pet)?.character ?? null,
    /* On disk, as far as this window knows? */
    stored(pet: string) { const c = latest?.pets.find(p => p.id === pet)?.character; return !!c && slots.get(c)?.rev != null; },
    /* Shows something that isn't a save but belongs in the same place. Goes at the next change. */
    say(problem: Problem, actions: SaveAction[] = []) { notice = { problem, actions }; tell(); },
    onSave(f: (s: SaveState) => void) { watchers.add(f); f(told); return () => { watchers.delete(f); }; },
    ask,
    post: (m: Said) => io.wire.post(m)
  };
}
export type HubStore = ReturnType<typeof createHubStore>;
