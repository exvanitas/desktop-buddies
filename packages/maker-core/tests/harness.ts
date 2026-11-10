/* The Maker on fake I/O: a clock that only moves when told, art with no canvas, and a log of what
   reached the world and the store. */
import type { Buddy, Frame, ImageRef } from '@buddies/buddy-file';
import { createMaker, memoryStore, type ArtTools, type Change, type MakerBuddy, type MakerFile, type MakerState, type MakerStore, type Saved } from '../src';

export const png = (name: string) => `data:image/png;base64,${Buffer.from(name).toString('base64')}`;
export const BOX = { x0: .1, y0: .1, x1: .9, y1: 1 };
export const REF: ImageRef = { ow: 300, oh: 300, w: 300, h: 300, cx: 150, by: 280, side: 280 };
export const frame = (name: string): Frame => ({ src: png(name), bb: BOX });
export const buddy = (more: Partial<MakerBuddy> = {}): MakerBuddy => ({ id: 'x', character: 'cabc', name: 'Ann', size: 120, faces: 'right', base: frame('base'), ref: REF, poses: {}, ...more });

export const file = (name: string, type = 'image/png', text = ''): MakerFile => ({ name, type, text: async () => text });

export const fakeArt = (more: Partial<ArtTools> = {}): ArtTools => ({
  processBase: async src => ({ frame: { src, bb: BOX }, ref: REF, photo: false }),
  processFrames: async srcs => ({ frames: srcs.map(src => ({ src, bb: BOX })), scale: 1 }),
  matchScale: async () => 1.5,
  bottomOf: async () => BOX.y1,
  fromShimeji: async list => list.some(f => /shime1\.png$/.test(f.name)) ? { base: { src: list[0]!.src, bb: BOX }, ref: REF, poses: { walk: { frames: [{ src: list[0]!.src, bb: BOX }], fps: 6, scale: 1 } }, faces: 'left', size: 100 } : null,
  natSort: (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
  ...more
});

export interface Options { saved?: Saved; store?: MakerStore; art?: Partial<ArtTools>; sample?: Buddy }

export function harness(o: Options = {}) {
  const toasts: string[] = [], acts: [string, string][] = [], changes: Change[] = [], order: string[] = [], pages: MakerState[] = [], built: string[] = [];
  const real = o.store || memoryStore(o.saved);
  const store: MakerStore = { load: () => real.load(), save: s => { order.push('store'); return real.save(s); } };
  let now = 0, next = 1, draws = 0;
  const timers = new Map<number, { at: number; f: () => void }>();
  const art = fakeArt(o.art);
  const maker = createMaker({
    store, art, toast: m => { toasts.push(m); },
    world: { sync: () => { order.push('world'); }, act: (id, a) => { acts.push([id, a]); }, actAll: a => { acts.push(['*everyone*', a]); } },
    samples: { build: async kind => (built.push(kind), o.sample || { name: kind, base: frame(kind), ref: REF, poses: {}, faces: 'right', size: 120 }), thumb: kind => png(kind) },
    readImage: async f => f && /^image\//.test(f.type) ? png(f.name) : null,
    exportPage: s => { pages.push(s); },
    after: (ms, f) => { timers.set(next, { at: now + ms, f }); return next++; },
    cancel: id => { timers.delete(id); },
    random: () => (++draws * .137) % 1
  });
  maker.subscribe(c => { changes.push(c); });
  /* moves the clock on, running what comes due in order */
  function tick(ms: number) {
    const until = now + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); now = due[1].at; due[1].f();
    }
    now = until;
  }
  /* how many saves reached the store */
  const saves = () => order.filter(x => x === 'store').length;
  /* the samples built, by kind */
  return { maker, toasts, acts, changes, order, pages, built, tick, saves, store: real };
}

/* A Maker already started, holding these buddies with the first selected. */
export async function started(pets: MakerBuddy[] = [buddy()], o: Options = {}) {
  const h = harness({ saved: { pets, started: true }, ...o });
  await h.maker.start();
  h.order.length = 0; h.changes.length = 0;
  return h;
}
