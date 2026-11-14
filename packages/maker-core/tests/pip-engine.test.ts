/* Pip in the engine: every pose slot shows her own art, and a long seeded run, with a person picking
   her up, swinging, holding, throwing, clicking and hovering, shows each pose the engine has without
   an error, always in a frame of that pose's own art. */
import assert from 'node:assert';
import { test } from 'vitest';
import { POSES, hasArt } from '@buddies/buddy-file';
import { BOOK, type BuddyData, type Pet } from '@buddies/engine';
import { screen, windowRect, world, type TestWorld } from '../../engine/tests/support';
import { createSamples } from '../src';
import { measuringPaper } from './paper';

/* In the schema, with nothing in the engine that shows it yet. */
const NOT_IN_ENGINE = new Set(['dangle_legs']);
const VP = { x: 0, y: 0, scale: 1 };

async function pip(): Promise<BuddyData> {
  const m = measuringPaper();
  return { id: 'pip', ...await createSamples(m.paper, m.art).build('pip') };
}

test('every pose slot resolves to her own art, not a fallback', async () => {
  const p = await pip();
  for (const s of POSES) assert.ok(hasArt(p, s.key), s.key);
});

/* A world that notes, every frame, the pose she shows and whether the picture is that pose's own. */
function watched(p: BuddyData) {
  const w = world([screen('s', 0, 0, 1600, 900), windowRect('w1', 300, 420, 640, 320, 1), windowRect('w2', 1050, 250, 400, 300, 2)], { seed: 7 });
  const pet = w.add(p), seen = new Map<string, number>(), wrong: string[] = [];
  const own = new Map(Object.entries(p.poses).map(([k, pose]) => [k, new Set(pose!.frames.map(f => f.src))]));
  const step = (n: number, until?: () => boolean) => {
    for (let i = 0; i < n; i++) {
      w.frame();
      const f = pet.frame(VP), pose = f.stage.split(' ')[2]!;
      seen.set(pose, (seen.get(pose) || 0) + 1);
      if (!own.get(pose)?.has(f.src!) && wrong.length < 10) wrong.push(`${pose} at ${w.now.t.toFixed(0)}`);
      assert.ok(Number.isFinite(pet.P.x) && Number.isFinite(pet.P.y), `she's somewhere at ${w.now.t}`);
      if (until && until()) return;
    }
  };
  return { w, pet, seen, wrong, step };
}

/* hands: press on her, move, let go */
function grab(w: TestWorld, pet: Pet) { const c = pet.center(); w.sim.input.down(pet.id, c.x, c.y); w.sim.input.move(pet.id, c.x + 8, c.y - 8); return { x: c.x + 8, y: c.y - 8 }; }

test('a long seeded run with Pip reaches every pose the engine shows, each in her own art', async () => {
  const p = await pip(), { w, pet, seen, wrong, step } = watched(p), { input } = w.sim;
  const floor = () => pet.P.surf === 'floor' && pet.calm();

  /* ten minutes on her own */
  step(36000);

  /* each behaviour and action, asked for in turn */
  for (const name of [...Object.keys(BOOK.behaviours), ...Object.keys(BOOK.actions)]) {
    step(3000, floor);
    pet.act(name);
    const pose = BOOK.behaviours[name]?.main.pose ?? BOOK.actions[name]?.clip;
    step(1500, () => !!pose && seen.has(pose) && floor());
  }

  /* picked up, swung both ways, held still until she struggles free */
  step(3000, floor);
  let at = grab(w, pet); step(20);
  for (let i = 0; i < 90; i++) { at = { x: at.x + (i % 30 < 15 ? 28 : -28), y: at.y }; input.move(pet.id, at.x, at.y); step(1); }
  step(700, () => pet.P.state !== 'held');
  input.up(pet.id);

  /* thrown hard, up and sideways, a few times */
  for (const [dx, dy] of [[40, -40], [-44, -10], [44, 30], [0, -45]] as const) {
    step(3000, floor);
    at = grab(w, pet); step(10);
    for (let i = 0; i < 4; i++) { at = { x: at.x + dx, y: at.y + dy }; input.move(pet.id, at.x, at.y); step(1); }
    input.up(pet.id); step(600);
  }

  /* clicked until she's cross; hovered over until she's shy */
  step(3000, floor);
  for (let i = 0; i < 6; i++) { const c = pet.center(); input.down(pet.id, c.x, c.y); input.up(pet.id); step(12); }
  step(400);
  step(3000, floor);
  { const c = pet.center(); input.pointer(c.x, c.y); input.enter(pet.id); step(300); input.leave(pet.id); }

  /* and ten more minutes */
  step(36000);

  const missing = POSES.map(s => s.key as string).filter(k => !NOT_IN_ENGINE.has(k) && !seen.has(k));
  assert.deepStrictEqual(missing, [], `never shown: ${missing.join(', ')}`);
  assert.deepStrictEqual(wrong, [], 'a pose showed a picture that isn\'t its own');
});
