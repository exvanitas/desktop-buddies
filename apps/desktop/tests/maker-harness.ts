/* The Maker's whole save path on the fake exe: the real hub, the real page logic and the real
   maker-core, with art that needs no canvas and clocks that only move when told. */
import { createHash } from 'node:crypto';
import { POSES, write, type Buddy, type Frame, type Pose, type PoseKey } from '@buddies/buddy-file';
import type { MakerState } from '@buddies/maker-core';
import type { Message } from '../src/host';
import { createHub } from '../src/hub-core';
import type { HubState, MakerBoot, Said } from '../src/manager-api';
import { createManagerClient } from '../src/manager-client';
import { createMakerView, type MakerViewHost } from '@buddies/maker-view';
import { closingDialog } from '../src/maker-closing';
import { mountMaker } from '../src/maker-page';
import type { SaveState } from '../src/maker-store';
import { MANAGER } from '../src/manager-window';
import type { Monitor } from '../src/shell';
import { createFakeExe, type FakeExe } from '../src/shell-fake';
import { createBus, type Wire } from '../src/wire';

/* The hub's queue is waited on a tick at a time, and Node's digest answers from a thread pool, so
   a big buddy's names could take more ticks than a test gives. The same hash, answered at once. */
const subtle = globalThis.crypto.subtle as { digest: (alg: string, b: Uint8Array) => Promise<ArrayBuffer> };
subtle.digest = async (alg, b) => { if (alg !== 'SHA-256') throw new Error(alg); const h = createHash('sha256').update(b).digest(); return h.buffer.slice(h.byteOffset, h.byteOffset + h.length) as ArrayBuffer; };

export const BOX = { x0: .1, y0: .1, x1: .9, y1: 1 };
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/* A data URL that passes for a real PNG, different for each seed. */
export const png = (seed: string) => `data:image/png;base64,${Buffer.from([...SIGNATURE, ...Buffer.from(seed)]).toString('base64')}`;
export const frame = (seed: string): Frame => ({ src: png(seed), bb: BOX });
export const small = (character: string, name = 'Pip', more: Partial<Buddy> = {}): Buddy => ({ character, name, base: frame(`${character}-base`), poses: { walk: { frames: [frame(`${character}-walk`)], fps: 6, scale: 1 } }, ...more });
/* The shape of the largest real buddy we've seen: 40 poses, 1145 frames, every image different. */
export function bigBuddy(character = 'cbig', name = 'Big'): Buddy {
  const poses: Partial<Record<PoseKey, Pose>> = {};
  POSES.slice(0, 40).forEach((p, i) => { poses[p.key as PoseKey] = { frames: Array.from({ length: i < 25 ? 29 : 28 }, (_, j) => frame(`${character}-${p.key}-${j}`)), fps: 6, scale: 1 }; });
  return small(character, name, { poses });
}
const MONITOR: Monitor = { i: 0, name: 'A', primary: true, scale: 1, x: 0, y: 0, w: 1920, h: 1040, full: { x: 0, y: 0, w: 1920, h: 1080 } };

export const tick = () => new Promise(r => setTimeout(r));
/* Her revision as this Manager last heard it, which a delete has to name. */
export const revOf = (c: { state: HubState | null | undefined }, id: string) => c.state?.buddies.find(b => b.id === id)?.rev ?? -1;
export const manifestOf = (exe: FakeExe, id: string) => new TextDecoder().decode(exe.files.get(`library/${id}/buddy.json`));
export const saved = (exe: FakeExe, id: string) => { const f = exe.files.get(`library/${id}/buddy.json`); return f ? (JSON.parse(new TextDecoder().decode(f)) as { buddy: Buddy }).buddy : null; };
export const changes = (exe: FakeExe) => exe.calls.filter(c => /^data_(write|move|delete)$/.test(c.cmd));
/* Each save of a buddy has one step that makes the new copy hers: a move into her home when she's
   new, or her manifest written there when she's home already. */
