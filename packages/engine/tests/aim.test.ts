/* What she can aim at and the arc that gets her there. No buddy here: a jumper and some rectangles. */
import assert from 'node:assert';
import { createTerrain, type Rectangle, type Terrain } from '@buddies/terrain';
import { test } from 'vitest';
import { aims, arc, plan, spots, type Jumper } from '../src/aim';
import { lively, type Pace } from '../src/pace';
import { GRAV } from '../src/state';
import { mulberry32, screen, windowRect } from './support';

const SCREEN = () => screen('s', 0, 0, 1600, 900);
/* the same terrain with one window gone */
const createTerrainWith = (t: Terrain, gone: string) => { const next = createTerrain(t.rects().filter(r => r.id !== gone)); next.sweep = t.sweep; return next; };
const floorOf = (t: Terrain, owner: string) => t.surfaces().find(s => s.owner === owner && s.kind === 'floor')!;
/* a size-120 buddy, standing at x on the given floor */
function jumper(t: Terrain, x: number, owner = 's', o: Partial<Omit<Jumper, 'reach'>> & { reach?: Partial<Pace['reach']> } = {}): Jumper {
  const on = floorOf(t, owner), k = o.k ?? 1;
  return { x, y: on.at, side: 36 * k, up: 120 * k, ext: 62 * k, zone: t.rectById('s')!.rect, on, turn: 0, ...o, k, reach: { ...lively.reach, ...o.reach } };
}
const aimed = (rects: Rectangle[], x: number, owner = 's', o: Parameters<typeof jumper>[3] = {}) => { const t = createTerrain(rects); return aims(t, jumper(t, x, owner, o)); };
/* the window a test is about: the ones in its way are called over, head or wall */
const subject = (id: string) => !['over', 'head', 'wall'].includes(id);
const tops = (rects: Rectangle[], x: number, owner = 's', o: Parameters<typeof jumper>[3] = {}) => aimed(rects, x, owner, o).filter(a => a.way === 'top' && subject(a.owner));
const sides = (rects: Rectangle[], x: number, owner = 's', o: Parameters<typeof jumper>[3] = {}) => aimed(rects, x, owner, o).filter(a => a.way === 'side' && subject(a.owner));

test('an arc arrives, exactly, at one frame a tick, up or down and at any scale', () => {
  for (const k of [1, 1.5, .8]) for (const [dx, dy, rise] of [[300, -200, 50], [-420, -500, 190], [250, 300, 110], [0, -100, 50], [90, 0, 50]] as const) {
    const a = arc({ x: 100, y: 500 }, { x: 100 + dx, y: 500 + dy }, rise * k, k);
    let x = 100, y = 500, vy = a.vy;
    for (let i = 0; i < a.frames; i++) { vy += GRAV * k; x += a.vx; y += vy; }
    assert.ok(Math.abs(x - 100 - dx) < 1e-6 && Math.abs(y - 500 - dy) < 1e-6, `${k} ${dx} ${dy}: ${x} ${y}`);
  }
});

test('an arc goes up by its rise, over the higher end', () => {
  for (const [dy, rise] of [[-300, 60], [200, 110]] as const) {
    const a = arc({ x: 0, y: 500 }, { x: 200, y: 500 + dy }, rise, 1);
    let y = 500, vy = a.vy, high = 500;
    for (let i = 0; i < a.frames; i++) { vy += GRAV; y += vy; high = Math.min(high, y); }
    const want = Math.min(500, 500 + dy) - rise;
    assert.ok(Math.abs(high - want) < 12, `peak ${high}, wanted about ${want}`);
  }
});

test('reach: across, in either direction', () => {
  const w = [SCREEN(), windowRect('w', 800, 700, 300, 100)];
  const at = (across: number, x: number) => tops(w, x, 's', { reach: { across } });
  assert.strictEqual(at(200, 400).length, 0);
  const a = at(480, 400);
  assert.strictEqual(a.length, 1); assert.ok(Math.abs(a[0]!.x - 400) <= 480, 'never past the limit');
  assert.strictEqual(tops(w, 1500, 's', { reach: { across: 200 } }).length, 0);
  assert.strictEqual(tops(w, 1500, 's', { reach: { across: 480 } }).length, 1);
});

