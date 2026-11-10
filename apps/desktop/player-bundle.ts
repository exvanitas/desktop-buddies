import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';

const entry = fileURLToPath(new URL('../maker/src/player.ts', import.meta.url));

/* The standalone page's script, built once as a single classic bundle, for export.ts to embed. The
   same as apps/maker's: both Makers export the same page. */
export function playerBundle(): Plugin {
  const id = 'virtual:player';
  return {
    name: 'buddies-player',
    resolveId: source => (source === id ? '\0' + id : null),
    async load(source) {
      if (source !== '\0' + id) return null;
      const out = await build({
        configFile: false, logLevel: 'warn', publicDir: false,
        build: { write: false, lib: { entry, formats: ['iife'], name: 'BuddyPlayer', fileName: () => 'player.js' } }
      });
      const [result] = Array.isArray(out) ? out : [out];
      if (!result || !('output' in result)) throw new Error('the player did not build');
      return `export default ${JSON.stringify(result.output[0].code)};`;
    }
  };
}
