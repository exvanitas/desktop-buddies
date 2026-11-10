/* The edge shots' hold on the world, on the real host and engine with a made-up buddy: she goes where
   she's put, in the pose and frame asked for, holds still, and the numbers say where she's drawn. */
import assert from 'node:assert';
import type { Frame, Pose, PoseKey } from '@buddies/buddy-file';
import type { BuddyData } from '@buddies/engine';
import { test } from 'vitest';
import { createHost, type Area, type Message, type Port } from '../src/host';
import { whole } from './areas';
import type { WindowEntry } from '../src/shell';
import { addDangle, afterDizzy, cropFor, createPoser, DANGLE, type Op } from '../shell-check/edge-world';
import { windowRects } from '../src/window-terrain';

const AREA: Area = whole({ i: 0, x: 0, y: 0, w: 1024, h: 728, scale: 1 });
const WIN: WindowEntry = { id: 7, x: 307, y: 233, w: 410, h: 291, z: 0, max: false, topmost: false, tool: false, layered: false, class: 'WindowsForms10', exe: 'powershell.exe' };
let img = 0;
const frame = (y1: number, y0 = .1): Frame => ({ src: `data:image/png;base64,F${++img}`, bb: { x0: .25, y0, x1: .75, y1 } });
const pose = (...y1: number[]): Pose => ({ frames: y1.map(y => frame(y)), fps: 6 });
/* drawn low, as the prompt kit draws Dizzy: Stand up follows it */
const low = (...y1: number[]): Pose => ({ frames: y1.map(y => frame(y, .45)), fps: 6 });
const POSES: Partial<Record<PoseKey, Pose>> = {
  stand: pose(.9), walk: pose(.9, .88), dizzy: low(.95, .9, .85), stand_up: pose(.7, .8, .9), climb: pose(.9, .9), wall: pose(.9),
  hang: pose(.9), crawl: pose(.9, .9), dangle_legs: pose(.8), sprawl: pose(.95)
};
const BUDDY: BuddyData = { id: 'b0', size: 120, faces: 'right', base: frame(.9), poses: POSES };

function desk(buddy: BuddyData = BUDDY, areas: Area[] = [AREA], windows: WindowEntry[] = [WIN]) {
  addDangle();
  let t = 0;
  const every: { ms: number; f: () => void; next: number }[] = [];
  const host = createHost({
    random: () => .5, now: () => t, note: () => {},
    after: () => 0, cancel: () => {}, every: (ms, f) => { every.push({ ms, f, next: ms }); }
  });
  const poser = createPoser(host);
  const hub: Port = { postMessage() {} };
  host.connect(hub);
  /* what world-probe.ts does with each message */
  const send = (m: Message) => { if (poser.heard(m)) { host.message(hub, m); poser.after(m); } };
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { t += 16; for (const e of every) if (t >= e.next) { e.next += e.ms; e.f(); } } };
  send({ k: 'start', all: areas, pets: [buddy] });
  send({ k: 'windows', list: windows, exclude: [] });
  tick(300);
  let n = 0;
  const ask = (m: Op) => poser.ask({ k: 'probe', n: ++n, ...m }) as Record<string, any>;
  return { host, send, tick, ask, pet: () => host.sim!.pets.get('b0')! };
}
const at = { owner: 'window7', kind: 'floor' as const, f: .5 };

test('she stands where she is put, in the frame asked for, and stays', () => {
  const d = desk();
  const r = d.ask({ op: 'pose', id: 'b0', at, state: 'walk', frame: 1, dir: 1 });
  assert.strictEqual(r.ok, true, r.why);
  assert.deepStrictEqual(r.shows, { pose: 'walk', frame: 1, frames: 2 });
  assert.strictEqual(r.surface.at, 233);
  assert.strictEqual(r.surface.on, 'window');
  /* The floor rule: the bottom of the union of her boxes on the line. This frame's box is 2% of her size above it. */
  assert.ok(Math.abs(r.anchor.y - 233) < 1e-9 && Math.abs(r.union.y1 - 233) < 1e-9, JSON.stringify(r.anchor));
  assert.ok(Math.abs(r.box.y1 - (233 - .02 * 120)) < 1e-9, String(r.box.y1));
  assert.ok(Math.abs(r.anchor.x - (307 + 205)) < 1e-3, String(r.anchor.x));
  const before = { ...d.pet().P };
  d.tick(200);
  assert.strictEqual(d.pet().P.x, before.x); assert.strictEqual(d.pet().P.state, 'walk'); assert.strictEqual(d.pet().P.t, before.t);
});

test('a pose ends whatever flight she was on: nothing thrown, nothing to catch', () => {
  const d = desk();
  d.ask({ op: 'pose', id: 'b0', at, state: 'idle', frame: 0, dir: 1 });
  d.pet().act('ceilGo');
  assert.deepStrictEqual([d.pet().P.state, d.pet().P.catches], ['air', true], 'mid-leap');
  assert.strictEqual(d.ask({ op: 'pose', id: 'b0', at, state: 'idle', frame: 0, dir: 1 }).ok, true);
  assert.deepStrictEqual([d.pet().P.thrown, d.pet().P.catches, d.pet().P.hard], [false, false, false]);
});

