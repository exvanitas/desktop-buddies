/* The Maker in Peel, drawn on top of createMaker(). It reads the Maker, calls its changes and redraws what
   `subscribe` says changed. What it remembers for itself is what's on screen. By moment: it opens on
   Everything, and the sheets are for focused work. */
import type { PoseKey } from '@buddies/buddy-file';
import { linesOf, type Maker } from '@buddies/maker-core';
import { h } from '@buddies/peel/dom';
import { menuOf } from '@buddies/peel/menu';
import { createPopover } from '@buddies/peel/popover';
import { readTheme, showTheme } from '@buddies/peel/theme';
import { cellsOf } from './art';
import { createBar } from './bar';
import { createBoard } from './board';
import { silent, label } from './captions';
import { firstState, isLine, isPose, isPrompt, sheetOf, type Backing, type Page, type Sel, type View } from './context';
import { sortFiles, watchDrops } from './drops';
import { createEmpty } from './empty';
import { browserIO, type MakerViewHost, type MakerViewIO } from './host';
import { MOMENTS } from './moments';
import { createPickers } from './pickers';
import { readBacking, readSpots, saveBacking, saveSpots } from './remember';
import { createSaveStatus } from './save-status';
import { createSpine } from './spine';
import { createTray } from './tray';
import { lineAfterTidy } from './words';

const TOAST_MS = 3000;

/* What's said when art arrives with the window on its way out. */
const CLOSING = 'The Maker is closing, so that wasn\'t added. It\'s still on your disk.';

