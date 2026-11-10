/* The Maker's windows, as the hub keeps them. Each window is a lifetime with its own label, so a
   close or a focus meant for one can never reach the next. At most one is current: the hub opens
   it, and every New buddy and Edit goes through here.

   open     the window is up. A request focuses it and tells its page.
   closing  minimized, so the hub is flushing it to put a fresh one in its place. A request now is
            refused, and changes nothing anyone will be told.

   API 1's exe doesn't say when a window closes, so whether the current one is still there is asked
   each time. API 2's does, and its focus restores a minimized window, so a request just focuses
   the current one, and a fresh one only replaces a window that went. Every message about a window carries its label, and the hub only acts on one for the
   current window. Its page says hello once it's listening, and hears what it was last asked for. A
   window the hub didn't open, from before it restarted, is never made current: it can still save,
   with revisions keeping the library safe from it, and New buddy and Edit open a fresh one. */
import { makerBusy, makerHolding, makerNotOpened, reason, type Problem } from './failures';
import type { Answer, MakerBoot, Said } from './manager-api';
import type { PlainWindowSpec, Shell } from './shell';

/* Peel's sizes. The view draws the title bar, and Windows keeps the shadow and snapping. */
export const MAKER: Omit<PlainWindowSpec, 'label'> = {
  kind: 'window', page: 'maker.html', title: 'Desktop Buddies Maker',
  width: 1180, height: 680, minWidth: 960, minHeight: 600, center: true, decorations: false, shadow: true
};
/* Longer than a page waits to hear about its own last save. */
export const LEAVE_MS = 40000;

export interface MakerWindowsIO {
  shell: Shell;
  post(m: Said): void;
  after(ms: number, f: () => void): void;
  /* A refusal the Manager is shown. */
  refuse(p: Problem): Answer;
  note(line: string): void;
  /* the exe is API 2 */
  newer?(): boolean;
}
interface Life { label: string; asked: MakerBoot; closing: boolean }

export function createMakerWindows({ shell, post, after, refuse, note, newer = () => false }: MakerWindowsIO) {
  /* Unique past a restart of the hub, as windows outlive it. */
  const run = Math.random().toString(36).slice(2, 8);
  let lives = 0, asks = 0, current: Life | null = null, turn: Promise<unknown> = Promise.resolve();
  let flushing: { label: string; n: number; done(clean: boolean): void } | null = null;
  const OK: Answer = { ok: true };

  const minimized = (label: string) => shell.windowMinimized(label).catch(() => null);
  const tell = (life: Life) => { post({ k: 'maker-edit', ...life.asked }); };
  async function born(id?: string) {
    const label = `maker-${run}-${++lives}`;
    current = { label, asked: { n: ++asks, label, ...(id !== undefined ? { id } : {}) }, closing: false };
    await shell.windowOpen({ ...MAKER, label, boot: current.asked });
  }
  /* Asks the page to flush, and says if it can go. Past the limit, nobody's waiting for it, and it
     hears that too. */
  function flushed(life: Life, n: number) {
    return new Promise<boolean>(done => {
      const mine = { label: life.label, n, done };
      flushing = mine;
      post({ k: 'maker-leave', n, label: life.label });
      after(LEAVE_MS, () => { if (flushing === mine) { flushing = null; post({ k: 'maker-stay', n, label: life.label }); done(false); } });
    });
  }

  /* API 2: focus restores her window. One that went says so, and one that's gone without a word
     yet answers that there's no such window. */
  async function focused(id?: string): Promise<Answer> {
    const life = current;
    if (life) {
      const ask: MakerBoot = { n: ++asks, label: life.label, ...(id !== undefined ? { id } : {}) };
      try { await shell.windowFocus(life.label); life.asked = ask; tell(life); return OK; }
      catch (e) { if (!/no window/.test(reason(e))) throw e; }
    }
    await born(id);
    return OK;
  }

  async function decide(id?: string): Promise<Answer> {
    if (newer()) return focused(id);
    const life = current, m = life && await minimized(life.label);
    if (!life || m === null) return born(id).then(() => OK);
    const ask: MakerBoot = { n: ++asks, label: life.label, ...(id !== undefined ? { id } : {}) };
    if (!m) { await shell.windowFocus(life.label); life.asked = ask; tell(life); return OK; }
    /* The exe can't restore a minimized window, so a fresh one takes its place, once this one has
       nothing left to lose. */
    life.closing = true;
    try {
      if (!await flushed(life, ask.n)) return refuse(makerHolding());
      /* It's waiting to go, so if it won't, it has to hear that. If it went by itself, it's gone. */
      try { await shell.windowClose(life.label); }
      catch (e) { if (await minimized(life.label) !== null) { post({ k: 'maker-stay', n: ask.n, label: life.label }); throw e; } }
      await born(id);
      return OK;
    } finally { life.closing = false; }
  }

  return {
    /* Edit, or New buddy with no id. */
    request(id?: string): Promise<Answer> {
      if (current?.closing) return Promise.resolve(refuse(makerBusy()));
      const go = turn.then(() => decide(id)).catch((e: unknown) => { note(`maker window: ${reason(e)}`); return refuse(makerNotOpened()); });
      turn = go;
      return go;
    },
    /* API 2: a window went. If it was the current one, the next request opens a fresh one. */
    closed(label: string) {
      if (current?.label === label) current = null;
    },
    heard(m: Said) {
      /* A page still loading can't have heard what was asked of it. */
      if (m.k === 'maker-hello' && m.label === current?.label) tell(current);
      else if (m.k === 'maker-left' && m.label === flushing?.label && m.n === flushing.n) {
        const { done } = flushing;
        flushing = null;
        done(m.clean);
      }
    }
  };
}
