import { defineConfig } from 'vite';

/* The local API's end-to-end probe, which api-e2e.ps1 adds to its own copy of the app. It never ships. */
export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist/api-probe',
    lib: { entry: 'shell-check/api-probe.ts', formats: ['iife'], name: 'ApiProbe', fileName: () => 'api-probe.js' }
  }
});