test('reach: up, measured to the top', () => {
  const w = [SCREEN(), windowRect('w', 800, 500, 300, 100)];
  assert.strictEqual(tops(w, 500, 's', { reach: { up: 399 } }).length, 0);
  assert.strictEqual(tops(w, 500, 's', { reach: { up: 400 } }).length, 1);
});

test('reach: down, from one window to a lower one', () => {
  const w = [SCREEN(), windowRect('a', 100, 250, 300, 100), windowRect('b', 600, 800, 300, 60)];
  assert.strictEqual(tops(w, 250, 'a', { reach: { down: 549 } }).length, 0);
  assert.strictEqual(tops(w, 250, 'a', { reach: { down: 550 } }).length, 1);
});

test('reach: down counts to where she\'d really hold on, not to the top of the side', () => {
  const rects = [SCREEN(), windowRect('a', 100, 250, 300, 100), windowRect('w', 800, 400, 300, 400)];
  assert.strictEqual(sides(rects, 250, 'a', { reach: { down: 300 } }).length, 0, 'the top of it is in reach, the grip isn\'t');
  assert.strictEqual(sides(rects, 250, 'a', { reach: { down: 320 } }).length, 1);
});

test('reach scales with the screen', () => {
  const w = [SCREEN(), windowRect('w', 800, 300, 400, 100)];
  assert.strictEqual(tops(w, 500, 's', { reach: { up: 500 } }).length, 0);
  assert.strictEqual(tops(w, 500, 's', { k: 1.25, reach: { up: 500 } }).length, 1);
});

test('reach across scales with the screen too', () => {
  const w = [SCREEN(), windowRect('w', 800, 700, 300, 100)];
  assert.strictEqual(tops(w, 400, 's', { reach: { across: 400 } }).length, 0);
  assert.strictEqual(tops(w, 400, 's', { k: 1.25, reach: { across: 400 } }).length, 1);
});

test('speed: a target that needs a faster run than that is out', () => {
  const w = [SCREEN(), windowRect('w', 1000, 840, 300, 60)];
  assert.strictEqual(tops(w, 100, 's', { reach: { speed: 2, across: 1500 } }).length, 0);
  assert.strictEqual(tops(w, 100, 's', { reach: { speed: 30, across: 1500 } }).length, 1);
});

test('hidden: a covered top is not a target, and a part covered is aimed round', () => {
  const w = windowRect('w', 800, 500, 400, 100, 1);
  assert.strictEqual(tops([SCREEN(), w, windowRect('over', 700, 400, 600, 300, 2)], 500).length, 0, 'all of it');
  assert.strictEqual(tops([SCREEN(), w, windowRect('over', 700, 400, 600, 300, 2, { terrain: false })], 500).length, 0, 'by a blocker');
  const part = tops([SCREEN(), w, windowRect('over', 1000, 400, 300, 300, 2)], 500);
  assert.strictEqual(part.length, 1); assert.ok(part[0]!.x + 36 <= 1000 && part[0]!.x - 36 >= 800, `on the open part: ${part[0]!.x}`);
});

test('wide enough: a top narrower than the ledge limit is left alone, however it got narrow', () => {
  const need = 72 * lively.reach.ledge;
  assert.strictEqual(tops([SCREEN(), windowRect('w', 800, 500, need - 1, 100)], 500).length, 0);
  assert.strictEqual(tops([SCREEN(), windowRect('w', 800, 500, need, 100)], 500).length, 1);
  assert.strictEqual(tops([SCREEN(), windowRect('w', 800, 500, 400, 100, 1), windowRect('over', 800 + need - 1, 400, 400, 300, 2)], 500).length, 0, 'what is left of it');
  assert.strictEqual(tops([SCREEN(), windowRect('w', 800, 500, 400, 100, 1), windowRect('over', 800 + need, 400, 400, 300, 2)], 500).length, 1);
});

