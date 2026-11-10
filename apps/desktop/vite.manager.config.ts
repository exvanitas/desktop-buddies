import { defineConfig } from 'vite';
import { peelSheet } from '../../packages/peel/build';

/* The Manager page, as one classic script, and its sheet. Runs after the overlay build, into the same folder. */
export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [peelSheet('manager.css', ['public/manager.css'])],
  build: {
    outDir: 'dist/app',
    emptyOutDir: false,
    lib: { entry: 'src/manager.ts', formats: ['iife'], name: 'BuddyManager', fileName: () => 'manager.js' }
  }
});