test('the hub cannot unpause her while she is held, and release gives its pause back', () => {
  const d = desk();
  d.ask({ op: 'pose', id: 'b0', at, state: 'sit', frame: 0, dir: 1 });
  d.send({ k: 'pause', on: false });
  assert.strictEqual(d.host.sim!.world.paused, true);
  d.send({ k: 'pets', pets: [BUDDY] });
  assert.strictEqual(d.host.sim!.world.names, false, 'names stay off for the shots');
  d.ask({ op: 'release' });
  assert.strictEqual(d.host.sim!.world.paused, false);
  assert.strictEqual(d.host.sim!.world.names, true);
});

test('dizzy ends into stand up, frame by frame', () => {
  const d = desk();
  assert.deepStrictEqual(d.ask({ op: 'pose', id: 'b0', at, state: 'dizzy', frame: 2, dir: 1 }).shows, { pose: 'dizzy', frame: 2, frames: 3 });
  for (const f of [0, 1, 2]) {
    const r = d.ask({ op: 'pose', id: 'b0', at, state: 'dizzy', finish: true, frame: f, dir: 1 });
    assert.strictEqual(r.clip, true);
    assert.deepStrictEqual(r.shows, { pose: 'stand_up', frame: f, frames: 3 });
  }
});

test('a dizzy drawn standing goes straight on, with no stand up', () => {
  const d = desk({ ...BUDDY, poses: { ...POSES, dizzy: pose(.95, .9, .85) } });
  const r = d.ask({ op: 'pose', id: 'b0', at, state: 'dizzy', finish: true, frame: 0, dir: 1 });
  assert.notStrictEqual(r.clip, true);
  assert.notStrictEqual(r.shows?.pose, 'stand_up');
});

test('the shots after Dizzy are named for what is drawn: Stand up after a low one, Stand after a standing one', () => {
  const low = desk(), standing = desk({ ...BUDDY, poses: { ...POSES, dizzy: pose(.95, .9, .85) } });
  const next = (d: ReturnType<typeof desk>, f: number) => d.ask({ op: 'pose', id: 'b0', at, state: 'dizzy', finish: true, frame: f, dir: 1 });
  const pf = (r: ReturnType<typeof afterDizzy>) => r && [r.pose, r.frames];
  assert.deepStrictEqual(pf(afterDizzy(next(low, 0))), ['stand_up', 3]);
  assert.deepStrictEqual([0, 1, 2].map(f => afterDizzy(next(low, f))!.name(f)), ['stand_up.f0', 'stand_up.f1', 'stand_up.f2']);
  assert.deepStrictEqual(pf(afterDizzy(next(standing, 0))), ['stand', 1]);
  assert.strictEqual(afterDizzy(next(standing, 0))!.name(0), 'stand.f0');
  assert.strictEqual(afterDizzy({ ok: false, why: 'no such buddy' }), null);
});

test('walls, the ceiling and dangle legs', () => {
  const d = desk();
  const left = d.ask({ op: 'pose', id: 'b0', at: { owner: 'window7', kind: 'wall', side: -1 }, state: 'climb', frame: 0, dir: 1 });
  assert.strictEqual(left.ok, true, left.why);
  assert.strictEqual(left.surface.at, 307); assert.strictEqual(left.surface.normal.x, -1);
  assert.strictEqual(left.shows.pose, 'climb');
  assert.ok(Math.abs(left.box.x1 - 307) < 1e-9, 'her box meets the wall from outside');
  const right = d.ask({ op: 'pose', id: 'b0', at: { owner: 'window7', kind: 'wall', side: 1 }, state: 'wall', frame: 0, dir: 1 });
  assert.strictEqual(right.surface.at, 307 + 410); assert.ok(Math.abs(right.box.x0 - 717) < 1e-9);
  const hang = d.ask({ op: 'pose', id: 'b0', at: { owner: 'window7', kind: 'ceil' }, state: 'hang', frame: 0, dir: 1 });
  assert.strictEqual(hang.surface.at, 233 + 291); assert.ok(Math.abs(hang.box.y0 - 524) < 1e-9);
  const dangle = d.ask({ op: 'pose', id: 'b0', at, state: DANGLE, frame: 0, dir: 1 });
  assert.deepStrictEqual(dangle.shows, { pose: 'dangle_legs', frame: 0, frames: 1 });
  const sprawl = d.ask({ op: 'pose', id: 'b0', at: { owner: 'monitor0', kind: 'floor', f: .15 }, state: 'trip', frame: 0, dir: -1 });
  assert.strictEqual(sprawl.surface.at, 728); assert.strictEqual(sprawl.dir, -1); assert.strictEqual(sprawl.shows.pose, 'sprawl');
  assert.strictEqual(d.ask({ op: 'pose', id: 'b0', at: { owner: 'window9', kind: 'floor' }, state: 'sit', frame: 0, dir: 1 }).why, 'no such surface');
});

