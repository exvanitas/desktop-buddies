/* A copy out on the desktop while her file is edited: the real hub feeding the real world. She picks
   up the edit without being dismissed, her image really changes, and who's out doesn't. */
import assert from 'node:assert';
import { write } from '@buddies/buddy-file';
import { test } from 'vitest';
import { createHost, type Message, type Port } from '../src/host';
import { whole } from './areas';
import { createDisk, frame, hubOn, makerOn, pickedFile, small } from './maker-harness';

/* The world the hub is talking to, with one overlay joined, on a clock moved by hand. */
function worldOf(r: Awaited<ReturnType<typeof hubOn>>) {
  let now = 0, step = () => {};
  const host = createHost({ random: () => .5, now: () => now, after: () => 0, cancel: () => {}, every: (ms, f) => { if (ms === 16) step = f; }, note() {} });
  const frames: { k: string; frame?: { pets: { id: string; src?: string | null; off?: boolean }[] } }[] = [];
  const hub: Port = { postMessage() {} }, overlay: Port = { postMessage: m => frames.push(m as (typeof frames)[number]) };
  host.connect(hub); host.connect(overlay);
  const at = whole({ i: 0, x: 0, y: 0, w: 1920, h: 1040, scale: 1 });
  let fed = 0;
  /* Everything the hub has said to the world since last time. */
  const feed = () => { for (; fed < r.sent.length; fed++) host.message(hub, r.sent[fed] as Message); };
  feed();
  host.message(overlay, { k: 'join', me: at, n: 0 });
  const run = (ticks = 5) => { feed(); for (let i = 0; i < ticks; i++) { now += 16; step(); } };
  const lastSrc = (id: string) => frames.flatMap(f => f.frame?.pets ?? []).filter(p => p.id === id && p.src).at(-1)?.src ?? null;
  return { host, run, lastSrc, sim: () => host.sim!, frames };
}

async function outOnTheDesktop(copies = 1) {
  const exe = createDisk(), r = await hubOn(exe, write(small('c1', 'Pip')));
  const m = await r.manager();
  for (let i = 1; i < copies; i++) await m.client.callAnother('c1');
  await r.done();
  const world = worldOf(r);
  world.run(300); /* she arrives from above the screen */
  const page = await makerOn(r, 'c1');
  await r.done();
  return { exe, r, m, world, page };
}

test('her image really changes on the desktop, with no dismiss', async () => {
  const { world, page, r } = await outOnTheDesktop();
  const pet = world.sim().pets.get('c1')!, before = world.lastSrc('c1');
  assert.match(before!, /^library\/c1\/[0-9a-f]{32}\.png$/);
  const x = pet.P.x;
  await page.maker.setMainImage(pickedFile('new.png'));
  await page.pass(1300);
  await r.done();
  world.run();
  const after = world.lastSrc('c1');
  assert.notStrictEqual(after, before, 'new bytes, a new name, so no page can show the old image');
  assert.strictEqual(world.sim().pets.get('c1'), pet, 'the same buddy: she wasn\'t dismissed or remade');
  assert.ok(Math.abs(pet.P.x - x) < 100, `she stays about where she was: ${x} to ${pet.P.x}`);
});

test('an image that didn\'t change keeps its URL, so no page loads it again', async () => {
  const { world, page, r, exe } = await outOnTheDesktop();
  const before = world.lastSrc('c1'), seen = new Set<string>();
  for (const name of ['A', 'B', 'C']) {
    page.maker.setName(name);
    await page.pass(1300);
    await r.done();
    world.run();
    seen.add(world.lastSrc('c1')!);
  }
  assert.deepStrictEqual([...seen], [before]);
  assert.ok(exe.files.has(before!), 'and it\'s served from where she is now');
});

test('her name and size reach the desktop too', async () => {
  const { world, page, r } = await outOnTheDesktop();
  page.maker.setSize(300);
  await page.pass(1300);
  await r.done();
  world.run(3);
  const pets = r.sent.filter(m => m.k === 'pets').at(-1) as Extract<Message, { k: 'pets' }>;
  assert.strictEqual(pets.pets[0]!.size, 300);
});

test('who\'s out doesn\'t change: not the list, not the count, and settings aren\'t written for it', async () => {
  const { exe, world, page, r, m } = await outOnTheDesktop(3);
  const before = [...world.sim().pets.keys()], kept = exe.files.get('settings.json');
  page.maker.setName('Bea');
  await page.pass(1300);
  await r.done();
  world.run();
  assert.deepStrictEqual([...world.sim().pets.keys()], before);
  assert.strictEqual(m.s().buddies.find(b => b.id === 'c1')!.copies, 3);
  assert.deepStrictEqual(new TextDecoder().decode(exe.files.get('settings.json')), new TextDecoder().decode(kept));
  assert.ok(!r.sent.some(x => x.k === 'dismiss'));
});

test('all her copies change, not just the first', async () => {
  const { world, page, r } = await outOnTheDesktop(3);
  await page.maker.setMainImage(pickedFile('new.png'));
  await page.pass(1300);
  await r.done();
  world.run();
  const srcs = ['c1', 'c1~1', 'c1~2'].map(world.lastSrc);
  assert.ok(srcs.every(s => s && s === srcs[0]), srcs.join());
});

test('a buddy at home stays home when she\'s edited', async () => {
  const { world, page, r, m } = await outOnTheDesktop();
  await m.client.dismiss('c1');
  await r.done();
  world.run();
  page.maker.setName('Bea');
  await page.pass(1300);
  await r.done();
  assert.strictEqual(m.s().buddies.find(b => b.id === 'c1')!.status, 'home');
  const pets = r.sent.filter(x => x.k === 'pets').at(-1) as Extract<Message, { k: 'pets' }>;
  assert.deepStrictEqual(pets.pets, []);
});

test('the Manager and the tray see the new name and image', async () => {
  const { exe, page, r, m } = await outOnTheDesktop();
  const before = m.s().buddies[0]!.image;
  page.maker.setName('Bea');
  page.maker.current()!.base = frame('other');
  await page.pass(1300);
  await r.done();
  assert.strictEqual(m.s().buddies[0]!.name, 'Bea');
  assert.notStrictEqual(m.s().buddies[0]!.image, before);
  assert.ok(JSON.stringify(exe.tray).includes('Bea'));
});

test('being held mid-save, she stays held', async () => {
  const { world, page, r } = await outOnTheDesktop();
  const hub: Port = { postMessage() {} };
  world.host.connect(hub);
  world.run();
  const pet = world.sim().pets.get('c1')!;
  world.host.message(hub, { k: 'down', id: 'c1', x: pet.P.x, y: pet.P.y, from: 0 });
  world.host.message(hub, { k: 'cursor', x: pet.P.x, y: pet.P.y, down: true });
  world.run(2);
  for (let i = 1; i < 10; i++) { world.host.message(hub, { k: 'cursor', x: 500, y: 500 - i * 20, down: true }); world.run(1); }
  assert.strictEqual(pet.P.state, 'held');
  page.maker.setName('Bea');
  await page.pass(1300);
  await r.done();
  world.run();
  assert.strictEqual(world.sim().pets.get('c1'), pet);
  assert.strictEqual(pet.P.state, 'held');
});

test('an edit that drops a pose she\'s doing doesn\'t stop her', async () => {
  const { world, page, r } = await outOnTheDesktop();
  page.maker.clearPose(page.maker.current()!, 'walk');
  await page.pass(1300);
  await r.done();
  world.run(120);
  assert.ok(world.sim().pets.get('c1'));
});
