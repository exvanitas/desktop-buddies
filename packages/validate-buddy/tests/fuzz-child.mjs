/* fuzz-run.ts in a Node of its own: node --max-old-space-size=256 fuzz-child.mjs <seed> <cases> [seed files...] */
import { fileURLToPath } from 'node:url';
import { load } from '../bin/bundle.mjs';

await load(fileURLToPath(new URL('./fuzz-run.ts', import.meta.url)));
