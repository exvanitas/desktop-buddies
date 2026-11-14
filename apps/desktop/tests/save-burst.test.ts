/* The runner's slow saves, forced: a stretch of writes where the disk takes 250 ms to 1.3 s each, as
   the traces on 3436aee showed, in the middle of a new big buddy's first save. On a clock of its own
   (slow-disk.ts), so it takes a moment. What it shows: the trace names writing and how slow the
   writes got, and writes kept out four at a time save only the round trips, because the exe does
   the disk's work one at a time: a slow disk is just as slow either way. */
import assert from 'node:assert';
import { write } from '@buddies/buddy-file';
import { test } from 'vitest';
import { createLibrary } from '../src/library';
import { createFakeExe } from '../src/shell-fake';
import { bigBuddy } from './maker-harness';
import { slowDisk } from './slow-disk';

const DISK_MS = 6, TRIP_MS = 4;
/* Sixty writes from the 300th, at the runner's slowest: 250 ms to 1.3 s. */
const BURST = [250, 500, 800, 1300];
const burst = (n: number) => n >= 300 && n < 360 ? BURST[n % BURST.length]! : DISK_MS;
const extra = Array.from({ length: 60 }, (_, i) => BURST[(300 + i) % BURST.length]! - DISK_MS).reduce((a, b) => a + b, 0);

async function save(most: number, disk = burst) {
  const exe = createFakeExe(), notes: string[] = [], d = slowDisk(exe.shell, disk, TRIP_MS);
  const lib = createLibrary(d.shell, l => notes.push(l), d.now, most);
  await d.run(lib.add(write(bigBuddy())));
  return { ms: d.now(), line: notes.find(l => l.startsWith('library: a save took'))!, exe };
}
const field = (line: string, re: RegExp) => Number(re.exec(line)![1]);

test('a burst of slow writes: the trace names writing, with the p90 and the slowest', async () => {
  const { ms, line } = await save(4);
  assert.ok(line, 'a slow save says so');
  const writing = field(line, /writing (\d+)/);
  assert.ok(writing / ms > 0.95, `writing is the save: ${line}`);
  assert.ok(field(line, / (\d+) most$/) >= 1300 * 0.99, line);
  /* Four out at once, so each waits for the three ahead of it: the burst's own writes are its p90. */
  assert.ok(field(line, /median, (\d+) p90/) < 250 && field(line, /median, (\d+) p90/) >= 4 * DISK_MS, line);
  assert.match(line, /; 1146 images, 4 at a time, each \d+ median, \d+ p90, \d+ most$/);
}, 60000);

test('four out at once saves the round trips and nothing of the burst', async () => {
  const one = await save(1), four = await save(4);
  /* One at a time pays a round trip and the disk for each write. Four at a time pays the disk alone,
     because the exe's lock keeps the disk's work one at a time. The burst is in both. */
  const writes = 1146 + 1;
  assert.ok(Math.abs(one.ms - (writes * (TRIP_MS + DISK_MS) + extra)) < 0.03 * one.ms, `one at a time: ${one.ms}`);
  assert.ok(Math.abs(four.ms - (writes * DISK_MS + extra)) < 0.05 * four.ms, `four at a time: ${four.ms}`);
  assert.ok(one.ms - four.ms > 0.8 * writes * TRIP_MS, 'the round trips are what four at a time saves');
  assert.ok(four.ms > 30000 && one.ms > 30000, `past the Maker's 30 s wait either way: ${one.ms} and ${four.ms}`);
  /* Without the burst, the share four at a time saves is the round trips' share of a normal save. */
  const calm1 = await save(1, () => DISK_MS), calm4 = await save(4, () => DISK_MS);
  assert.ok(calm4.ms < 0.7 * calm1.ms, `${calm1.ms} -> ${calm4.ms}`);
}, 120000);
