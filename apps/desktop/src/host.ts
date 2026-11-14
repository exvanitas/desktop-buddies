/* The desktop host's world: one simulation for every overlay. It knows nothing of workers or
 windows. The hub starts it, feeds it the cursor and tells it what changes. Overlays join it, and
 it sends each one a frame for its own viewport. World units are physical pixels. */
import { GOODBYE_MS, createSim, lively, type BuddyData, type Frame, type Sim, type Viewport } from '@buddies/engine';
import { createTerrain, type Rectangle } from '@buddies/terrain';
import type { Rect, WindowEntry } from './shell';
import { overlayRect } from './overlay-rect';
import { TICK_MS } from './pacing';
import { windowRects } from './window-terrain';

/* A monitor in physical pixels on the virtual desktop, with a number that lasts the run. x y w h are its
   work area, the world's terrain. `full` is the whole screen. Its overlay's window is that less one
   line, overlay-rect.ts: she can be drawn past the work area, over the taskbar, and still be seen. */
export interface Area extends Rect { i: number; scale: number; full: Rect }
/* what the terrain needs of one: its work area */
export type Work = Omit<Area, 'full'>;
export interface Cursor { x: number; y: number; down: boolean }
export type Message =
/* from the hub */
| { k: 'start'; all: Area[]; pets: BuddyData[] }
| { k: 'monitors'; all: Area[] }
| { k: 'windows'; list: WindowEntry[]; exclude: string[] }
| { k: 'leave'; i: number; n: number } /* overlay window `n`, on monitor `i`, closed */
| { k: 'pets'; pets: BuddyData[] }
| { k: 'dismiss'; id: string }
| { k: 'bring'; id: string } /* to the monitor under the cursor */
| { k: 'pause'; on: boolean }
| { k: 'say'; id: string; text: string; from: string } /* a line another app asked for, marked with its name */
| ({ k: 'cursor' } & Cursor)
/* from an overlay */
| { k: 'join'; me: Area; n: number } /* `n`: which window this is, from its boot. Each the hub opens has its own */
| { k: 'down'; id: string; x: number; y: number; from: number }
| { k: 'move'; id: string; x: number; y: number }
| { k: 'up'; id: string }
| { k: 'over'; id: string | null }
| { k: 'act'; id: string; a: string }
| { k: 'act-all'; a: string }; /* everyone at once: the desktop check asks for it */
export interface Port { postMessage(m: unknown): void }
/* What an overlay hears from the world: its place, a frame with its tick's time, and whether the world is still. */
export type ToOverlay = { k: 'area'; area: Area } | { k: 'frame'; frame: Frame; t: number } | { k: 'still'; on: boolean };
export interface HostIO {
random(): number; now(): number;
after(ms: number, f: () => void): number; cancel(id: number): void;
/* A timer that runs every `ms`, and what stops it. One that gives nothing back can't be stopped, and runs on. */
every(ms: number, f: () => void): (() => void) | void;
note(text: string): void;
}
interface Overlay { i: number | null; n: number | null; vp: Viewport | null; sent: Map<string, string | null | undefined>; last: Frame | null; over: string | null }

const HOLD_MS = 500; /* a press the cursor stream never confirms ends here */

const toRect = (a: Area): Rectangle => ({ id: 'monitor' + a.i, kind: 'screen', rect: { x: a.x, y: a.y, w: a.w, h: a.h }, z: 0, terrain: true, scale: a.scale });
/* An overlay's own CSS pixels: from its window's origin. */
export const viewport = (a: Area): Viewport => { const o = overlayRect(a); return { x: o.x, y: o.y, scale: a.scale, w: o.w / a.scale, h: o.h / a.scale }; };

/* A press held open until the button is seen to come up. The cursor stream and the page's press
   arrive in either order, so it keeps the last button state. A press the stream never confirms
   ends by itself after `ms`. */
export function createHold(ms: number, now: () => number) {
  let active = false, seen = false, at = 0, button = false;
  return {
    get active() { return active; },
    press() { active = true; seen = button; at = now(); },
    end() { active = false; },
    /* Returns true when this ends the hold. */
    cursor(down: boolean) {
      button = down;
      if (active && down) seen = true;
      if (!active || down || !seen) return false;
      active = false; return true;
    },
    expired() {
      if (!active || seen || now() - at <= ms) return false;
      active = false; return true;
    }
  };
}

/* Whether two frames say the same, as JSON would write them: plain data, where a key left undefined is
   no key, and a number that isn't finite, or undefined in a list, is null. It reads them where they
   lie, so a world that ticks 62 times a second makes no garbage to find out that nothing changed. */
const json = (v: unknown) => (typeof v === 'number' && !Number.isFinite(v)) || v === undefined ? null : v;
export function same(a: unknown, b: unknown): boolean {
  a = json(a); b = json(b);
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  let keys = 0;
  for (const k in x) { if (x[k] === undefined) continue; keys++; if (y[k] === undefined || !same(x[k], y[k])) return false; }
  for (const k in y) if (y[k] !== undefined) keys--;
  return keys === 0;
}

