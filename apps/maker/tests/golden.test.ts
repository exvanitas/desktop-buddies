/* The engine must paint what the original painted, frame for frame, and draw the same random
   numbers in the same order. On a mismatch, replays the original to show the first difference. */
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { test } from 'vitest';
import { createWorld } from '../src/web-host';

const require = createRequire(import.meta.url);
const { Driver, originalScripts } = require('./golden/harness.js');
const { scenarios } = require('./golden/scenarios.js');
const { traces, chunk } = require('./golden/traces.json');
const rerecorded: string[] = require('./golden/rerecorded.json').batches.flatMap((b: { scenarios: string[] }) => b.scenarios);

interface Scenario { name: string; opt: object; fn(d: unknown): void }
interface Trace { frames: number; rand: number; hashes: string[] }

function play(s: Scenario, source: object, keep: boolean) { const d = new Driver({ ...source, keep, ...s.opt }); s.fn(d); return d; }

function firstDifference(s: Scenario) {
  if (rerecorded.includes(s.name)) return 're-recorded on purpose, so the original can no longer show the difference';
  const a: string[] = play(s, { scripts: originalScripts() }, true).lines, b: string[] = play(s, { create: createWorld }, true).lines;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return `frame ${i + 1}\n  original: ${String(a[i]).slice(0, 1500)}\n  now:      ${String(b[i]).slice(0, 1500)}`;
  }
  return 'traces agree when replayed; the recorded hashes are stale';
}

/* The longest scenarios take 4 to 5 s alone, so a busy machine pushes them past vitest's 5 s. Their
   traces are what's tested, not their speed. */
const SCENARIO_MS = 30000;

for (const s of scenarios as Scenario[]) {
  test(`golden: ${s.name}`, { timeout: SCENARIO_MS }, () => {
    const want: Trace | undefined = traces[s.name];
    assert.ok(want, 'no recorded trace');
    const got: Trace = play(s, { create: createWorld }, false).finish();
    if (got.frames !== want.frames || got.rand !== want.rand || got.hashes.join() !== want.hashes.join()) {
      const at = got.hashes.findIndex((h, i) => h !== want.hashes[i]);
      assert.fail(`differs near frame ${Math.max(0, at) * chunk}: ${firstDifference(s)}`);
    }
  });
}
