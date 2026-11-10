/* The right-click menu's window, which the hub keeps. Two parts:

   - `reduce`, pure: (state, event) -> (state, what to do). Events are what people do, what the page
     says, timers, and the end of every step on a window, done or failed, however late. What to do is
     steps on a window, messages, timers, a choice to run, and notes. No step starts while one is
     running, unless that one is past its deadline: then it's given up on.
   - `createBuddyMenu`, a thin driver: runs what the reducer says and feeds every result back to it
     as an event, through one queue. Nothing else changes the state.

   Every window has its own label, `buddy-menu-<n>`, from a start that's random each run, and every
   step, answer and page message names it. There is at most one current window. Any other window
   that exists, or might, is owed a close until a close of it is answered, done or "no window". So an
   answer about an old window, however late, can only settle what's owed for it: it never touches the
   current one.

   What the reducer keeps to:
   - The window opens on the first right-click, hidden, never at start: a window that opens takes the
     foreground, even hidden. Until it has been shown it holds the keyboard invisibly, so one nobody
     wants is owed a close. So is one where any step failed or was given up on, hides included, or
     whose page didn't come up, draw or say it has the keyboard in time, and one made after its open
     was given up on. A close that fails or is given up on stays owed, and is tried again after a wait
     that doubles, and at the next thing that happens. Once shown and hidden again, with its page up,
     the current window is kept for the next right-click.
   - A showing goes: her menu drawn in the hidden window, its size back from the page, then the
     window placed beside her, shown and focused. Each step is for one showing, and one finished for a
     showing nobody wants any more is undone by the next. It counts as shown only once its page says
     it has the keyboard: a page that died can't, so its window is closed.
   - If the exe stops answering altogether, nothing here can close a window.
   - A wanted showing always has a deadline of its own, whatever it waits on, so it's always shown or
     dropped in the end, even behind a step that never ends.
   - Nothing shows while buddies are hidden or paused.
   - A choice is done once, for the showing it was made in, and only what her menu offers, about her. */
import { reason } from './failures';
import { PLAYS, type BuddyRow, type Command, type MenuToHub, type Said } from './manager-api';
import { beside, workAt, type Work } from './menu-place';
import { randomStart } from './random-start';
import type { Monitor, PlainWindowSpec, Rect, Shell } from './shell';

/* Each window is opened from this, under a label of its own, which its page gets as its boot. */
export const MENU: PlainWindowSpec = {
  label: 'buddy-menu', kind: 'window', page: 'buddy-menu.html', title: 'Desktop Buddies menu',
  width: 200, height: 300, decorations: false, transparent: true, shadow: false,
  alwaysOnTop: true, skipTaskbar: true, resizable: false, visible: false
};
export const labelOf = (start: number, n: number) => `${MENU.label}-${start + n}`;
export const isMenu = (label: string) => label.startsWith(`${MENU.label}-`);
/* How long a window has to be made, and then its page to come up; a page to draw a menu; any other
   step to finish; and the first wait before a failed close is tried again, which doubles to RETRY_MAX_MS. */
export const UP_MS = 5000, DRAW_MS = 3000, STEP_MS = 5000, RETRY_MS = 250, RETRY_MAX_MS = 8000;
/* How long a right-click waits to be shown before it's given up, whatever it's waiting on, and how
   long a page has to say it has the keyboard once its window was focused. */
export const WANT_MS = 12000, FOCUS_MS = 2000;

