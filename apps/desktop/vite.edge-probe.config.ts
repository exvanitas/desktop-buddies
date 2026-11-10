import { defineConfig } from 'vite';

/* The edge shots' two probe scripts, which edge-shots.ps1 adds to its own copy of the app. They
   never ship. `--mode world` builds the world, anything else the page. Into the probes' folder. */
export default defineConfig(({ mode }) => ({
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist/probe',
    emptyOutDir: false,
    lib: mode === 'world'
      ? { entry: 'shell-check/world-probe.ts', formats: ['iife'], name: 'EdgeWorld', fileName: () => 'world-probe.js' }
      : { entry: 'shell-check/edge-probe.ts', formats: ['iife'], name: 'EdgeProbe', fileName: () => 'edge-probe.js' }
  }
}));
