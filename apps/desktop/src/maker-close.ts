/* Closing the Maker, as phases, whoever asks for it.

   editing  the window in use. Work can start.
   waiting  input is stopped and no new work starts. What's running finishes, with nothing sent
            meanwhile, then everything is flushed. Keep editing goes back from here, and only here.
   closing  the window has been asked to go. There's no way back while any ask is out: once every
            one is refused, it's editing again and the person is told; if it sticks, Close anyway
            asks again.
   gone     an ask landed, so the window went. Nothing brings editing back.

   Past the time limit in waiting or closing, or on a failure in waiting, the person is offered what
   that phase allows, and until the window has really gone nothing is given up. */
import { makerNotClosed, stillSaving, type Problem } from './failures';
import type { HubStore, SaveAction } from './maker-store';

export type Phase = 'editing' | 'waiting' | 'closing' | 'gone';
export interface ClosingUI {
  /* Input stops, everywhere, until `hide`. */
  show(): void;
  /* What's holding the close, and what can be done. */
  ask(what: { title: string; why: string; fix: string }, actions: SaveAction[]): void;
  hide(): void;
}
export interface CloserIO {
  ui: ClosingUI;
  store: Pick<HubStore, 'pause' | 'discard' | 'flush' | 'onSave' | 'say'>;
  after(ms: number, f: () => void): () => void;
  askAfter: number;
}
export interface Closing {
  /* Takes the window away. If it rejects, the window is still here. */
  destroy(): Promise<unknown>;
  /* Close anyway, once the window has been asked: asks again. The same as `destroy` unless said. */
  again?(): Promise<unknown>;
  /* For a close nobody can see: when waiting can't finish cleanly, it goes back at once. */
  gaveUp?(): void;
}

export function createCloser({ ui, store, after, askAfter }: CloserIO) {
  let phase: Phase = 'editing', how: Closing | null = null, asking = false, running = 0, out = 0;
  let stopAsk = () => {}, unwatch: (() => void) | null = null, idle: (() => void) | null = null;

  function editing(problem?: Problem) {
    phase = 'editing'; how = null; asking = false;
    stopAsk(); unwatch?.(); unwatch = null;
    store.discard(false);
    store.pause(false);
    ui.hide();
    if (problem) store.say(problem);
  }

  /* What can be done now, and only that. */
  function render() {
    if (!asking) return;
    unwatch ??= store.onSave(s => {
      const failed = s.kind === 'failed' ? s : null;
      if (phase === 'waiting') ui.ask(failed ?? stillSaving(), [
        ...(failed?.actions ?? []).map(a => ({ label: a.label, run() { a.run(); void flush(); } })),
        { label: 'Keep editing', run() { const h = how; editing(); h?.gaveUp?.(); } },
        { label: 'Close anyway', run() { store.discard(true); issue(); } }
      ]);
      else if (phase === 'closing') ui.ask(stillSaving(), [{ label: 'Close anyway', run: () => { void ask(how?.again ?? how!.destroy); } }]);
    });
  }

  /* The window is asked to go, and from here there's no way back but its refusal. */
  function issue() {
    if (phase !== 'waiting') return;
    phase = 'closing';
    unwatch?.(); unwatch = null; render();
    void ask(how!.destroy);
  }
  /* Any ask still out can take the window yet, so only when every ask has been refused does editing
     come back. One that lands is never taken off the count. */
  async function ask(go: () => Promise<unknown>) {
    out++;
    try { await go(); phase = 'gone'; stopAsk(); }
    catch { if (--out === 0) editing(makerNotClosed()); }
  }

  /* Its answer is only for the close that asked: one taken back and started again flushes for itself. */
  async function flush() {
    const mine = how;
    const clean = await store.flush();
    if (how !== mine || phase !== 'waiting') return;
    if (clean) return issue();
    const h = how;
    if (h?.gaveUp) { editing(); h.gaveUp(); }
    else { asking = true; render(); }
  }

  return {
    get phase() { return phase; },
    /* Work starts, if the window is in use. Returns what ends it. */
    work(): (() => void) | null {
      if (phase !== 'editing') return null;
      running++;
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        if (--running === 0) idle?.();
      };
    },
    /* Whoever started `close` takes it back, as Keep editing does. Only while waiting: once the
       window has been asked, only the ask's own refusal can. */
    stay(close: Closing) {
      if (how !== close || phase !== 'waiting') return false;
      editing();
      return true;
    },
    /* False if one's already under way, which stays in charge. */
    start(close: Closing) {
      if (phase !== 'editing') return false;
      phase = 'waiting'; how = close;
      ui.show();
      store.pause(true);
      stopAsk = after(askAfter, () => { asking = true; render(); });
      const drained = () => { idle = null; if (phase !== 'waiting') return; store.pause(false); void flush(); };
      if (running) idle = drained; else drained();
      return true;
    }
  };
}
