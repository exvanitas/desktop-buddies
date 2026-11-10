/* Which real windows are terrain, and how. The rules alone first, then the rules with the real
   terrain under them, on the owner's desk. */
import assert from 'node:assert';
import fs from 'node:fs';
import { read } from '@buddies/buddy-file';
import { createSim, lively } from '@buddies/engine';
import { createTerrain, type Rectangle, type Surface } from '@buddies/terrain';
import { test } from 'vitest';
import { DESK } from '../../../packages/terrain/tests/fixtures';
import type { Work as Area } from '../src/host';
import type { WindowEntry } from '../src/shell';
import { ROOM, SEAM, TINY, appsIn, windowRects } from '../src/window-terrain';

const win = (id: number, x: number, y: number, w: number, h: number, more: Partial<WindowEntry> = {}): WindowEntry => ({ id, x, y, w, h, z: 0, max: false, topmost: false, tool: false, layered: false, class: 'Notepad', exe: 'notepad.exe', ...more });
const ONE: Area[] = [{ i: 0, x: 0, y: 0, w: 1920, h: 1040, scale: 1 }];
const OWNER: Area[] = DESK().map((r, i) => ({ i, ...r.rect, scale: r.scale }));
const rects = (list: WindowEntry[], areas = ONE, exclude: string[] = []) => windowRects(list, areas, exclude);
const NORMAL = (more: Partial<WindowEntry> = {}) => win(1, 300, 400, 800, 500, more);
const only = (list: WindowEntry[], areas = ONE) => { const r = rects(list, areas); assert.strictEqual(r.length, 1); return r[0]!; };
const inside = (a: Area, p: { x: number; y: number }) => p.x >= a.x && p.x <= a.x + a.w && p.y >= a.y && p.y <= a.y + a.h;

test('a plain window is terrain where it stands, with an id that is its own', () => {
  assert.deepStrictEqual(rects([NORMAL()]), [{ id: 'window1', kind: 'window', rect: { x: 300, y: 400, w: 800, h: 500 }, z: 1, terrain: true, scale: 1, cut: [] }]);
});

test('the id lasts while the window moves, resizes and changes depth', () => {
  const before = rects([NORMAL(), win(2, 0, 200, 300, 300, { z: 1 })]), after = rects([win(2, 50, 250, 400, 400), NORMAL({ x: 10, y: 300, z: 1 })]);
  assert.deepStrictEqual(before.map(r => r.id).sort(), after.map(r => r.id).sort());
});

test("the top of the exe's order is the top of the terrain's, and every window is above the screens", () => {
  const [top, mid, low] = rects([win(1, 300, 400, 800, 500, { z: 0 }), win(2, 300, 400, 800, 500, { z: 1 }), win(3, 300, 400, 800, 500, { z: 2 })]);
  assert.ok(top!.z > mid!.z && mid!.z > low!.z && low!.z > 0);
});

/* The real names, spelled out here so a row can't leave the table without a test noticing. */
for (const name of [
  'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Progman', 'WorkerW',
  'NotifyIconOverflowWindow', 'TopLevelWindowForOverflowXamlIsland', 'TaskListThumbnailWnd',
  'Windows.UI.Core.CoreWindow', 'StartMenuSizingFrame', 'Shell_LightDismissOverlay', 'LauncherTipWnd', 'Shell_InputSwitchTopLevelWindow',
  'ForegroundStaging', 'MultitaskingViewFrame', 'TaskSwitcherWnd', 'XamlExplorerHostIslandWindow', 'XamlExplorerHostIslandWindow_WASDK',
  '#32768', 'tooltips_class32', 'Xaml_WindowedPopupClass', 'Microsoft.UI.Content.PopupWindowSiteBridge'
]) {
  test(`shell class: ${name} is not there at all`, () => {
    assert.deepStrictEqual(rects([NORMAL({ class: name })]), []);
    assert.deepStrictEqual(rects([NORMAL({ class: name.toUpperCase() })]), [], 'Windows ignores case in a class name');
  });
}

