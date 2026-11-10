#!/usr/bin/env node
/* pnpm -s validate-buddy [--json] <file>... checks .buddy files as hostile data. Exit 0 when all are clean. */
import { fileURLToPath } from 'node:url';
import { load } from './bundle.mjs';

const { run } = await load(fileURLToPath(new URL('../src/cli.ts', import.meta.url)));
/* run as `pnpm validate-buddy`, paths are from where pnpm was called; INIT_CWD leaks into anything pnpm starts, so only then */
const byScript = process.env.npm_lifecycle_event === 'validate-buddy' && process.env.INIT_CWD;
const { code, out } = run(process.argv.slice(2), byScript || process.cwd());
process.stdout.write(out);
process.exitCode = code;
