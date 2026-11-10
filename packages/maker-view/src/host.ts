/* What the view asks of whoever hosts it. Everything the exe could add is optional, because the view
   also works as a plain web page. */
export type SaveState =
  | { kind: 'saved' } | { kind: 'saving' }
  | { kind: 'failed'; title: string; why: string; fix: string; actions?: { label: string; run(): void }[] };

export interface MakerViewHost {
  /* The drawn title bar. Absent on the web, where the browser has its own. */
  window?: { minimize(): void; close(): void };
  /* Live save status. Returns an unsubscribe. */
  onSave(f: (s: SaveState) => void): () => void;
  /* The Maker's toasts, drawn here in Peel's style. Returns an unsubscribe. */
  onToast?(f: (message: string) => void): () => void;
  /* Sends the real buddy out and tries an action. Absent on the web. */
  tryOnScreen?(id: string, action: string): void;
  saveBuddyFile(id: string): void;
  exportPage?(): void;
  /* Work begins: art coming in, from the event that brought it to the last step. Returns what ends
     it, or null if the host won't take new work now, as the app won't while it's closing. */
  work?(): (() => void) | null;
}

/* What comes from the page. The defaults are the browser's, and a test passes its own. */
export interface MakerViewIO {
  /* for what belongs to this viewer: theme, backing, last sheet. It may throw. */
  store(): Pick<Storage, 'getItem' | 'setItem'>;
  /* false when the viewer has asked for reduced motion */
  moves(): boolean;
  copy(text: string): Promise<void>;
  /* runs f every ms until the answer is called */
  every(ms: number, f: () => void): () => void;
  after(ms: number, f: () => void): () => void;
  /* a place at the bottom of Look for settings about every buddy, which a host may fill */
  worldSettings?: (box: HTMLElement) => void;
}

async function copyToClipboard(text: string) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = document.createElement('textarea');
    t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
  }
}

export const browserIO = (): MakerViewIO => ({
  store: () => localStorage,
  moves: () => !matchMedia('(prefers-reduced-motion: reduce)').matches,
  copy: copyToClipboard,
  every: (ms, f) => { const t = setInterval(f, ms); return () => clearInterval(t); },
  after: (ms, f) => { const t = setTimeout(f, ms); return () => clearTimeout(t); }
});