test('real apps that look shell-ish stay', () => {
  for (const name of ['Chrome_WidgetWin_1', 'CabinetWClass', 'ApplicationFrameWindow', 'ConsoleWindowClass', '#32770', 'CASCADIA_HOSTING_WINDOW_CLASS', 'MozillaWindowClass']) {
    assert.strictEqual(rects([NORMAL({ class: name })]).length, 1, name);
  }
});

test('the thresholds are decisions, not accidents', () => {
  assert.deepStrictEqual(TINY, { w: 120, h: 40 });
  assert.strictEqual(ROOM, 120, "a buddy's default size");
});

test('a tool window is not there at all', () => {
  assert.deepStrictEqual(rects([NORMAL({ tool: true })]), []);
});

test('tiny: under either limit is not there at all, and at the limit is', () => {
  assert.deepStrictEqual(rects([NORMAL({ w: TINY.w - 1 })]), []);
  assert.deepStrictEqual(rects([NORMAL({ h: TINY.h - 1 })]), []);
  assert.strictEqual(rects([NORMAL({ w: TINY.w, h: TINY.h })]).length, 1);
});

test('the exclude list: by exe, whatever the case, and only that exe', () => {
  const list = [NORMAL({ exe: 'Discord.EXE' }), win(2, 900, 300, 500, 400, { exe: 'code.exe', z: 1 })];
  assert.deepStrictEqual(rects(list, ONE, ['discord.exe']).map(r => r.id), ['window2']);
  assert.deepStrictEqual(rects(list, ONE, ['DISCORD.exe']).map(r => r.id), ['window2']);
  assert.deepStrictEqual(rects(list, ONE, []).map(r => r.id), ['window1', 'window2']);
});

test('a topmost layered window is an overlay nobody sees as a window: no terrain, and no blocker', () => {
  const overlay = win(1, 0, 0, 1920, 1040, { layered: true, topmost: true }), under = win(2, 300, 400, 800, 500, { z: 1 });
  const out = rects([overlay, under]);
  assert.deepStrictEqual(out.map(r => r.id), ['window2']);
  const t = createTerrain([...DESK(), ...out]);
  assert.ok(!t.hidden(t.surfaceById('window2:top:0')!, { x: 500, y: 400 }));
});

test('layered alone and topmost alone are ordinary windows', () => {
  assert.strictEqual(only([NORMAL({ layered: true })]).terrain, true);
  assert.strictEqual(only([NORMAL({ topmost: true })]).terrain, true);
});

test('maximized: a blocker over the same rectangle', () => {
  const r = only([win(1, 0, 200, 1920, 840, { max: true })]);
  assert.strictEqual(r.terrain, false);
  assert.deepStrictEqual(r.rect, { x: 0, y: 200, w: 1920, h: 840 });
});

test('a blocker hides what is behind it, and gives no surfaces', () => {
  const t = createTerrain([...DESK(), ...rects([win(1, 0, 0, 1920, 1040, { max: true }), win(2, 300, 400, 800, 500, { z: 1 })])]);
  assert.deepStrictEqual(t.surfaces().filter(s => s.owner === 'window1'), []);
  assert.ok(t.hidden(t.surfaceById('window2:top:0')!, { x: 500, y: 400 }));
});

test('room: a window snapped to half the screen, its top at the top of the monitor, is a blocker', () => {
  assert.strictEqual(only([win(1, 0, 0, 960, 1040)]).terrain, false);
});

test('room: one threshold, at the limit it is a floor, a pixel under it is not', () => {
  assert.strictEqual(only([win(1, 300, ROOM, 800, 500)]).terrain, true);
  assert.strictEqual(only([win(1, 300, ROOM - 1, 800, 500)]).terrain, false);
});

