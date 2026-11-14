/* A save the hub answers after the Maker's 30 s wait, as a slow disk with antivirus can make a big
   buddy's first save. While the hub gets somewhere it says `working`, and whoever's waiting waits on:
   no false "no answer" while she lands. A hub that gets nowhere says nothing, so a real hang still
   says "no answer". The hub's clock and the pages' clocks only move when told. */
import assert from 'node:assert';
import { write } from '@buddies/buddy-file';
import { test } from 'vitest';
import { WORKING_MS } from '../src/hub-core';
import type { Said } from '../src/manager-api';
import { createManagerClient } from '../src/manager-client';
import { createDisk, frame, hubOn, lands, makerOn, revOf, saved, small, tick } from './maker-harness';

const STEP_MS = WORKING_MS + 1000;
const big = () => ({ name: 'Slow', base: frame('slow-base'), poses: { walk: { frames: Array.from({ length: 6 }, (_, i) => frame(`slow-${i}`)), fps: 6, scale: 1 } } });

async function setup(...more: string[]) {
  const exe = createDisk(), clock = { t: 0 }, heard: Said[] = [];
  const r = await hubOn(exe, write(small('c1')), undefined, { now: () => clock.t });
  const m = await r.manager();
  for (const id of more) await m.client.importFiles([{ name: `${id}.buddy`, path: `${id}.buddy`, size: 1, text: async () => write(small(id)), url: async () => '' }]);
  await r.done();
  r.bus.wire().listen(x => { heard.push(x); });
  const page = await makerOn(r, 'c1');
  const working = () => heard.filter(x => x.k === 'working').length;
  return { exe, r, m, page, clock, working };
}

test('a save that lands slowly but steadily: never "no answer", and saved once she has', async () => {
  const { exe, r, page, clock, working } = await setup();
  /* Each of her writes is held, and let go one at a time, a step apart: 8 writes, 48 s in all. */
  const holds = Array.from({ length: 12 }, () => exe.hold('data_write'));
  const made = page.maker.addPet(big(), true)!;
  await page.pass(1300);
  const id = made.character!;
  const seen: string[] = [];
  for (const go of holds) {
    clock.t += STEP_MS; go(); await r.done();
    await page.pass(STEP_MS);
    seen.push(page.saveState.kind);
  }
  assert.ok(!seen.includes('failed'), seen.join());
  assert.strictEqual(saved(exe, id)!.name, 'Slow');
  assert.strictEqual(page.saveState.kind, 'saved');
  assert.strictEqual(lands(exe, id), 1);
  assert.ok(working() >= 6, `the hub said it was working ${working()} times`);
});

test('a save that gets nowhere still says "no answer" at 30 s, and the hub says nothing meanwhile', async () => {
  const { exe, r, page, clock, working } = await setup();
  const release = exe.hold('data_write', () => true);
  page.maker.addPet(big(), true);
  await page.pass(1300);
  for (let i = 0; i < 6; i++) { clock.t += STEP_MS; await r.done(); await page.pass(STEP_MS); }
  const shown = page.saveState as { kind: string; title?: string };
  assert.strictEqual(shown.kind, 'failed');
  assert.match(shown.title ?? '', /no answer/);
  assert.strictEqual(working(), 0, 'nothing moved, so nothing was said');
  release(); await r.done(); await page.pass(100);
  assert.strictEqual(page.saveState.kind, 'saved', 'and when it does land, it says so');
});

test('the Manager: a delete queued behind a slow save waits on, and is answered, never "no answer" then done anyway', async () => {
  const { exe, r, page, clock } = await setup('c2');
  const timers: { at: number; f: () => void }[] = [];
  let mt = 0;
  const client = createManagerClient({
    wire: r.bus.wire(), session: 'slow-manager', shimeji: async () => null, closeWindow: async () => {},
    after: (ms, f) => { const t = { at: mt + ms, f }; timers.push(t); return () => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); }; }
  });
  const pass = (ms: number) => { mt += ms; for (const t of timers.filter(x => x.at <= mt)) { timers.splice(timers.indexOf(t), 1); t.f(); } };
  await r.done(); await tick();
  const rev = revOf(client, 'c2');
  assert.ok(rev >= 0, 'the Manager has her');
  const holds = Array.from({ length: 12 }, () => exe.hold('data_write'));
  page.maker.addPet(big(), true);
  await page.pass(1300);
  let answer: Awaited<ReturnType<typeof client.deleteBuddy>> | null = null;
  void client.deleteBuddy('c2', rev).then(a => { answer = a; });
  await r.done();
  for (const go of holds) {
    clock.t += STEP_MS; go(); await r.done();
    await page.pass(STEP_MS); pass(STEP_MS); await r.done();
    if (answer) break;
  }
  assert.ok(answer, 'answered');
  assert.deepStrictEqual(answer, { ok: true });
  assert.ok(!client.state!.failures.some(f => /no answer/.test(f.title)), JSON.stringify(client.state!.failures));
  assert.ok(!client.state!.buddies.some(b => b.id === 'c2'), 'and she was deleted, once');
});

test('closing on a save that lands slowly: Close anyway is offered at 5 s as ever, and the window goes once she lands', async () => {
  const { exe, r, page, clock } = await setup();
  const holds = Array.from({ length: 12 }, () => exe.hold('data_write'));
  const made = page.maker.addPet(big(), true)!;
  await page.pass(1300);
  page.host.window!.close();
  await r.done();
  const offered: string[][] = [], open: boolean[] = [];
  for (const go of holds) {
    clock.t += STEP_MS; go(); await r.done();
    await page.pass(STEP_MS);
    offered.push(page.closing.labels()); open.push(exe.windows.has(page.label));
  }
  assert.ok(offered[0]!.includes('Close anyway'), JSON.stringify(offered[0]));
  assert.ok(open[3], 'still open while she lands, with the way out offered');
  assert.ok(!open.at(-1), 'gone by itself once she has');
  assert.strictEqual(saved(exe, made.character!)!.name, 'Slow');
});