type Ask = Extract<MenuToHub, { k: 'menu-ask' }>;
export type Step = { k: 'open' } | { k: 'place'; at: Rect } | { k: 'show' } | { k: 'focus' } | { k: 'hide' } | { k: 'close' };
export type Event =
| { k: 'ask'; ask: Ask; row: BuddyRow | null; work: Work | null; maker: boolean }
| { k: 'press' } /* a press on a buddy, Hide all or Pause */
| { k: 'closed'; n: number; why: string }
| { k: 'choose'; n: number; label: string; cmd: Command }
| { k: 'up'; label: string }
| { k: 'ready'; n: number; label: string; w: number; h: number }
| { k: 'focused'; n: number; label: string; t: number }
| { k: 'done'; id: number; label: string; step: Step['k']; why?: string } /* a step ended: with `why` if it failed */
| { k: 'late'; id: number } /* a step's time ran out: it's given up on */
| { k: 'page-late'; label: string } /* a window's page didn't come up in time */
| { k: 'draw-late'; n: number }
| { k: 'want-late'; n: number } /* a showing that wasn't shown in time */
| { k: 'focus-late'; n: number } /* its page didn't say it has the keyboard */
| { k: 'retry' }
| { k: 'sweep' }; /* try again to close windows whose open never answered */
export type Do = { k: 'step'; id: number; label: string; step: Step } | { k: 'post'; m: Said } | { k: 'timer'; ms: number; event: Event } | { k: 'run'; cmd: Command; n: number } | { k: 'note'; line: string };

/* `asked`: its window was focused and the page asked; `focused`: the page said it has the keyboard,
   while shown for it. Only that counts as shown. */
interface Want { n: number; ask: Ask; row: BuddyRow; work: Work; maker: boolean; first: boolean; sent: boolean; size?: { w: number; h: number }; placed?: Rect; asked: boolean; focused: boolean }
/* The current window: its page up, made and never shown, and the showing it's shown for. */
interface Win { label: string; up: boolean; fresh: boolean; shown: number | null }
export interface State {
  n: number; ids: number; windows: number; start: number;
  want: Want | null;
  cur: Win | null; shownOnce: boolean;
  /* windows owed a close, never the current one; a close failed and waits for its retry or the next
     thing that happens; failures in a row */
  owed: string[]; waiting: boolean; tries: number;
  /* Opens given up on that haven't answered: such a window can still appear, so a close that finds
     none doesn't end it. They're swept, closed again, every RETRY_MAX_MS until the open answers or a
     close finds one. */
  limbo: string[]; sweeping: boolean;
  /* The step that's running: on which window, for which showing, whether the page came up while the
     window was still being made, and, for a close, whether its window was found to exist after it
     went out, so its "no window" may predate it. */
  busy: { id: number; step: Step; label: string; n: number | null; up: boolean; recheck?: boolean } | null;
}
export const initial = (start: number): State => ({ n: 0, ids: 0, windows: 0, start, want: null, cur: null, shownOnce: false, owed: [], waiting: false, tries: 0, limbo: [], sweeping: false, busy: null });

/* What her menu can ask for: about her, and nothing else. */
const OFFERED: ReadonlySet<Command['k']> = new Set(['bring', 'act', 'another', 'dismiss-one', 'dismiss', 'maker', 'export', 'delete']);
const offered = (cmd: Command, id: string) => OFFERED.has(cmd.k) && 'id' in cmd && cmd.id === id && (cmd.k !== 'act' || (PLAYS as readonly string[]).includes(cmd.action));
const same = (a?: Rect, b?: Rect) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const USER: ReadonlySet<Event['k']> = new Set(['ask', 'press', 'closed', 'choose']);
/* the exe's answer, or Tauri's for two opens that raced */
const ALREADY = /already (open|exists)/;

