/* The Maker page's logic with no page in it: maker-core on the hub's store, and the host the view
   talks to. maker.ts hands in what only a page has, and the smoke run's probe hands in the same. */
import { createMaker, type ArtTools, type MakerDeps, type MakerState, type Maker } from '@buddies/maker-core';
import type { Answer, Exported, MakerBoot, Said } from './manager-api';
import type { MakerViewHost } from '@buddies/maker-view';
import { createCloser, type Closing, type ClosingUI } from './maker-close';
import { createHubStore } from './maker-store';
import { notExported, type Problem } from './failures';
import type { Events, Shell } from './shell';
import type { Wire } from './wire';

export type MakerView = (root: HTMLElement, maker: Maker, host: MakerViewHost) => unknown;

export interface MakerPageIO extends Pick<MakerDeps, 'art' | 'samples' | 'readImage' | 'after' | 'cancel' | 'random'> {
  art: ArtTools;
  shell: Shell; wire: Wire<Said>; session: string; boot: MakerBoot;
  root: HTMLElement; view: MakerView; closing: ClosingUI;
  /* The standalone page's html, which only a page can build. */
  buildPage(state: MakerState): Promise<string>;
  /* The page's own `pagehide`. */
  onLeaving(f: () => void): void;
}

/* How long a close waits on saving before it asks. A window must never just ignore someone. */
export const CLOSE_ASK_MS = 5000;
/* On API 2, how long before the exe stops waiting a quit's last word goes, whatever's still out. */
export const QUIT_MARGIN_MS = 1000;

