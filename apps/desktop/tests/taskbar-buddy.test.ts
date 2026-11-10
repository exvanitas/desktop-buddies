/* taskbar-check.ps1's test buddy: the committed file is what the helper makes, it's a valid buddy of one
   solid colour, and the run's setup brings her out alone, sunk past a bottom taskbar's edge. */
import assert from 'node:assert';
import fs from 'node:fs';
import { inflateSync } from 'node:zlib';
import { read } from '@buddies/buddy-file';
import type { BuddyData } from '@buddies/engine';
import { test } from 'vitest';
import { COLOUR, FLOOR_LIFT, SIZE, TOLERANCE, squarePng, taskbarBuddy } from '../shell-check/taskbar-buddy';
import { createHost, type Area, type Message, type Port } from '../src/host';
import { createHub } from '../src/hub-core';
import type { Said } from '../src/manager-api';
import type { Monitor } from '../src/shell';
import { createFakeExe } from '../src/shell-fake';
import { createBus } from '../src/wire';

const FILE = new URL('../shell-check/taskbar-check.buddy', import.meta.url);

test('the committed file is what the helper makes', () => {
  assert.strictEqual(fs.readFileSync(FILE, 'utf8'), taskbarBuddy() + '\n');
});

test('a valid buddy: one opaque colour, her size, a floor lift and nothing else', () => {
  const b = read(fs.readFileSync(FILE, 'utf8'));
  assert.deepStrictEqual([b.character, b.size, b.lift, Object.keys(b.poses).length], ['ctaskbarcheck', SIZE, { floor: FLOOR_LIFT }, 0]);
  const png = Buffer.from(b.base.src.split(',')[1]!, 'base64');
  assert.ok(png.equals(Buffer.from(squarePng())));
  /* IHDR then one IDAT: inflate it and look at every pixel, each row after its filter byte */
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20), at = 8 + 25, len = png.readUInt32BE(at);
  assert.strictEqual(png.toString('latin1', at + 4, at + 8), 'IDAT');
  const raw = inflateSync(png.subarray(at + 8, at + 8 + len));
  assert.strictEqual(raw.length, h * (1 + w * 4));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * (1 + w * 4) + 1 + x * 4;
    assert.deepStrictEqual([raw[i], raw[i + 1], raw[i + 2], raw[i + 3]], [COLOUR.r, COLOUR.g, COLOUR.b, 255], `${x},${y}`);
  }
});

/* The primary monitor as a run would find it: 1920 x 1080 with a 48 px taskbar at the bottom. */
const MONITOR: Monitor = { i: 0, name: 'A', primary: true, scale: 1, x: 0, y: 0, w: 1920, h: 1032, full: { x: 0, y: 0, w: 1920, h: 1080 } };

test('the run\'s data folder and launch file bring her out, alone, nobody seeded', async () => {
  const exe = createFakeExe({ monitors: [MONITOR], args: ['--no-manager', 'taskbar-check.buddy'], opened: [{ name: 'taskbar-check.buddy', content: fs.readFileSync(FILE, 'utf8') }] });
  /* what the script writes before it starts the exe */
  await exe.shell.dataWrite('settings.json', JSON.stringify({ out: [], noSeed: true }));
  const sent: Message[] = [];
  const hub = createHub({ shell: exe.shell, send: m => sent.push(m), seed: async () => { throw new Error('seeded'); }, after: () => {}, wire: createBus<Said>().wire() });
  await hub.start();
  await new Promise(r => setTimeout(r)); await hub.settled;
  const pets = [...sent].reverse().find(m => m.k === 'pets' || m.k === 'start') as Extract<Message, { k: 'pets' | 'start' }>;
  assert.deepStrictEqual(pets.pets.map(p => p.id), ['ctaskbarcheck']);
  assert.ok(!exe.logs.some(l => /seeded/.test(l)), exe.logs.join('\n'));

  /* and in the world she stands on the work area's floor, drawn down past it, over the strip */
  const area: Area = { i: 0, x: 0, y: 0, w: 1920, h: 1032, scale: 1, full: MONITOR.full };
  let t = 0;
  const every: { ms: number; f: () => void; next: number }[] = [];
  const host = createHost({ random: () => .5, now: () => t, note: () => {}, after: () => 0, cancel: () => {}, every: (ms, f) => { every.push({ ms, f, next: ms }); } });
  const port: Port = { postMessage() {} };
  host.connect(port);
  host.message(port, { k: 'start', all: [area], pets: pets.pets as BuddyData[] });
  for (let i = 0; i < 400 && !(host.sim!.pets.get('ctaskbarcheck')!.P.surf === 'floor'); i++) { t += 16; for (const e of every) if (t >= e.next) { e.next += e.ms; e.f(); } }
  const pet = host.sim!.pets.get('ctaskbarcheck')!;
  assert.strictEqual(pet.P.surf, 'floor');
  pet.go('sit'); pet.P.dur = 1e9; t += 16; for (const e of every) if (t >= e.next) { e.next += e.ms; e.f(); }
  const f = pet.frame({ x: 0, y: 0, scale: 1, w: 1920, h: 1080 });
  const bottom = f.box.t + f.box.size;
  assert.ok(bottom - 1032 >= 48, `drawn down to ${bottom}, ${bottom - 1032} px past the floor`);
});

test('the check looks for her colour, opens her file, and starts from the settings tested above', () => {
  const ps = fs.readFileSync(new URL('../shell-check/taskbar-check.ps1', import.meta.url), 'utf8');
  const m = ps.match(/\$COLOUR = @\{ r = (\d+); g = (\d+); b = (\d+); tol = (\d+) \}/)!;
  assert.deepStrictEqual(m.slice(1).map(Number), [COLOUR.r, COLOUR.g, COLOUR.b, TOLERANCE]);
  assert.ok(ps.includes("'taskbar-check.buddy'"));
  assert.ok(ps.includes(`'{"out":[],"noSeed":true}'`));
});
