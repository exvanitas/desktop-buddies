/* The Manager's logic, with no interface in it. Any view can sit on this: read `state`, subscribe
   to changes, and call the methods. Each method resolves to an Answer, and every failure also
   lands in `state.failures`, so a view can show them all in one place.

   The hub owns everything. This holds nothing worth keeping, so a window can close at any moment:
   the hub finishes what it was sent, and the next window reads the result from its state. */
import { LIMIT, newCharacter, write, type Buddy } from '@buddies/buddy-file';
import { badFile, badShime, noShime1, reason, silent, type Failure, type Problem } from './failures';
import { sortHanded, type Handed, type Job } from './handed';
import type { Answer, Command, Exported, HubState, Imported, ReplaceHow, Said } from './manager-api';
import { MANAGER } from './manager-window';
import type { Wire } from './wire';

export interface ClientIO {
  wire: Wire<Said>;
  /* unique to this window, so an answer meant for one that closed is never taken for ours */
  session: string;
  /* Runs `f` after `ms`, and returns what cancels it. */
  after(ms: number, f: () => void): () => void;
  /* fromShimeji in @buddies/art. It needs a canvas, so the page hands it in. */
  shimeji(files: { name: string; src: string }[]): Promise<Buddy | null>;
  closeWindow(): Promise<void>;
}
const HELLO_MS = 500, ANSWER_MS = 30000;

