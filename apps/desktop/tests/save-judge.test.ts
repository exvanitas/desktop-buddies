/* save-judge.mjs, which smoke.ps1 runs over the Maker log: a stall the runner's disk made passes,
   one of ours fails. The lines are the runner's own, from the runs named. */
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { classify, judge } from '../shell-check/save-judge.mjs';

/* 43576954506 on 739f091: the 39.3 s first save, 38.9 s of it writing. */
const R39 = [
  '  142.68 library: a save took 38909 ms: hashing 15, settling 23, clearing staging 1, writing 38857, the manifest 10, the move 2; 1146 images, 4 at a time, each 31 median, 379 p90, 1062 most',
  '  142.70 maker save of c2fcksvnazd30m8ji8bm2 took 39209 ms: queued 0, looking 39, reading 244, storing 38909, reading back 4, telling 12'
];
/* 43573982407 on 3436aee: a 29.5 s first save. */
const R29 = [
  '  174.13 library: a save took 28651 ms: hashing 23, settling 8, clearing staging 2, writing 28599, the manifest 14, the move 4; 1146 images, 4 at a time, each 35 median, 261 p90, 1015 most',
  '  174.18 maker save of cv2ut7bh39b9ez4il935o took 29286 ms: queued 0, looking 72, reading 515, storing 28651, reading back 9, telling 40'
];
/* 43573979405 on 3436aee: the 30 s upgrade, with her first save earlier in the same log. */
const R30 = [
  '   57.53 library: a save took 9484 ms: hashing 18, settling 8, clearing staging 1, writing 9439, the manifest 12, the move 6; 1146 images, 4 at a time, each 31 median, 38 p90, 82 most',
  '   57.56 maker save of ce9k1ic2dkzdiek4fne2n took 9814 ms: queued 0, looking 40, reading 264, storing 9486, reading back 10, telling 14',
  '  120.51 library: a save took 29558 ms: hashing 16, settling 8, listing 4, writing 28252, the manifest 13, deleting 1266; 1146 images, 4 at a time, each 33 median, 275 p90, 1338 most',
  '  120.54 maker save of ce9k1ic2dkzdiek4fne2n took 29972 ms: queued 0, looking 34, reading 345, storing 29559, reading back 5, telling 29'
];

test('the runner\'s three slow saves are disk stalls, with the lines they were judged by', () => {
  const a = classify(R39, { id: 'c2fcksvnazd30m8ji8bm2', kind: 'first', ms: 39335 });
  assert.strictEqual(a.disk, true, a.why);
  assert.match(a.why, /storing 99% of 39209 ms, writes 31 median, 379 p90, 1062 most/);
  assert.deepStrictEqual(a.trace, R39.map(l => l.trim()));
  assert.strictEqual(classify(R29, { id: 'cv2ut7bh39b9ez4il935o', kind: 'first', ms: 29477 }).disk, true);
  const up = classify(R30, { id: 'ce9k1ic2dkzdiek4fne2n', kind: 'upgrade', ms: 30047 });
  assert.strictEqual(up.disk, true, up.why);
  assert.ok(up.trace[0]!.includes('deleting 1266'), 'the upgrade, not her first save');
});

test('a queue stall is ours, and fails', () => {
  const lines = [
    '  60.00 library: a save took 8000 ms: hashing 15, settling 6, clearing staging 1, writing 7970, the manifest 6, the move 2; 1146 images, 4 at a time, each 28 median, 32 p90, 91 most',
    '  60.01 maker save of cq took 28300 ms: queued 20000, looking 40, reading 250, storing 8000, reading back 4, telling 6'
  ];
  const v = classify(lines, { id: 'cq', kind: 'first', ms: 28400 });
  assert.strictEqual(v.disk, false);
  assert.match(v.why, /storing was 28% of 28300 ms: queued took 20000/);
});

test('slow storing with writes that weren\'t slow is ours too', () => {
  const lines = [
    '  60.00 library: a save took 30000 ms: hashing 15, settling 25000, clearing staging 1, writing 4970, the manifest 6, the move 2; 1146 images, 4 at a time, each 28 median, 32 p90, 91 most',
    '  60.01 maker save of cs took 30300 ms: queued 0, looking 40, reading 250, storing 30000, reading back 4, telling 6'
  ];
  const v = classify(lines, { id: 'cs', kind: 'first', ms: 30400 });
  assert.strictEqual(v.disk, false);
  assert.match(v.why, /writes weren't slow: 28 median, 32 p90, 91 most/);
});

test('a save that never landed fails, and so does one with no library line', () => {
  const going = ['  110.00 maker save of cn still going after 30002 ms: storing for 29718; library: writing for 29679 ms, 834 of 1146 written, 4 out, the oldest for 176 ms; the hub page visible'];
  const v = classify(going, { id: 'cn', kind: 'first', ms: 150000 });
  assert.strictEqual(v.disk, false);
  assert.match(v.why, /never landed/);
  assert.strictEqual(classify([R39[1]!], { id: 'c2fcksvnazd30m8ji8bm2', kind: 'first', ms: 39335 }).disk, false);
});

test('the probe\'s own one-by-one writes have no hub step: only the disk can stall them', () => {
  assert.strictEqual(classify([], { id: 'cx', kind: 'legacy', ms: 40000 }).disk, true);
});

test('judge reads the probe\'s lines, and the command prints what smoke.ps1 reads', () => {
  const probe = (name: string, stalls: unknown[]) => `  174.15 PROBE PASS ${name} ${JSON.stringify({ firstSaveMs: [1], stalls })}`;
  const log = [...R39, probe('shaped_firsts', [{ id: 'c2fcksvnazd30m8ji8bm2', kind: 'first', ms: 39335 }, { id: 'cnever', kind: 'first', ms: 150000 }]), probe('shaped', [])].join('\r\n');
  const out = judge(log);
  assert.deepStrictEqual(out.map(r => [r.name, r.ok]), [['maker.stall.shaped_firsts.first.c2fcksvnazd30m8ji8bm2', true], ['maker.stall.shaped_firsts.first.cnever', false]]);
  assert.match(out[0]!.why, /^disk stall: 39335 ms, storing 99%/);
  assert.match(out[1]!.why, /^not the disk: 150000 ms, never landed/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'save-judge-')), file = path.join(dir, 'maker.log');
  try {
    fs.writeFileSync(file, log);
    const printed = execFileSync(process.execPath, [new URL('../shell-check/save-judge.mjs', import.meta.url).pathname, file], { encoding: 'utf8' }).split('\n');
    assert.match(printed[0]!, /^PASS maker\.stall\.shaped_firsts\.first\.c2fcksvnazd30m8ji8bm2 disk stall: /);
    assert.ok(printed[1]!.startsWith('  trace: ') && printed[1]!.includes('379 p90'), printed[1]);
    assert.ok(printed.some(l => /^FAIL maker\.stall\.shaped_firsts\.first\.cnever not the disk/.test(l)));
    fs.writeFileSync(file, probe('shaped', []));
    assert.strictEqual(execFileSync(process.execPath, [new URL('../shell-check/save-judge.mjs', import.meta.url).pathname, file], { encoding: 'utf8' }).trim(), 'PASS maker.stalls none');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
