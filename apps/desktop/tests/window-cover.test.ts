/* A tester's report on preview 5, from the exe's window lists to the engine: a window brought in front
   of the side she holds on to makes her let go, and the side holds her again once it's gone. */
import assert from 'node:assert';
import type { BuddyData } from '@buddies/engine';
import { test } from 'vitest';
import { createHost, type Area, type Port } from '../src/host';
import { whole } from './areas';
import type { WindowEntry } from '../src/shell';

const AREA: Area = whole({ i: 0, x: 0, y: 0, w: 1920, h: 1040, scale: 1 });
const BUDDY: BuddyData = { id: 'b0', name: 'Olive', size: 120, faces: 'right', poses: {}, base: { src: 'data:image/png;base64,AAAA', bb: { x0: .2, y0: 0, x1: .8, y1: 1 } } };
const entry = (id: number, x: number, y: number, w: number, h: number, more: Partial<WindowEntry> = {}): WindowEntry =>
  ({ id, x, y, w, h, z: 0, max: false, topmost: false, tool: false, layered: false, class: 'Secret_Class', exe: 'Secret.exe', ...more });
/* hers: its left side at x 600, from y 300 to 700 */
const A = (z: number) => entry(7, 600, 300, 400, 400, { z });
/* over the top of her body on that side, short of her middle */
const B = (z: number, more: Partial<WindowEntry> = {}) => entry(9, 500, 380, 300, 80, { z, ...more });

function desk(list: WindowEntry[]) {
  let t = 0;
  const every: { ms: number; f: () => void; next: number }[] = [];
  const host = createHost({ random: () => .5, now: () => t, note: () => {}, after: () => 0, cancel: () => {}, every: (ms, f) => { every.push({ ms, f, next: ms }); } });
  const hub: Port = { postMessage() {} };
  host.connect(hub);
  host.message(hub, { k: 'start', all: [AREA], pets: [BUDDY] });
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { t += 16; for (const e of every) if (t >= e.next) { e.next += e.ms; e.f(); } } };
  const windows = (next: WindowEntry[]) => { host.message(hub, { k: 'windows', list: next, exclude: [] }); tick(); };
  windows(list);
  const pet = () => host.sim!.pets.get('b0')!;
  /* on her side at t 200: her middle at y 500 */
  const cling = () => {
    const p = pet(), s = host.sim!.world.terrain.surfaceById('window7:left:0')!, at = host.sim!.world.terrain.pointOn(s, 200);
    Object.assign(p.P, { on: { surface: s, t: 200 }, x: at.x, y: at.y, vx: 0, vy: 0 });
    p.go('wall'); p.P.dur = 1e9; p.P.chatT = 1e9;
    tick(2);
    assert.strictEqual(p.P.on?.surface.id, 'window7:left:0', 'clinging');
  };
  return { windows, tick, cling, pet };
}
const fell = (d: ReturnType<typeof desk>) => d.pet().P.on === null && d.pet().P.state === 'air';

test('a new window opened in front of the side she holds: she lets go', () => {
  const d = desk([A(0)]);
  d.cling();
  d.windows([B(0), A(1)]);
  assert.ok(fell(d));
});

test('a window behind hers changes nothing, and brought to the front, she lets go', () => {
  const d = desk([A(0), B(1)]);
  d.cling(); d.tick(30);
  assert.strictEqual(d.pet().P.on?.surface.id, 'window7:left:0', 'behind hers');
  d.windows([B(0), A(1)]);
  assert.ok(fell(d));
});

test('moved in front: dragged over her from somewhere else', () => {
  const d = desk([entry(9, 1300, 100, 300, 80, { z: 0 }), A(1)]);
  d.cling(); d.tick(30);
  assert.strictEqual(d.pet().P.on?.surface.id, 'window7:left:0', 'not over her yet');
  d.windows([B(0), A(1)]);
  assert.ok(fell(d));
});

test('maximized in front is a blocker, and she lets go', () => {
  const d = desk([A(0)]);
  d.cling();
  d.windows([entry(9, 0, 0, 1920, 1040, { z: 0, max: true }), A(1)]);
  assert.ok(fell(d));
});

test('minimized or closed again: the side holds her once more', () => {
  const d = desk([A(0)]);
  d.cling();
  d.windows([B(0), A(1)]);
  assert.ok(fell(d));
  d.windows([A(0)]);
  d.cling(); d.tick(30);
  assert.strictEqual(d.pet().P.on?.surface.id, 'window7:left:0');
});

test('a window in front that is no window at all, an overlay or a tool, covers nothing', () => {
  for (const more of [{ layered: true, topmost: true }, { tool: true }]) {
    const d = desk([A(0)]);
    d.cling();
    d.windows([B(0, more), A(1)]); d.tick(30);
    assert.strictEqual(d.pet().P.on?.surface.id, 'window7:left:0', JSON.stringify(more));
  }
});
