import { defineConfig } from 'vite';

/* The pacing check's probe, which it adds to its own copy of overlay.html. It never ships. Into the
   probes' folder, after the others. See pacing.ps1. */
export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist/probe',
    emptyOutDir: false,
    lib: { entry: 'shell-check/pacing-probe.ts', formats: ['iife'], name: 'PacingProbe', fileName: () => 'pacing-probe.js' }
  }
});
