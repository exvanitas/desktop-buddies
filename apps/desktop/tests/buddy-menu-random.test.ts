/* The right-click menu's windows under random interleavings. Seeded runs drive the real driver and
   reducer with random right-clicks, presses, Hide all, page messages (late, doubled, stale, signed by
   the wrong window, or never), and steps on windows whose effect happens at one time and whose answer
   comes at another, later or never, or fails. The clock runs past every deadline. At every quiet point
   it checks what must always hold, and at the end, with the faults stopped and everything let finish,
   what must hold once things settle. A failure prints its seed.
     MENU_SEEDS=n MENU_SEED=s to run more, or one. */
import assert from 'node:assert';
import { test } from 'vitest';
import { STEP_MS, UP_MS, createBuddyMenu, type MenuIO } from '../src/buddy-menu';
import type { BuddyRow, Command, Said } from '../src/manager-api';
import type { Monitor, PlainWindowSpec, Rect, Shell } from '../src/shell';

const SEEDS = Number(process.env.MENU_SEEDS) || 3000, ONE = process.env.MENU_SEED, STEPS = 120;
const MON: Monitor = { i: 0, name: 'M', primary: true, scale: 1.5, x: 0, y: 0, w: 1920, h: 1040, full: { x: 0, y: 0, w: 1920, h: 1080 } };
const ROW: BuddyRow = { id: 'ada', name: 'Ada', image: 'x.png', status: 'out', copies: 1, can: ['eat'], rev: 1 };

