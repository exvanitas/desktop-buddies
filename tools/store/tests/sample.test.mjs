/* The release's sample buddy: the repo's sample, byte for byte, the same twice, and any clean buddy
   in her place. A file the app would refuse is never written. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_FROM, exportSample } from '../sample-buddy.mjs';

/* in the tool's own ignored dist folder, gone after each test */
const SCRATCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/tests');
const dir = () => { fs.mkdirSync(SCRATCH, { recursive: true }); return fs.mkdtempSync(path.join(SCRATCH, 'sample-')); };
afterEach(() => fs.rmSync(path.dirname(SCRATCH), { recursive: true, force: true }));
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

describe('sample-buddy', () => {
  it('writes the repo sample byte for byte, and the same file twice', async () => {
    const d = dir(), a = path.join(d, 'a.buddy'), b = path.join(d, 'b.buddy');
    const r = await exportSample(DEFAULT_FROM, a);
    await exportSample(DEFAULT_FROM, b);
    expect(sha(a)).toBe(sha(DEFAULT_FROM));
    expect(sha(b)).toBe(sha(a));
    expect(r.sha256).toBe(sha(a));
    expect(r.name).toBe('Olive');
  });

  it('takes another buddy in her place', async () => {
    const d = dir(), from = path.join(d, 'other.buddy'), out = path.join(d, 'out.buddy');
    const f = JSON.parse(fs.readFileSync(DEFAULT_FROM, 'utf8'));
    f.buddy.name = 'Someone Else';
    fs.writeFileSync(from, JSON.stringify(f));
    expect((await exportSample(from, out)).name).toBe('Someone Else');
    expect(sha(out)).toBe(sha(from));
  });

  it('refuses a file the app would refuse, and writes nothing', async () => {
    const d = dir(), from = path.join(d, 'bad.buddy'), out = path.join(d, 'out.buddy');
    fs.writeFileSync(from, '{"app":"nope"}');
    await expect(exportSample(from, out)).rejects.toThrow(/isn't a clean buddy file/);
    expect(fs.existsSync(out)).toBe(false);
  });
});