test("room: counts from the top of the monitor it is on, and grows with that monitor's scale", () => {
  const low = OWNER[1]!;
  assert.strictEqual(only([win(1, 900, low.y + ROOM * 1.5, 800, 500)], OWNER).terrain, true);
  assert.strictEqual(only([win(1, 900, low.y + ROOM * 1.5 - 1, 800, 500)], OWNER).terrain, false);
});

test('a window above the top of every monitor has no floor anyone can see', () => {
  assert.strictEqual(only([win(1, 300, -50, 800, 500)]).terrain, false);
});

test('off the side: the floor stops at the monitor, and the rest still hides what is behind it', () => {
  const out = rects([win(1, -300, 400, 800, 500)]);
  assert.deepStrictEqual(out.map(r => [r.id, r.terrain, r.rect]), [
    ['window1', true, { x: 0, y: 400, w: 500, h: 500 }],
    ['window1 rest', false, { x: -300, y: 400, w: 800, h: 500 }]
  ]);
  assert.strictEqual(out[0]!.z, out[1]!.z, "its own rest mustn't cover it");
});

test('off the bottom: the sides stop at the monitor', () => {
  assert.deepStrictEqual(rects([win(1, 300, 800, 800, 500)])[0]!.rect, { x: 300, y: 800, w: 800, h: 240 });
});

const cutOf = (w: WindowEntry, areas = ONE) => rects([w], areas)[0]!.cut;
test('a cut side is no edge: off the left, the right, the bottom', () => {
  assert.deepStrictEqual(cutOf(win(1, -300, 400, 800, 500)), ['left']);
  assert.deepStrictEqual(cutOf(win(1, 1500, 400, 800, 500)), ['right']);
  assert.deepStrictEqual(cutOf(win(1, 300, 400, 800, 900)), ['bottom']);
  assert.deepStrictEqual(cutOf(win(1, -300, 400, 2800, 900)), ['left', 'right', 'bottom']);
});

test('the review\'s window: nothing at x=0 for her to climb round', () => {
  const t = createTerrain([...DESK(), ...rects([win(1, -300, 400, 800, 500)])]);
  assert.strictEqual(t.surfaceById('window1:left:0'), null);
  assert.strictEqual(t.surfaceById('window1:top:0')!.prev, null);
});

test('no room beside it is no edge either: one threshold, on every side', () => {
  assert.deepStrictEqual(cutOf(win(1, ROOM, 400, 800, 500)), []);
  assert.deepStrictEqual(cutOf(win(1, ROOM - 1, 400, 800, 500)), ['left']);
  assert.deepStrictEqual(cutOf(win(1, 1920 - ROOM - 800, 400, 800, 500)), []);
  assert.deepStrictEqual(cutOf(win(1, 1920 - ROOM - 799, 400, 800, 500)), ['right']);
  assert.deepStrictEqual(cutOf(win(1, 300, 400, 800, 1040 - ROOM - 400)), []);
  assert.deepStrictEqual(cutOf(win(1, 300, 400, 800, 1040 - ROOM - 399)), ['bottom']);
});

test('a side uses the room of the largest scale in its run', () => {
  assert.deepStrictEqual(cutOf(win(1, ROOM * 1.5 - 1, 300, 800, 400), PAIR), ['left']);
  assert.deepStrictEqual(cutOf(win(1, ROOM * 1.5, 300, 800, 400), PAIR), []);
});

test('that room grows with the monitor\'s scale', () => {
  const low = OWNER[1]!;
  assert.deepStrictEqual(cutOf(win(1, low.x + ROOM * 1.5, 1700, 500, 300), OWNER), []);
  assert.deepStrictEqual(cutOf(win(1, low.x + ROOM * 1.5 - 1, 1700, 500, 300), OWNER), ['left']);
});

test('an edge with no room is whole, so nothing is left over to block', () => {
  const out = rects([win(1, 10, 400, 800, 500)]);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0]!.rect, { x: 10, y: 400, w: 800, h: 500 });
});

