/* A rectangle's `cut` edges: where it stops is no edge of the thing itself, so nothing is there. */
import assert from 'node:assert';
import { test } from 'vitest';
import { createTerrain } from '../src/terrain';
import { screen, windowRect } from './fixtures';

const SCREEN = () => screen('s', 0, 0, 1600, 900);
const edges = (cut?: ('top' | 'bottom' | 'left' | 'right')[]) => createTerrain([SCREEN(), windowRect('w', 0, 300, 500, 600, 1, { cut })]).surfaces().filter(s => s.owner === 'w').map(s => s.id).sort();

test('nothing cut: all four edges, as ever', () => {
  assert.deepStrictEqual(edges(), ['w:bottom:0', 'w:left:0', 'w:right:0', 'w:top:0']);
  assert.deepStrictEqual(edges([]), ['w:bottom:0', 'w:left:0', 'w:right:0', 'w:top:0']);
});

for (const edge of ['left', 'right', 'bottom', 'top'] as const) {
  test(`a cut ${edge} gives no surface, and leaves the others`, () => {
    assert.deepStrictEqual(edges([edge]), ['w:bottom:0', 'w:left:0', 'w:right:0', 'w:top:0'].filter(id => id !== `w:${edge}:0`));
  });
}

test('several at once', () => {
  assert.deepStrictEqual(edges(['left', 'bottom']), ['w:right:0', 'w:top:0']);
});

test('nothing round the corner: the floor ends in the open at a cut side, and still joins a real one', () => {
  const t = createTerrain([SCREEN(), windowRect('w', 0, 300, 500, 600, 1, { cut: ['left'] })]), top = t.surfaceById('w:top:0')!;
  assert.strictEqual(top.prev, null);
  assert.strictEqual(top.next, 'w:right:0');
});

test('a cut edge stops nothing: a body crosses where it would have been', () => {
  const t = createTerrain([SCREEN(), windowRect('w', 300, 300, 500, 300, 1, { cut: ['left'] })]);
  assert.strictEqual(t.sweep({ x: 200, y: 400 }, { x: 400, y: 400 }, { kind: 'wall' }), null);
});

test('it still hides what is behind it, cut or not', () => {
  const t = createTerrain([SCREEN(), windowRect('w', 300, 300, 500, 300, 2, { cut: ['left', 'bottom'] }), windowRect('v', 400, 400, 200, 100, 1)]);
  assert.ok(t.hidden(t.surfaceById('v:top:0')!, { x: 500, y: 400 }));
});

test('screens have no use for it', () => {
  const plain = createTerrain([SCREEN()]).surfaces().length;
  assert.strictEqual(createTerrain([screen('s', 0, 0, 1600, 900, 1, { cut: ['left'] })]).surfaces().length, plain);
});