/* `quiet`: buddies are hidden or paused, as the hub says now. */
export function reduce(state: State, e: Event, quiet: boolean): { state: State; out: Do[] } {
  const s: State = { ...state, want: state.want && { ...state.want }, cur: state.cur && { ...state.cur }, owed: [...state.owed], limbo: [...state.limbo], busy: state.busy && { ...state.busy } }, out: Do[] = [];
  const note = (line: string) => out.push({ k: 'note', line: `menu: ${line}` });
  const drop = () => { if (s.want) out.push({ k: 'post', m: { k: 'menu-hide', n: s.want.n } }); s.want = null; };
  const owe = (label: string) => { if (!s.owed.includes(label)) s.owed.push(label); };
  /* The current window has to go: it's owed a close, and whatever it was showing is dropped. */
  const retire = (why: string) => { if (s.cur) owe(s.cur.label); s.cur = null; note(why); drop(); };
  const isCur = (label: string) => s.cur?.label === label;
  /* a close that failed or never answered: still owed, tried again after a wait that doubles */
  const later = (why: string) => {
    s.waiting = true;
    out.push({ k: 'timer', ms: Math.min(RETRY_MS * 2 ** s.tries, RETRY_MAX_MS), event: { k: 'retry' } });
    s.tries++;
    note(`couldn't close a window, so it will try again: ${why}`);
  };

  if (USER.has(e.k)) s.waiting = false;
  switch (e.k) {
    case 'ask':
      if (quiet) note('a right-click while buddies are hidden or paused');
      else if (!e.row) note('a right-click on someone not in the library');
      else if (!e.work) note('no monitors');
      else {
        drop();
        s.want = { n: ++s.n, ask: e.ask, row: e.row, work: e.work, maker: e.maker, first: !s.shownOnce, sent: false, asked: false, focused: false };
        out.push({ k: 'timer', ms: WANT_MS, event: { k: 'want-late', n: s.n } });
      }
      break;
    case 'press': drop(); break;
    case 'closed': if (s.want?.n === e.n) s.want = null; break;
    case 'choose':
      if (s.want?.n !== e.n || !isCur(e.label)) note('a choice from a menu that has closed');
      else if (!offered(e.cmd, s.want.row.id)) note(`a choice the menu doesn't offer: ${e.cmd.k}`);
      else { drop(); out.push({ k: 'run', cmd: e.cmd, n: e.n }); }
      break;
    case 'up':
      if (s.busy?.step.k === 'open' && s.busy.label === e.label) s.busy.up = true;
      else if (s.cur && isCur(e.label)) s.cur.up = true;
      break;
    case 'ready': if (s.want?.n === e.n && isCur(e.label)) s.want.size = { w: e.w, h: e.h }; break;
    case 'focused':
      if (s.want?.n !== e.n || !s.cur || !isCur(e.label) || s.cur.shown !== e.n || s.want.focused) break;
      s.want.focused = true;
      out.push({ k: 'note', line: `menu ${e.n} focused ${Math.round(e.t - s.want.ask.t)} ms after the right-click${s.want.first ? ', first open' : ''}` });
      break;
    case 'focus-late': if (s.want?.n === e.n && !s.want.focused) retire('the page never said it had the keyboard'); break;
    case 'late': {
      /* Given up on, so the next step can go out though this one never answered. Whatever window it
         was on is owed a close: one being made might yet be. */
      const b = s.busy;
      if (b?.id !== e.id) break;
      s.busy = null;
      note(`gave up on ${b.step.k}, which never answered`);
      if (b.step.k === 'open') { owe(b.label); s.limbo.push(b.label); drop(); }
      else if (b.step.k === 'close') later('it never answered');
      else if (isCur(b.label)) retire(`couldn't ${b.step.k} it in time`);
      break;
    }
    case 'page-late': if (s.cur && isCur(e.label) && !s.cur.up) retire('the page never came up'); break;
    case 'draw-late': if (s.want?.n === e.n && !s.want.size) retire('the page didn\'t draw the menu'); break;
    case 'want-late': if (s.want?.n === e.n && !s.want.focused) { note('a right-click that couldn\'t be shown in time'); drop(); } break;
    case 'retry': s.waiting = false; break;
    case 'sweep': s.sweeping = false; for (const l of s.limbo) owe(l); break;
    case 'done': {
      const b = s.busy;
      if (b?.id !== e.id) { stale(s, e); break; }
      s.busy = null;
      const failed = e.why !== undefined;
      if (b.step.k === 'close') {
        const none = failed && /no window/.test(e.why!);
        if (failed && !none) { later(e.why!); break; }
        /* the window was made after this close went out: it's still owed, and goes again now */
        if (none && b.recheck) break;
        s.owed = s.owed.filter(l => l !== b.label);
        s.tries = 0; s.waiting = false;
        /* Closed, so its open is done with. None there, and its open never answered: it can still come. */
        if (!none) s.limbo = s.limbo.filter(l => l !== b.label);
        else if (s.limbo.includes(b.label) && !s.sweeping) { s.sweeping = true; out.push({ k: 'timer', ms: RETRY_MAX_MS, event: { k: 'sweep' } }); }
        break;
      }
      if (b.step.k === 'open') {
        const already = failed && ALREADY.test(e.why!);
        if (failed && !already) { note(`couldn't open its window: ${e.why}`); drop(); break; }
        s.cur = { label: b.label, up: b.up && !already, fresh: true, shown: null };
        if (already) out.push({ k: 'post', m: { k: 'menu-ping', label: b.label } });
        if (!s.cur.up) out.push({ k: 'timer', ms: UP_MS, event: { k: 'page-late', label: b.label } });
        break;
      }
      if (!s.cur || !isCur(b.label)) break;
      if (failed) { retire(`couldn't ${b.step.k} it: ${e.why}`); break; }
      if (b.step.k === 'place' && s.want?.n === b.n) s.want.placed = b.step.at;
      else if (b.step.k === 'show') { s.cur.shown = b.n; s.cur.fresh = false; s.shownOnce = true; }
      /* Focused, as far as the exe knows. Whether the page has the keyboard, only it can say. */
      else if (b.step.k === 'focus' && s.want?.n === b.n) {
        s.want.asked = true;
        out.push({ k: 'post', m: { k: 'menu-check', label: b.label, n: b.n } }, { k: 'timer', ms: FOCUS_MS, event: { k: 'focus-late', n: b.n } });
      }
      else if (b.step.k === 'hide') s.cur.shown = null;
      break;
    }
  }
  if (quiet && s.want) drop();
  /* A window made and never shown holds the keyboard invisibly: nobody wanting it, it goes at once. */
  if (!s.want && s.cur?.fresh) { owe(s.cur.label); s.cur = null; note('nobody wanted its window by the time it was made'); }
  plan(s, out);
  return { state: s, out };
}