test('room above: a window in front at head height rules a spot out, and one behind does not', () => {
  const w = windowRect('w', 800, 500, 200, 100, 2), head = (z: number) => windowRect('head', 700, 300, 400, 150, z);
  assert.strictEqual(tops([SCREEN(), w, head(3)], 500).length, 0);
  assert.strictEqual(tops([SCREEN(), w, windowRect('head', 700, 300, 400, 150, 3, { terrain: false })], 500).length, 0, 'a blocker too');
  assert.strictEqual(tops([SCREEN(), w, windowRect('head', 700, 300, 400, 150, 1, { terrain: false })], 500).length, 1, 'behind her, it takes no room');
  const clear = tops([SCREEN(), windowRect('w', 800, 500, 200, 100, 2), windowRect('head', 700, 200, 400, 180, 3)], 500);
  assert.strictEqual(clear.length, 1, 'with her whole height clear');
});

test('room above: no top so near the screen edge that her head would be off it', () => {
  assert.strictEqual(tops([SCREEN(), windowRect('w', 800, 119, 400, 100)], 500, 's', { reach: { up: 900 } }).length, 0);
  assert.strictEqual(tops([SCREEN(), windowRect('w', 800, 400, 400, 100)], 500, 's', { reach: { up: 900 } }).length, 1);
});

test('she lands on the stretch she aimed at, with her whole body on it', () => {
  const w = [SCREEN(), windowRect('w', 800, 500, 400, 100)], [a] = tops(w, 500);
  assert.strictEqual(a!.y, 500); assert.ok(a!.x >= 836 && a!.x <= 1164);
  assert.strictEqual(a!.owner, 'w'); assert.ok(a!.vx > 0); assert.ok(a!.vy < 0);
});

test('the way must be clear: a window side in the path rules the arc out', () => {
  const target = windowRect('w', 800, 700, 200, 100), wall = windowRect('wall', 650, 200, 40, 700, 2);
  assert.strictEqual(tops([SCREEN(), target], 500).length, 1);
  assert.strictEqual(tops([SCREEN(), target, wall], 500).length, 0);
});

test('the way must be clear: straight under a window she would hit its underside', () => {
  const w = [SCREEN(), windowRect('w', 300, 400, 1000, 100)];
  assert.strictEqual(tops(w, 800).length, 0);
  assert.strictEqual(tops(w, 100).length, 1, 'from beside it, she clears the corner');
});

test('a screen ceiling in the way rules out an arc too high for it', () => {
  const w = [screen('s', 0, 0, 1600, 400), windowRect('w', 800, 180, 300, 100)];
  assert.strictEqual(tops(w, 500, 's', { reach: { rises: [400] } }).length, 0);
  assert.strictEqual(tops(w, 500, 's', { reach: { rises: [50] } }).length, 1);
});

test('never the window she is on, only other windows, and nothing on a bare screen', () => {
  assert.strictEqual(aimed([SCREEN(), windowRect('w', 300, 500, 600, 200)], 500, 'w').length, 0);
  assert.strictEqual(aimed([SCREEN()], 500).length, 0);
  const t = createTerrain([SCREEN()]);
  assert.strictEqual(spots(t, jumper(t, 500)).length, 0);
});

test('out of reach is skipped before any arc is flown', () => {
  const t = createTerrain([SCREEN(), windowRect('far', 1300, 300, 200, 100), windowRect('high', 100, 130, 200, 100), windowRect('near', 500, 700, 200, 100)]), sweep = t.sweep;
  let flown = 0;
  t.sweep = (...a) => { flown++; return sweep(...a); };
  const me = jumper(t, 200, 's', { reach: { across: 500, up: 350 } }), got = aims(t, me);
  assert.deepStrictEqual([...new Set(got.map(a => a.owner))], ['near']);
  const near = flown; flown = 0;
  aims(createTerrainWith(t, 'near'), me);
  assert.ok(near > 0); assert.strictEqual(flown, 0, 'nothing in reach, nothing flown');
});