export function createManagerClient(io: ClientIO) {
  const waiting = new Map<string, (a: Answer) => void>(), listeners = new Set<(s: HubState) => void>();
  let hub: HubState | null = null, sent = 0, local: Failure[] = [], stopHello = () => {};

  const current = (): HubState | null => hub && { ...hub, failures: [...hub.failures, ...local] };
  const tell = () => { const s = current(); if (s) for (const f of listeners) f(s); };

  /* With no hub to keep it, a failure stays here. */
  function unanswered(cmd: Command): Answer<never> {
    const failure = { ...silent(cmd.k), id: `${io.session}-${++sent}` };
    local = [...local, failure]; tell();
    return { ok: false, failure };
  }
  /* `patient` is for a command that waits on a person, not on the hub. */
  function send<T>(cmd: Command, patient = false) {
    const id = `${io.session}:${++sent}`;
    return new Promise<Answer<T>>(done => {
      const stop = patient ? () => {} : io.after(ANSWER_MS, () => { waiting.delete(id); done(unanswered(cmd)); });
      waiting.set(id, a => { stop(); waiting.delete(id); done(a as Answer<T>); });
      io.wire.post({ k: 'do', id, cmd });
    });
  }

  io.wire.listen(m => {
    if (m.k === 'state') { stopHello(); hub = m.state; tell(); }
    else if (m.k === 'done') waiting.get(m.id)?.(m.answer);
  });
  /* The hub only speaks when something changes, so a new window has to ask. */
  (function hello() {
    if (hub) return;
    io.wire.post({ k: 'hello' });
    stopHello = io.after(HELLO_MS, hello);
  })();

  const report = (problem: Problem) => send<Imported>({ k: 'report', problem });

  async function shimeji(folder: string, files: Handed[], call?: boolean) {
    let made: Buddy | null;
    try { made = await io.shimeji(await Promise.all(files.map(async f => ({ name: f.name, src: await f.url() })))); }
    catch { return report(badShime(folder)); }
    if (!made) return report(noShime1(folder));
    return send<Imported>({ k: 'import', name: `${folder}.buddy`, content: write({ ...made, name: folder, character: newCharacter() }), call, rev: 'ask' });
  }
  async function file(f: Handed, call: boolean | undefined, rev: null | 'ask') {
    if (f.size > LIMIT.file) return report(badFile(f.name, 'too big')); /* read would say the same, once it had all of it in memory */
    let content: string;
    try { content = await f.text(); } catch (e) { return report(badFile(f.name, reason(e))); }
    return send<Imported>({ k: 'import', name: f.name, content, call, rev });
  }
  async function importAll(files: Handed[], call: boolean | undefined, rev: null | 'ask') {
    const answers: (Answer<Imported> & { files: Handed[] })[] = [];
    for (const j of sortHanded(files)) answers.push({ ...await job(j, call, rev), files: handedIn(j) });
    return answers;
  }
  const handedIn = (j: Job) => j.k === 'file' ? [j.file] : j.k === 'shimeji' ? j.files : [];
  function job(j: Job, call: boolean | undefined, rev: null | 'ask') {
    if (j.k === 'refused') return report(j.problem);
    return j.k === 'shimeji' ? shimeji(j.folder, j.files, call) : file(j.file, call, rev);
  }

  return {
    get state() { return current(); },
    /* Called with each new state, and straight away if there is one. Returns what stops it. */
    subscribe(f: (s: HubState) => void) {
      listeners.add(f);
      const s = current(); if (s) f(s);
      return () => { listeners.delete(f); };
    },

    /* Out on the desktop. Calling a buddy that's already out does nothing. */
    call: (id: string) => send({ k: 'call', id }),
    callAnother: (id: string) => send({ k: 'another', id }),
    /* Dismiss means every copy, as the tray does. The owner hasn't ruled on this: a view that wants
       the other meaning has dismissOne, which takes the newest copy. */
    dismiss: (id: string) => send({ k: 'dismiss', id }),
    dismissOne: (id: string) => send({ k: 'dismiss-one', id }),
    /* Every copy of her, to the cursor. Nothing happens for someone at home. */
    bringHere: (id: string) => send({ k: 'bring', id }),
    giveTreat: (id: string) => send({ k: 'act', id, action: 'eat' }),
    chaseMouse: (id: string) => send({ k: 'act', id, action: 'chase' }),

    /* `.buddy` and `.buddy.json` files, and Shimeji folders, from fromInput or takeDrops. One at a
       time, so a big drop stays small in memory, with one answer each. One that would replace
       someone replaces nobody: it's answered `asked`. A window that closes partway
       stops the rest. `call` brings each one out. Each answer carries its own files, so trying one
       again sends only those, through retryImport. */
    importFiles: (files: Handed[], o: { call?: boolean } = {}) => importAll(files, o.call, 'ask'),
    /* A file that would replace someone is answered `asked`, and waits in `state.replacing` for
       this. Replace's answer says if she was replaced, and Keep both's is the new buddy. */
    answerReplace: (ask: string, how: ReplaceHow) => send<Imported>({ k: 'replace', ask, how }),
    /* Trying again, with `rev` from the failure: null means nobody was there, so anyone there now
       is refused. Otherwise anyone it would replace is asked about, as on a first try. A Shimeji
       folder is a new buddy each time, so nobody is replaced. */
    retryImport: (files: Handed[], rev: number | null) => importAll(files, undefined, rev === null ? null : 'ask'),
    /* Cancelling the save window is a saved: false answer, not a failure. */
    exportBuddy: (id: string) => send<Exported>({ k: 'export', id, owner: MANAGER.label }, true),
    /* Only the her that was confirmed: one a save or an import has changed since is refused. */
    deleteBuddy: (id: string, rev: number) => send({ k: 'delete', id, rev }),

    setHidden: (on: boolean) => send({ k: 'hide', on }),
    setPaused: (on: boolean) => send({ k: 'pause', on }),
    setAutostart: (on: boolean) => send({ k: 'autostart', on }),
    setFiles: (on: boolean) => send({ k: 'files', on }),
    setWalk: (on: boolean) => send({ k: 'walk', on }),
    /* `on` keeps buddies off this app's windows. */
    setExcluded: (app: string, on: boolean) => send({ k: 'exclude', app, on }),
    /* Other apps asking buddies to do things: the switch, an answer to one that's waiting, and
       forgetting an answer, so that app is asked again. */
    setApi: (on: boolean) => send({ k: 'api', on }),
    answerApp: (app: string, allow: boolean) => send({ k: 'api-answer', app, allow }),
    forgetApp: (app: string) => send({ k: 'api-forget', app }),

    /* The Maker's hook. `state.maker` says whether it's there yet. */
    newBuddy: () => send({ k: 'maker' }),
    editBuddy: (id: string) => send({ k: 'maker', id }),

    clearFailure(id: string) {
      if (local.some(f => f.id === id)) { local = local.filter(f => f.id !== id); tell(); return Promise.resolve<Answer>({ ok: true }); }
      return send({ k: 'clear', id });
    },
    clearFailures() { local = []; tell(); return send({ k: 'clear' }); },

    /* Really closes the window. Anything sent carries on without it. */
    close: () => io.closeWindow()
  };
}
export type ManagerClient = ReturnType<typeof createManagerClient>;
