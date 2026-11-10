/* The page half of the browser check: the real view on the real createMaker, with memoryStore, real
   canvas art and real sample drawing, and a fake host that writes down what it's asked. It's a plain web
   page, so this is also what the view needs from a page that isn't the exe. */
import { bottomOf, fromShimeji, matchScale, natSort, processBase, processFrames } from '@buddies/art';
import { read, type Buddy, type PoseKey, POSES } from '@buddies/buddy-file';
import { createMaker, createSamples, memoryStore, type MakerBuddy, type MakerFile, type MakerStore, type Paper, type Pen, type Saved } from '@buddies/maker-core';
import { createMakerView, everyoneSettings, type MakerViewHost, type SaveState } from '../../src';

export interface Boot {
  fixture: keyof typeof FIXTURES;
  /* host pieces: all there unless told otherwise */
  window?: boolean; tryOnScreen?: boolean; exportPage?: boolean; onToast?: boolean;
  world?: boolean;
  /* the store refuses to save */
  storage?: 'none';
  /* never start the Maker, to look at the moment before */
  hold?: boolean;
}

const sorted = (o: unknown): unknown => Array.isArray(o) ? o.map(sorted) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)])) : o;
const dataUrl = (b: Blob) => new Promise<string>(done => { const r = new FileReader(); r.onload = () => done(r.result as string); r.readAsDataURL(b); });
const fetched = async (url: string) => dataUrl(await (await fetch(url)).blob());
const readImage = (f: MakerFile | null | undefined) => new Promise<string | null>(res => {
  if (!f || !/^image\//.test(f.type)) return res(null);
  const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => res(null); r.readAsDataURL(f as File);
});
const paper: Paper = side => {
  const c = document.createElement('canvas'); c.width = c.height = side;
  return { pen: c.getContext('2d') as unknown as Pen, png: () => c.toDataURL('image/png') };
};
const art = { processBase, processFrames, matchScale, bottomOf, fromShimeji, natSort };
const samples = createSamples(paper, art);

const olive = async () => read(await (await fetch('/__sample.json')).text());
const fromArt = async (file: string, name: string, more: Partial<Buddy> = {}): Promise<Buddy> => {
  const r = (await processBase(await fetched(`/__art/${file}`)))!;
  return { character: `c${name.replace(/\W/g, '')}x`, name, size: 120, faces: 'right', base: r.frame, ref: r.ref, poses: {}, ...more };
};
const LONG = 'I have been sitting here for a long while thinking about how the light moves across your desk in the afternoon, and how I would very much like to walk along the top of that window, if it is all the same to you, and then come back down again for a small snack and perhaps a very short nap on your taskbar.';
const WORDY: Buddy['lines'] = {
  chat: [LONG.slice(0, 300), 'A short one', 'Medium sized line that is not so short at all'],
  hello: [LONG.slice(0, 120), 'Hi'], held: [LONG.slice(0, 200)], think: ['x'.repeat(300)]
};

/* An artist's real lengths: up to 38 characters, about 285 px at the desktop's 13 px bold. One word
   alone is longer than a narrow bubble. The first is as long as a line on a sticker gets. */
const LINES_38: Buddy['lines'] = {
  hello: ['Hello hello, it is me, hi!', 'Have you been staring at that all day?', 'Hey! That tickles, please stop it now!'],
  love: ['Mmm, that is the good spot right there', 'Supercalifragilisticexpialidociously!!'],
  chat: ['I think I will take a little nap here.', 'Could you scroll a bit slower for me?'],
  climb: ['Up I go, up and up, do not look down!'], drop: ['Whoa whoa whoa, catch me if you can!!']
};

const room = (...pets: Buddy[]): Saved => ({ pets: pets.map((b, i): MakerBuddy => ({ id: `b${i}`, ...b })), started: true });
/* Art that runs past its stored box, as a hand-set file has. The window must leave such a box alone. */
const OUTSIDE = { x0: .36, y0: .4, x1: .62, y1: .78 };
const handSet = async () => {
  const n = await olive();
  n.base.bb = { ...OUTSIDE };
  for (const key of ['stand', 'walk', 'wave'] as const) for (const f of n.poses[key]?.frames || []) f.bb = { ...OUTSIDE };
  original = JSON.stringify(n);
  return room(n);
};
const FIXTURES = {
  handSet,
  empty: async () => room(),
  one: async () => room(await fromArt('sprout/main.webp', 'Sprout')),
  olive: async () => room(await olive()),
  pip: async () => room(await samples.build('pip')),
  /* every pose has art: Olive's, spread round, so every image is real */
  full: async () => {
    const n = await olive(), frames = Object.values(n.poses).flatMap(p => p!.frames);
    POSES.forEach((p, i) => { if (!n.poses[p.key as PoseKey]) n.poses[p.key as PoseKey] = { frames: [frames[i % frames.length]!, frames[(i + 3) % frames.length]!], fps: 6, scale: 1 }; });
    return room(n);
  },
  many: async () => {
    const n = await olive(), frames = Object.values(n.poses).flatMap(p => p!.frames);
    n.poses.walk = { frames: Array.from({ length: 60 }, (_, i) => frames[i % frames.length]!), fps: 8, scale: 1 };
    return room(n);
  },
  wordy: async () => { const n = await olive(); n.lines = { ...n.lines, ...WORDY }; return room(n); },
  artist: async () => { const n = await olive(); n.lines = { ...n.lines, ...LINES_38 }; return room(n); },
  tall: async () => room(await fromArt('derived/tower.webp', 'Tower')),
  wide: async () => room(await fromArt('derived/loaf.webp', 'Loaf')),
  pixel: async () => room(await fromArt('derived/bit.webp', 'Bit')),
  names: async () => room(...await Promise.all([
    fromArt('pudding/main.webp', 'ぷりんちゃんとおともだちのながいなまえのバディ'), fromArt('derived/kumquat.webp', '小苹果'), fromArt('derived/matcha.webp', '보리 찐빵'),
    fromArt('derived/mint.webp', 'ليلى الصغيرة'), fromArt('derived/radish.webp', 'Ёжик в тумане'), fromArt('derived/ube.webp', 'हिंदी नाम'),
    fromArt('derived/barty.webp', 'Bartholomew Thistlewick the Fourth of Little Upper Downing!!')
  ]))
};

let original = '';
const calls: { what: string; id?: string; action?: string }[] = [];
const acts: [string, string][] = [], synced = { count: 0 }, pages = { count: 0 }, toasts: string[] = [];
let saveTo: (s: SaveState) => void = () => {}, toastTo: (m: string) => void = () => {};
let unsubscribed = 0;
let maker: ReturnType<typeof createMaker> | null = null, saved: MakerStore | null = null;

async function boot(o: Boot) {
  const initial = await FIXTURES[o.fixture]();
  saved = memoryStore(initial);
  maker = createMaker({
    store: saved, art, samples, readImage,
    world: { sync: () => { synced.count++; }, act: (id, a) => { acts.push([id, a]); }, actAll: a => { acts.push(['*everyone*', a]); } },
    exportPage: () => { pages.count++; },
    toast: m => { toasts.push(m); toastTo(m); },
    after: (ms, f) => window.setTimeout(f, ms), cancel: id => clearTimeout(id), random: () => Math.random()
  });
  const host: MakerViewHost = {
    onSave(f) { saveTo = f; return () => { unsubscribed++; saveTo = () => {}; }; },
    saveBuddyFile(id) { calls.push({ what: 'saveBuddyFile', id }); },
    ...o.window === false ? {} : { window: { minimize() { calls.push({ what: 'minimize' }); }, close() { calls.push({ what: 'close' }); } } },
    ...o.tryOnScreen === false ? {} : { tryOnScreen(id, action) { calls.push({ what: 'tryOnScreen', id, action }); } },
    ...o.exportPage === false ? {} : { exportPage() { calls.push({ what: 'exportPage' }); void maker!.exportPage(); } },
    ...o.onToast === false ? {} : { onToast(f) { toastTo = f; return () => { unsubscribed++; toastTo = () => {}; }; } }
  };
  const over = {
    ...o.world ? { worldSettings: everyoneSettings(maker) } : {},
    ...o.storage === 'none' ? { store: () => { throw new Error('storage is off'); } } : {}
  };
  const view = createMakerView(document.getElementById('root')!, maker, host, over);
  Object.assign(H, { view });
  if (!o.hold) await maker.start();
  return true;
}

const H = {
  boot, calls, acts, synced, pages, toasts,
  get maker() { return maker!; },
  get unsubscribed() { return unsubscribed; },
  save(s: SaveState | { kind: 'failed'; title: string; why: string; fix: string; labels: string[] }) {
    if ('labels' in s) { const { labels, ...f } = s; saveTo({ ...f, actions: labels.map(label => ({ label, run() { calls.push({ what: `action ${label}` }); } })) }); }
    else saveTo(s);
  },
  toast(m: string) { toastTo(m); },
  pet(): MakerBuddy { return maker!.current()!; },
  /* the buddy as the file said, and as it is now, keys in one order */
  sortedOf: sorted,
  asFiled: () => sorted(JSON.parse(original)),
  asNow: () => { const { id: _, ...rest } = JSON.parse(JSON.stringify(maker!.current())); return sorted(rest); },
  stored: () => saved!.load(),
  start: () => maker!.start(),
  file: fetched,
  poses: POSES.map(p => p.key)
};
Object.assign(window, { H });
