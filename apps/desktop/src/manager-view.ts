/* The Manager's view: Peel. It only reads the hub's state and calls the client. What it remembers
   for itself is what's on screen right now: what's being looked for, what's open, what's dragging.
   Everything it can't do from inside a page comes in as ViewIO. The units are in manager/. */
import type { Answer, BuddyRow, HubState, Imported } from './manager-api';
import type { ManagerClient } from './manager-client';
import type { Handed } from './handed';
import { h } from '@buddies/peel/dom';
import { menuOf } from '@buddies/peel/menu';
import { createPopover } from '@buddies/peel/popover';
import { readTheme, saveTheme, showTheme, type Store, type Theme } from '@buddies/peel/theme';
import { FIND_FROM, createFind } from './manager/find';
import { createFooter } from './manager/footer';
import { createPickers, watchDrops } from './manager/importing';
import { buddyItems, confirmOf } from './manager/menu';
import { createMisprints } from './manager/misprints';
import type { Outlines } from './manager/outlines';
import { createPeel } from './manager/peel';
import { createFilesNote, createWalkSetting, settingsPanel } from './manager/settings';
import { createApiSetting, createAsking } from './manager/asking';
import { createReplacing } from './manager/replacing';
import { createSheet } from './manager/sheet';
import { createTitlebar } from './manager/titlebar';

export interface ViewIO {
  minimize(): Promise<void>;
  outline: Outlines;
  store: Store;
  /* false when the viewer has asked for reduced motion */
  moves(): boolean;
  now(): number;
  after(ms: number, f: () => void): void;
}

const WAITING: HubState = { ready: false, buddies: [], hidden: false, paused: false, autostart: false, packaged: false, walk: true, exclude: [], apps: [], maker: false, failures: [], api: { on: false, apps: [], asking: [] }, replacing: [] };
/* How long a note says what just happened. */
export const NOTE_MS = 5000;

