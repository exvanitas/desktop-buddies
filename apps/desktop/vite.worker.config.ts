import { defineConfig } from 'vite';

/* The world's SharedWorker, as one classic script. Runs after the overlay build, into the same folder. */
export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist/app',
    emptyOutDir: false,
    lib: { entry: 'src/world.ts', formats: ['iife'], name: 'BuddyWorld', fileName: () => 'world.js' }
  }
});