test('out of range is skipped before anything else is asked about a window', () => {
  const rects = [SCREEN(), windowRect('top', 100, 300, 300, 100), windowRect('far', 1300, 300, 200, 100), windowRect('high', 100, 20, 200, 60), windowRect('low', 300, 800, 200, 60), windowRect('near', 600, 350, 200, 100)];
  const t = createTerrain(rects), open = t.open, asked = new Set<string>();
  t.open = s => { asked.add(s.owner); return open(s); };
  aims(t, jumper(t, 250, 'top', { reach: { across: 500, up: 150, down: 300 } }));
  assert.deepStrictEqual([...asked], ['near']);
});

test('flying only past what is near the arc finds what flying past everything would', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const draw = mulberry32(seed), rects: Rectangle[] = [SCREEN()];
    for (let i = 0; i < 14; i++) rects.push(windowRect('w' + i, Math.floor(draw() * 1300), Math.floor(draw() * 700), 150 + Math.floor(draw() * 400), 100 + Math.floor(draw() * 300), i + 1));
    const t = createTerrain(rects), everything = createTerrain(rects), all = everything.sweep;
    everything.sweep = (from, to, o) => { const { among: _, ...rest } = o!; return all(from, to, rest); };
    for (const x of [100, 500, 900, 1300]) assert.deepStrictEqual(aims(t, jumper(t, x)), aims(everything, jumper(everything, x)), `seed ${seed}, x ${x}`);
  }
});

test('a search stops at its flight limit, having looked at the nearest first', () => {
  const rects = [SCREEN(), ...Array.from({ length: 6 }, (_, i) => windowRect('w' + i, 300 + i * 200, 840, 150, 50)).reverse()];
  const all = aimed(rects, 60, 's', { reach: { flights: 500, across: 1500, speed: 40, rises: [50, 110, 190, 300] } });
  assert.strictEqual(new Set(all.map(a => a.owner)).size, 6);
  const few = aimed(rects, 60, 's', { reach: { flights: 2, across: 1500, speed: 40, rises: [50, 110, 190, 300] } });
  assert.deepStrictEqual(few.map(a => a.owner), ['w0', 'w1']);
  assert.strictEqual(aimed(rects, 60, 's', { reach: { flights: 0 } }).length, 0);
});

test('spots stop at the three nearest', () => {
  const t = createTerrain([SCREEN(), ...Array.from({ length: 6 }, (_, i) => windowRect('w' + i, 700 + i * 150, 500, 120, 100)).reverse()]), me = jumper(t, 50, 's', { reach: { across: 300, flights: 500 } });
  assert.deepStrictEqual(spots(t, me).map(s => s.owner), ['w0', 'w1', 'w2']);
});

test('spots: hopeless windows near her can\'t use up the whole search', () => {
  /* each top has a lid just over it that no arc gets past, so every arc at it is wasted */
  const lidded = (i: number) => [windowRect('h' + i, 900 + i * 140, 700, 120, 100, 1), windowRect('lid' + i, 850 + i * 140, 640, 220, 10, 1, { cut: ['top', 'left', 'right'] })];
  const t = createTerrain([SCREEN(), ...[0, 1, 2, 3].flatMap(lidded), windowRect('w', 100, 700, 160, 100, 1)]), me = jumper(t, 800, 's', { reach: { across: 300, flights: 20 } });
  assert.deepStrictEqual(spots(t, me).map(o => o.owner), ['w']);
});

test('spots: a window whose share is spent isn\'t asked about again', () => {
  const t = createTerrain([SCREEN(), windowRect('h', 900, 700, 120, 100), windowRect('lid', 300, 640, 1200, 10, 1, { cut: ['top', 'left', 'right'] })]), open = t.open;
  let asked = 0;
  t.open = s => { if (s.owner === 'h') asked++; return open(s); };
  spots(t, jumper(t, 800, 's', { reach: { across: 300, flights: 10 } }), []);
  assert.strictEqual(asked, 1, 'a share of one flight is one try');
});

