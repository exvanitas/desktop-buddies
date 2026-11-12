#!/usr/bin/env node
/* Writes the sample .buddy file that goes on a release, for the Store's testers and anyone else who
   wants to try the app before they have a buddy. The app ships with none.

     node tools/store/sample-buddy.mjs [--from <file>] [--out <file>]

   --from  the buddy to export. By default the repo's code-drawn sample,
           packages/test-support/fixtures/sample.json. Any clean .buddy file works, so the sample
           can be swapped without changing this script.
   --out   where to write it. By default desktop-buddies-sample.buddy in the current folder.

   The file is checked as the app checks one (packages/validate-buddy) and copied byte for byte, so
   the same input always gives the same file. It prints her name, the size and the SHA-256. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from '../../packages/validate-buddy/bin/bundle.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_FROM = path.join(REPO, 'packages/test-support/fixtures/sample.json');
export const DEFAULT_NAME = 'desktop-buddies-sample.buddy';

/* The file's bytes and her name, or an Error saying why not. */
export async function exportSample(from, out) {
  const bytes = fs.readFileSync(from);
  const { validate } = await load(path.join(REPO, 'packages/validate-buddy/src/index.ts'));
  const report = validate(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
  if (!report.ok) throw new Error(`${path.basename(from)} isn't a clean buddy file: ${report.problems.slice(0, 3).map(p => p.message).join('; ')}`);
  const name = JSON.parse(bytes.toString('utf8')).buddy.name;
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, bytes);
  return { name, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = n => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
  try {
    const out = flag('out') || DEFAULT_NAME;
    const r = await exportSample(flag('from') || DEFAULT_FROM, out);
    console.log(`${path.basename(out)}: ${r.name}, ${r.bytes} bytes, sha256 ${r.sha256}`);
  } catch (e) {
    console.error(String(e.message || e));
    process.exitCode = 1;
  }
}
