import { defineConfig } from 'vite';

/* The smoke run's probe, which it adds to its own copy of the app. It never ships. See smoke.ps1. */
export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist/probe',
    lib: { entry: 'shell-check/manager-probe.ts', formats: ['iife'], name: 'ManagerProbe', fileName: () => 'manager-probe.js' }
  }
});
