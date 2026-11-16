/* Round a window's outer corner near a screen's edge, where the usual swing has no room: she steps
   past the corner and tips over it. Measured on her turned box as drawn, over the turn, against how
   she's drawn the tick before it and once it's over (her climbing tips her into a wall a little
   anyway) and against the same corner with room all round. */
import assert from 'node:assert';
import { test } from 'vitest';
import { corners, label, run, type Corner, type Run } from './corners';

const key = (c: Corner) => `${c.way} ${c.side} ${c.size} ${c.shape} ${c.art}`;
const roomy = (c: Corner) => c.gap >= 5 * c.size && c.above >= 5 * c.size && c.below >= 5 * c.size;
let runs: Run[] | null = null;
/* every corner once, for all the tests below */
function all() {
  if (!runs) runs = corners({ both: true }).map(c => run(c));
  return runs;
}
const twins = () => new Map(all().filter(r => roomy(r.corner)).map(r => [key(r.corner), r]));
/* the window tucked into a screen's corner, with less room either way than her art needs to tip:
   g sin(a) + t cos(a) >= h + w sin(a) cos(a) at every turn a fails for art as wide as she is tall */
const boxedIn = (c: Corner) => c.gap < 5 * c.size && (c.above < 5 * c.size || c.below < 5 * c.size) && c.shape === 'square' && Math.min(c.gap, c.above, c.below) / c.size < 1.1;

test('round a window\'s corner near a screen\'s edge, she always goes round', () => {
  assert.deepStrictEqual(all().filter(r => !r.went).map(r => label(r.corner)), []);
}, 120000);

test('near a screen\'s edge, she steps past the corner and tips over it: never into the window deeper than at either end or than with room', () => {
  const twin = twins(), seen: string[] = [];
  for (const r of all()) {
    if (roomy(r.corner) || boxedIn(r.corner)) continue;
    const bound = Math.max(r.ends.win, twin.get(key(r.corner))!.deepest), over = Math.max(...r.wins) - bound;
    /* a 150th of her size: 3.4 px for a 512 px buddy. Measured 2.7 at most; the swing she had went up to 0.15 of her size. */
    if (over > r.corner.size / 150) seen.push(`${label(r.corner)}: ${over.toFixed(1)} px deeper`);
  }
  assert.deepStrictEqual(seen, []);
}, 120000);

test('near a screen\'s edge, she\'s never drawn further off the screen than at either end', () => {
  const seen = all().filter(r => r.offs.some(d => d > r.ends.off + .5)).map(r => `${label(r.corner)}: ${Math.max(...r.offs).toFixed(1)} px off, ${r.ends.off.toFixed(1)} at the ends`);
  assert.deepStrictEqual(seen, []);
}, 120000);

test('stepping past and tipping over, she moves and turns no more in a tick than round any corner with room at her size', () => {
  const seen: string[] = [];
  for (const size of [64, 120, 240, 512]) {
    const room = all().filter(r => r.corner.size === size && roomy(r.corner));
    const most = { move: Math.max(...room.map(r => r.move)), mid: Math.max(...room.map(r => r.mid)), turn: Math.max(...room.map(r => r.turn)) };
    /* at a twentieth more than her size of room on one side, her turned art always steps past */
    for (const r of all().filter(r => r.corner.size === size && r.corner.art === 'main' && !roomy(r.corner) && !boxedIn(r.corner) && Math.min(r.corner.gap, r.corner.above, r.corner.below) === Math.round(1.05 * size))) {
      if (r.move > most.move + .5 || r.mid > most.mid + .5) seen.push(`${label(r.corner)}: moved ${r.move.toFixed(1)} px, her middle ${r.mid.toFixed(1)}, against ${most.move.toFixed(1)} and ${most.mid.toFixed(1)} with room`);
      if (r.turn > most.turn + .25) seen.push(`${label(r.corner)}: turned ${r.turn.toFixed(1)} degrees, against ${most.turn.toFixed(1)} with room`);
    }
  }
  assert.deepStrictEqual(seen, []);
}, 120000);

test('boxed into a screen\'s corner with no room to tip, she still goes round on the screen without a jump', () => {
  const seen: string[] = [];
  for (const r of all().filter(r => boxedIn(r.corner))) {
    if (r.mid > Math.max(45, r.corner.size / 9)) seen.push(`${label(r.corner)}: her middle moved ${r.mid.toFixed(1)} px in a tick`);
    /* On the screen beats clear of the window: drawn over its corner a moment, as she always was
       there. Measured up to 0.19 of her size past her ends. */
    if (Math.max(...r.wins) > r.corner.size / 5 + r.ends.win) seen.push(`${label(r.corner)}: ${Math.max(...r.wins).toFixed(1)} px into the window`);
  }
  assert.deepStrictEqual(seen, []);
}, 120000);
