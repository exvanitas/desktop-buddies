import { fileURLToPath } from 'node:url';
import { build, defineConfig, type Plugin } from 'vite';

const entry = fileURLToPath(new URL('./src/player.ts', import.meta.url));

/* The exported page's script, built once as a single classic bundle, for export.ts to embed. */
function playerBundle(): Plugin {
  const id = 'virtual:player';
  return {
    name: 'buddies-player',
    resolveId: source => (source === id ? '\0' + id : null),
    async load(source) {
      if (source !== '\0' + id) return null;
      const out = await build({
        configFile: false, logLevel: 'warn',
        build: { write: false, lib: { entry, formats: ['iife'], name: 'BuddyPlayer', fileName: () => 'player.js' } }
      });
      const [result] = Array.isArray(out) ? out : [out];
      if (!result || !('output' in result)) throw new Error('the player did not build');
      return `export default ${JSON.stringify(result.output[0].code)};`;
    }
  };
}

/* Plain deferred scripts, so the built maker also opens straight from a file. */
function classicScripts(): Plugin {
  return {
    name: 'buddies-classic-scripts',
    enforce: 'post',
    transformIndexHtml: html => html.replace(/<script type="module" crossorigin/g, '<script defer').replace(/ crossorigin(?= href=)/g, '').replace(/(<link rel="stylesheet") crossorigin/g, '$1')
  };
}

export default defineConfig({
  base: './',
  plugins: [playerBundle(), classicScripts()],
  build: {
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: { output: { format: 'iife' } }
  }
});
