/* Mutated valid files: the validator never throws, never hangs and stays small. The run is its own Node,
   with a 256 MB heap and a time limit, because a hang can't be caught from inside. */
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url)), SAMPLE = path.resolve(HERE, '../../test-support/fixtures/sample.json');
const CASES = 4000, SLOWEST_MS = 1000, RSS_MB = 400, LIMIT_MS = 120000;

test(`${CASES} mutated files: nothing thrown, no hang, under ${RSS_MB} MB`, () => {
  const r = spawnSync(process.execPath, ['--max-old-space-size=256', path.join(HERE, 'fuzz-child.mjs'), '20261109', String(CASES), SAMPLE],
    { encoding: 'utf8', timeout: LIMIT_MS, killSignal: 'SIGKILL' });
  assert.strictEqual(r.signal, null, `killed by ${r.signal}: a hang or a runaway`);
  assert.strictEqual(r.status, 0, r.stderr.slice(0, 2000));
  const d = JSON.parse(r.stdout.trim().split('\n').pop()!);
  console.log('fuzz', JSON.stringify(d));
  assert.strictEqual(d.cases, CASES);
  assert.strictEqual(d.throws, 0, r.stderr.slice(0, 2000));
  assert.strictEqual(d.internal, 0, r.stderr.slice(0, 2000));
  assert.ok(d.slowestMs < SLOWEST_MS, `slowest case took ${d.slowestMs} ms`);
  assert.ok(d.peakRssMb < RSS_MB, `peak ${d.peakRssMb} MB`);
  /* the mutations reach the image parsers, not just the reader */
  for (const code of ['truncated', 'malformed', 'type-mismatch']) assert.ok(d.seen[code] > 0, `no ${code} seen: ${JSON.stringify(d.seen)}`);
}, LIMIT_MS + 10000);