test('spots: a place that uses up the share doesn\'t hide the others for good', () => {
  const t = createTerrain([SCREEN(), windowRect('w', 100, 200, 120, 150)]);
  const at = (turn: number) => spots(t, jumper(t, 300, 's', { turn })).map(s => s.t);
  assert.deepStrictEqual(at(0), [], 'the nearest place spends the whole share and gets nowhere');
  assert.ok([1, 2, 3].some(turn => at(turn).length), 'another turn starts from another place');
  assert.deepStrictEqual(at(4), at(0), 'and the turns come round');
});

test('spots: the shares add up to the search, however many windows there are', () => {
  const lidded = (i: number) => [windowRect('h' + i, 900 + i * 20, 700, 120, 100, 1), windowRect('lid' + i, 850 + i * 20, 640, 220, 10, 1, { cut: ['top', 'left', 'right'] })];
  const t = createTerrain([SCREEN(), ...Array.from({ length: 30 }, (_, i) => lidded(i)).flat()]), near = t.near;
  let flights = 0;
  t.near = b => { flights++; return near(b); };
  spots(t, jumper(t, 800, 's', { reach: { across: 300, flights: 20 } }), []);
  assert.ok(flights > 0 && flights <= 20, `${flights} flights`);
});

test('a plan keeps what it finds, and walks only go for what the hops left', () => {
  const t = createTerrain([SCREEN(), windowRect('a', 300, 600, 200, 100), windowRect('b', 1300, 600, 200, 100)]), me = jumper(t, 150, 's', { reach: { across: 500 } }), p = plan(t, me);
  assert.deepStrictEqual([...new Set(p.hops.map(a => a.owner))], ['a']);
  assert.deepStrictEqual(p.walks.map(s => s.owner), ['b']);
});

test('what can only be asked for one window answers for that window', () => {
  const t = createTerrain([SCREEN(), windowRect('a', 300, 600, 200, 100), windowRect('b', 800, 600, 200, 100)]);
  assert.deepStrictEqual([...new Set(aims(t, jumper(t, 650), 'b').map(a => a.owner))], ['b']);
});

test('all of her stays on her own screen: a window on the next monitor is not a target', () => {
  const rects = [SCREEN(), screen('n', 1600, 0, 1000, 900), windowRect('w', 1800, 600, 300, 100)];
  assert.strictEqual(tops(rects, 1500, 's', { reach: { across: 900 } }).length, 0);
  const straddles = [SCREEN(), screen('n', 1600, 0, 1000, 900), windowRect('w', 1400, 600, 500, 100)], [a] = tops(straddles, 1000);
  assert.ok(a && a.x + 36 <= 1600, 'only the part on this screen');
});

test('all of her stays on her own screen: a side on the next monitor, and a jump from under the screen top', () => {
  assert.strictEqual(sides([SCREEN(), screen('n', 1600, 0, 1000, 900), windowRect('w', 1800, 300, 300, 500)], 1500, 's', { reach: { across: 900 } }).length, 0);
  assert.strictEqual(tops([SCREEN(), windowRect('a', 100, 60, 300, 100), windowRect('w', 700, 500, 300, 100)], 250, 'a').length, 0, 'her head is off it already');
});

test('all of her stays on her own screen: just enough of a window on this side of the edge is enough', () => {
  const [a] = tops([SCREEN(), screen('n', 1600, 0, 1000, 900), windowRect('w', 1480, 600, 500, 100)], 1000);
  assert.ok(a && a.x + 36 <= 1600, 'on the part that is here');
});

test('the same jump at twice the scale is the same jump, twice the size', () => {
  const at = (k: number) => tops([screen('s', 0, 0, 1600 * k, 900 * k), windowRect('w', 800 * k, 500 * k, 400 * k, 100 * k)], 500 * k, 's', { k, side: 36 * k, up: 120 * k, ext: 62 * k, reach: { rises: [200] } })[0]!;
  const one = at(1), two = at(2);
  assert.ok(Math.abs(two.vy - one.vy * 2) < .01 && Math.abs(two.vx - one.vx * 2) < .01, `${one.vx},${one.vy} against ${two.vx},${two.vy}`);
});