export function mountView(root: HTMLElement, client: ManagerClient, io: ViewIO) {
  let state = WAITING, query = '', importing = 0, theme: Theme = readTheme(io.store);
  showTheme(theme);

  /* A failed command can be tried again from the window that sent it. No one else knows how. */
  const retries = new Map<string, () => void>();
  const canRetry = (id: string, retry: () => void) => { retries.set(id, retry); misprints.retryKnown(); };
  const act = (send: () => Promise<Answer<unknown>>) => { void send().then(a => { if (!a.ok) canRetry(a.failure.id, () => act(send)); }); };

  /* `rev`: a retry, from its failure. */
  async function bring(files: Handed[], rev?: number | null) {
    importing++; draw();
    try {
      for (const a of await (rev === undefined ? client.importFiles(files) : client.retryImport(files, rev))) {
        if (!a.ok && a.files.length) { const seen = a.rev; canRetry(a.failure.id, () => void bring(a.files, seen)); }
        if (a.ok && a.value?.upToDate) say(`${a.value.name} is already up to date.`);
      }
    } finally { importing--; draw(); }
  }

  /* A short note on what just happened, that goes by itself. Names are only text. */
  const note = h('p', { class: 'note', role: 'status', hidden: true });
  let noted = 0;
  function say(words: string) {
    const n = ++noted;
    note.textContent = words; note.hidden = false;
    io.after(NOTE_MS, () => { if (n === noted) note.hidden = true; });
  }

  const pop = h('div', { class: 'pop' }), popover = createPopover(pop);
  const pickers = createPickers(files => void bring(files));
  const peel = createPeel(io.moves);

  /* The menu for one buddy, or its confirm. The hub can change who it's about while it's open: a
     save or an import changes her revision, whatever it does to her name and main image. */
  let menuFor: string | null = null, asked: BuddyRow | null = null, offered = '';
  const offerOf = (b: BuddyRow) => `${b.copies > 1 ? 2 : b.copies} ${state.maker} ${b.can} ${b.name} ${b.image}`;
  const row = (id: string) => state.buddies.find(b => b.id === id);
  /* Only ever the her the confirm named: the hub refuses one that's changed since, retries too. */
  function deleteIt(b: BuddyRow) {
    void client.deleteBuddy(b.id, b.rev).then(a => { if (!a.ok) canRetry(a.failure.id, () => deleteIt(b)); });
  }
  function buddyMenu(b: BuddyRow) {
    const shut = (f: () => void) => () => { popover.close(); f(); };
    return menuOf(buddyItems(b, state.maker, {
      bringHere: shut(() => act(() => client.bringHere(b.id))),
      treat: shut(() => act(() => client.giveTreat(b.id))),
      chase: shut(() => act(() => client.chaseMouse(b.id))),
      another: shut(() => act(() => client.callAnother(b.id))),
      dismissOne: shut(() => act(() => client.dismissOne(b.id))),
      edit: shut(() => act(() => client.editBuddy(b.id))),
      exportIt: shut(() => act(() => client.exportBuddy(b.id))),
      remove: () => {
        asked = b;
        const { el, stay } = confirmOf(b, () => popover.close(), () => { popover.close(false); deleteIt(b); });
        popover.swap(el, stay);
      }
    }), `More for ${b.name}`);
  }
  function more(b: BuddyRow, anchor: HTMLElement) {
    if (menuFor === b.id) { popover.close(); return; }
    popover.show(buddyMenu(b), anchor, () => { menuFor = null; asked = null; });
    menuFor = b.id; offered = offerOf(b);
  }
  function follow() {
    if (menuFor === null) return;
    const b = row(menuFor);
    if (!b || (asked && b.rev !== asked.rev)) popover.close(false);
    else if (!asked && offerOf(b) !== offered) { offered = offerOf(b); popover.swap(buddyMenu(b)); }
  }

  function offerImport(anchor: HTMLElement) {
    if (popover.anchor === anchor) { popover.close(); return; }
    popover.show(menuOf([
      { words: 'A .buddy file', act: () => { popover.close(); pickers.pickFile(); } },
      { words: 'A Shimeji folder', act: () => { popover.close(); pickers.pickFolder(); } }
    ], 'Import'), anchor);
  }
  const walk = createWalkSetting({ walk: on => act(() => client.setWalk(on)), exclude: (app, on) => act(() => client.setExcluded(app, on)) });
  const filesNote = createFilesNote();
  const apiSetting = createApiSetting({ setOn: on => act(() => client.setApi(on)), forget: app => act(() => client.forgetApp(app)) });
  const asking = createAsking({ answer: (app, allow) => act(() => client.answerApp(app, allow)) });
  /* After Replace, a note says she was. After Keep both, the new one is brought into view. A
     failure lands in the misprints, and a disk that wouldn't take it asks again. */
  const replacing = createReplacing({
    answer: (q, how) => client.answerReplace(q.ask, how).then(a => {
      const got = a.ok ? a.value as Imported | undefined : undefined;
      if (!got || how === 'none') return;
      if (how === 'replace') say(got.replaced ? `${q.name} was replaced.` : `${got.name} came in from the file.`);
      else { say('Kept both. The file is a new buddy.'); reveal(got.id); }
    })
  }, io.now);
  /* Find could be hiding her. */
  function reveal(id: string) {
    if (query) find.clear();
    sheet.reveal(id);
  }
  function openSettings(anchor: HTMLElement) {
    if (popover.anchor === anchor) { popover.close(); return; }
    const panel = () => settingsPanel(theme, t => { theme = t; showTheme(t); saveTheme(io.store, t); const next = panel(); popover.swap(next, next.querySelector<HTMLElement>(`[data-theme-choice="${t}"]`) ?? undefined); }, walk.el, apiSetting.el, filesNote.el);
    popover.show(panel(), anchor);
  }

  const find = createFind(q => { query = q; draw(); });
  const newBuddy = () => act(() => client.newBuddy());
  const bar = createTitlebar({ find: find.el, importIt: offerImport, newBuddy, minimize: () => void io.minimize(), close: () => void client.close() });
  const misprints = createMisprints({
    pickFile: pickers.pickFile, pickFolder: pickers.pickFolder,
    clear: id => { retries.delete(id); void client.clearFailure(id); },
    clearAll: () => { retries.clear(); void client.clearFailures(); }
  }, retries);
  const sheet = createSheet({
    call: b => act(() => client.call(b.id)),
    dismiss: b => act(() => client.dismiss(b.id)),
    more, outline: io.outline, peel, now: io.now, after: io.after,
    importIt: offerImport, newBuddy,
    clearFind: () => find.clear()
  }, misprints.el, replacing.el, note, asking.el);
  const footer = createFooter({
    hide: on => act(() => client.setHidden(on)),
    pause: on => act(() => client.setPaused(on)),
    autostart: on => act(() => client.setAutostart(on)),
    settings: openSettings
  });
  const veil = h('div', { class: 'veil', hidden: true }, h('span', {}, 'Drop to add'));
  const win = h('div', { class: 'win' }, bar.el, sheet.el, footer.el, veil);
  root.replaceChildren(win, pop, ...pickers.els);

  function draw() {
    const { ready, buddies, maker, failures } = state, finding = buddies.length >= FIND_FROM;
    find.update({ show: finding, ready });
    bar.update({ ready, maker, finding, importing: importing > 0 });
    misprints.update(failures);
    sheet.update({ buddies, query, ready, maker });
    footer.update(state);
    walk.update(state);
    filesNote.update(state.packaged === true);
    asking.update({ ...state.api, ready });
    replacing.update(state.replacing ?? []);
    apiSetting.update({ ...state.api, ready });
    popover.place();
    win.dataset.ready = String(ready);
  }
  draw();

  client.subscribe(s => {
    state = s;
    for (const id of retries.keys()) if (!s.failures.some(f => f.id === id)) retries.delete(id);
    draw();
    follow();
  });
  watchDrops(document, files => void bring(files), on => { veil.hidden = !on; }, () => state.ready);
}
