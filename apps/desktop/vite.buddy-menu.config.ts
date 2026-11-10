import { defineConfig } from 'vite';
import { peelSheet } from '../../packages/peel/build';

/* The right-click menu's page, as one classic script, and its sheet. Runs after the overlay build, into the same folder. */
export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [peelSheet('buddy-menu.css', ['public/buddy-menu.css'])],
  build: {
    outDir: 'dist/app',
    emptyOutDir: false,
    lib: { entry: 'src/buddy-menu-page.ts', formats: ['iife'], name: 'BuddyMenu', fileName: () => 'buddy-menu.js' }
  }
});
