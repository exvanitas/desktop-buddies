import { defineConfig } from 'vite';

/* The contract check's app folder: its own small hub, for the Windows runner. See shell-check. */
export default defineConfig({
  base: './',
  publicDir: 'shell-check/public',
  build: {
    outDir: 'dist/shell-check',
    lib: { entry: 'shell-check/hub.ts', formats: ['iife'], name: 'ShellCheck', fileName: () => 'hub.js' }
  }
});