test('an edge cut off at a monitor is no target', () => {
  const cut = (edges: ('top' | 'left')[]) => [SCREEN(), windowRect('w', 800, 300, 300, 500, 1, { cut: edges })];
  assert.strictEqual(tops(cut([]), 300).length, 1); assert.strictEqual(sides(cut([]), 300).length, 1);
  assert.strictEqual(tops(cut(['top']), 300).length, 0);
  assert.strictEqual(sides(cut(['left']), 300).length, 0);
});

test('a side: only the one facing her', () => {
  const w = [SCREEN(), windowRect('w', 800, 200, 300, 600)];
  assert.deepStrictEqual(sides(w, 300).map(a => a.x), sides(w, 300).map(() => 765));
  assert.strictEqual(sides(w, 300).length, 1);
  assert.strictEqual(sides(w, 1500).length, 1); assert.strictEqual(sides(w, 1500)[0]!.x, 1135);
});

test('a side: with the middle of it covered, she finds a stretch that is not', () => {
  const rects = [SCREEN(), windowRect('a', 100, 560, 300, 100), windowRect('w', 800, 100, 300, 780), windowRect('over', 700, 300, 200, 300, 2, { terrain: false })];
  const [a] = sides(rects, 250, 'a');
  assert.ok(a && (a.y <= 300 || a.y - 120 >= 600), `clear of what covers it: ${a && a.y}`);
  const below = rects.slice(0, 3).concat(windowRect('over', 700, 50, 200, 550, 2, { terrain: false })), [b] = sides(below, 250, 'a');
  assert.ok(b && b.y - 120 >= 600, `only under it: ${b && b.y}`);
});

test('a side: as tall as the wall reach of a wide buddy needs', () => {
  const wide = { side: 100, up: 60, ext: 102 };
  assert.strictEqual(sides([SCREEN(), windowRect('w', 800, 300, 300, 203)], 300, 's', wide).length, 0);
  assert.strictEqual(sides([SCREEN(), windowRect('w', 800, 300, 300, 204)], 300, 's', wide).length, 1);
});

test('a side: tall enough to hold on to', () => {
  assert.strictEqual(sides([SCREEN(), windowRect('w', 800, 600, 300, 123)], 300).length, 0);
  assert.strictEqual(sides([SCREEN(), windowRect('w', 800, 500, 300, 300)], 300).length, 1);
});

test('a side: she grabs below its top and above its grip line, not where it is hidden', () => {
  const [a] = sides([SCREEN(), windowRect('w', 800, 200, 300, 600)], 300);
  assert.ok(a!.y >= 200 + 62 + 60 && a!.y < 800 - 36, `feet at ${a!.y}`);
  assert.strictEqual(sides([SCREEN(), windowRect('w', 800, 200, 300, 600, 1), windowRect('over', 700, 100, 200, 780, 2)], 300).length, 0, 'all covered');
  const [b] = sides([SCREEN(), windowRect('w', 800, 200, 300, 600, 1), windowRect('over', 700, 100, 200, 400, 2)], 300);
  assert.ok(b && b.y - 60 >= 500, `clinging below what covers it: ${b.y}`);
});

test('a side: on a short one she still finds the little stretch above the grip line', () => {
  const [a] = sides([SCREEN(), windowRect('w', 800, 300, 300, 170)], 300);
  assert.ok(a && a.y < 470 - 36, `feet at ${a && a.y}`);
});

test('a side: a window in front of where she means to hold on doesn\'t rule out the whole side', () => {
  const front = windowRect('front', 790, 450, 200, 90, 2, { cut: ['left', 'right'] });
  assert.strictEqual(sides([SCREEN(), windowRect('w', 800, 300, 300, 500, 1), front], 300).length, 1);
});

test('a side: a contact near its top is judged where the clamp puts her', () => {
  /* she meets it at once, feet at about 425, and is put down to hold on from 402 to 522 */
  const rects = (more: Rectangle[]) => [SCREEN(), windowRect('a', 500, 430, 300, 100), windowRect('w', 800, 400, 300, 300), ...more];
  const at = (more: Rectangle[]) => sides(rects(more), 763.99, 'a').length;
  assert.strictEqual(at([]), 1);
  assert.strictEqual(at([windowRect('over', 700, 470, 95, 30, 3, { terrain: false })]), 0);
});