test('sides shorter than a buddy are no sides', () => {
  assert.deepStrictEqual(cutOf(win(1, 300, 950, 800, 500)), ['left', 'right', 'bottom']);
  assert.deepStrictEqual(cutOf(win(1, 300, 1040 - ROOM, 800, 500)), ['bottom']);
});

/* Side by side */
const PAIR: Area[] = [{ i: 0, x: 0, y: 0, w: 1920, h: 1040, scale: 1 }, { i: 1, x: 1920, y: 0, w: 1920, h: 1040, scale: 1.5 }];
const after = (gap: number): Area[] => [PAIR[0]!, { ...PAIR[1]!, x: 1920 + gap, scale: 1 }];

test('side by side: a window across the join is not cut at all, wherever it goes', () => {
  for (const x of [1519, 1520, 1521]) assert.deepStrictEqual(rects([win(1, x, 400, 800, 400)], PAIR), [{ id: 'window1', kind: 'window', rect: { x, y: 400, w: 800, h: 400 }, z: 1, terrain: true, scale: x + 400 > 1920 ? 1.5 : 1, cut: [] }]);
});

test('side by side: the run ends where the monitors end', () => {
  assert.deepStrictEqual(rects([win(1, -300, 400, 3000, 500)], PAIR)[0]!.rect, { x: 0, y: 400, w: 2700, h: 500 });
  assert.deepStrictEqual(rects([win(1, 3500, 400, 800, 500)], PAIR)[0]!.rect, { x: 3500, y: 400, w: 340, h: 500 });
});

test('side by side: whatever order the monitors come in', () => {
  assert.deepStrictEqual(rects([win(1, 1519, 400, 800, 400)], [...PAIR].reverse()), rects([win(1, 1519, 400, 800, 400)], PAIR));
});

test('the gap in a run is the gap the terrain joins across', () => {
  const walls = (gap: number) => createTerrain([{ id: 'a', kind: 'screen', rect: { x: 0, y: 0, w: 1920, h: 1040 }, z: 0, terrain: true, scale: 1 }, { id: 'b', kind: 'screen', rect: { x: 1920 + gap, y: 0, w: 1920, h: 1040 }, z: 0, terrain: true, scale: 1 }]).surfaces().filter(s => s.kind === 'wall').length;
  assert.ok(walls(SEAM) < walls(SEAM + 1), 'the terrain joins them up to SEAM, and no further');
  assert.strictEqual(rects([win(1, 1600, 400, 800, 500)], after(SEAM))[0]!.rect.w, 800);
  assert.strictEqual(rects([win(1, 1600, 400, 800, 500)], after(SEAM + 1))[0]!.rect.w, 320);
});

test('a monitor with no room at that height breaks the run', () => {
  const stepped: Area[] = [PAIR[0]!, { i: 1, x: 1920, y: 350, w: 1920, h: 1040, scale: 1 }];
  assert.strictEqual(rects([win(1, 1600, 400, 800, 500)], stepped)[0]!.rect.w, 320);
});

test('monitors that are side by side lower down are not a run at the height of a top above one of them', () => {
  const stepped: Area[] = [PAIR[0]!, { i: 1, x: 1920, y: 500, w: 1920, h: 1040, scale: 1 }];
  assert.strictEqual(rects([win(1, 1600, 400, 800, 500)], stepped)[0]!.rect.w, 320);
});

test('side by side, one shorter: the bottom stops at the shorter one it reaches', () => {
  const uneven: Area[] = [PAIR[0]!, { i: 1, x: 1920, y: 0, w: 1920, h: 700, scale: 1 }];
  assert.strictEqual(rects([win(1, 1600, 300, 800, 700)], uneven)[0]!.rect.h, 400);
  assert.strictEqual(rects([win(1, 300, 300, 800, 700)], uneven)[0]!.rect.h, 700, 'a window that reaches only the taller one keeps its height');
  assert.strictEqual(rects([win(1, 1010, 300, 800, 700)], uneven)[0]!.rect.h, 400, 'one a buddy on its side would stand over counts too');
});

