/* The release scripts' own tests are Python, like the scripts. This runs them with the checks. */
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

test('the packer and the version check pass their tests', () => {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const r = spawnSync(python, ['-I', fileURLToPath(new URL('test_release.py', import.meta.url))], { encoding: 'utf8', timeout: 110000 });
  assert.ok(!r.error, `couldn't run ${python}: ${r.error}`);
  assert.ok(r.status === 0, r.stderr.slice(-4000));
  assert.match(r.stderr, /^OK$/m);
/* About 4.5 s alone, so the 5 s default fails it whenever the rest of the suite runs alongside. */
}, 120000);