export function mountMaker(io: MakerPageIO) {
  /* This window's own label: whatever the hub says to another window isn't for this one. */
  const { shell, boot } = io, { label } = boot, toasts = new Set<(m: string) => void>();
  const after = (ms: number, f: () => void) => { const t = io.after(ms, f); return () => io.cancel(t); };
  const store = createHubStore({ wire: io.wire, session: io.session, open: boot.id, after, heard, handOver: () => core.saveNow() });

  const core = createMaker({
    store, art: io.art, samples: io.samples, readImage: io.readImage, after: io.after, cancel: io.cancel, random: io.random,
    toast: m => { for (const f of toasts) f(m); },
    saveWarning: null, /* the status says it, in the app's own words */
    exportPage: () => { void exportPage(); },
    world: {
      sync() {}, /* the world is the hub's, and it hears when a save lands */
      act(id, action) {
        const c = store.characterOf(id);
        if (c) void store.ask({ k: 'maker-try', id: c, action, call: false });
      }
    }
  });

  const maker = core;
  /* Art coming in registers with this from the event that brought it, so Close knows when none is half done. */
  const closer = createCloser({ ui: io.closing, store, after, askAfter: CLOSE_ASK_MS });

  /* Everything the hub asks of the page, and every flush it needs first, one at a time. */
  let work: Promise<unknown> = Promise.resolve(), heardUpTo = boot.n;
  /* The hub's close, which only the hub can say isn't happening. */
  let leaving: { n: number; stay(): void } | null = null;
  const inOrder = (f: () => Promise<unknown>) => { work = work.then(f, f); return work; };
  const { flush } = store;

  function edit(id?: string) {
    return inOrder(async () => {
      await flush();
      if (id === undefined) return maker.deselect();
      const p = await store.open(id, () => { void edit(id); });
      if (p) maker.adopt(p);
    });
  }
  function heard(m: Said) {
    if ((m.k === 'maker-edit' || m.k === 'maker-leave' || m.k === 'maker-stay') && m.label !== label) return;
    if (m.k === 'maker-edit') {
      if (m.n <= heardUpTo) return;
      heardUpTo = m.n;
      void edit(m.id);
    } else if (m.k === 'maker-leave') {
      /* The hub takes the window away itself, once it hears this one's ready to go. */
      const left = (clean: boolean) => store.post({ k: 'maker-left', n: m.n, label, clean });
      let refused = () => {};
      const close: Closing = {
        /* Settles only if the hub says it isn't closing after all. */
        destroy() { left(true); return new Promise((_, no) => { refused = () => no(new Error('the hub kept the window')); }); },
        again: () => shell.windowClose(label),
        gaveUp() { left(false); }
      };
      if (!closer.start(close)) return left(false);
      leaving = { n: m.n, stay() { if (!closer.stay(close)) refused(); } };
    } else if (m.k === 'maker-stay' && leaving?.n === m.n) {
      const l = leaving; leaving = null; l.stay();
    }
  }

  const close = () => { closer.start({ destroy: () => shell.windowClose(label) }); };

  /* API 1's quit won't wait, so sending is all that's left to try. API 2's waits for a page that
     asks, up to `bound`, so a quit takes the same way as Close: input stops, image work finishes,
     everything is flushed, and only then is the exe told this page is ready. It's never told while a
     write is out: if that takes too long, the exe's bound ends the run. If a close was already under
     way, that close is in charge, and a second before the bound whatever it holds goes as a last word. */
  async function quitting(q: Events['quitting']) {
    if (!q) return store.lastGasp();
    await shell.quitWait().catch(() => {});
    const mine = closer.start({ destroy: async () => {
      for (let n = 0; n < 10 && !store.settled(); n++) if (!await flush()) break;
      await store.idle();
      /* Whatever the exe says, this page is done: a refusal here isn't the window refusing to go. */
      await shell.quitReady().catch(() => {});
    } });
    if (!mine) after(Math.max(0, q.bound - QUIT_MARGIN_MS), () => { if (closer.phase !== 'gone') store.lastGasp(); });
  }

  function shown(a: Answer, what: () => void) {
    if (!a.ok) store.say(a.failure as Problem, [{ label: 'Try again', run: what }]);
  }
  async function saveBuddyFile(id: string) {
    if (!await flush()) return;
    const c = store.characterOf(id); if (!c) return;
    shown(await store.ask<Exported>({ k: 'export', id: c, owner: label }, 0), () => { void saveBuddyFile(id); });
  }
  /* Only what's been opened in this window goes in the page. */
  async function exportPage() {
    if (!await flush()) return;
    const { state } = maker; if (!state.pets.length) return;
    const name = state.pets.length === 1 ? state.pets[0]!.name || 'buddy' : 'desktop-buddies';
    let content: string;
    try { content = await io.buildPage(state); }
    catch { return store.say({ ...notExported(name, 'read'), why: "The page couldn't be built.", fix: 'Try again.' }, [{ label: 'Try again', run: () => { void exportPage(); } }]); }
    shown(await store.ask<Exported>({ k: 'save-page', name, content, owner: label }, 0), () => { void exportPage(); });
  }
  async function tryOnScreen(id: string, action: string) {
    await flush();
    const c = store.characterOf(id);
    if (c && store.stored(id)) shown(await store.ask({ k: 'maker-try', id: c, action, call: true }), () => { void tryOnScreen(id, action); });
  }

  const host: MakerViewHost = {
    window: { minimize: () => { void shell.windowMinimize(label); }, close },
    onSave: store.onSave,
    tryOnScreen: (id, action) => { void tryOnScreen(id, action); },
    saveBuddyFile: id => { void saveBuddyFile(id); },
    exportPage: () => { void maker.exportPage(); },
    onToast(f) { toasts.add(f); return () => { toasts.delete(f); }; },
    work: () => closer.work()
  };

  maker.subscribe(() => store.touched());
  /* The real exe gets nothing out on `pagehide` when its window is closed, so a close from outside
     takes the title bar's way. */
  void shell.onCloseAsked(label, close);
  void shell.on('quitting', q => { void quitting(q); });
  io.view(io.root, maker, host);
  io.onLeaving(store.lastGasp);
  work = maker.start().then(() => store.post({ k: 'maker-hello', label }));
  return { maker, store, host, close, edit, closer, label, settled: () => work };
}
export type MakerPage = ReturnType<typeof mountMaker>;
