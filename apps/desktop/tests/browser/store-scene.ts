/* The Store screenshots' desktop, in one page: the real hub on the fake exe, as fake-hub.ts has it,
   the real world (host.ts) on a clock this page steps, and the real view drawing it with the real
   overlay CSS over a drawn desktop. Run by tools/store/screenshots.mjs. Never ships.

   The world runs on a seeded random and a stepped clock, so the same steps draw the same picture.
   The windows are plain boxes this page draws, at the places the fake exe reports them. */
import { createView } from '@buddies/view';
import { createHost, viewport, type Area, type Message, type Port } from '../../src/host';
import { createHub } from '../../src/hub-core';
import { createLibrary } from '../../src/library';
import type { Said } from '../../src/manager-api';
import { createManagerClient } from '../../src/manager-client';
import { overlayRect } from '../../src/overlay-rect';
import { createFakeExe } from '../../src/shell-fake';
import type { Monitor, WindowEntry } from '../../src/shell';
import { MENU_CHANNEL, broadcastWire } from '../../src/wire';

export interface Boot {
  /* the buddy file's text */
  sample: string;
  /* copies of her out */
  copies: number;
  /* physical pixels, and the display's scale */
  screen: { w: number; h: number; scale: number; taskbar: number };
  windows: { x: number; y: number; w: number; h: number; exe: string }[];
  /* the local API on, with these apps allowed */
  api?: string[];
  seed: number;
}

/* mulberry32: small, and the same everywhere */
const seeded = (s: number) => () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/* What a host's timers need, on a clock that only moves when it's told to. */
function steppedClock() {
  let t = 1000, n = 0;
  const once = new Map<number, { at: number; f: () => void }>(), every: { ms: number; next: number; f: () => void }[] = [];
  return {
    now: () => t,
    after(ms: number, f: () => void) { once.set(++n, { at: t + ms, f }); return n; },
    cancel(id: number) { once.delete(id); },
    every(ms: number, f: () => void) { every.push({ ms, next: t + ms, f }); },
    /* Fires everything due in the next `ms`, in time order, timers before ticks at the same time. */
    run(ms: number) {
      const end = t + ms;
      for (;;) {
        let at = Infinity, timer: number | null = null, tick: (typeof every)[number] | null = null;
        for (const [id, o] of once) if (o.at < at) { at = o.at; timer = id; }
        for (const e of every) if (e.next < at) { at = e.next; timer = null; tick = e; }
        if (at > end) break;
        t = at;
        if (timer !== null) { const o = once.get(timer)!; once.delete(timer); o.f(); }
        else { tick!.next += tick!.ms; tick!.f(); }
      }
      t = end;
    }
  };
}

const px = (n: number) => `${n}px`;
function place(el: HTMLElement, r: { x: number; y: number; w: number; h: number }, scale: number) {
  Object.assign(el.style, { left: px(r.x / scale), top: px(r.y / scale), width: px(r.w / scale), height: px(r.h / scale) });
}

/* A window drawn as a plain box: a bar with three buttons, and grey lines for content. No words. */
function drawWindow(r: Boot['windows'][number], scale: number, z: number) {
  const w = document.createElement('div'); w.className = 'win'; place(w, r, scale); w.style.zIndex = String(10 + z);
  const bar = document.createElement('div'); bar.className = 'bar';
  for (let i = 0; i < 3; i++) bar.append(document.createElement('i'));
  const body = document.createElement('div'); body.className = 'body';
  const lines = Math.max(2, Math.floor((r.h / scale - 70) / 26));
  for (let i = 0; i < lines; i++) { const l = document.createElement('b'); l.style.width = `${[86, 72, 92, 64, 80, 58][i % 6]}%`; body.append(l); }
  w.append(bar, body);
  return w;
}

