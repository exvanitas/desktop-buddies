/* Draws the sample buddy that tests use and that a public build seeds a first run with:
   packages/test-support/fixtures/sample.json. She's the Maker's code-drawn Pip, put through the
   Maker's own pipeline, warmed in colour and given a small bob, so nothing in her is anyone's art.

     node packages/maker-view/tests/browser/make-sample.mjs

   Needs the Chromium the browser checks use. Run it again only to change her on purpose: tests
   count her poses, frames and lines. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHarness } from './harness.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const OUT = path.join(REPO, 'packages/test-support/fixtures/sample.json');

const NAME = 'Olive', CHARACTER = 'colive0seed';
const LINES = {
  hello: ['Hi!', 'Oh, hello!', 'Peep!', 'You called?', 'Here I am!', 'Hiya!'],
  chat: ['Peep peep!', 'Nice cursor!', 'Wanna play?', 'Look, look!', 'So fun!', 'Busy day?'],
  think: ['Seeds?', 'Hmm...', 'Clouds today?', 'Nap soon?', 'Where to...', 'Bored now.'],
  love: ['Hehe!', 'More pats!', 'So fluffy...', 'Love you!', '*happy flap*', 'Yay!'],
  shy: ['*hides*', 'Why stare?', 'Um...', "Don't look!", 'Eep!', 'Hehe...'],
  angry: ['Hey!', 'Stop it!', 'Peck!', 'No poking!', 'Hmph!', 'Too much!'],
  hurt: ['Oof!', 'Owie...', 'That hurt!', 'Ouch!', 'Dizzy...', 'Eep!'],
  eat: ['Nom!', 'Tasty!', 'Yum!', 'Seeds!', 'More!', 'Crumbs!'],
  dance: ['Dance!', 'Wiggle!', 'Flap flap!', 'Party!', 'Shake it!', 'Hop!'],
  bye: ['Bye bye!', 'See ya!', 'Off I go!', 'Later!', 'Peep!', 'Bye!']
};

/* Chromium's WebP carries an ICC profile chunk: a file with no metadata goes without it. */
function plain(url) {
  const b = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  if (b.toString('latin1', 12, 16) !== 'VP8X') return url;
  const parts = [];
  for (let i = 12; i + 8 <= b.length;) { const n = b.readUInt32LE(i + 4), end = i + 8 + n + (n & 1); if (b.toString('latin1', i, i + 4) !== 'ICCP') parts.push(b.subarray(i, end)); i = end; }
  const body = Buffer.concat(parts);
  body[8] &= ~0x20; /* VP8X: no ICC profile */
  const head = Buffer.from('RIFF....WEBP', 'latin1'); head.writeUInt32LE(body.length + 4, 4);
  return 'data:image/webp;base64,' + Buffer.concat([head, body]).toString('base64');
}
const clean = f => ({ ...f, src: plain(f.src) });

const h = await startHarness();
try {
  const r = await h.open({ fixture: 'one' });
  const drawn = await r.page.evaluate(async () => {
    /* Recoloured, and on a bob drawn a little smaller from the top, so her feet leave the floor.
       The box is measured again the way the Maker measures it: alpha over 24. */
    const warm = (f, bob = 1) => new Promise((done, fail) => {
      const im = new Image();
      im.onload = () => {
        const w = im.naturalWidth, h = im.naturalHeight, c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d'); x.filter = 'hue-rotate(-22deg) saturate(1.15)'; x.drawImage(im, w * (1 - bob) / 2, 0, w * bob, h * bob);
        let bb = f.bb;
        if (bob !== 1) {
          const d = x.getImageData(0, 0, w, h).data; let x0 = w, y0 = h, x1 = -1, y1 = -1;
          for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) if (d[(y * w + i) * 4 + 3] > 24) { x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
          bb = { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h };
        }
        done({ src: c.toDataURL('image/webp', 1), bb });
      };
      im.onerror = fail; im.src = f.src;
    });
    const p = await H.maker.addSample('pip');
    const poses = {};
    for (const [k, q] of Object.entries(p.poses)) poses[k] = { ...q, frames: await Promise.all(q.frames.map((f, i) => warm(f, k === 'stand' && i % 4 === 3 ? .96 : 1))) };
    return { size: p.size, faces: p.faces, ref: p.ref, base: await warm(p.base), poses };
  });
  if (r.errors.length) throw new Error(r.errors.join('\n'));
  await r.ctx.close();
  const poses = Object.fromEntries(Object.entries(drawn.poses).map(([k, q]) => [k, { ...q, frames: q.frames.map(clean) }]));
  const buddy = { name: NAME, size: drawn.size, faces: drawn.faces, ref: drawn.ref, lines: LINES, character: CHARACTER, base: clean(drawn.base), poses };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ app: 'desktop-buddies', version: 2, buddy }));
  console.log(`${path.relative(REPO, OUT)}: ${Object.keys(buddy.poses).length} poses, ${(fs.statSync(OUT).size / 1e3).toFixed(0)} kB`);
} finally { await h.stop(); }