test('two runs at one height: the one showing more of the top wins', () => {
  const apart: Area[] = [PAIR[0]!, { i: 1, x: 2500, y: 0, w: 1920, h: 1040, scale: 1 }];
  assert.deepStrictEqual(rects([win(1, 1500, 300, 1500, 500)], apart)[0]!.rect, { x: 2500, y: 300, w: 500, h: 500 });
  assert.deepStrictEqual(rects([win(1, 1300, 300, 1500, 500)], apart)[0]!.rect, { x: 1300, y: 300, w: 620, h: 500 });
});

test('wholly off every monitor: no surfaces at all', () => {
  for (const w of [win(1, -32000, -32000, 800, 500), win(2, 5000, 300, 800, 500), win(3, 100, 1800, 500, 400)]) {
    assert.strictEqual(only([w], OWNER).terrain, false);
  }
});

test('a sliver left on the monitor is no floor', () => {
  assert.strictEqual(only([win(1, -800 + TINY.w - 1, 400, 800, 500)]).terrain, false);
  assert.strictEqual(rects([win(1, -800 + TINY.w, 400, 800, 500)])[0]!.terrain, true);
});

test("the owner's desk: a window down the left, past the top monitor's floor, stops at it", () => {
  assert.deepStrictEqual(rects([win(1, 100, 1000, 500, 1000)], OWNER)[0]!.rect, { x: 100, y: 1000, w: 500, h: 392 });
});

test("the owner's desk: a top in the taskbar's strip between the monitors is no floor", () => {
  assert.strictEqual(only([win(1, 900, 1410, 800, 500)], OWNER).terrain, false);
});

test("the owner's desk: a window on the low monitor hanging into the dead corner keeps the part she can be drawn on", () => {
  const low = OWNER[1]!, out = rects([win(1, 300, 1700, 800, 500)], OWNER);
  assert.deepStrictEqual(out[0]!.rect, { x: low.x, y: 1700, w: 380, h: 500 });
  assert.strictEqual(out[0]!.scale, 1.5);
});

test("the owner's desk: a window across both monitors belongs to the one holding its top, and still blocks the other", () => {
  const list = [win(1, 1000, 1000, 800, 1000), win(2, 1200, 1700, 300, 400, { z: 1 })], out = rects(list, OWNER);
  assert.deepStrictEqual(out[0]!.rect, { x: 1000, y: 1000, w: 800, h: 392 });
  assert.deepStrictEqual(out[1]!.rect, { x: 1000, y: 1000, w: 800, h: 1000 });
  const t = createTerrain([...DESK(), ...out]);
  assert.ok(t.hidden(t.surfaceById('window2:top:0')!, { x: 1300, y: 1700 }), 'the part on the low monitor hides what is behind it');
});

/* The sample, slimmed to the first seed's shape: 0.66 of her box wide. A buddy as wide as her box
   can hang a few pixels off a monitor on a window top narrower than she is, which this doesn't
   claim to hold. The engine doesn't hand out bh(), so this is its sum. */
const WHOLE = read(fs.readFileSync(new URL('../../../packages/test-support/fixtures/sample.json', import.meta.url), 'utf8'));
const SAMPLE = { ...WHOLE, base: { ...WHOLE.base, bb: { ...WHOLE.base.bb, x0: .171875, x1: .828125 } } };
const olive = () => {
  const sim = createSim({ terrain: createTerrain(DESK()), pace: lively, random: () => .5, now: () => 0, after: () => 0, cancel() {} });
  sim.sync({ pets: [{ ...SAMPLE, id: 'n' }], bubbles: true, names: true, chatter: 'normal' });
  const pet = sim.pets.get('n')!, bb = SAMPLE.base.bb;
  return (k: number) => { pet.P.k = k; const w = pet.bw(), h = (bb.y1 - bb.y0) * 120 * k; return { w, h, ext: Math.max(w, h) / 2 + 2 * k }; };
};
/* Her whole body at a point on a surface. On a wall or under a ceiling, with no art of her own for
   it, she's the main image turned round her feet, so she stands out from it by her height. */