export const lands = (exe: FakeExe, id: string) => exe.calls.filter(c => (c.cmd === 'data_move' && (c.args as { to: string }).to === `library/${id}`) || (c.cmd === 'data_write' && c.path === `library/${id}/buddy.json`)).length;

export function createDisk(api = 1) { return createFakeExe({ monitors: [MONITOR], api }); }

/* A run of the hub on this disk. */
export async function hubOn(exe: FakeExe, seed = write(small('cseed', 'Seed')), bus = createBus<Said>(), io: { now?: () => number } = {}) {
  exe.revive();
  const sent: Message[] = [], timers: { ms: number; f: () => void }[] = [], hubWire = bus.wire();
  const hub = createHub({ shell: exe.shell, send: m => sent.push(m), seed: async () => seed, after: (ms, f) => { timers.push({ ms, f }); }, wire: hubWire, ...io });
  await hub.start();
  /* Time for everything that can happen to happen. A race, because a test can be holding the queue. */
  const done = async () => { for (let i = 0; i < 12; i++) { await tick(); await Promise.race([hub.settled, tick()]); } };
  async function manager() {
    const client = createManagerClient({
      wire: bus.wire(), session: `m${Math.random()}`, after: () => () => {},
      shimeji: async () => null, closeWindow: () => exe.shell.windowClose(MANAGER.label)
    });
    await done();
    return { client, s: () => client.state as HubState };
  }
  /* Calling a late timer: the hub's own retries, and how long it waits for a window to answer. */
  const fire = (ms: number) => { for (const t of timers.filter(x => x.ms === ms)) { timers.splice(timers.indexOf(t), 1); t.f(); } };
  /* The hub alone goes, and any windows stay. Start another on the same bus. */
  const stop = () => hubWire.close();
  return { exe, hub, bus, sent, timers, done, manager, fire, stop };
}
export type HubRun = Awaited<ReturnType<typeof hubOn>>;

export const art = {
  processBase: async (src: string) => ({ frame: { src, bb: BOX }, ref: { ow: 300, oh: 300, w: 300, h: 300, cx: 150, by: 280, side: 280 }, photo: false }),
  processFrames: async (srcs: string[]) => ({ frames: srcs.map(src => ({ src, bb: BOX })), scale: 1 }),
  matchScale: async () => 1.5,
  bottomOf: async (_src: string): Promise<number | null> => BOX.y1,
  fromShimeji: async () => null,
  natSort: (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })
};
export const pickedFile = (name: string) => ({ name, type: 'image/png', text: async () => '' });

let pages = 0;
/* A Maker window on this hub. Its clock only moves through `pass`. */
/* A page in a window, with what that window was opened with. Most tests want `makerOn`, which has
   the hub open the window as the Manager does. */