export function createHost(io: HostIO) {
  const ports = new Map<Port, Overlay>(), hold = createHold(HOLD_MS, io.now);
  let sim: Sim | null = null, drag: { id: string } | null = null, ticks = 0, pets: BuddyData[] = [], areas: Area[] = [];
  /* Paused, hidden or away, the world is still, and nothing ticks: it costs nothing, however long.
     Whatever changes what it shows meanwhile (a bring, a line, a window that moved, an overlay that
     joined, a timer of its own) is drawn there and then, by one step. A hand holding someone keeps it
     ticking, so a drag goes on as it did. */
  let ticking = false, stilled = false, stopTicks: (() => void) | null = null;
  let windows: Extract<Message, { k: 'windows' }> | null = null, windowsStale = false;
  const homes = new Map<string, string>(), leaving = new Map<string, number>(); /* who's saying goodbye, and the timer that ends it */
  const world = () => sim!;

  function sync(next: BuddyData[]) {
    pets = next;
    world().sync({ pets, bubbles: true, names: true, chatter: 'normal' });
    if (drag && !world().pets.has(drag.id)) { drag = null; hold.end(); }
  }

  /* The hub's list. A buddy called back in time stays, and one still saying goodbye to a list that
     doesn't hold it gets to finish. */
  function wanted(next: BuddyData[]) {
    for (const [id, timer] of leaving) if (next.some(p => p.id === id)) { io.cancel(timer); leaving.delete(id); }
    sync([...next, ...pets.filter(p => leaving.has(p.id))]);
  }

  /* An overlay's place comes from here, never from the boot data it was opened with: the layout can
     change while a page loads. It's told the current one. */
  function place(port: Port, s: Overlay) {
    const a = areas.find(m => m.i === s.i);
    s.vp = a ? viewport(a) : null; s.last = null;
    if (a) port.postMessage({ k: 'area', area: a });
  }

  function start(m: Extract<Message, { k: 'start' }>) {
    areas = m.all;
    sim = createSim({
      terrain: createTerrain(m.all.map(toRect)), pace: lively,
      random: io.random, now: io.now, after: later, cancel: io.cancel
    });
    sync(m.pets);
    for (const [port, s] of ports) place(port, s);
    clock();
    io.every(10000, () => io.note(`rate ticks=${ticks}`));
  }

  const still = () => !!sim && !!world().world.paused && !drag && !hold.active;
  /* Ticks while the world runs, or a hand holds someone; stops when it's still. Overlays are told
     when it stops and starts: while it runs they draw on every animation frame, as they always did,
     and while it's still they draw only what comes. */
  function clock() {
    if (!still()) {
      if (!ticking) {
        ticking = true; const stop = io.every(TICK_MS, step); stopTicks = typeof stop === 'function' ? stop : null;
        if (stilled) { stilled = false; tell({ k: 'still', on: false }); }
      }
    } else if (ticking && stopTicks) { stopTicks(); stopTicks = null; ticking = false; stilled = true; tell({ k: 'still', on: true }); }
  }
  function tell(m: Extract<ToOverlay, { k: 'still' }>) { for (const [port, s] of ports) if (s.vp) port.postMessage(m); }
  /* After anything that can change what's shown: a still world, its timer stopped, takes the one step
     that shows it. A timer that can't be stopped ticks on and shows it, as it always did. */
  function settle() {
    clock();
    if (!ticking) update(io.now());
  }
  /* The world's own timers, and the host's, are followed by that step too. */
  function later(ms: number, f: () => void) { return io.after(ms, () => { f(); if (sim) settle(); }); }
  /* Coming back, the world's clock is moved on to now while it's still paused, so its first tick
     after the pause takes one tick's time, not the whole pause's. */
  function pause(on: boolean) {
    if (!on && world().world.paused) world().advance(io.now());
    world().world.paused = on;
  }

  /* Screens and windows are one list, so neither can undo the other. */
  function refit() {
    windowsStale = false;
    world().setRects([...areas.map(toRect), ...(windows ? windowRects(windows.list, areas, windows.exclude) : [])]);
  }

  function step() {
    ticks++;
    update(io.now());
    clock();
  }
  function update(t: number) {
    if (hold.expired()) release();
    if (windowsStale) refit();
    world().advance(t);
    for (const p of world().pets.values()) {
      const was = homes.get(p.id);
      if (was !== undefined && was !== p.P.home) io.note(`crossed ${p.id} ${was} to ${p.P.home} as ${p.P.state}`);
      homes.set(p.id, p.P.home);
    }
    publish(t);
  }

  /* Images are big and rarely change, so each is sent once per overlay, when it comes into view. Each
     frame carries its tick's time, by which overlays draw it on the display's beat: pacing.ts. */
  function publish(t: number) {
    for (const [port, s] of ports) {
      if (!s.vp) continue;
      const frame = world().frame(s.vp);
      /* one who left is sent her images again if she comes back */
      for (const id of s.sent.keys()) if (!frame.pets.some(f => f.id === id)) s.sent.delete(id);
      for (const f of frame.pets) {
        if (f.off || s.sent.get(f.id) === f.src) delete f.src;
        else s.sent.set(f.id, f.src);
      }
      if (s.last && same(frame, s.last)) continue;
      s.last = frame;
      port.postMessage({ k: 'frame', frame, t });
    }
  }

  /* A new list of monitors. A buddy keeps to its own monitor by id, and overlays that stay get
     their new place. */
  function monitors(all: Area[]) {
    areas = all;
    refit();
    for (const [port, s] of ports) place(port, s);
  }
  /* Only that window goes. Its replacement on the same monitor can have joined first, from its own port. */
  function leave(i: number, n: number) {
    const before = hovered();
    for (const [port, s] of ports) if (s.i === i && s.n === n) ports.delete(port);
    const after = hovered();
    for (const x of before) if (!after.has(x)) world().input.leave(x);
  }
  /* It waves, says so, and goes in a burst of stars. */
  function dismiss(id: string) {
    const pet = world().pets.get(id); if (!pet || leaving.has(id)) return;
    pet.farewell();
    leaving.set(id, later(GOODBYE_MS, () => { world().poof(id); leaving.delete(id); sync(pets.filter(p => p.id !== id)); }));
  }

  /* She drops in near the top of the monitor under the cursor, at its x. A hand that held her lets go,
     so what it does next throws nothing. */
  function bring(id: string) {
    if (!world().pets.has(id)) return io.note(`bring: ${id} isn't here`);
    if (drag && drag.id === id) { drag = null; hold.end(); }
    world().bring(id, world().world.mouse);
    io.note(`brought ${id}`);
  }

  function press(m: Extract<Message, { k: 'down' }>) { drag = { id: m.id }; hold.press(); world().input.down(m.id, m.x, m.y); io.note(`press ${m.id} from overlay ${m.from}`); }
  function release() { const { id } = drag!; drag = null; hold.end(); world().input.up(id); const P = world().pets.get(id)!.P; io.note(`release ${id} state=${P.state} vx=${P.vx.toFixed(1)} vy=${P.vy.toFixed(1)}`); }
  function cursor(c: Cursor) {
    world().input.pointer(c.x, c.y);
    const ended = hold.cursor(c.down);
    if (!drag) return;
    world().input.move(drag.id, c.x, c.y);
    if (ended) release();
  }
  /* Overlays report what the cursor is over, each on its own monitor. Hover is the union. */
  function over(port: Port, id: string | null) {
    const before = hovered();
    ports.get(port)!.over = id;
    const after = hovered();
    for (const x of before) if (!after.has(x)) world().input.leave(x);
    for (const x of after) if (!before.has(x)) world().input.enter(x);
  }
  const hovered = () => new Set([...ports.values()].flatMap(s => s.over ? [s.over] : []));

  return {
    connect(port: Port) { ports.set(port, { i: null, n: null, vp: null, sent: new Map(), last: null, over: null }); },
    message(port: Port, m: Message) {
      if (!ports.has(port)) return; /* an overlay that left can still have messages on the way */
      if (m.k === 'start') { if (!sim) start(m); return; }
      if (m.k === 'join') { const s = ports.get(port)!; s.i = m.me.i; s.n = m.n; place(port, s); io.note(`joined overlay ${m.me.i}`); if (stilled && s.vp) port.postMessage({ k: 'still', on: true }); if (sim) settle(); return; }
      if (!sim) return;
      handle(port, m);
      /* the cursor alone moves nothing in a still world, unless a hand holds someone */
      if (m.k !== 'cursor' || ticking) settle();
    },
    get sim() { return sim; }
  };

  function handle(port: Port, m: Message) {
    if (m.k === 'cursor') cursor(m);
    else if (m.k === 'monitors') monitors(m.all);
    /* Only the latest counts, and it lands on the next tick, however many came before it. */
    else if (m.k === 'windows') { windows = m; windowsStale = true; }
    else if (m.k === 'leave') leave(m.i, m.n);
    else if (m.k === 'pets') wanted(m.pets);
    else if (m.k === 'dismiss') dismiss(m.id);
    else if (m.k === 'bring') bring(m.id);
    else if (m.k === 'pause') pause(m.on);
    else if (m.k === 'down') press(m);
    else if (m.k === 'move') { if (!drag) world().input.move(m.id, m.x, m.y); }
    else if (m.k === 'up') { if (drag && drag.id === m.id) release(); }
    else if (m.k === 'over') over(port, m.id);
    else if (m.k === 'act') world().act(m.id, m.a);
    else if (m.k === 'say') world().say(m.id, m.text, m.from);
    else if (m.k === 'act-all') world().actAll(m.a);
  }
}