function bodyAt(s: Surface, p: { x: number; y: number }, b: { w: number; h: number }) {
  if (s.kind === 'floor') return { x: p.x - b.w / 2, y: p.y - b.h, w: b.w, h: b.h };
  if (s.kind === 'ceil') return { x: p.x - b.w / 2, y: p.y, w: b.w, h: b.h };
  return { x: s.normal.x > 0 ? p.x : p.x - b.h, y: p.y - b.h / 2, w: b.h, h: b.h };
}
const holds = (a: Area, r: { x: number; y: number; w: number; h: number }) => r.x >= a.x && r.y >= a.y && r.x + r.w <= a.x + a.w && r.y + r.h <= a.y + a.h;
/* Where on a surface she can be held: as far as a real end lets her, and the middle. */
const stops = (s: Surface, margin: number) => { const n = s.to - s.from; return n < margin * 2 ? [n / 2] : [margin, n / 2, n - margin]; };

function everyBody(areas: Area[], screens: Rectangle[], from: [number, number], to: [number, number]) {
  const size = olive();
  let bodies = 0;
  for (let x = from[0]; x <= to[0]; x += 97) for (let y = from[1]; y <= to[1]; y += 71) for (const [w, h] of [[300, 200], [800, 500], [1600, 1400], [3700, 2600]]) {
    const t = createTerrain([...screens, ...rects([win(1, x, y, w!, h!)], areas)]);
    for (const s of t.surfaces().filter(s => s.owner === 'window1')) {
      const near = t.home(t.pointOn(s, (s.to - s.from) / 2)), b = size(near.scale);
      for (const at of stops(s, s.kind === 'wall' ? b.ext : b.w / 2)) {
        const p = t.pointOn(s, at), k = t.home(p).scale, body = bodyAt(s, p, size(k));
        bodies++;
        assert.ok(areas.some(a => holds(a, body)), `${x},${y} ${w}x${h}: ${s.id} at ${at}, body ${JSON.stringify(body)}`);
      }
    }
  }
  return bodies;
}

test("her whole body, on every surface of a window anywhere on the owner's desk, is on a monitor", () => {
  const bodies = everyBody(OWNER, DESK(), [-900, -600], [3900, 2700]);
  assert.ok(bodies > 20000, `checked ${bodies}`);
});

test('her whole body, on a window on one monitor, wherever it goes', () => {
  const bodies = everyBody(ONE, [{ id: 'monitor0', kind: 'screen', rect: { x: 0, y: 0, w: 1920, h: 1040 }, z: 0, terrain: true, scale: 1 }], [-900, -500], [2400, 1400]);
  assert.ok(bodies > 5000, `checked ${bodies}`);
});

test('the apps on offer: real apps only, each once, sorted, in lower case', () => {
  assert.deepStrictEqual(appsIn([
    NORMAL({ exe: 'Zed.exe' }), win(2, 0, 200, 500, 500, { exe: 'zed.EXE' }), win(3, 0, 200, 500, 500, { exe: 'Code.exe', max: true }),
    win(4, 0, 0, 1920, 40, { class: 'Shell_TrayWnd', exe: 'explorer.exe' }), win(5, 0, 0, 500, 500, { tool: true, exe: 'tool.exe' }),
    win(6, 0, 0, 40, 40, { exe: 'tiny.exe' }), win(7, 0, 0, 500, 500, { topmost: true, layered: true, exe: 'nvcontainer.exe' }),
    win(8, 0, 200, 500, 500, { exe: '' })
  ]), ['code.exe', 'zed.exe']);
});
