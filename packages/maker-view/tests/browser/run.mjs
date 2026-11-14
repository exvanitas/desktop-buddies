/* The Maker's view in a real headless browser: the real view on the real createMaker, with memoryStore, a
   fake host and real art. Every function of apps/maker/src/panel.js is on the checklist below, done for
   real, and every state is rendered and measured at every size.
     pnpm test:maker-view [--shots=dir] [--only=word] [--no-shots]
   Needs a Chromium that's already installed: set CHROME_PATH, or it looks in Playwright's cache. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHarness, TAILS, WRAPS } from './harness.mjs';
import { shootAll, SIZES, THEMES } from './render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '../../../..');
const ART = path.join(REPO, 'packages/test-support/art');
const flag = name => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);
const ONLY = flag('only'), SHOTS = flag('shots'), NO_SHOTS = process.argv.includes('--no-shots');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const ok = (name, good, detail) => { results.push([!!good, name]); console.log(`${good ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); };
const h = await startHarness();
const group = async (name, f) => {
  if (ONLY && !name.includes(ONLY)) return;
  try { await f(); }
  catch (e) { ok(`${name} ran to its end`, false, String(e.message).split('\n')[0]); }
};
const clean = async (r, what) => { ok(`${what}: no errors or outside requests`, !r.errors.length, r.errors.slice(0, 3).join(' | ') || undefined); await r.ctx.close(); };

const art = f => path.join(ART, f);
const SAMPLE_FILE = () => ({ name: 'olive.buddy', mimeType: 'application/octet-stream', buffer: fs.readFileSync(path.join(REPO, 'packages/test-support/fixtures/sample.json')) });
/* real images, under the names a person gives them */
const png = (name, from = 'pudding/main.webp') => ({ name, mimeType: 'image/png', buffer: fs.readFileSync(art(from)) });
const pet = page => page.evaluate(() => { const p = H.pet(); return { name: p.name, size: p.size, faces: p.faces, base: p.base.src.slice(0, 40) + p.base.src.length, poses: Object.fromEntries(Object.entries(p.poses).map(([k, v]) => [k, { frames: v.frames.length, fps: v.fps, scale: v.scale }])), lines: p.lines, kit: p.kit }; });
const count = page => page.evaluate(() => H.maker.state.pets.length);
const idle = page => page.waitForFunction(() => document.querySelector('[data-working]').hidden);
const sheet = (page, n) => page.locator(`.spine [data-s="${n}"]`).click();
const title = page => page.locator('.tray h3').textContent();
const copied = page => page.evaluate(() => navigator.clipboard.readText());
const dropFiles = (page, files, over = 'body') => page.evaluate(async ({ files, over }) => {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), c => c.charCodeAt(0))], f.name, { type: f.type }));
  document.querySelector(over).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
}, { files: files.map(f => ({ name: f.name, type: f.mimeType, b64: f.buffer.toString('base64') })), over });
const pasteImage = (page, f) => page.evaluate(async f => {
  const dt = new DataTransfer();
  dt.items.add(new File([Uint8Array.from(atob(f.b64), c => c.charCodeAt(0))], f.name, { type: f.type }));
  document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, { name: f.name, type: f.mimeType, b64: f.buffer.toString('base64') });

/* ---------- the page ---------- */
await group('page', async () => {
  const r = await h.open({ fixture: 'olive' });
  const f = await r.page.evaluate(async () => { await document.fonts.ready; return { lexend: document.fonts.check('13px Lexend'), puff: document.fonts.check('600 17px DynaPuff'), faces: [...document.fonts].map(x => x.family + ':' + x.status), name: getComputedStyle(document.querySelector('.who h1')).fontFamily.split(',')[0], body: getComputedStyle(document.body).fontFamily.split(',')[0] }; });
  ok('both fonts load from the page\'s own folder', f.lexend && f.puff && f.faces.every(x => /loaded/.test(x)) && f.name === 'DynaPuff' && f.body === 'Lexend', f);
  const csp = await r.page.evaluate(() => document.querySelector('meta[http-equiv]').content);
  ok('it runs under a CSP with no unsafe-inline', !/unsafe/.test(csp) && /style-src 'self'/.test(csp), csp);
  ok('no style attribute is written through HTML', await r.page.evaluate(() => !document.querySelector('[style*="url("]')));
  const wc = await r.page.evaluate(() => { const b = document.querySelector('.bar'); return { drag: b.hasAttribute('data-tauri-drag-region') && b.querySelector('.grow').hasAttribute('data-tauri-drag-region'), l: [...document.querySelectorAll('.wc button')].map(x => x.getAttribute('aria-label')).join() }; });
  ok('a title bar with drag regions, minimize and close', wc.drag && wc.l === 'Minimize,Close', wc);
  await r.page.getByRole('button', { name: 'Minimize' }).click();
  await r.page.getByRole('button', { name: 'Close', exact: true }).click();
  ok('minimize and close reach the host', JSON.stringify(await r.page.evaluate(() => H.calls.map(c => c.what))) === '["minimize","close"]');
  ok('nothing left this page', r.outside.length === 0, r.outside);
  await clean(r, 'page');
});

/* ---------- panel.js, item by item ---------- */
await group('checklist', async () => {
  { const r = await h.open({ fixture: 'empty' });
    ok('panel.js add from image: no buddy exists until it has one', await count(r.page) === 0);
    await r.page.setInputFiles('input[data-pick=buddies]', [png('fern.png')]);
    await r.page.waitForSelector('.board');
    ok('panel.js add from image: the picker makes a buddy with real art', await count(r.page) === 1 && (await pet(r.page)).name === 'fern');
    ok('panel.js add from image: it opens on Everything', (await r.page.locator('.board h2').textContent()) === 'Everything');
    await clean(r, 'add from image'); }
  { const r = await h.open({ fixture: 'empty' });
    await dropFiles(r.page, [png('moss.png')]);
    await r.page.waitForSelector('.board');
    ok('panel.js add by drop: an image dropped on the first step makes a buddy', (await pet(r.page)).name === 'moss');
    await clean(r, 'add by drop'); }
  { const r = await h.open({ fixture: 'empty' });
    await pasteImage(r.page, png('clip.png'));
    await r.page.waitForSelector('.board');
    ok('panel.js add by paste: an image pasted with no buddy makes one', await count(r.page) === 1);
    await clean(r, 'add by paste'); }
  for (const kind of ['pip']) {
    const r = await h.open({ fixture: 'empty' });
    await r.page.locator(`.first-more [data-sample="${kind}"]`).click();
    await r.page.waitForSelector('.board');
    const p = await pet(r.page);
    ok(`panel.js sample: ${kind} starts a buddy from its real drawing`, await count(r.page) === 1 && new RegExp(kind, 'i').test(p.name), p.name);
    if (kind === 'pip') ok('panel.js sample: Pip comes with her full pose set', Object.keys(p.poses).length > 15, Object.keys(p.poses).length);
    await clean(r, `sample ${kind}`);
  }
  { const r = await h.open({ fixture: 'olive' });
    await r.page.locator('[data-who]').click();
    await r.page.locator('.buddies [data-sample="pip"]').click();
    await r.page.waitForFunction(() => H.maker.state.pets.length === 2);
    ok('panel.js sample: also from the buddies menu, with a buddy open', true);
    await r.page.locator('[data-who]').click();
    await r.page.locator('.in-window .pick').first().click();
    ok('panel.js select: another buddy in this window opens', (await r.page.locator('.who h1').textContent()) === 'Olive');
    await clean(r, 'select'); }
  { const r = await h.open({ fixture: 'empty' });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shime-')), inner = path.join(dir, 'Mochi', 'img');
    fs.mkdirSync(inner, { recursive: true });
    ['pip/stand_1.webp', 'pip/walk_1.webp', 'pip/run_1.webp', 'pip/sit_1.webp'].forEach((f, i) => fs.copyFileSync(art(f), path.join(inner, `shime${i + 1}.png`)));
    /* Every image in its img folder, picked as files: no folder to name her after. */
    await r.page.setInputFiles('input[data-pick=shimeji]', fs.readdirSync(inner).map(n => path.join(inner, n)));
    await r.page.waitForSelector('.board');
    const p = await pet(r.page);
    ok('panel.js import Shimeji images: called Shimeji, with poses', p.name === 'Shimeji' && Object.keys(p.poses).length > 0, p.name);
    fs.rmSync(dir, { recursive: true, force: true });
    await clean(r, 'import Shimeji'); }
  { const r = await h.open({ fixture: 'empty' });
    await r.page.setInputFiles('input[data-pick=buddyFile]', [SAMPLE_FILE()]);
    await r.page.waitForSelector('.board');
    const p = await pet(r.page);
    ok('panel.js import buddy file: Olive comes in whole', p.name === 'Olive' && p.poses.stand.frames === 16 && !!p.lines, p.name);
    await r.page.setInputFiles('input[data-pick=buddyFile]', [{ name: 'broken.buddy', mimeType: 'application/octet-stream', buffer: Buffer.from('{"app":"nope"}') }]);
    await r.page.waitForSelector('.toast:not([hidden])');
    ok('panel.js import buddy file: a bad file says so and adds nothing', await count(r.page) === 1, await r.page.locator('.toast').textContent());
    await clean(r, 'import buddy file'); }
  { const r = await h.open({ fixture: 'olive' });
    const before = (await pet(r.page)).base;
    await sheet(r.page, 'look');
    await r.page.evaluate(() => { H.startWalk = H.pet().poses.walk.frames[0].src; });
    await r.page.setInputFiles('input[data-pick=main]', [png('new.png')]);
    await r.page.waitForFunction(b => H.pet().base.src.slice(0, 40) + H.pet().base.src.length !== b, before);
    ok('panel.js change main image: the picker changes it', true);
    const src = await r.page.locator('.who .art img').getAttribute('src');
    ok('panel.js change main image: the bar shows the new one', src === await r.page.evaluate(() => H.pet().base.src));
    const b2 = (await pet(r.page)).base;
    await pasteImage(r.page, png('pasted.png', 'derived/loaf.webp'));
    await r.page.waitForFunction(b => H.pet().base.src.slice(0, 40) + H.pet().base.src.length !== b, b2);
    ok('panel.js paste: on Look, a pasted image is the main image', true);
    const b3 = (await pet(r.page)).base;
    await dropFiles(r.page, [png('walk_1.png', 'pip/walk_1.webp')], '.bar');
    await r.page.waitForFunction(() => H.pet().poses.walk.frames[0].src !== H.startWalk);
    ok('a drop on Look away from the main image goes by its name', (await pet(r.page)).base === b3);
    await dropFiles(r.page, [png('dropped.png', 'derived/tower.webp')], '.stage');
    await r.page.waitForFunction(b => H.pet().base.src.slice(0, 40) + H.pet().base.src.length !== b, b3);
    ok('panel.js drop: on Look, an image dropped on the main image replaces it', true);
    await clean(r, 'main image'); }
  { const r = await h.open({ fixture: 'olive' });
    await sheet(r.page, 'look');
    await r.page.locator('[data-name]').fill('Ёжик');
    ok('panel.js name: typing changes it, and the bar with it', (await pet(r.page)).name === 'Ёжик' && (await r.page.locator('.who h1').textContent()) === 'Ёжик');
    await r.page.locator('[data-faces="left"]').click();
    ok('panel.js faces: left', (await pet(r.page)).faces === 'left');
    await r.page.locator('[data-faces="right"]').click();
    ok('panel.js faces: right', (await pet(r.page)).faces === 'right');
    await r.page.locator('[data-size]').fill('200');
    ok('panel.js size: the slider changes it', (await pet(r.page)).size === 200);
    const w = await r.page.locator('.look-art .stage .art').evaluate(e => e.getBoundingClientRect().height);
    const want = await r.page.evaluate(() => { const b = H.pet().base.bb; return (b.y1 - b.y0) * 200; });
    ok('panel.js size: Look draws it at its real size', Math.abs(w - want) < 1, { w, want });
    await r.page.locator('[data-lift="floor"]').fill('20');
    const floored = () => r.page.evaluate(() => { const a = document.querySelector('.look-art .stage .art'), f = document.querySelector('.look-art .stage .floor'), i = a.querySelector('img'); return { art: a.getBoundingClientRect().bottom, floor: f.getBoundingClientRect().top, side: i.getBoundingClientRect().width, lift: H.pet().lift?.floor, below: document.querySelector('.look-art .stage').getBoundingClientRect().bottom }; });
    const up = await floored();
    ok('lift: Look sets her own lift as a share of her size', up.lift === .1, up);
    ok('lift: Look draws the floor that far under the main image, inside the stage', Math.abs(up.floor - up.art - .1 * up.side) < 1 && up.below > up.floor, up);
    await r.page.locator('[data-lift="floor"]').fill('-20');
    const down = await floored();
    ok('lift: below 0 the floor runs through her', Math.abs(down.art - down.floor - .1 * down.side) < 1, down);
    const sunk = await r.page.evaluate(() => getComputedStyle(document.querySelector('.tray .live .art')).translate);
    ok('lift: the tray preview sinks her by it too', /^0px [0-9.]+px$/.test(sunk), sunk);
    await r.page.locator('[data-lift="floor"]').fill('0');
    /* a wall beside her and a ceiling above her, each moved by its own lift alone */
    const sides = () => r.page.evaluate(() => {
      const at = k => { const s = document.querySelector(`.look-art .side[data-s="${k}"]`), line = s.querySelector(`.${k}`).getBoundingClientRect(), a = s.querySelector('.art'), b = a.getBoundingClientRect(), t = getComputedStyle(a).translate.split(' ').map(parseFloat); return { gap: k === 'wall' ? b.left - line.left : b.top - line.top, move: k === 'wall' ? t[0] || 0 : t[1] || 0, across: k === 'wall' ? t[1] || 0 : t[0] || 0 }; };
      return { wall: at('wall'), ceiling: at('ceiling') };
    });
    const flat = await sides();
    ok('lift: at 0 she touches the wall and the ceiling', Math.abs(flat.wall.gap) < 1 && Math.abs(flat.ceiling.gap) < 1, flat);
    await r.page.locator('[data-lift="wall"]').fill('30');
    const out = await sides();
    ok('lift: Out from walls moves her out from the wall line, on x only, and leaves the ceiling', out.wall.move > 0 && Math.abs(out.wall.gap - out.wall.move) < 1 && out.wall.across === 0 && out.ceiling.move === 0, out);
    await r.page.locator('[data-lift="ceiling"]').fill('30');
    const hung = await sides();
    ok('lift: Down from ceilings moves her down from the ceiling line, on y only', hung.ceiling.move > 0 && Math.abs(hung.ceiling.gap - hung.ceiling.move) < 1 && hung.ceiling.across === 0, hung);
    for (const k of ['wall', 'ceiling']) await r.page.locator(`[data-lift="${k}"]`).fill('0');
    /* art from a file, measured here from its pixels */
    await r.page.waitForSelector('[data-k="Lift"]');
    const filed = await r.page.evaluate(() => H.pet().poses.stand.frames.map(f => f.bb.y1));
    ok('lift: art from a file reads 0 px, measured from its pixels', (await r.page.locator('.knobs .rng output').nth(2).textContent()) === '0 px' && new Set(filed).size > 1, filed);
    await r.page.locator('[data-k="Lift"]').fill('-8');
    const was = await r.page.evaluate(() => ({ y: H.pet().poses.stand.frames.map(f => f.bb.y1), S: H.pet().size * (H.pet().poses.stand.scale || 1) }));
    ok('lift: each frame from where its own art ends', was.y.every((y, i) => Math.abs(filed[i] - 8 / was.S - y) < 1e-9), { filed, was });
    await r.page.evaluate(() => { H.pet().poses.walk.scale = 3.3; });
    await r.page.locator('.spine [data-match]').click();
    await idle(r.page);
    const scale = await r.page.evaluate(() => H.pet().poses.walk.scale);
    ok('panel.js match art: every pose is rescaled by real measuring', scale !== 3.3 && scale > .3 && scale < 3, scale);
    await clean(r, 'look'); }
  { const r = await h.open({ fixture: 'one' });
    await r.page.locator('.spine [data-s="1"]').click();
    await r.page.locator('.nm[data-art="walk"]').click();
    await r.page.setInputFiles('input[data-pick=frames]', [png('b.png', 'test/hop.webp'), png('a.png', 'pip/stand_1.webp')]);
    await r.page.waitForSelector('.fs-roll');
    ok('panel.js frames add: land on the picked pose, with real processing', (await pet(r.page)).poses.walk.frames === 2);
    ok('panel.js frames add: the sticker says so', /2 frames/.test(await r.page.locator('.c[data-keys~="walk"] small').textContent()));
    await r.page.locator('.nm[data-art="stand"]').click();
    await dropFiles(r.page, [png('x.png', 'pip/sit_1.webp')], '.tray');
    await r.page.waitForSelector('.fs-roll');
    ok('panel.js frames add: dropped on the tray, they\'re for what\'s in it', (await pet(r.page)).poses.stand.frames === 1);
    await r.page.locator('.nm[data-art="walk"]').click();
    const order = () => r.page.evaluate(() => H.pet().poses.walk.frames.map(f => f.src.length).join());
    const o0 = await order();
    await r.page.getByRole('button', { name: 'Move later' }).click();
    const o1 = await order();
    ok('panel.js frames order: later', o1 === o0.split(',').reverse().join());
    await r.page.getByRole('button', { name: 'Move earlier' }).click();
    ok('panel.js frames order: earlier', await order() === o0);
    await r.page.locator('[data-k="Speed"]').fill('12');
    ok('panel.js frames speed: the slider changes it', (await pet(r.page)).poses.walk.fps === 12);
    await r.page.locator('[data-k="Scale"]').fill('150');
    ok('panel.js frames scale: the slider changes it', (await pet(r.page)).poses.walk.scale === 1.5);
    const s = await r.page.locator('.c[data-keys~="walk"] .art img').evaluate(e => e.style.width);
    await r.page.locator('[data-k="Scale"]').fill('60');
    ok('panel.js frames scale: the sticker follows without a redraw', s !== await r.page.locator('.c[data-keys~="walk"] .art img').evaluate(e => e.style.width));
    await r.page.waitForSelector('[data-k="Lift"]');
    ok('lift: freshly cut art stands on the floor, at 0 px', (await r.page.locator('.knobs .rng output').nth(2).textContent()) === '0 px');
    const placed = () => r.page.evaluate(() => { const live = document.querySelector('.tray .live'), f = live.querySelector('.floor').getBoundingClientRect(), a = live.querySelector('.art').getBoundingClientRect(), i = live.querySelector('.art img').getBoundingClientRect(); return { floor: f.bottom, box: a.bottom, img: i.top, side: i.width, size: H.pet().size, scale: H.pet().poses.walk.scale }; });
    const at0 = await placed(), cut = await r.page.evaluate(() => H.pet().poses.walk.frames.map(f => f.bb.y1));
    ok('lift: the preview stands her on its floor line', Math.abs(at0.box - at0.floor) < .6, at0);
    await r.page.locator('[data-k="Lift"]').fill('-8');
    const at8 = await placed(), sank = at8.img - at0.img, want8 = 8 * at8.side / (at8.size * at8.scale);
    ok('lift: -8 px sinks her art into the floor by 8 px at the preview\'s size', Math.abs(at8.box - at8.floor) < .6 && Math.abs(sank - want8) < 1, { sank, want8 });
    const lifted = await r.page.evaluate(() => H.pet().poses.walk.frames.map(f => f.bb.y1)), step = 8 / (at8.size * at8.scale);
    ok('lift: and the file holds it, each frame from where its own art ends', cut.length === 2 && cut[0] !== cut[1] && lifted.every((y, i) => Math.abs(cut[i] - step - y) < 1e-9), { cut, lifted, step });
    await r.page.getByRole('button', { name: 'Remove frame' }).click();
    ok('panel.js frames remove: one comes off', (await pet(r.page)).poses.walk.frames === 1);
    await r.page.locator('[data-clear]').click();
    await r.page.locator('.confirm .bad').click();
    ok('panel.js frames clear: after asking, the pose is empty', !(await pet(r.page)).poses.walk);
    await clean(r, 'frames'); }
  { const r = await h.open({ fixture: 'full' });
    const offered = await r.page.evaluate(() => { document.querySelector('[data-all]').click(); return [...document.querySelectorAll('.allact button')].map(b => [b.dataset.t, b.textContent]); });
    ok('panel.js Try: all 21 actions are on offer to a full buddy', offered.length === 21, offered.length);
    for (const [a, words] of offered) {
      if (!await r.page.locator('.allact').count()) await r.page.locator('[data-all]').click();
      await r.page.locator(`.allact [data-t="${a}"]`).click();
      const got = await r.page.evaluate(() => { const last = H.acts.at(-1); return { act: last[1], who: last[0] === H.pet().id, on: !!document.querySelector('.live .art img') }; });
      ok(`panel.js Try ${words}: reaches the world and shows in the tray`, got.act === a && got.who && got.on, got);
    }
    await r.page.locator('[data-screen]').click();
    const c = await r.page.evaluate(() => H.calls.at(-1));
    ok('Try on my screen: sends the real buddy out with that action', c.what === 'tryOnScreen' && c.action === offered.at(-1)[0], c);
    await clean(r, 'try'); }
  { const r = await h.open({ fixture: 'one' });
    await r.page.locator('[data-all]').click();
    const words = await r.page.locator('.allact button').allTextContents();
    ok('panel.js Try: a buddy with no art for it isn\'t offered it', !words.includes('Dance') && !words.includes('Snack') && words.includes('Wave'), words.length);
    await clean(r, 'try offered'); }
  { const r = await h.open({ fixture: 'olive' });
    await sheet(r.page, 4);
    await r.page.locator('.say[data-sit="hello"][data-i="1"]').click();
    await r.page.locator('.tray .field').fill('Good evening');
    ok('panel.js lines: a line changes as it\'s typed', (await pet(r.page)).lines.hello[1] === 'Good evening');
    ok('panel.js lines: everywhere it shows', (await r.page.locator('.says .say[data-sit="hello"][data-i="1"]').textContent()) === 'Good evening' && (await r.page.locator('.pv').textContent()) === 'Good evening');
    await r.page.locator('[data-add-line]').click();
    await r.page.keyboard.type('One more');
    ok('panel.js lines: a line can be added, and the writer has the keyboard', (await pet(r.page)).lines.hello.at(-1) === 'One more');
    await r.page.locator('[data-rm]').click();
    ok('panel.js lines: a line can be removed', (await pet(r.page)).lines.hello.at(-1) !== 'One more');
    await r.page.locator('[data-restore]').click();
    ok('panel.js lines and defaults: going back to the defaults asks first', !!(await pet(r.page)).lines.hello && await r.page.locator('.confirm').count() === 1);
    await r.page.locator('.confirm .bad').click();
    ok('panel.js lines and defaults: one situation goes back to the defaults', !(await pet(r.page)).lines.hello);
    await r.page.locator('.say[data-sit="love"][data-i="0"]').click();
    await r.page.locator('[data-say]').click();
    ok('Say it: shows in the tray', await r.page.locator('.live > .say.said').count() === 1);
    await clean(r, 'lines'); }
  { const r = await h.open({ fixture: 'one' });
    await sheet(r.page, 'kit');
    await r.page.locator('[data-kit="personality"]').fill('A sleepy forest spirit');
    await r.page.locator('[data-kit="appearance"]').fill('Small round moss creature');
    let k = (await pet(r.page)).kit;
    ok('panel.js kit: personality and appearance', k.personality === 'A sleepy forest spirit' && k.appearance === 'Small round moss creature');
    await r.page.locator('[data-kit="quality"]').fill('best quality');
    await r.page.locator('[data-kit="style"]').fill('chibi');
    k = (await pet(r.page)).kit;
    ok('panel.js kit: quality tags and always add', k.quality === 'best quality' && k.styleTags === 'chibi');
    await r.page.getByRole('button', { name: 'Copy dialogue prompt' }).click();
    await r.page.waitForSelector('.toast:not([hidden])');
    const dp = await copied(r.page);
    ok('panel.js kit: dialogue prompt copies to the real clipboard', /A sleepy forest spirit/.test(dp) && /JSON/.test(dp), dp.length);
    await r.page.locator('[data-k="edit-lines"]').click();
    ok('panel.js kit: Edit current lines fills the box', /"hello"/.test(await r.page.locator('[data-reply]').inputValue()));
    await r.page.locator('[data-reply]').fill('Here you go:\n```json\n{"hello": ["Howdy", "Hi hi"], "appearance": "ignored"}\n```');
    await r.page.locator('[data-apply]').click();
    const p = await pet(r.page);
    ok('panel.js kit: paste reply applies', p.lines.hello[0] === 'Howdy' && p.lines.hello.length === 2);
    ok('panel.js kit: and the box empties', (await r.page.locator('[data-reply]').inputValue()) === '');
    ok('panel.js kit: the status says whose lines', /own lines for 1 of 33/.test(await r.page.locator('[data-stat]').textContent()));
    await r.page.locator('[data-reply]').fill('not json at all');
    await r.page.locator('[data-apply]').click();
    ok('panel.js kit: a bad reply stays to be fixed', (await r.page.locator('[data-reply]').inputValue()) === 'not json at all');
    await r.page.locator('[data-reset]').click();
    await r.page.locator('.confirm .bad').click();
    ok('panel.js kit: Use default lines, after asking', !(await pet(r.page)).lines);
    ok('panel.js kit: 11 essentials first', await r.page.locator('.pr').count() === 11);
    await r.page.locator('[data-copy="walk_1"]').click();
    await r.page.waitForFunction(() => document.querySelector('.toast').textContent.includes('walk_1'));
    ok('panel.js kit: one image prompt copies', /moss creature/.test(await copied(r.page)) && /walking/.test(await copied(r.page)));
    await r.page.locator('.pr[data-file="walk_1"] .pr-pick').click();
    const full = await r.page.locator('[data-prompt-text]').inputValue();
    ok('panel.js kit: the full prompt opens, in the tray', /walking/.test(full) && full.length > 80, full.length);
    await r.page.locator('[data-more]').click();
    ok('panel.js kit: all 31 show', await r.page.locator('.pr').count() === 31);
    await r.page.locator('[data-copy-all]').click();
    await r.page.waitForFunction(() => document.querySelector('.toast').textContent.includes('31'));
    const sheetText = await copied(r.page);
    ok('panel.js kit: all of them copy as one', (sheetText.match(/^### /gm) || []).length === 32, (sheetText.match(/^### /gm) || []).length);
    await r.page.locator('[data-more]').click();
    ok('panel.js kit: essentials come back', await r.page.locator('.pr').count() === 11);
    await r.page.locator('[data-negative]').click();
    await r.page.waitForFunction(() => document.querySelector('.toast').textContent.includes('negative'));
    ok('panel.js kit: negative prompt copies, in tags mode', (await copied(r.page)).length > 20);
    await r.page.locator('[data-mode="text"]').click();
    ok('panel.js kit: text mode hides quality tags and the negative', await r.page.locator('[data-kit="quality"]').count() === 0 && await r.page.locator('[data-negative]').count() === 0);
    ok('panel.js kit: text mode has its own always add', /mascot/i.test(await r.page.locator('[data-kit="style"]').inputValue()));
    await r.page.locator('[data-mode="tags"]').click();
    ok('panel.js kit: and tags mode comes back', await r.page.locator('[data-kit="quality"]').count() === 1);
    await r.page.setInputFiles('input[data-pick=generated]', [png('main.png', 'sprout/main.webp'), png('walk_1.png', 'pip/walk_1.webp'), png('walk_2.png', 'pip/run_1.webp'), png('cat.png')]);
    await r.page.waitForFunction(() => !!H.pet().poses.walk);
    const g = await pet(r.page);
    ok('panel.js kit: upload generated finds poses by file name', g.poses.walk.frames === 2);
    await r.page.waitForFunction(() => /skipped 1/.test(document.querySelector('.toast').textContent));
    ok('panel.js kit: and says what it skipped', true);
    ok('Prompt kit: the row now shows its art', await r.page.locator('.pr[data-file="walk_1"] .art img').count() === 1);
    await dropFiles(r.page, [png('sit.png', 'pip/sit_1.webp')]);
    await r.page.waitForFunction(() => !!H.pet().poses.sit);
    ok('panel.js kit: dropping generated images works too', true);
    await clean(r, 'kit'); }
  { const r = await h.open({ fixture: 'olive' });
    await r.page.locator('[data-save-file]').click();
    await r.page.locator('[data-export]').click();
    const got = await r.page.evaluate(() => ({ calls: H.calls, pages: H.pages.count, id: H.pet().id }));
    ok('panel.js save buddy file: the host gets the buddy\'s id', got.calls[0].what === 'saveBuddyFile' && got.calls[0].id === got.id, got.calls[0]);
    ok('panel.js export page: reaches the host', got.calls[1].what === 'exportPage' && got.pages === 1, got.pages);
    await clean(r, 'save and export'); }
  { const r = await h.open({ fixture: 'olive', window: false, tryOnScreen: false, exportPage: false, onToast: false, world: true });
    await sheet(r.page, 'look');
    await r.page.getByRole('switch', { name: 'Speech bubbles' }).click();
    ok('panel.js bubbles: a web page can offer them', await r.page.evaluate(() => H.maker.state.bubbles === false));
    await r.page.getByRole('switch', { name: 'Name tags' }).click();
    ok('panel.js names: a web page can offer them', await r.page.evaluate(() => H.maker.state.names === false));
    await r.page.locator('[data-k="chatter-high"]').click();
    ok('panel.js chatter: a web page can offer it', await r.page.evaluate(() => H.maker.state.chatter === 'high'));
    await r.page.locator('[data-k="all-love"]').click();
    ok('panel.js Everyone: acts reach everyone', JSON.stringify(await r.page.evaluate(() => H.acts.at(-1))) === '["*everyone*","love"]');
    await clean(r, 'everyone'); }
});

/* ---------- how the window behaves ---------- */
await group('window', async () => {
  { const r = await h.open({ fixture: 'olive' });
    await sheet(r.page, 4);
    const size = () => r.page.evaluate(() => [...document.querySelectorAll('.c .art')].map(e => { const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }).join('|'));
    const tray = () => r.page.locator('.tray').evaluate(e => Math.round(e.getBoundingClientRect().height));
    const s0 = await size(), t0 = await tray();
    await r.page.locator('.say[data-sit="hello"]').first().click();
    /* the sizes are worked out again on a resize, so that's when they could depend on it */
    await r.page.evaluate(() => dispatchEvent(new Event('resize')));
    ok('sticker size never depends on what\'s picked', s0 === await size());
    ok('the tray is one height for art and for words', t0 === await tray(), [t0, await tray()]);
    await r.page.locator('.nm[data-art="happy"]').click();
    ok('picking art leaves the stickers alone too', s0 === await size());
    const left = () => r.page.locator('.page').evaluate(e => e.getBoundingClientRect().width);
    const w0 = await left(), box = await r.page.locator('.perf').boundingBox();
    await r.page.mouse.move(box.x + 7, box.y + 100); await r.page.mouse.down(); await r.page.mouse.move(box.x + 127, box.y + 100, { steps: 4 }); await r.page.mouse.up();
    const w1 = await left();
    ok('the divider drags', Math.abs(w1 - w0 - 120) < 12, [w0, w1]);
    await r.page.locator('.perf').focus();
    await r.page.keyboard.press('Home');
    ok('and the art follows it', s0 !== await size(), await size());
    await r.page.keyboard.press('End');
    await r.page.locator('.perf').focus();
    const w2 = await left();
    await r.page.keyboard.press('ArrowLeft');
    ok('the divider answers the keyboard', await left() < w2);
    const w3 = await left();
    await sheet(r.page, 1);
    await sheet(r.page, 4);
    ok('a sheet keeps its divider', Math.abs(await left() - w3) < 1);
    await clean(r, 'divider'); }
  { /* nothing but the keyboard */
    const r = await h.open({ fixture: 'olive' });
    const active = () => r.page.evaluate(() => { const a = document.activeElement; return (a.dataset && (a.dataset.s || a.dataset.k)) || a.textContent; });
    await r.page.locator('.spine [data-s="all"]').focus();
    for (let i = 0; i < 6 && await active() !== '4'; i++) await r.page.keyboard.press('Tab');
    await r.page.keyboard.press('Enter');
    ok('keyboard: a sheet opens from the spine', (await r.page.locator('.board h2').textContent()) === 'Feelings');
    await r.page.locator('.nm[data-art="wave"]').focus();
    await r.page.keyboard.press('Enter');
    ok('keyboard: Enter picks art', (await title(r.page)) === 'Wave / greet');
    await r.page.locator('.say[data-sit="hello"]').first().focus();
    await r.page.keyboard.press('Enter');
    ok('keyboard: Enter opens a word', (await title(r.page)) === 'When you click it');
    ok('keyboard: and the focus stays where it was', await r.page.evaluate(() => document.activeElement.classList.contains('say')));
    await r.page.locator('.perf').focus();
    const v = () => r.page.locator('.perf').getAttribute('aria-valuenow');
    const v0 = +await v();
    await r.page.keyboard.press('ArrowRight');
    ok('keyboard: the divider moves', +await v() === v0 + 4);
    await r.page.keyboard.press('Home');
    ok('keyboard: Home goes to its end', +await v() === 28);
    await r.page.locator('.say[data-add="hello"]').focus();
    await r.page.keyboard.press('Enter');
    await r.page.keyboard.type('First');
    await r.page.keyboard.press('Enter');
    await r.page.keyboard.type('Second');
    const l = (await pet(r.page)).lines.hello;
    ok('keyboard: Enter writes the next line', l.at(-2) === 'First' && l.at(-1) === 'Second', l.slice(-2));
    await r.page.locator('[data-all]').focus();
    await r.page.keyboard.press('Enter');
    ok('keyboard: All actions opens with the focus inside', await r.page.evaluate(() => !!document.activeElement.closest('.allact')));
    await r.page.keyboard.press('Escape');
    ok('keyboard: Escape closes it and comes back', await r.page.locator('.allact').count() === 0 && await r.page.evaluate(() => document.activeElement.matches('[data-all]')));
    await sheet(r.page, 1);
    await r.page.locator('[data-k="later"]').focus();
    await r.page.keyboard.press('Enter');
    ok('keyboard: moving a frame keeps the focus on the button', await r.page.evaluate(() => document.activeElement.matches('[data-k="later"]')));
    await clean(r, 'keyboard'); }
  { /* what scrolls to show itself */
    const r = await h.open({ fixture: 'olive' });
    await sheet(r.page, 'words');
    await r.page.evaluate(() => { document.querySelector('.say[data-sit="bye"]').click(); });
    const seen = await r.page.evaluate(() => { const g = document.querySelector('.sit.on').getBoundingClientRect(), b = document.querySelector('.allw').getBoundingClientRect(); return g.top >= b.top - 1 && g.top < b.bottom; });
    ok('a word picked far down All words scrolls into view', seen);
    await r.page.evaluate(() => { document.querySelector('.allw').scrollTop = 0; document.querySelector('.say[data-sit="hello"]').click(); });
    ok('and one near the top comes back', await r.page.evaluate(() => { const g = document.querySelector('.sit.on').getBoundingClientRect(), b = document.querySelector('.allw').getBoundingClientRect(); return g.top >= b.top - 1 && g.top < b.bottom; }));
    const here = await r.page.evaluate(() => document.querySelector('.allw').scrollTop);
    await r.page.locator('.say[data-sit="hello"]').first().click();
    ok('and one already in view stays put', here === await r.page.evaluate(() => document.querySelector('.allw').scrollTop));
    await clean(r, 'reveal');
    const m = await h.open({ fixture: 'many' });
    await sheet(m.page, 1);
    await m.page.locator('.nm[data-art="walk"]').click();
    await m.page.locator('.fs-go').fill('60');
    const inView = () => m.page.evaluate(() => { const t = document.querySelector('.fs-t.on').getBoundingClientRect(), b = document.querySelector('.fs-roll').getBoundingClientRect(); return t.left >= b.left - 1 && t.right <= b.right + 1; });
    ok('the picked frame scrolls into view along a long strip', await inView());
    await m.page.locator('.fs-go').fill('1');
    ok('and back', await inView());
    await m.page.locator('[data-k="later"]').click();
    ok('moving a frame keeps it in view', await inView());
    await clean(m, 'long strip'); }
  { /* small art stays crisp, and big art says when Look can't show it whole */
    const r = await h.open({ fixture: 'pixel' });
    await r.page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); x.fillStyle = '#6a5'; x.fillRect(4, 4, 24, 28); H.pet().base.src = c.toDataURL(); H.maker.select(H.pet().id); });
    await r.page.waitForFunction(() => document.querySelector('.mk').classList.contains('px'));
    ok('pixel art stays crisp', (await r.page.locator('.c .art img').first().evaluate(e => getComputedStyle(e).imageRendering)) === 'pixelated');
    await clean(r, 'pixel');
    const n = await h.open({ fixture: 'olive' });
    await n.page.waitForTimeout(100);
    ok('art that isn\'t small stays smooth', !await n.page.locator('.mk').evaluate(e => e.classList.contains('px')));
    await sheet(n.page, 'look');
    ok('Look says it\'s the real size', /will be on your screen/.test(await n.page.locator('[data-real]').textContent()));
    await clean(n, 'look size');
    const w = await h.open({ fixture: 'wide' });
    await sheet(w.page, 'look');
    await w.page.locator('[data-size]').fill('280');
    await w.page.locator('.perf').focus();
    await w.page.keyboard.press('Home');
    ok('Look says so when this side is too narrow for the real size', /Shown smaller/.test(await w.page.locator('[data-real]').textContent()), await w.page.locator('[data-real]').textContent());
    await w.page.keyboard.press('End');
    ok('and stops saying so when there\'s room', /will be on your screen/.test(await w.page.locator('[data-real]').textContent()));
    await clean(w, 'look narrow'); }
  { /* really played, on the real clock */
    const r = await h.open({ fixture: 'full' });
    /* frames that really differ: many of Olive's are the same picture */
    await r.page.evaluate(() => { const f = [...new Map(Object.values(H.pet().poses).flatMap(p => p.frames).map(x => [x.src, x])).values()]; H.pet().poses.laugh = { frames: f.slice(0, 4), fps: 24, scale: 1 }; H.maker.select(H.pet().id); });
    await r.page.locator('.nm[data-art="laugh"]').click();
    const img = () => r.page.locator('.live .art img').getAttribute('src');
    const first = await img();
    await r.page.waitForTimeout(300);
    ok('Play: a play-once pose doesn\'t start by itself', await img() === first);
    await r.page.locator('[data-play]').click();
    await r.page.waitForTimeout(500);
    const last = await r.page.evaluate(() => H.pet().poses.laugh.frames.at(-1).src);
    ok('Play: a play-once pose ends on its last frame', await img() === last);
    const held = await img();
    await r.page.waitForTimeout(300);
    ok('Play: and holds it', await img() === held && (await r.page.locator('[data-play]').textContent()) === 'Play');
    await r.page.evaluate(() => { H.pet().poses.walk = { frames: H.pet().poses.stand.frames.slice(5), fps: 24, scale: 1 }; H.maker.select(H.pet().id); });
    await r.page.locator('.nm[data-art="walk"]').click();
    /* Its speed is the unit tests' job (fake timers). Here: it starts by itself. A fixed 400 ms
       window missed it on a loaded machine, so look for up to 3 s. */
    const seen = new Set();
    for (let t = Date.now(); seen.size < 2 && Date.now() - t < 3000;) { seen.add(await img()); await r.page.waitForTimeout(40); }
    ok('Play: a loop starts by itself when picked', seen.size >= 2, seen.size);
    await r.page.locator('[data-fi="1"]').click();
    const stopped = await img();
    await r.page.waitForTimeout(150);
    ok('Play: picking a frame stops on it', await img() === stopped && stopped === await r.page.evaluate(() => H.pet().poses.walk.frames[1].src));
    await r.page.evaluate(() => { const f = H.pet().poses.stand.frames; H.pet().poses.dragL = { frames: [f[0], f[7]], fps: 24, scale: 1 }; H.maker.select(H.pet().id); });
    await r.page.locator('.nm[data-art="dragL"]').click();
    const gentle = await img();
    await r.page.waitForTimeout(300);
    ok('Play: the swing doesn\'t run by itself', await img() === gentle);
    await r.page.locator('[data-play]').click();
    await r.page.waitForTimeout(800);
    const strong = await img();
    ok('Play: the swing goes to strong', strong !== gentle);
    await r.page.waitForTimeout(800);
    ok('Play: and back to gentle, and stops', await img() === gentle && (await r.page.locator('[data-play]').textContent()) === 'Play');
    await r.page.waitForTimeout(800);
    ok('Play: it doesn\'t loop', await img() === gentle);
    await clean(r, 'play'); }
  { const r = await h.open({ fixture: 'olive' }, { reduced: true });
    await r.page.evaluate(() => { const f = [...new Map(Object.values(H.pet().poses).flatMap(p => p.frames).map(x => [x.src, x])).values()]; H.pet().poses.stand = { frames: f.slice(0, 4), fps: 24, scale: 1 }; H.maker.select(H.pet().id); });
    const img = () => r.page.locator('.live .art img').getAttribute('src');
    const first = await img();
    await r.page.waitForTimeout(500);
    ok('reduced motion: nothing runs by itself', await img() === first);
    await clean(r, 'reduced'); }
  { const r = await h.open({ fixture: 'olive' });
    await r.page.locator('[data-who]').click();
    const inside = await r.page.locator('.pop > *').evaluate(e => { const b = e.getBoundingClientRect(); return b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight; });
    ok('a menu stays inside the window', inside);
    ok('nothing moves the menu\'s layer, or a fixed menu would scroll the page and close itself', await r.page.locator('.pop').evaluate(e => { const s = getComputedStyle(e); return s.animationName === 'none' && s.transform === 'none'; }));
    await r.page.mouse.click(600, 300);
    ok('and an outside click closes it', await r.page.locator('.pop > *').count() === 0);
    await clean(r, 'menus'); }
  { const r = await h.open({ fixture: 'olive' });
    const stand = () => r.page.evaluate(() => H.maker.current().poses.stand?.frames.length ?? 0);
    const had = await stand();
    await dropFiles(r.page, [png('cat.png')]);
    await r.page.waitForSelector('.placed:not([hidden])');
    const words = await r.page.locator('.placed button').allTextContents();
    ok('an unnamed image goes to the open pose at once, and nothing asks', await stand() === had + 1 && await r.page.locator('[role=dialog]').count() === 0, await stand());
    ok('the note offers Undo and the other places', words.join() === 'Undo,New main image,A new buddy', words);
    ok('it doesn\'t take the keyboard', await r.page.evaluate(() => !document.activeElement?.closest('.placed')));
    const box = await r.page.locator('.placed').boundingBox(), size = r.page.viewportSize();
    ok('it sits inside the window', box && box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height, JSON.stringify(box));
    await r.page.locator('.placed button', { hasText: 'Undo' }).click();
    await r.page.waitForFunction(n => (H.maker.current().poses.stand?.frames.length ?? 0) === n, had);
    ok('and Undo leaves everything as it was', await count(r.page) === 1 && await stand() === had && await r.page.locator('.placed').isHidden());
    const veil = () => r.page.locator('.veil').isHidden();
    await r.page.evaluate(() => { const d = new DataTransfer(); d.items.add(new File(['x'], 'a.png', { type: 'image/png' })); document.body.dispatchEvent(new DragEvent('dragenter', { dataTransfer: d, bubbles: true })); });
    ok('a drag with files raises the veil', !await veil());
    await clean(r, 'drops'); }
});

/* ---------- speech bubbles point at her ---------- */
/* A tester, preview 5: the words tray's tail sat at the bubble's top-left, pointing up and away from her. Every
   place a bubble sits over art: the words tray (beside her), a Try in the pose tray (above her, or by a
   wall), and a sticker (above her), short and long lines, on the floor, a wall, held and the ceiling. */
await group('bubbles', async () => {
  const check = async (r, label) => {
    const got = await r.page.evaluate(TAILS);
    for (const x of got) ok(`bubble ${label}, ${x.where}: its tail points at her`, !x.bad, x.bad ? x : undefined);
    return got.length;
  };
  const line = async (r, s, k, i = 0) => { await sheet(r.page, s); await r.page.locator(`.strip .say[data-sit="${k}"][data-i="${i}"]`).click(); await h.settled(r.page); };
  const tryIt = async (r, t) => { await r.page.locator(`.try [data-t="${t}"]`).first().click(); await h.settled(r.page); };
  for (const [w, hh, theme] of [[1180, 680, 'dark'], [960, 600, 'dark'], [1180, 680, 'light']]) {
    const at = `${w}x${hh} ${theme}`, r = await h.open({ fixture: 'wordy' }, { w, h: hh, theme });
    let n = 0;
    /* the words tray: on the floor, short and long, on a wall, held, falling */
    for (const [s, k, i] of [[8, 'spin', 0], [4, 'hello', 1], [1, 'chat', 0], [1, 'chat', 1], [3, 'climb', 0], [2, 'held', 0], [2, 'drop', 0]]) { await line(r, s, k, i); n += await check(r, `${at} words ${k} ${i}`); }
    /* a Try over a picked line, ceiling included */
    await line(r, 3, 'grab'); await tryIt(r, 'ceilGo'); n += await check(r, `${at} words grab, ceiling`);
    /* a Try in the pose tray: floor, wall, air */
    await sheet(r.page, 8); await r.page.locator('.nm[data-art="dance"]').click();
    await tryIt(r, 'spin'); n += await check(r, `${at} pose spin`);
    await sheet(r.page, 3); await r.page.locator('.nm[data-art="climb"]').first().click();
    await tryIt(r, 'climbGo'); n += await check(r, `${at} pose climbGo`);
    await tryIt(r, 'drop'); n += await check(r, `${at} pose drop`);
    /* a short line over her keeps to one line while it fits */
    await sheet(r.page, 4); await r.page.locator('.nm[data-art="wave"]').click();
    await tryIt(r, 'shy'); n += await check(r, `${at} pose shy`);
    const one = await r.page.locator('.tray:not(.w) .live > .say').evaluate(e => ({ h: e.getBoundingClientRect().height, line: parseFloat(getComputedStyle(e).lineHeight), t: e.textContent }));
    ok(`bubbles ${at}: "${one.t}" over her is one line`, one.h < one.line * 2, one);
    /* stickers: every line on Feelings, a resting one and a picked one, short and wide */
    await sheet(r.page, 4);
    for (const k of ['hello', 'love', 'shy', 'angry', 'cry']) { await r.page.locator(`.strip .say[data-sit="${k}"][data-i="0"]`).click(); await h.settled(r.page); n += await check(r, `${at} sticker ${k}`); }
    ok(`bubbles ${at}: enough of them were measured`, n >= 18, n);
    await clean(r, `bubbles ${at}`);
    /* one image laid on its side: thin art on a wall, against the preview's left edge */
    const thin = await h.open({ fixture: 'wide' }, { w, h: hh, theme });
    await sheet(thin.page, 3); await thin.page.locator('.nm[data-art="climb"]').first().click();
    await tryIt(thin, 'climbGo');
    await check(thin, `${at} thin climbGo`);
    ok(`bubbles ${at}: a Try on a wall shows a bubble`, await thin.page.locator('.tray:not(.w) .live[data-s="wall"] > .say').count() === 1);
    await clean(thin, `bubbles thin ${at}`);
  }
});

/* ---------- long lines wrap inside their bubbles ---------- */
/* An artist's lines run to 38 letters. Every bubble over art wraps them inside itself, at spaces, and a
   sticker's bubble that wraps taller stays in its sticker: the first row's was cut off at the top, a
   lower row's covered the names above it. Every size the renders use, both themes. */
await group('wraps', async () => {
  for (const [w, hh, scale] of SIZES) for (const theme of THEMES) {
    const at = `${w}x${hh}@${scale} ${theme}`, r = await h.open({ fixture: 'artist' }, { w, h: hh, scale, theme });
    const look = async (what, want) => {
      await h.settled(r.page);
      const got = await r.page.evaluate(WRAPS), tails = await r.page.evaluate(TAILS);
      for (const x of got) ok(`wraps ${at} ${what}, ${x.where}: its words sit inside it`, !x.bad, x.bad ? x : undefined);
      for (const x of tails) ok(`wraps ${at} ${what}, ${x.where}: its tail points at her`, !x.bad, x.bad ? x : undefined);
      if (want) ok(`wraps ${at} ${what}: ${want.where} wraps`, got.some(x => x.where.startsWith(want.where) && x.lines >= 2), got);
    };
    const line = async (s, k, i) => { await sheet(r.page, s); await r.page.locator(`.strip .say[data-sit="${k}"][data-i="${i}"]`).click(); };
    /* on a sticker, as long as a sticker's line gets, and the tray beside her */
    await line(4, 'hello', 0); await look('hello 0', { where: 'sticker' });
    for (const [s, k, i] of [[4, 'hello', 1], [4, 'love', 0], [4, 'love', 1], [1, 'chat', 0]]) { await line(s, k, i); await look(`${k} ${i}`, { where: 'words tray' }); }
    /* a Try in the pose tray says its own line over her: on a wall, and falling */
    await sheet(r.page, 3); await r.page.locator('.nm[data-art="climb"]').first().click();
    for (const t of ['climbGo', 'drop']) { await r.page.locator(`.try [data-t="${t}"]`).first().click(); await look(`pose ${t}`, { where: 'pose tray' }); }
    await clean(r, `wraps ${at}`);
  }
});

/* ---------- a file's own data ---------- */
await group('file', async () => {
  /* Art past its stored box is how a hand-set file looks, and nothing in the window may tidy it. */
  const r = await h.open({ fixture: 'handSet' });
  const same = async what => {
    const [a, b] = await r.page.evaluate(() => [JSON.stringify(H.asFiled()), JSON.stringify(H.asNow())]);
    ok(`a hand-set buddy still deep-equals its file: ${what}`, a === b, a === b ? undefined : 'it changed');
  };
  await same('opened');
  const pages = await r.page.evaluate(() => [...document.querySelectorAll('.spine [data-s]')].map(b => b.dataset.s));
  ok('the visit covers every page', pages.length === 13, pages.length);
  const picked = new Set();
  for (const s of pages) {
    await sheet(r.page, s);
    const poses = await r.page.evaluate(() => [...new Set([...document.querySelectorAll('.board [data-art]')].flatMap(b => b.dataset.art.split(' ')))]);
    for (const k of poses) {
      await r.page.evaluate(k => document.querySelector(`.board [data-art~="${k}"]`).click(), k);
      picked.add(k);
    }
    await r.page.evaluate(() => dispatchEvent(new Event('resize')));
  }
  ok('the visit picked every pose', picked.size === 49, picked.size);
  await same('after every sheet and every pose');
  const stored = await r.page.evaluate(async () => { const { id: _, ...rest } = (await H.stored()).pets[0]; return JSON.stringify(H.sortedOf(rest)) === JSON.stringify(H.asFiled()); });
  ok('and what was saved does too', stored);
  await clean(r, 'file');
});

/* ---------- a failed save ---------- */
await group('save', async () => {
  const r = await h.open({ fixture: 'olive' });
  const chip = () => r.page.locator('[data-save]').textContent();
  await r.page.evaluate(() => H.save({ kind: 'saved' }));
  ok('a good save is one quiet word', (await chip()) === 'Saved' && await r.page.locator('.misprint').count() === 0);
  await r.page.evaluate(() => H.save({ kind: 'saving' }));
  ok('saving is one quiet word too', (await chip()) === 'Saving');
  await r.page.evaluate(() => H.save({ kind: 'failed', title: "Olive didn't save", why: 'The disk is full.', fix: 'Free some space, then try again.', labels: ['Try again'] }));
  const t = await r.page.locator('.misprint').textContent();
  ok('a failed save shows its title, why and fix', /Olive didn't save/.test(t) && /The disk is full\./.test(t) && /Free some space/.test(t), t);
  ok('it can\'t be missed: a dashed misprint and a word in the warning colour', await r.page.locator('.misprint').evaluate(e => getComputedStyle(e).borderTopStyle === 'dashed' && e.getBoundingClientRect().height > 30) && (await chip()) === 'Not saved');
  ok('it\'s announced', (await r.page.locator('.misprint').getAttribute('role')) === 'alert');
  await r.page.getByRole('button', { name: 'Try again' }).click();
  ok('its actions reach the host', (await r.page.evaluate(() => H.calls.at(-1).what)) === 'action Try again');
  await r.page.locator('[data-keep]').click();
  ok('and it offers a way to keep the work', (await r.page.evaluate(() => H.calls.at(-1).what)) === 'saveBuddyFile');
  await r.page.evaluate(() => H.save({ kind: 'saving' }));
  ok('trying again doesn\'t look saved', await r.page.locator('.misprint').count() === 1 && /Not saved yet/.test(await chip()));
  await r.page.evaluate(() => H.save({ kind: 'saved' }));
  ok('only a real save clears it', (await chip()) === 'Saved' && await r.page.locator('.misprint').isHidden());
  await r.page.evaluate(() => H.toast('From the Maker'));
  ok('a host\'s toast draws in the window', (await r.page.locator('.toast').textContent()) === 'From the Maker');
  await clean(r, 'save');
});

/* ---------- the exe's pieces being absent ---------- */
await group('absent', async () => {
  const r = await h.open({ fixture: 'olive', window: false, tryOnScreen: false, exportPage: false, onToast: false });
  ok('as a plain web page: no window buttons', await r.page.locator('.wc').count() === 0);
  ok('as a plain web page: no drag marks', await r.page.locator('[data-tauri-drag-region]').count() === 0);
  ok('as a plain web page: no Try on my screen', await r.page.locator('[data-screen]').count() === 0);
  ok('as a plain web page: no Export until the host has one', await r.page.locator('[data-export]').count() === 0);
  await sheet(r.page, 4);
  await r.page.locator('[data-t="wave"]').click();
  await r.page.locator('.say[data-sit="hello"]').first().click();
  await r.page.locator('[data-save-file]').click();
  ok('as a plain web page: the rest still works', (await r.page.evaluate(() => H.calls.at(-1).what)) === 'saveBuddyFile');
  await sheet(r.page, 'look');
  ok('as a plain web page: Look has no world settings unless asked', await r.page.locator('.world').count() === 0);
  await clean(r, 'absent');
  const s = await h.open({ fixture: 'olive', storage: 'none' });
  await sheet(s.page, 4); await sheet(s.page, 'all');
  await s.page.locator('[data-b="dark"]').click();
  ok('with storage off, everything still works', (await s.page.locator('.mk').getAttribute('data-back')) === 'dark');
  await clean(s, 'storage off');
  const f = await h.open({ fixture: 'olive', hold: true });
  ok('before start: it says it\'s getting ready', await f.page.locator('.first.waiting').isVisible());
  await f.page.evaluate(() => H.start());
  await f.page.waitForSelector('.board');
  ok('and then it opens', (await f.page.locator('.board h2').textContent()) === 'Everything');
  await clean(f, 'hold');
});

/* ---------- what it costs ---------- */
await group('cost', async () => {
  const r = await h.open({ fixture: 'full' });
  const m = await r.page.evaluate(async () => {
    const paint = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const decoded = () => Promise.all([...document.images].filter(i => !i.closest('.fs-roll')).map(i => i.decode().catch(() => {})));
    const timed = async f => { const t = performance.now(); f(); const sync = performance.now() - t; await paint(); const painted = performance.now() - t; await decoded(); return { sync: +sync.toFixed(1), painted: +painted.toFixed(1), decoded: +(performance.now() - t).toFixed(1) }; };
    const click = s => document.querySelector(s).click();
    const out = { frames: Object.values(H.pet().poses).reduce((n, p) => n + p.frames.length, 0), kb: Math.round(JSON.stringify(H.pet()).length / 1024) };
    click('.spine [data-s="1"]'); await paint();
    out.open = await timed(() => click('.spine [data-s="all"]'));
    out.stickers = document.querySelectorAll('.c').length;
    out.images = document.images.length;
    const runs = [];
    for (let i = 0; i < 20; i++) { const a = performance.now(); click(`.nm[data-art="${i % 2 ? 'walk' : 'run'}"]`); runs.push(performance.now() - a); await paint(); }
    runs.sort((a, b) => a - b);
    out.pickMedianMs = +runs[10].toFixed(1); out.pickWorstMs = +runs[19].toFixed(1);
    out.heapMb = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
    return out;
  });
  console.log('cost, full-art Everything:', JSON.stringify(m));
  ok('every sticker on Everything, one image each', m.stickers === 40 || m.stickers >= 36, m.stickers);
  ok('Everything paints soon enough to feel instant on this machine', m.open.painted < 300, m.open);
  ok('a pick is cheap, because it only marks what\'s there', m.pickMedianMs < 30, m.pickMedianMs);
  await clean(r, 'cost');
});

/* ---------- every state, every size, measured ---------- */
if (!NO_SHOTS && (!ONLY || 'renders'.includes(ONLY))) {
  await shootAll(h, { shots: SHOTS || null, onShot(label, m, r) {
    ok(`${label}: nothing runs off the window`, !m.off.length, m.off.slice(0, 4).join(' | ') || undefined);
    ok(`${label}: no words are cut short`, !m.clipped.length, m.clipped.slice(0, 4).join(' | ') || undefined);
    ok(`${label}: all text is readable`, !m.faint.length, m.faint.slice(0, 4).join(' | ') || undefined);
    ok(`${label}: no errors`, !r.errors.length, r.errors.slice(0, 3).join(' | ') || undefined);
  } });
}

await h.stop();
const failed = results.filter(([g]) => !g);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.${SHOTS ? ` Screenshots in ${SHOTS}` : ''}`);
for (const [, n] of failed) console.log(`  FAILED: ${n}`);
process.exit(failed.length ? 1 : 0);