async function boot(o: Boot) {
  const { w, h, scale, taskbar } = o.screen;
  const monitor: Monitor = { i: 0, name: 'A', primary: true, scale, x: 0, y: 0, w, h: h - taskbar, full: { x: 0, y: 0, w, h } };
  const exe = createFakeExe({ monitors: [monitor] }), library = createLibrary(exe.shell, () => {});
  const id = await library.add(o.sample);
  await exe.shell.dataWrite('settings.json', JSON.stringify({
    out: Array.from({ length: o.copies }, () => id), noSeed: true,
    ...o.api ? { api: true, apiApps: o.api.map(name => ({ name, allow: true })) } : {}
  }));
  const list: WindowEntry[] = o.windows.map((r, i) => ({ id: i + 1, ...r, z: i, max: false, topmost: false, tool: false, layered: false, class: 'App' }));
  exe.setWindows(list);

  /* the desktop, back to front: wallpaper, windows, taskbar, then the overlay, which is always on top */
  const desk = document.getElementById('desk')!;
  list.forEach((e, i) => desk.append(drawWindow(o.windows[i]!, scale, list.length - e.z)));
  const bar = document.createElement('div'); bar.className = 'taskbar';
  place(bar, { x: 0, y: h - taskbar, w, h: taskbar }, scale);
  for (let i = 0; i < 6; i++) bar.append(document.createElement('i'));
  desk.append(bar);

  const clock = steppedClock();
  const host = createHost({ random: seeded(o.seed), now: clock.now, after: clock.after, cancel: clock.cancel, every: clock.every, note: () => {} });
  const root = document.getElementById('root')!;
  let area: Area | null = null;
  const vp = { x: 0, y: 0, scale, w: w / scale, h: h / scale };
  const view = createView({ root, input: { pointer() {}, down() {}, move() {}, up() {}, enter() {}, leave() {} } as never, viewport: vp, pointerCapture: false, hover: false });
  /* the overlay's end of the world, as overlay.ts has it, drawing each frame as it comes */
  const overlay: Port = { postMessage(m: { k: string; frame?: never; area?: Area }) {
    if (m.k === 'frame') view.apply(structuredClone(m.frame!));
    else if (m.k === 'area') { area = m.area!; Object.assign(vp, viewport(area)); place(root, overlayRect(area), scale); }
  } };
  const hubPort: Port = { postMessage() {} };
  host.connect(hubPort); host.connect(overlay);
  const send = (m: Message) => {
    host.message(hubPort, structuredClone(m));
    if (m.k === 'start') host.message(overlay, { k: 'join', me: m.all[0]!, n: 1 });
  };

  const hub = createHub({ shell: exe.shell, send, seed: async () => null, after: (ms, f) => { setTimeout(f, ms); }, wire: broadcastWire<Said>(), menuWire: broadcastWire<Said>(MENU_CHANNEL) });
  await hub.start();
  await hub.settled;
  const client = createManagerClient({
    wire: broadcastWire<Said>(), session: 'store-shots',
    after: (ms, f) => { const t = setTimeout(f, ms); return () => clearTimeout(t); },
    shimeji: async () => null, closeWindow: async () => {}
  });
  return { exe, hub, client, id, clock, host };
}

type Run = Awaited<ReturnType<typeof boot>>;
let run: Run;
const b64 = (bytes: Uint8Array) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };

Object.assign(window, {
  S: {
    boot: async (o: Boot) => { run = await boot(o); return run.id; },
    /* the world's clock, moved on by this much */
    run: (ms: number) => run.clock.run(ms),
    /* what the exe's asset provider would serve */
    file: (path: string) => { const f = run.exe.files.get(path); return f ? b64(f) : null; },
    /* where each copy is and what she's doing, to choose a moment by */
    where: () => [...(run.host.sim?.pets ?? [])].map(([id, p]) => ({ id, x: Math.round(p.P.x), y: Math.round(p.P.y), state: p.P.state, surf: p.P.surf })),
    /* a window of the app's own, shown as a picture of it: the real page, shot on its own */
    showWindow: (src: string, r: { x: number; y: number; w: number; h: number }) => {
      const img = document.createElement('img'); img.className = 'own'; img.src = src;
      Object.assign(img.style, { left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h) });
      document.getElementById('desk')!.append(img);
      return new Promise(done => { img.onload = img.onerror = done; });
    }
  }
});