test('a side: pressed up against it from below its grip line, she would only bounce', () => {
  const rects = [SCREEN(), windowRect('w', 800, 300, 300, 500)];
  assert.strictEqual(sides(rects, 300).length, 1);
  assert.strictEqual(sides(rects, 763.99).length, 0, 'she meets it at once, with her feet under the line');
});

test('a side: a window in front where she would cling rules it out', () => {
  const w = windowRect('w', 800, 200, 300, 400, 1);
  assert.strictEqual(sides([SCREEN(), w], 300).length, 1);
  assert.strictEqual(sides([SCREEN(), w, windowRect('over', 500, 150, 299, 500, 2, { terrain: false })], 300).length, 0);
});

test('a side: too fast to hold on to is out', () => {
  const rects = [screen('s', 0, 0, 1600, 2400), windowRect('w', 800, 1400, 300, 900)];
  assert.strictEqual(sides(rects, 300, 's', { reach: { rises: [200] } }).length, 1);
  assert.strictEqual(sides(rects, 300, 's', { reach: { rises: [1200] } }).length, 0, 'coming down from that high');
});

test('spots: the nearest place to jump from, for a window out of reach from here', () => {
  const t = createTerrain([SCREEN(), windowRect('w', 1000, 500, 300, 100)]), me = jumper(t, 100, 's', { reach: { across: 400 } });
  assert.strictEqual(aims(t, me).length, 0);
  const [s] = spots(t, me);
  assert.strictEqual(s!.owner, 'w');
  assert.ok(aims(t, { ...me, x: s!.t + me.on.from }, 'w').length > 0, 'and it works from there');
  assert.ok(s!.t <= 1000, 'on her side of it');
});

test('spots: from under a window she walks out to jump', () => {
  const t = createTerrain([SCREEN(), windowRect('w', 300, 400, 1000, 100)]), me = jumper(t, 800);
  assert.strictEqual(aims(t, me).filter(a => a.way === 'top').length, 0);
  const [s] = spots(t, me);
  assert.ok(s && (s.t < 300 || s.t > 1300), `clear of it: ${s && s.t}`);
});

test('spots: none for a window she can already reach, or one nothing would reach', () => {
  const t = createTerrain([SCREEN(), windowRect('w', 700, 600, 300, 100)]);
  assert.strictEqual(spots(t, jumper(t, 500)).length, 0);
  const high = createTerrain([SCREEN(), windowRect('w', 700, 150, 300, 90)]);
  assert.strictEqual(spots(high, jumper(high, 500, 's', { reach: { up: 300 } })).length, 0);
});

test('spots: stays on her surface, with all of her on it, and off any hidden part', () => {
  const t = createTerrain([SCREEN(), windowRect('a', 100, 600, 400, 100, 1), windowRect('b', 1200, 500, 300, 90, 1)]), me = jumper(t, 300, 'a', { reach: { across: 840 } });
  const [s] = spots(t, me);
  assert.ok(s && s.t >= 36 && s.t <= 364, `on it: ${s && s.t}`);
  const covered = createTerrain([SCREEN(), windowRect('a', 100, 600, 400, 100, 1), windowRect('b', 1200, 500, 300, 90, 1), windowRect('over', 460, 500, 200, 300, 3)]);
  const m2 = jumper(covered, 300, 'a', { reach: { across: 840 } });
  assert.strictEqual(spots(covered, m2).filter(o => o.owner === 'b').length, 0, 'the spot it would be is behind a window');
  const head = createTerrain([SCREEN(), windowRect('a', 100, 600, 400, 100, 1), windowRect('b', 1200, 500, 300, 90, 1), windowRect('over', 460, 400, 200, 150, 3)]);
  const m3 = jumper(head, 300, 'a', { reach: { across: 840 } });
  assert.strictEqual(spots(head, m3).filter(o => o.owner === 'b').length, 0, 'and so is one with a window over her head, not over the top');
});