export function createMakerView(root: HTMLElement, maker: Maker, host: MakerViewHost, over: Partial<MakerViewIO> = {}) {
  const io: MakerViewIO = { ...browserIO(), ...over };
  const gone = new AbortController(), { signal } = gone;
  showTheme(readTheme(io.store));

  let now = firstState(), shownId: string | null = null, working = 0, hideToast = () => {};
  now.back = readBacking(io.store);

  const toast = h('div', { class: 'toast', role: 'status', hidden: true });
  function say(message: string) {
    toast.textContent = message; toast.hidden = false;
    hideToast();
    hideToast = io.after(TOAST_MS, () => { toast.hidden = true; });
  }
  const workingEl = h('span', { class: 'saved', role: 'status', 'data-working': 'true', hidden: true }, 'Working on it');
  /* The one way art comes in. It's registered before its first step, so whoever hosts this can tell
     nothing is half done, and it ends when its last step has landed or been refused. */
  function busy<T>(work: () => Promise<T>): Promise<T | undefined> {
    const end = host.work ? host.work() : () => {};
    if (!end) { say(CLOSING); return Promise.resolve(undefined); }
    working++; workingEl.hidden = false;
    let run: Promise<T>;
    try { run = work(); } catch (e) { run = Promise.reject(e); }
    return run.finally(() => { working--; workingEl.hidden = working === 0; end(); });
  }

  const pickers = createPickers({
    main: f => void busy(() => maker.setMainImage(f)),
    buddies: fs => void busy(() => maker.addFiles(fs)),
    frames: fs => { const p = maker.current(); if (p) void busy(() => maker.addFrames(p, fs)); },
    generated: fs => void busy(() => maker.importGenerated(fs)),
    shimeji: fs => void busy(() => maker.importShimeji(fs)),
    buddyFile: f => void busy(() => maker.importBuddy(f))
  });
  const pop = h('div', { class: 'pop' }), popover = createPopover(pop);

  const v: View = {
    maker, host, io, popover, pickers,
    get now() { return now; },
    pet: () => maker.current()!,
    pick, open,
    tryIt(action) { now.tried = action; maker.act(v.pet().id, action); tray.draw(); },
    setBacking(b: Backing) { now.back = b; saveBacking(io.store, b); drawAll(); },
    drawTray: () => tray.draw(),
    drawBoard: () => { board.draw(); },
    mark: () => board.mark(),
    resized() { board.resized(); tray.resized(); },
    saveSpots() { saveSpots(io.store, v.pet().character || v.pet().id, { last: now.last, splits: now.splits }); },
    say,
    copy(text, what) { void io.copy(text).then(() => say(`Copied ${what}`), () => say(`Couldn't copy the ${what}`)); },
    busy,
    askAbout
  };

  const status = createSaveStatus(() => maker.current() ? { label: 'Save buddy file', run: () => { const id = maker.selected; if (id) host.saveBuddyFile(id); } } : null);
  const bar = createBar(v, status.chip, workingEl);
  const board = createBoard(v), tray = createTray(v), spine = createSpine(v);
  const empty = createEmpty(maker, pickers, busy);
  const mk = h('div', { class: 'mk' }, spine.el, board.el, tray.el);
  const waiting = h('main', { class: 'first waiting', role: 'status' }, 'Getting ready');
  const veil = h('div', { class: 'veil', hidden: true }, h('span', {}, 'Drop to add'));
  const win = h('div', { class: 'win maker' }, bar.el, status.banner, waiting, empty.el, mk, veil);
  root.replaceChildren(win, pop, toast, ...pickers.els);

  /* Opening on a different buddy starts again, on Everything, with its own remembered places. */
  function followBuddy() {
    const p = maker.current(), id = p ? p.id : null;
    if (id === shownId) return;
    shownId = id;
    tray.stop();
    /* a choice left open was about the buddy that's gone */
    popover.close(false);
    const back = now.back;
    now = firstState(); now.back = back;
    if (p) { const s = readSpots(io.store, p.character || p.id, MOMENTS.length); now.last = s.last; now.splits = s.splits; }
    maker.pickPose('stand');
  }

  function drawAll() {
    const ready = !!maker.state, p = ready ? maker.current() : undefined;
    waiting.hidden = ready;
    win.dataset.ready = String(ready);
    if (!ready) { empty.el.hidden = mk.hidden = true; return; }
    followBuddy();
    bar.update();
    empty.el.hidden = !!p; mk.hidden = !p;
    if (!p) { tray.stop(); empty.show(); return; }
    mk.dataset.back = now.back;
    mk.classList.toggle('slim', !Object.values(p.poses).some(x => x && x.frames.length));
    spine.update();
    /* the tray first: its height sets the room left for the page */
    tray.draw();
    board.draw();
    pixelArt(p.base.src);
    popover.place();
  }

  /* Small art is pixel art, and stays crisp as it's scaled up. */
  function pixelArt(src: string) {
    const probe = new Image();
    probe.onload = () => { mk.classList.toggle('px', probe.naturalWidth <= 96); };
    probe.src = src;
  }

  /* A line left blank is gone once the writer moves on, and the one being opened may shift up.
     Clicking the line being written isn't moving on, unless a whole page is changing. */
  function leaveLine(next: Sel, page = false) {
    const was = now.sel;
    if (!isLine(was) || (!page && isLine(next) && next.sit === was.sit && next.i === was.i)) return { sel: next, tidied: false };
    const p = v.pet(), list = linesOf(p, was.sit);
    maker.tidyLines(was.sit);
    const after = linesOf(p, was.sit);
    if (after === list) return { sel: next, tidied: false };
    if (!isLine(next) || next.sit !== was.sit) return { sel: next, tidied: true };
    return { sel: { sit: next.sit, i: next.i >= list.length ? after.length : lineAfterTidy(list, next.i) }, tidied: true };
  }

  function pick(asked: Sel) {
    const { sel, tidied } = leaveLine(asked);
    now.sel = sel; now.tried = null; now.held = null;
    if (isPose(sel)) maker.pickPose(sel.pose);
    /* A word opens where it's written. */
    if (isLine(sel) && now.page !== 'words') {
      const home = MOMENTS.findIndex(m => m.sits.some(s => s.k === sel.sit)) + 1;
      if (now.page !== home) { now.page = home; now.last = home; v.saveSpots(); spine.update(); tray.draw(); board.draw(); board.reveal(); return; }
    }
    tray.draw();
    if (tidied) board.draw();
    board.picked();
  }

  function open(page: Page) {
    now.sel = leaveLine(now.sel, true).sel;
    popover.close(false);
    now.page = page; now.tried = null; now.held = null;
    const m = sheetOf(page), p = v.pet();
    if (page === 'words' && !isLine(now.sel)) now.sel = { sit: 'chat', i: 0 };
    if (page === 'all' && !isPose(now.sel)) now.sel = { pose: 'stand' };
    /* a prompt is only read in Prompt kit */
    if (page !== 'kit' && isPrompt(now.sel)) now.sel = { pose: 'stand' };
    if (m) {
      now.last = page as number; v.saveSpots();
      const c = cellsOf(p, m.poses)[0], first = m.sits.find(s => !silent(p, s))!;
      now.sel = c ? { pose: c.keys[0]! } : { sit: first.k, i: 0 };
    }
    if (isPose(now.sel)) maker.pickPose(now.sel.pose);
    spine.update();
    tray.draw();
    board.draw();
    board.reveal();
  }

  /* A short question over the board. */
  function ask(question: string, choices: { words: string; act(): void }[]) {
    const anchor = board.el.querySelector<HTMLElement>('header h2') || bar.el;
    popover.show(h('div', { class: 'ask', role: 'dialog', 'aria-label': question },
      h('b', { dir: 'auto' }, question),
      menuOf(choices.map(c => ({ words: c.words, act() { popover.close(false); c.act(); } })), question)), anchor);
  }

  /* An image with no pose in its name could be for anything, so it asks. */
  function askAbout(files: File[]) {
    const p = maker.current();
    if (!p) { void busy(() => maker.addFiles(files)); return; }
    const sel = now.sel, pose: PoseKey | null = isPose(sel) ? sel.pose : null, one = files.length === 1;
    ask(one ? `Where does ${files[0]!.name} go?` : `Where do these ${files.length} go?`, [
      ...pose ? [{ words: `Frames for ${label(pose)}`, act() { maker.pickPose(pose); void busy(() => maker.addFrames(p, files)); } }] : [],
      ...one ? [{ words: 'New main image', act() { void busy(() => maker.setMainImage(files[0])); } }] : [],
      { words: one ? 'A new buddy' : 'New buddies, one each', act() { void busy(() => maker.addFiles(files)); } }
    ]);
  }

  /* What a drop brought, once read. It's part of the drop's own work, so what it starts is returned
     to finish with it, rather than started as work of its own. A question it asks ends it, and
     whatever is chosen later is new work. It ends when all of it has, and a failure still shows. */
  function took(files: File[], where: EventTarget | null, from: string | null): Promise<unknown> {
    const jobs: Promise<unknown>[] = [], go = (f: () => Promise<unknown>) => { jobs.push(f()); };
    const done = () => Promise.allSettled(jobs).then(all => { for (const r of all) if (r.status === 'rejected') throw r.reason; });
    if (!maker.state) return done();
    if (from !== maker.selected) { say('Nothing was added, because the buddy changed while the files were being read. They\'re still on your disk.'); return done(); }
    const p = maker.current(), sorted = sortFiles(files);
    for (const f of sorted.buddyFiles) go(() => maker.importBuddy(f));
    /* A set of Shimeji images is a whole new buddy, so with one already open it asks. */
    if (sorted.shimeji.length && p) ask(`Make a new buddy from these ${sorted.shimeji.length} Shimeji images?`, [
      { words: 'A new buddy', act() { void busy(() => maker.addFiles(sorted.shimeji)); } },
      { words: 'Not now', act() {} }
    ]);
    else if (sorted.shimeji.length) go(() => maker.addFiles(sorted.shimeji));
    if (sorted.other.length && !sorted.named.length && !sorted.unnamed.length && !sorted.buddyFiles.length && !sorted.shimeji.length) say('Only images, buddy files and Shimeji folders can be added');
    const images = [...sorted.named, ...sorted.unnamed];
    if (!images.length) return done();
    if (!p) { go(() => maker.addFiles(images)); return done(); }
    /* on the tray, they're frames for what's in it */
    const overTray = where instanceof Element && !!where.closest('.tray'), sel = now.sel;
    if (overTray && isPose(sel)) { maker.pickPose(sel.pose); go(() => maker.addFrames(p, images)); return done(); }
    /* on the main image itself, one image replaces it */
    const overMain = where instanceof Element && !!where.closest('.stage');
    if (now.page === 'look' && overMain && images.length === 1) { go(() => maker.setMainImage(images[0])); return done(); }
    if (sorted.named.length) go(() => maker.importGenerated(sorted.named));
    if (sorted.unnamed.length && !sorted.named.length && !sorted.shimeji.length) askAbout(sorted.unnamed);
    else if (sorted.unnamed.length) say(`Skipped ${sorted.unnamed.length} with no pose in the name`);
    return done();
  }

  /* A dropped folder is read before anything else happens, so the reading is the work's first step. */
  watchDrops(document, on => { veil.hidden = !on; }, (read, where, from) => void busy(() => read().then(f => f.length && !signal.aborted ? took(f, where, from) : undefined)), signal, () => maker.selected);
  document.addEventListener('paste', e => {
    const t = e.target as Element | null;
    if (t?.closest?.('input, textarea')) return;
    const file = [...e.clipboardData?.items || []].find(x => x.type.startsWith('image/'))?.getAsFile();
    if (!file) return;
    e.preventDefault();
    if (!maker.state) return;
    if (!maker.current() || now.page === 'look') void busy(() => maker.pasteImage(file));
    else askAbout([file]);
  }, { signal });
  addEventListener('resize', () => { if (maker.state && maker.current()) v.resized(); }, { signal });
  void document.fonts?.ready.then(() => { if (!signal.aborted && maker.state && maker.current()) v.resized(); });

  const unsubscribe = [
    maker.subscribe(c => {
      /* a slow upload can finish for a buddy who is no longer on screen */
      if ('pet' in c && c.pet !== maker.current()) return;
      if (c.scope === 'field') return;
      if (c.scope === 'prompts') { board.refreshPrompts(); return; }
      if (c.scope === 'kit' && now.page !== 'kit') return;
      drawAll();
    }),
    host.onSave(s => status.update(s)),
    host.onToast ? host.onToast(say) : () => {}
  ];
  drawAll();

  return {
    destroy() {
      for (const u of unsubscribe) u();
      gone.abort(); tray.stop(); hideToast(); popover.dispose();
      root.replaceChildren();
    }
  };
}
