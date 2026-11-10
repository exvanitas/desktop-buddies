import { defineConfig } from 'vite';

/* The hub page, as one classic script. Runs after the overlay build, into the same folder. */
export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist/app',
    emptyOutDir: false,
    lib: { entry: 'src/hub.ts', formats: ['iife'], name: 'BuddyHub', fileName: () => 'hub.js' }
  }
});
