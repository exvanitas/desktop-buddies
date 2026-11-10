import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { peelSheet } from '../../packages/peel/build';
import { playerBundle } from './player-bundle';

/* maker.js embeds Nunito for exported pages, so Nunito's licence goes beside the other fonts. */
const nunitoLicence: Plugin = {
  name: 'nunito-licence',
  apply: 'build',
  writeBundle(options) {
    const fonts = path.join(options.dir!, 'fonts');
    fs.mkdirSync(fonts, { recursive: true });
    fs.copyFileSync(new URL('../maker/src/fonts/nunito-OFL.txt', import.meta.url), path.join(fonts, 'nunito-OFL.txt'));
  }
};

/* The Maker page, as one classic script. Runs after the overlay build, into the same folder. Not
   Vite's lib mode, as the other pages are: it looks for an iife's opening with a regex, finds the one
   inside the embedded player's text, and cuts the bundle there. */
export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [playerBundle(), nunitoLicence, peelSheet('maker.css', ['../../packages/maker-view/src/maker-view.css', 'src/maker-closing.css'])],
  build: {
    outDir: 'dist/app',
    emptyOutDir: false,
    rollupOptions: { input: 'src/maker.ts', output: { format: 'iife', entryFileNames: 'maker.js' } }
  }
});
