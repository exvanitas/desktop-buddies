/* Peel's sheet at build time: a page's css is peel.css followed by its own, and the fonts go beside it.
   A vite plugin, imported by relative path from a config, because a config can't load TypeScript from
   a package. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function peelSheet(fileName: string, own: string[]): Plugin {
  return {
    name: 'peel-sheet',
    apply: 'build',
    writeBundle(options) {
      const out = options.dir!;
      const css = [path.join(HERE, 'peel.css'), ...own].map(f => fs.readFileSync(f, 'utf8')).join('\n');
      fs.writeFileSync(path.join(out, fileName), css);
      fs.cpSync(path.join(HERE, 'fonts'), path.join(out, 'fonts'), { recursive: true });
    }
  };
}