export function pageOn(r: HubRun, boot: MakerBoot, more: { buildPage?: (s: MakerState) => Promise<string>; session?: string; wireOf?: (w: Wire<Said>) => Wire<Said>; art?: typeof art; dom?: boolean } = {}) {
  const timers = new Map<number, { at: number; f: () => void }>(), states: SaveState[] = [], toasts: string[] = [];
  let now = 0, next = 1, leaving = () => {}, host!: MakerViewHost;
  const real = r.bus.wire(), wire = more.wireOf ? more.wireOf(real) : real;
  /* What the real page's dialog does, as far as logic can tell. */
  const closing = {
    stopped: false, asked: null as null | { title: string; actions: { label: string; run(): void }[] },
    show() { closing.stopped = true; closing.asked = null; },
    ask(what: { title: string }, actions: { label: string; run(): void }[]) { closing.asked = { title: what.title, actions }; },
    hide() { closing.stopped = false; closing.asked = null; },
    labels: () => closing.asked?.actions.map(a => a.label) ?? [],
    press(label: string) { const a = closing.asked?.actions.find(x => x.label === label); if (!a) throw new Error(`no ${label}: ${closing.labels().join()}`); a.run(); }
  };
  /* With `dom`, the real view and the real closing dialog, in whatever DOM the test file has. */
  const root = more.dom ? document.body.appendChild(document.createElement('div')) : null as unknown as HTMLElement;
  const page = mountMaker({
    shell: r.exe.shell, wire, session: more.session ?? `p${++pages}`, boot, root,
    view: (el, maker, h) => {
      host = h; h.onSave(s => { states.push(s); }); h.onToast?.(m => { toasts.push(m); });
      if (more.dom) createMakerView(el, maker, h, { store: () => ({ getItem: () => null, setItem() {} }), moves: () => false, copy: async () => {}, every: () => () => {}, after: (ms, f) => { const t = setTimeout(f, ms); return () => clearTimeout(t); } });
    },
    art: more.art ?? art, closing: more.dom ? closingDialog() : closing, samples: { build: async kind => ({ name: kind, base: frame(kind), poses: {} }), thumb: kind => png(kind) },
    readImage: async f => f && /^image\//.test(f.type) ? png(f.name) : null,
    buildPage: more.buildPage ?? (async s => `<html>${s.pets.map(p => p.name).join()}</html>`),
    after: (ms, f) => { timers.set(next, { at: now + ms, f }); return next++; },
    cancel: id => { timers.delete(id); },
    random: () => Math.random(),
    onLeaving: f => { leaving = f; }
  });
  /* The clock moves on, and whatever's due runs, each with time to take effect. */
  async function pass(ms: number) {
    const until = now + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); now = due[1].at; due[1].f();
      await r.done();
    }
    now = until;
    await r.done();
  }
  return {
    ...page, pass, states, toasts, closing,
    /* Art coming in, as the view brings it: registered first, so Close waits for it. */
    track<T>(run: () => Promise<T>) { const end = page.host.work?.(); if (!end) return null; return run().finally(end); },
    get host() { return host; },
    get saveState() { return states.at(-1)!; },
    /* The window goes, as Alt+F4 does it: pagehide, then nothing more from it. */
    async killed() { leaving(); await tick(); real.close(); await r.done(); },
    /* The window goes, with no warning at all. */
    crashed() { real.close(); timers.clear(); }
  };
}
export type Page = ReturnType<typeof pageOn>;

/* The Maker as the Manager opens it: the hub opens its window, on her or on nobody, and this is the
   page in it. A test's further asks go through the hub the same way. */
export async function makerOn(r: HubRun, id?: string, more: Parameters<typeof pageOn>[2] = {}) {
  const m = await r.manager();
  const a = id === undefined ? await m.client.newBuddy() : await m.client.editBuddy(id);
  if (!a.ok) throw new Error(`the Maker didn't open: ${a.failure.title}`);
  const open = r.exe.calls.filter(c => c.cmd === 'window_open' && (c.args as { spec: { page: string } }).spec.page === 'maker.html').at(-1)!;
  const page = pageOn(r, (open.args as { spec: { boot: MakerBoot } }).spec.boot, more);
  await r.done();
  return page;
}

/* The hub on a disk that holds these, with a window open on the first. */
export async function holding(...buddies: Buddy[]) {
  const exe = createDisk();
  const r = await hubOn(exe, write(buddies[0] ?? small('cseed', 'Seed')));
  const m = await r.manager();
  for (const b of buddies.slice(1)) await m.client.importFiles([{ name: 'x.buddy', path: 'x.buddy', size: 1, text: async () => write(b), url: async () => '' }]);
  await r.done();
  const id = buddies[0]?.character ?? 'cseed';
  const page = await makerOn(r, id);
  return { exe, r, m, page, id };
}
/* Replacing a buddy through the Manager, as a person does it: the import asks, and they say
   Replace. Each answer is the Replace's, for a file that asked. */
export async function importing(m: { client: ReturnType<typeof createManagerClient> }, b: Buddy) {
  const answers = await m.client.importFiles([{ name: `${b.name}.buddy`, path: `${b.name}.buddy`, size: 1, text: async () => write(b), url: async () => '' }]);
  return Promise.all(answers.map(async a => a.ok && a.value?.asked ? { ...await m.client.answerReplace(a.value.asked, 'replace') as typeof a, files: a.files } : a));
}
