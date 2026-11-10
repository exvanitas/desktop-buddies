/* Renders the Maker's states headless, and measures what the eye misses: anything run off the window,
   clipped words, and text too faint to read. Shared by run.mjs and a look at one state.
     node packages/maker-view/tests/browser/render.mjs [--shots=dir] [--only=word] [--size=1180x680] [--theme=dark] */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MEASURE, startHarness } from './harness.mjs';

export const SIZES = [[1180, 680, 1], [960, 600, 1], [1180, 680, 1.5]], THEMES = ['dark', 'light'];

const pick = (page, sel) => page.locator(sel).first().click();
const sheet = n => async r => { await pick(r.page, `.spine [data-s="${n}"]`); };
export const STATES = {
  everything: { fixture: 'olive' },
  'everything-full': { fixture: 'full' },
  'everything-one': { fixture: 'one' },
  'sheet-picked-up': { fixture: 'olive', act: sheet(2) },
  'sheet-feelings-line': { fixture: 'olive', async act(r) { await sheet(4)(r); await pick(r.page, '.say[data-sit="hello"]'); } },
  'sheet-one-image': { fixture: 'one', act: sheet(1) },
  'sheet-fun-one-image': { fixture: 'one', act: sheet(8) },
  'sheet-meeting': { fixture: 'olive', act: sheet(9) },
  'sheet-full': { fixture: 'full', act: sheet(1) },
  'tall-art': { fixture: 'tall', act: sheet(3) },
  'wide-art': { fixture: 'wide', act: sheet(1) },
  'pixel-art': { fixture: 'pixel', act: sheet(1) },
  'all-words': { fixture: 'olive', act: sheet('words') },
  'all-words-long': { fixture: 'wordy', act: sheet('words') },
  'long-line-writer': { fixture: 'wordy', async act(r) { await sheet(1)(r); await pick(r.page, '.say[data-sit="chat"]'); } },
  'artist-lines-feelings': { fixture: 'artist', async act(r) { await sheet(4)(r); await pick(r.page, '.say[data-sit="hello"]'); } },
  'artist-lines-chat': { fixture: 'artist', async act(r) { await sheet(1)(r); await pick(r.page, '.say[data-sit="chat"]'); } },
  'many-frames': { fixture: 'many', async act(r) { await sheet(1)(r); await pick(r.page, '.nm[data-art="walk"]'); } },
  empty: { fixture: 'empty' },
  'empty-web': { fixture: 'empty', window: false, tryOnScreen: false, exportPage: false, onToast: false },
  names: { fixture: 'names' },
  'names-menu': { fixture: 'names', async act(r) { await pick(r.page, '[data-who]'); } },
  'names-sheet': { fixture: 'names', act: sheet(1) },
  kit: { fixture: 'olive', act: sheet('kit') },
  'kit-text-mode': { fixture: 'olive', async act(r) { await sheet('kit')(r); await pick(r.page, '[data-mode="text"]'); } },
  'kit-empty': { fixture: 'one', act: sheet('kit') },
  'kit-prompt-picked': { fixture: 'olive', async act(r) {
    await sheet('kit')(r);
    await r.page.locator('[data-kit="appearance"]').fill('Small round moss creature, green fur, leaf on head');
    await pick(r.page, '.pr[data-file="walk_1"] .pr-pick');
  } },
  look: { fixture: 'olive', act: sheet('look') },
  'look-one': { fixture: 'one', act: sheet('look') },
  'look-web': { fixture: 'olive', window: false, tryOnScreen: false, exportPage: false, onToast: false, world: true, act: sheet('look') },
  'save-failed': { fixture: 'olive', async act(r) { await r.page.evaluate(() => H.save({ kind: 'failed', title: "Olive didn't save", why: 'The disk is full.', fix: 'Free some space, then try again.', labels: ['Try again'] })); } },
  'save-failed-sheet': { fixture: 'olive', async act(r) { await sheet(4)(r); await r.page.evaluate(() => H.save({ kind: 'failed', title: "Olive didn't save", why: 'The library folder is locked by another program, and nothing you have changed since 9:14 is on disk.', fix: 'Close the other program, then try again. Your work stays in this window until then.', labels: ['Try again', 'Show the folder'] })); } },
  'all-actions': { fixture: 'olive', async act(r) { await pick(r.page, '[data-all]'); } },
  'clear-confirm': { fixture: 'olive', async act(r) { await sheet(1)(r); await pick(r.page, '[data-clear]'); } }
};

export async function shootAll(h, { shots, only, size, theme, onShot } = {}) {
  for (const [name, s] of Object.entries(STATES)) {
    if (only && !name.includes(only)) continue;
    for (const [w, hgt, scale] of SIZES) {
      if (size && size !== `${w}x${hgt}`) continue;
      for (const t of THEMES) {
        if (theme && theme !== t) continue;
        const r = await h.open(s, { w, h: hgt, scale, theme: t });
        if (s.act) await s.act(r);
        await h.settled(r.page);
        const label = `${name} ${w}x${hgt}@${scale} ${t}`;
        if (shots) await r.page.screenshot({ path: `${shots}/${name}-${w}x${hgt}@${scale}-${t}.png` });
        const m = await r.page.evaluate(MEASURE);
        await onShot?.(label, m, r);
        await r.ctx.close();
      }
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flag = name => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);
  const shots = flag('shots');
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const h = await startHarness();
  let bad = 0;
  await shootAll(h, { shots, only: flag('only'), size: flag('size'), theme: flag('theme'), onShot(label, m, r) {
    const problems = [...m.off.map(x => 'off: ' + x), ...m.clipped.map(x => 'clipped: ' + x), ...m.faint.map(x => 'faint: ' + x), ...r.errors.map(x => 'error: ' + x)];
    if (problems.length) { bad++; console.log(label, '\n   ', problems.slice(0, 12).join('\n    ')); }
  } });
  await h.stop();
  console.log(bad ? `${bad} renders with problems` : 'all renders clean');
}
