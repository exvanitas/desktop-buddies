/* Export a standalone page: one .html file with the styles, the built player and every buddy
   baked in. No editor panel; right-click a buddy for a Shimeji-style menu (call another, chase
   cursor, dismiss, dismiss all). Add #transparent to the URL for a see-through background (OBS
   browser source, wallpaper apps). */
import css from '@buddies/view/view.css?inline';
import type { Buddy } from '@buddies/buddy-file';
import type { BuddyData, Chatter } from '@buddies/engine';
import playerScript from 'virtual:player';
import nunito from './fonts/nunito.woff2?inline';
import type { PackedBuddy, PackedPose } from './player';

interface MakerState { pets: (BuddyData & { kit?: unknown })[]; bubbles?: boolean; names?: boolean; chatter?: Chatter }

const PLAYER_CSS = `
html, body { background: linear-gradient(180deg, #c3cff0 0%, #e7dcf2 55%, #f6e6ea 100%); font-family: Nunito, system-ui, sans-serif; color: #3b3340; }
html.clear, html.clear body { background: transparent; }
#root { position: fixed; inset: 0; pointer-events: none; }
.bm { position: fixed; z-index: 20; min-width: 170px; padding: 5px; background: #fff; border-radius: 12px; box-shadow: 0 10px 30px rgba(60, 40, 90, .22); font-size: 13px; font-weight: 700; }
.bm b { display: block; padding: 6px 12px 4px; font-size: 11px; color: #8a8094; text-transform: uppercase; letter-spacing: .04em; }
.bm button { display: block; width: 100%; padding: 7px 12px; border: 0; border-radius: 8px; background: none; text-align: left; cursor: pointer; font: inherit; color: inherit; }
.bm button:hover, .bm button:focus-visible { background: #f1ecf6; outline: none; }
.bm hr { border: 0; border-top: 1px solid #eee8f2; margin: 4px 6px; }
.bm-back { position: fixed; right: 16px; bottom: 16px; padding: 9px 16px; border: 0; border-radius: 99px; background: #fff; box-shadow: 0 6px 20px rgba(60, 40, 90, .18); font: 700 13px Nunito, system-ui, sans-serif; color: #3b3340; cursor: pointer; }
.bm-hint { position: fixed; left: 50%; bottom: 16px; translate: -50% 0; padding: 7px 14px; border-radius: 99px; background: rgba(59, 51, 64, .7); color: #fff; font-size: 12px; font-weight: 700; pointer-events: none; transition: opacity .6s; }
.bm-hint.gone { opacity: 0; }
html.clear .bm-hint { display: none; }`;


/* WebP keeps transparency; browsers that can't encode it return PNG, so keep the original then */
async function webp(src: string) {
  try {
    const im = new Image(); im.src = src; await im.decode();
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    c.getContext('2d')!.drawImage(im, 0, 0);
    const w = c.toDataURL('image/webp', .9);
    return w.startsWith('data:image/webp') && w.length < src.length ? w : src;
  } catch (e) { return src; }
}
const safe = (s: string) => s.replace(/<\/(script|style)/gi, '<\\/$1');

export async function build(state: MakerState) {
  /* Images go into one shared table (repeats stored once) re-encoded as WebP, which is
     several times smaller than the editor's PNGs. The editor's prompt-kit text is left out. */
  const imgs: string[] = [], at = new Map<string, number>();
  const ref = async (src: string) => {
    if (!at.has(src)) { at.set(src, imgs.length); imgs.push(await webp(src)); }
    return at.get(src)!;
  };
  const pets: PackedBuddy[] = [];
  for (const { kit, ...p } of state.pets) {
    const poses: Record<string, PackedPose> = {};
    for (const [k, ps] of Object.entries((p as Buddy).poses || {})) {
      const frames = []; for (const f of ps.frames) frames.push(Object.assign({}, f, { src: await ref(f.src) }));
      poses[k] = Object.assign({}, ps, { frames });
    }
    pets.push({ ...p, base: Object.assign({}, p.base, { src: await ref(p.base.src) }), poses });
  }
  const data = JSON.stringify({ imgs, pets, bubbles: state.bubbles !== false, names: state.names !== false, chatter: state.chatter || 'normal' }).replace(/</g, '\\u003c');
  const title = pets.length === 1 ? (pets[0].name || 'Desktop Buddy') : 'Desktop Buddies';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[&<>"]/g, '')}</title>
<style>@font-face { font-family: Nunito; src: url(${nunito}) format('woff2'); font-weight: 200 1000; font-display: swap; }
${safe(css)}${PLAYER_CSS}</style>
</head>
<body>
<div id="root"></div>
<div class="bm-hint">Right-click a buddy for options</div>
<script>${safe(playerScript)}</script>
<script>BuddyPlayer.start(${data});</script>
</body>
</html>`;
}

export async function download(state: MakerState, toast: (m: string) => void) {
  if (!state.pets.length) return toast('Add a buddy first');
  let html;
  try { html = await build(state); } catch (e) { return toast("Couldn't build the page (open the maker from a web server, not a file)"); }
  const name = state.pets.length === 1 ? (state.pets[0].name || 'buddy').replace(/[^\w\- ]+/g, '') : 'desktop-buddies';
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' })); a.download = name + '.html';
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Exported ${state.pets.length === 1 ? '1 buddy' : state.pets.length + ' buddies'} · right-click them there to dismiss`);
}

