/* Loads a TypeScript entry as one bundle made by the workspace's esbuild, so the command runs on any
   Node 22, with or without type stripping. Nothing is written to disk. */
import { build } from 'esbuild';

export async function load(entry) {
  const out = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', target: 'node22', write: false, logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].contents).toString('base64'));
}