/* The answer of a step given up on, which can come at any time. Every step given up on left its
   window owed a close, so it was never the current window's: all it can tell is whether that old
   window exists. Made or found late, it stays owed; closed, it's owed no more. A late "no window"
   says nothing: the close after it may have found the window, or it may yet be made. */
function stale(s: State, e: Extract<Event, { k: 'done' }>) {
  if (s.cur?.label === e.label) return;
  if (e.step === 'open') s.limbo = s.limbo.filter(l => l !== e.label);
  if (e.step === 'open' && (e.why === undefined || ALREADY.test(e.why))) {
    if (!s.owed.includes(e.label)) s.owed.push(e.label);
    if (s.busy?.step.k === 'close' && s.busy.label === e.label) s.busy.recheck = true;
  }
  if (e.step === 'close' && e.why === undefined) { s.owed = s.owed.filter(l => l !== e.label); s.limbo = s.limbo.filter(l => l !== e.label); }
}

/* The next step towards what's wanted, if none is running. */
function plan(s: State, out: Do[]) {
  if (s.busy) return;
  const start = (step: Step, label: string, n: number | null) => {
    const id = ++s.ids;
    s.busy = { id, step, label, n, up: false };
    out.push({ k: 'step', id, label, step }, { k: 'timer', ms: step.k === 'open' ? UP_MS : STEP_MS, event: { k: 'late', id } });
  };
  /* old windows first, oldest first */
  if (s.owed.length) { if (!s.waiting) start({ k: 'close' }, s.owed[0]!, null); return; }
  const w = s.want, cur = s.cur;
  if (cur && cur.shown !== null && cur.shown !== w?.n) return start({ k: 'hide' }, cur.label, cur.shown);
  if (!w) return;
  if (!cur) return start({ k: 'open' }, labelOf(s.start, ++s.windows), w.n);
  if (!cur.up) return;
  if (!w.sent) {
    w.sent = true;
    out.push({ k: 'post', m: { k: 'menu-show', label: cur.label, n: w.n, row: w.row, maker: w.maker, max: { w: Math.floor(w.work.w / w.work.scale), h: Math.floor(w.work.h / w.work.scale) } } },
      { k: 'timer', ms: DRAW_MS, event: { k: 'draw-late', n: w.n } });
    return;
  }
  if (!w.size) return;
  const at = beside(w.ask.her, w.ask.at, w.work, { w: Math.ceil(w.size.w * w.work.scale), h: Math.ceil(w.size.h * w.work.scale) });
  if (!same(at, w.placed)) return start({ k: 'place', at }, cur.label, w.n);
  if (cur.shown === null) return start({ k: 'show' }, cur.label, w.n);
  if (!w.asked) return start({ k: 'focus' }, cur.label, w.n);
}

