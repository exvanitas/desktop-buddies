import { defineConfig } from 'vite';

/* The overlay page. Everything in dist/app sits beside the exe, which serves it through its asset
   protocol with no server, so scripts are classic bundles at fixed relative paths. */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist/app',
    lib: { entry: 'src/overlay.ts', formats: ['iife'], name: 'BuddyOverlay', fileName: () => 'overlay.js', cssFileName: 'style' }
  }
});
