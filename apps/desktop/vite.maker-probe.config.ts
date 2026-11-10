import { defineConfig } from 'vite';
import { playerBundle } from './player-bundle';

/* The smoke run's probe of the Maker, which stands in for maker.js in its own copy of the app. It
   never ships. Runs after the Manager's probe, into the same folder. See smoke.ps1. */
export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [playerBundle()],
  build: {
    outDir: 'dist/probe',
    emptyOutDir: false,
    rollupOptions: { input: 'shell-check/maker-probe.ts', output: { format: 'iife', entryFileNames: 'maker-probe.js' } }
  }
});