export interface MenuIO {
  shell: Shell; post(m: Said): void; note(line: string): void; after(ms: number, f: () => void): void;
  /* her row, from the world id of any copy of her, or null */
  row(copy: string): BuddyRow | null;
  maker(): boolean; monitors(): Monitor[];
  /* buddies hidden or paused: no menu */
  quiet(): boolean;
  /* a choice made in the menu, run as the Manager's commands are */
  run(cmd: Command, n: number): void;
  /* where this run's window labels start: random, as other ids are */
  start?: number;
  /* The exe is API 2, so a window can open without taking the keyboard. The menu's window still
     opens on the first right-click, as on API 1: the rest is unchanged until that's measured. */
  newer?(): boolean;
}

export function createBuddyMenu(io: MenuIO) {
  const { shell } = io;
  let state = initial(io.start ?? randomStart()), running = false;
  const queue: Event[] = [];
  const native = (step: Step, label: string) =>
    step.k === 'open' ? shell.windowOpen({ ...MENU, ...(io.newer?.() ? { focused: false } : {}), label, boot: { label } }) : step.k === 'place' ? shell.windowPlace(label, step.at)
    : step.k === 'show' ? shell.windowShow(label) : step.k === 'focus' ? shell.windowFocus(label)
    : step.k === 'hide' ? shell.windowHide(label) : shell.windowClose(label);
  function run(d: Do) {
    if (d.k === 'post') io.post(d.m);
    else if (d.k === 'note') io.note(d.line);
    else if (d.k === 'run') io.run(d.cmd, d.n);
    else if (d.k === 'timer') io.after(d.ms, () => feed(d.event));
    else {
      const { id, label, step } = d, k = step.k;
      Promise.resolve().then(() => native(step, label)).then(() => feed({ k: 'done', id, label, step: k }), e => feed({ k: 'done', id, label, step: k, why: reason(e) }));
    }
  }
  /* One event at a time, each with what it leads to, in the order they came. */
  function feed(e: Event) {
    queue.push(e);
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const r = reduce(state, queue.shift()!, io.quiet());
        state = r.state;
        for (const d of r.out) run(d);
      }
    } finally { running = false; }
  }

  return {
    heard(m: Said) {
      if (m.k === 'menu-ask') feed({ k: 'ask', ask: m, row: io.row(m.copy), work: workAt(io.monitors(), m.at), maker: io.maker() });
      else if (m.k === 'menu-press') feed({ k: 'press' });
      else if (m.k === 'menu-up') feed({ k: 'up', label: m.label });
      else if (m.k === 'menu-ready') feed({ k: 'ready', n: m.n, label: m.label, w: m.w, h: m.h });
      else if (m.k === 'menu-closed') feed({ k: 'closed', n: m.n, why: m.why });
      else if (m.k === 'menu-choose') feed({ k: 'choose', n: m.n, label: m.label, cmd: m.cmd });
      else if (m.k === 'menu-focused') feed({ k: 'focused', n: m.n, label: m.label, t: m.t });
    },
    /* Hide all and Pause close it. */
    close: () => feed({ k: 'press' }),
    get state(): Readonly<State> { return state; }
  };
}