function random(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const flush = async () => { for (let i = 0; i < 6; i++) await null; };
/* what the runs got up to, so a pass can be seen to have meant something */
const stats = { shown: 0, ran: 0, swept: 0, hung: 0, lateAnswer: 0, doneUnanswered: 0, never: 0, lostOne: 0, owedAtOnce: 0, windowsAtOnce: 0, failed: {} as Record<string, number> };

/* One run. Returns null, or what broke. */
async function run(seed: number): Promise<string | null> {
  const r = random(seed), pick = <T>(l: T[]) => l[Math.floor(r() * l.length)]!, chance = (p: number) => r() < p;
  let faults = true, clock = 0;
  /* the exe: windows by label, and who has the keyboard */
  const windows = new Map<string, { visible: boolean; everShown: boolean; page: boolean }>();
  let focus = 'other';
  /* Each step on a window: its effect happens at one time, its answer comes at another. Either can be
     late; the answer can never come, with or without the effect. */
  const calls: { cmd: string; t0: number; answered: boolean }[] = [];
  const effects: { at: number; go: () => void }[] = [], answers: { at: number; go: () => void }[] = [];
  const timers: { at: number; f: () => void }[] = [];
  const toPage: Said[] = [], toHub: Said[] = [];
  const shownIn = new Map<string, number>(); /* the menu each window's page last drew */
  let quiet = false;
  const ran = new Set<number>();
  let broke: string | null = null, choosing: number | null = null;
  const s = () => menu.state;
  const dump = () => { const st = s(), w = st.want; return JSON.stringify({ want: w && { n: w.n, sent: w.sent, size: !!w.size, focused: w.focused }, cur: st.cur, owed: st.owed, limbo: st.limbo, sweeping: st.sweeping, waiting: st.waiting, busy: st.busy && { step: st.busy.step.k, label: st.busy.label }, windows: Object.fromEntries(windows), focus, quiet, timers: timers.length }); };
  const notes: string[] = [];
  const fail = (why: string) => { broke ??= `${why} ${dump()} ${process.env.MENU_SEED ? notes.slice(-14).join(" / ") : ""}`; };
  function later(ms: number, f: () => void) { timers.push({ at: clock + ms, f }); }

  function call(cmd: string, label: string, work: () => void) {
    /* Only one step the reducer is still waiting on: another can be running only once its deadline
       has passed, when the reducer gives up on it. */
    const live = calls.find(c => !c.answered && clock - c.t0 < (c.cmd === 'open' ? UP_MS : STEP_MS));
    if (live) fail(`two steps at once: ${live.cmd} and ${cmd}`);
    const c = { cmd, t0: clock, answered: false };
    calls.push(c);
    return new Promise<void>((done, no) => {
      const answer = (ok: boolean, why = '') => {
        if (faults && chance(0.03)) { stats.doneUnanswered++; return; }
        const late = faults && chance(0.05);
        if (late) stats.lateAnswer++;
        answers.push({ at: clock + (late ? 6000 + r() * 6000 : 0), go: () => { c.answered = true; if (ok) done(); else no(new Error(why)); } });
      };
      if (faults && chance(0.02)) { stats.never++; return; }
      const hang = faults && chance(0.05);
      if (hang) stats.hung++;
      effects.push({ at: clock + (hang ? 6000 + r() * 6000 : 0), go: () => {
        if (faults && chance(0.12)) { stats.failed[cmd] = (stats.failed[cmd] ?? 0) + 1; return answer(false, `${cmd} failed`); }
        try { work(); answer(true); } catch (e) { answer(false, String((e as Error).message)); }
      } });
    });
  }
  const there = (label: string) => { const w = windows.get(label); if (!w) throw new Error(`no window ${label}`); return w; };
  const shell = {
    windowOpen: (spec: PlainWindowSpec) => call('open', spec.label, () => {
      if (windows.has(spec.label)) throw new Error(`window ${spec.label} is already open`);
      windows.set(spec.label, { visible: false, everShown: false, page: false });
      focus = spec.label;
      if (!faults || chance(0.9)) later(r() * 300, () => { const w = windows.get(spec.label); if (w) { w.page = true; toHub.push({ k: 'menu-up', label: spec.label }); } });
    }),
    windowPlace: (label: string) => call('place', label, () => { there(label); }),
    windowShow: (label: string) => call('show', label, () => { const w = there(label); w.visible = true; w.everShown = true; }),
    /* A page that's alive hears the focus come, and says so for what it's showing. */
    windowFocus: (label: string) => call('focus', label, () => {
      const w = there(label);
      if (!w.visible || focus === label) return;
      focus = label;
      if (w.page && shownIn.has(label)) toHub.push({ k: 'menu-focused', n: shownIn.get(label)!, label, t: clock });
    }),
    /* A page that had the keyboard hears it go, as a click elsewhere, and asks to close. */
    windowHide: (label: string) => call('hide', label, () => {
      const w = there(label);
      w.visible = false;
      if (focus !== label) return;
      focus = 'other';
      if (w.page && shownIn.has(label)) toHub.push({ k: 'menu-closed', n: shownIn.get(label)!, why: 'blur' });
    }),
    windowClose: (label: string) => call('close', label, () => { there(label); windows.delete(label); if (focus === label) focus = 'other'; })
  };
  const io: MenuIO = {
    shell: shell as unknown as Shell, note: line => { notes.push(`${clock} ${line}`); }, row: c => c === 'ada' ? ROW : null, maker: () => true, monitors: () => [MON], quiet: () => quiet,
    post: m => toPage.push(m), after: (ms, f) => later(ms, f), start: 1000,
    run: (cmd, n) => {
      if (ran.has(n)) fail(`a second command for showing ${n}`);
      if (n !== choosing) fail(`a command for showing ${n} outside its choice`);
      ran.add(n); stats.ran++;
    }
  };
  const menu = createBuddyMenu(io);

  /* to the hub, as the channel delivers: in order */
  function deliverToHub() {
    const m = toHub.shift()!;
    if (m.k === 'menu-choose') {
      const st = s();
      choosing = st.want?.n === m.n && st.cur?.label === m.label && !ran.has(m.n) ? m.n : null;
      menu.heard(m);
      choosing = null;
      return;
    }
    menu.heard(m);
  }
  /* each window's page: draws what it's shown at some size, or not at all; answers a ping and a check */
  function deliverToPage() {
    const m = toPage.shift()!;
    if (!('label' in m)) return;
    const w = windows.get(m.label);
    if (!w?.page) return;
    if (m.k === 'menu-ping') { if (!faults || chance(0.9)) toHub.push({ k: 'menu-up', label: m.label }); }
    else if (m.k === 'menu-show') {
      shownIn.set(m.label, m.n);
      if (!faults || chance(0.92)) toHub.push({ k: 'menu-ready', n: m.n, label: m.label, w: 100 + Math.floor(r() * 200), h: 80 + Math.floor(r() * 500) });
    }
    else if (m.k === 'menu-check') { if (m.n === shownIn.get(m.label) && w.visible && focus === m.label) toHub.push({ k: 'menu-focused', n: m.n, label: m.label, t: clock }); }
  }
  const her = (): Rect => ({ x: Math.floor(r() * 1800), y: Math.floor(r() * 900), w: 120, h: 120 });
  /* a window to speak as: usually the current one, sometimes another */
  const someWindow = () => chance(0.85) && s().cur ? s().cur!.label : pick([...windows.keys(), 'buddy-menu-1']);
  const lastShown = () => shownIn.get(s().cur?.label ?? '') ?? 0;
  /* each with how often, against the others */
  const user: [number, () => void][] = [
    [3, () => { const h = her(); menu.heard({ k: 'menu-ask', copy: chance(0.95) ? 'ada' : 'nobody', her: h, at: { x: h.x + 50, y: h.y + 50 }, t: clock }); }],
    [1, () => menu.heard({ k: 'menu-press' })],
    /* the hub closes it whenever buddies are hidden or paused */
    [0.4, () => { quiet = !quiet; if (quiet) menu.close(); }],
    [1, () => toHub.push({ k: 'menu-closed', n: lastShown(), why: pick(['esc', 'blur']) })],
    [2, () => { const cmd: Command = pick<Command>([{ k: 'another', id: 'ada' }, { k: 'dismiss', id: 'ada' }, { k: 'hide', on: true }, { k: 'act', id: 'ada', action: 'eat' }]); toHub.push({ k: 'menu-choose', n: lastShown() - (chance(0.2) ? 1 : 0), label: someWindow(), cmd }); }],
    [0.5, () => toHub.push({ k: 'menu-ready', n: lastShown(), label: someWindow(), w: 150, h: 200 })],
    [0.3, () => toHub.push({ k: 'menu-up', label: someWindow() })],
    /* a page saying it has the keyboard: rightly, or from another window */
    [0.5, () => toHub.push({ k: 'menu-focused', n: lastShown(), label: chance(0.5) ? pick([...windows.keys(), 'buddy-menu-1']) : someWindow(), t: clock })],
    /* A window dies, or just its page, while hidden. The exe says nothing when a window goes, so one
       that dies while shown is only found at the next thing that happens, which this doesn't check. */
    [0.2, () => {
      const hidden = [...windows].filter(([, w]) => !w.visible);
      if (!hidden.length) return;
      const [label, w] = pick(hidden);
      if (chance(0.3)) { windows.delete(label); if (focus === label) focus = 'other'; } else w.page = false;
    }]
  ];
  const total = user.reduce((a, [w]) => a + w, 0);
  function someone() { let x = r() * total; for (const [w, f] of user) { x -= w; if (x < 0) return f; } return user[0]![1]; }

  const due = <T extends { at: number }>(l: T[]) => l.filter(x => x.at <= clock);
  const busy = () => due(effects).length + due(answers).length + toHub.length + toPage.length > 0;
  async function tick(final: boolean) {
    const can: (() => void)[] = [];
    const take = <T extends { at: number; go: () => void }>(l: T[]) => () => { const x = pick(due(l)); l.splice(l.indexOf(x), 1); x.go(); };
    if (due(effects).length) can.push(take(effects));
    if (due(answers).length) can.push(take(answers));
    if (toHub.length) can.push(deliverToHub);
    if (toPage.length) can.push(deliverToPage);
    /* once nothing fails, time only passes when nothing else can happen */
    if (timers.length && (!final || !can.length)) can.push(() => {
      timers.sort((a, b) => a.at - b.at);
      const t = timers.shift()!;
      clock = Math.max(clock, t.at);
      t.f();
    });
    if (!final && (chance(0.3) || !can.length)) can.push(someone());
    /* with nothing else to happen, time passes until a late effect or answer comes */
    const waiting = [...effects, ...answers];
    if (!can.length && waiting.length) can.push(() => { clock = Math.min(...waiting.map(x => x.at)); });
    if (!can.length) return false;
    pick(can)();
    await flush();
    return true;
  }
  /* What must hold whenever nothing is in flight. */
  function always(where: string) {
    const st = s(), w = st.want, cur = st.cur;
    const moving = timers.length > 0 || busy();
    if (w && !(cur && windows.get(cur.label)?.visible && cur.shown === w.n && w.focused) && !moving) fail(`${where}: showing ${w.n} wanted with nothing that will move it`);
    if (busy()) return;
    stats.owedAtOnce = Math.max(stats.owedAtOnce, st.owed.length);
    if (st.limbo.length) stats.swept++;
    stats.windowsAtOnce = Math.max(stats.windowsAtOnce, windows.size);
    /* a close owed with its retry waiting, or a step that never answered with its deadline to come */
    const mending = (st.owed.length > 0 || st.busy !== null) && timers.length > 0;
    for (const [label, win] of windows) {
      /* one whose open never answered is swept again and again until it's closed */
      const known = label === cur?.label || st.owed.includes(label) || (st.busy?.step.k === 'open' && st.busy.label === label) || (st.limbo.includes(label) && st.sweeping);
      if (!known) fail(`${where}: window ${label} exists and nothing will close it`);
      if (win.visible && !(label === cur?.label && w && cur.shown === w.n) && !mending) fail(`${where}: ${label} shown, wanted ${w?.n ?? 'nobody'}`);
      if (win.visible && quiet && !mending) fail(`${where}: shown while buddies are hidden or paused`);
    }
    if (cur?.fresh && !w) fail(`${where}: a window nobody wants, never shown, still current`);
    if (w?.focused && cur && !windows.get(cur.label)?.page && !mending) fail(`${where}: showing ${w.n} counted shown with its page dead`);
    if (w?.focused && cur && windows.get(cur.label)?.visible) stats.shown++;
  }

  for (let i = 0; i < STEPS && !broke; i++) { await tick(false); always(`step ${i}`); }
  /* Then no more faults or people: everything finishes, every timer runs. A dead page stays dead:
     only the reducer replacing its window brings one back. */
  faults = false;
  /* Settled: nothing left to do, but sweeping for windows whose open never answered, if there are
     any, and none of them there. */
  const resolved = () => { const x = s(), w = x.want, cw = x.cur && windows.get(x.cur.label); return !w || (!!cw && cw.visible && x.cur!.shown === w.n && w.focused); };
  const restful = () => { const x = s(); return !busy() && !x.owed.length && !x.busy && resolved() && (!timers.length || (x.limbo.length > 0 && x.sweeping && x.limbo.every(l => !windows.has(l)))); };
  for (let i = 0; i < 600 && !broke && !restful() && await tick(true); i++) always(`settling ${i}`);
  const st = s(), w = st.want;
  if (!restful()) fail('never settled');
  if (st.owed.length) fail('settled: a close still owed');
  for (const label of windows.keys()) if (label !== st.cur?.label) fail(`settled: ${label} left over`);
  if (st.cur?.fresh && !w) fail('settled: a window nobody wants, never shown');
  if (w && !(st.cur && windows.get(st.cur.label)?.visible && windows.get(st.cur.label)?.page && st.cur.shown === w.n && w.focused)) fail(`settled: showing ${w.n} still wanted and not shown`);
  if (!w && [...windows.values()].some(x => x.visible)) fail('settled: shown with nobody wanting it');
  if (focus !== 'other' && !windows.get(focus)?.visible) fail('settled: the keyboard with a hidden window');
  /* And it still works: with nothing failing, a right-click now is shown by a live page that has the
     keyboard. A menu that gave everyone up would keep every rule above. One right-click can be lost
     finding out that the window it had kept has a page that died while hidden: the next one is shown. */
  const works = () => { const end = s(), last = end.want, cw = end.cur && windows.get(end.cur.label); return !!last && !!cw && cw.visible && cw.page && end.cur!.shown === last.n && last.focused && focus === end.cur!.label; };
  for (let tries = 0; tries < 2 && !broke && !works(); tries++) {
    if (tries) stats.lostOne++;
    quiet = false;
    const h = her();
    menu.heard({ k: 'menu-ask', copy: 'ada', her: h, at: { x: h.x + 50, y: h.y + 50 }, t: clock });
    await flush();
    for (let i = 0; i < 600 && !broke && !(restful() && (works() || !s().want)) && await tick(true); i++) always(`last right-click ${i}`);
  }
  if (!broke && !works()) fail('two right-clicks with nothing failing, and neither was shown');
  return broke;
}

test(`${ONE ? `seed ${ONE}` : `${SEEDS} seeds`}: every window always ends where it should, whatever order things happen in`, async () => {
  const seeds = ONE ? [Number(ONE)] : Array.from({ length: SEEDS }, (_, i) => i + 1);
  const failed: string[] = [];
  for (const seed of seeds) {
    const why = await run(seed);
    if (why) failed.push(`seed ${seed}: ${why}`);
    if (failed.length >= 5) break;
  }
  console.log(`menu runs: ${JSON.stringify(stats)}`);
  assert.deepStrictEqual(failed, [], `rerun one with MENU_SEED=<seed>\n${failed.join('\n')}`);
  assert.ok(ONE || (stats.shown > 0 && stats.ran > 0 && stats.hung > 0 && stats.lateAnswer > 0 && stats.doneUnanswered > 0 && stats.never > 0 && stats.owedAtOnce > 1 && stats.windowsAtOnce > 1), 'the runs reached the states they are for');
}, 300000);

/* Seeds named in reviews. The random stream they named has changed since, so each case is pinned in
   buddy-menu.test.ts; these stay as more runs. */
test('review seeds: 1296, 1759, 1907', async () => {
  for (const seed of [1296, 1759, 1907]) assert.strictEqual(await run(seed), null, `seed ${seed}`);
});