test('a crop is a band across the line, out to anything of hers past it', () => {
  const box = { x0: 100, y0: 50, x1: 160, y1: 230 };
  assert.deepStrictEqual(cropFor({ kind: 'floor', at: 230, normal: { x: 0, y: -1 } }, box), { x: 76, y: 158, w: 108, h: 144 });
  /* legs 57 px past the line */
  assert.deepStrictEqual(cropFor({ kind: 'floor', at: 173, normal: { x: 0, y: -1 } }, box), { x: 76, y: 101, w: 108, h: 145 });
  assert.deepStrictEqual(cropFor({ kind: 'ceil', at: 50, normal: { x: 0, y: 1 } }, box), { x: 76, y: -22, w: 108, h: 144 });
  assert.deepStrictEqual(cropFor({ kind: 'ceil', at: 100, normal: { x: 0, y: 1 } }, box), { x: 76, y: 28, w: 108, h: 144 });
  assert.deepStrictEqual(cropFor({ kind: 'wall', at: 160, normal: { x: -1, y: 0 } }, box), { x: 88, y: 26, w: 144, h: 228 });
  assert.deepStrictEqual(cropFor({ kind: 'wall', at: 100, normal: { x: 1, y: 0 } }, box), { x: 28, y: 26, w: 144, h: 228 });
  assert.deepStrictEqual(cropFor({ kind: 'wall', at: 100, normal: { x: -1, y: 0 } }, box), { x: 28, y: 26, w: 148, h: 228 });
});

/* The owner's desk in the first local run, as the exe listed it: the edge surface, the backdrop that
   covers the primary work area, and another app's window. Each came up where Windows put it. */
const OWNER: Area[] = [whole({ i: 0, x: 0, y: 0, w: 3440, h: 1392, scale: 1 }), whole({ i: 1, x: 720, y: 1440, w: 1920, h: 1008, scale: 1.5 })];
const FORMS = { max: false, topmost: false, tool: false, layered: false, class: 'WindowsForms10.Window.8.app.0.141b42a_r6_ad1', exe: 'powershell.exe' };
const SURFACE = { id: 24841348, x: 1032, y: 445, w: 1376, h: 557, ...FORMS };
const BACKDROP = { id: 24841350, x: 0, y: 0, w: 3440, h: 1392, ...FORMS };
const BROWSER = { id: 590982, x: 559, y: 0, w: 2442, h: 1392, max: false, topmost: false, tool: false, layered: false, class: 'Chrome_WidgetWin_1', exe: 'chrome.exe' };
/* the exe's order: 0 is the top */
const stack = (...top: Omit<WindowEntry, 'z'>[]): WindowEntry[] => top.map((e, z) => ({ ...e, z }));
const ON = 'window24841348';
const EDGES: [string, Op][] = [
  ['window-top', { op: 'pose', id: 'b0', at: { owner: ON, kind: 'floor', f: .5 }, state: 'idle', frame: 0, dir: 1 }],
  ['window-left', { op: 'pose', id: 'b0', at: { owner: ON, kind: 'wall', side: -1, f: .5 }, state: 'climb', frame: 0, dir: 1 }],
  ['window-right', { op: 'pose', id: 'b0', at: { owner: ON, kind: 'wall', side: 1, f: .5 }, state: 'wall', frame: 0, dir: 1 }],
  ['window-bottom', { op: 'pose', id: 'b0', at: { owner: ON, kind: 'ceil', f: .5 }, state: 'hang', frame: 0, dir: 1 }]
];
const poses = (windows: WindowEntry[]) => { const d = desk(BUDDY, OWNER, windows); return EDGES.map(([name, m]) => [name, d.ask(m).why ?? 'ok']); };
const all = (why: string) => EDGES.map(([name]) => [name, why]);

test("the first local run: another app's window in front of the scene hides every edge of the surface", () => {
  assert.deepStrictEqual(poses(stack(BROWSER, SURFACE, BACKDROP)), all('off the surface, as air'));
});

test('the backdrop is a blocker, harmless under the surface and fatal over it, so the surface is raised last', () => {
  const back = windowRects(stack(SURFACE, BACKDROP), OWNER, []).find(r => r.id === 'window24841350')!;
  assert.strictEqual(back.terrain, false, 'no room above its top, so no floor: a blocker');
  assert.deepStrictEqual(poses(stack(SURFACE, BACKDROP, BROWSER)), all('ok'), 'raised, the backdrop under the surface');
  assert.deepStrictEqual(poses(stack(BACKDROP, SURFACE, BROWSER)), all('off the surface, as air'), 'the backdrop on top');
});
