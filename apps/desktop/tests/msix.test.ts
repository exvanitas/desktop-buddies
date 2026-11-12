/* The Store package's builder has its own tests in Python, like the builder. This runs them with
   the checks. Only MakePri and MakeAppx are left to the Windows runner. */
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

test('the MSIX builder passes its tests', () => {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const r = spawnSync(python, ['-I', fileURLToPath(new URL('../packaging/msix/tests/test_msix.py', import.meta.url))], { encoding: 'utf8', timeout: 110000 });
  assert.ok(!r.error, `couldn't run ${python}: ${r.error}`);
  assert.ok(r.status === 0, r.stderr.slice(-4000));
  assert.match(r.stderr, /^OK$/m);
}, 120000);
