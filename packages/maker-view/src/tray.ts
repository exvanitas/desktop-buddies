/* The tray holds what's picked and edits it: a pose's frames, a line, or a prompt. It's one height for
   all of them. The preview only places a pose on its surface: Play and Try on my screen are what it has. */
import { LIMIT, POSE, hasArt, type PoseKey, type Situation } from '@buddies/buddy-file';
import { ACTS, NEGATIVE, hasOwnLines, linesOf, type MakerBuddy } from '@buddies/maker-core';
import { button, h } from '@buddies/peel/dom';
import { mainSlot, slotOf, type Showing } from './art';
import { artOf, capOf, label, noArtNote, ownNote, saidOnce, silent, sitOf, usedFor } from './captions';
import { isLine, isPose, isPrompt, keepFocus, keepScroll, sheetOf, type View } from './context';
import { confirmOf } from './confirm';
import { drawArt, type DrawnArt } from './draw-art';
import { FLOORED, ON_FLOOR, UNBUILT, surfaceOf, tryOf, type Surface } from './facts';
import { faceWall, signed, standOff } from './floor';
import { frameIn, frameStrip, showPicked } from './frames';
import { COMMON_TRIES, WHEN } from './moments';
import { createPlayer, motionOf } from './playback';
import { addLine, addWord, rich } from './words';

const rangeOf = (name: string, min: number, max: number, value: number, words: (n: number) => string, changed: (n: number) => void) => {
  const input = h('input', { type: 'range', min, max, 'aria-label': name, 'data-k': name });
  input.value = String(value);
  const out = h('output', {}, words(value));
  input.addEventListener('input', () => { changed(+input.value); out.textContent = words(+input.value); });
  return h('div', { class: 'rng' }, h('span', {}, name), input, out);
};

export function createTray(v: View) {
  const el = h('section', { class: 'tray' });
  let stop = () => {}, live: DrawnArt | null = null, spoken = 0, liveBox: HTMLElement | null = null, liveKey: PoseKey | null = null;

  const showing = (p: MakerBuddy, k: PoseKey | null): Showing => {
    const s = k ? slotOf(p, k) : null;
    return s && s.kind !== 'none' ? s : mainSlot(p);
  };
  /* The preview: the art on its surface, and any words. */
  function liveOf(p: MakerBuddy, k: PoseKey | null, words: string | null, said = false, frame = 0) {
    const s = showing(p, k), art = drawArt(s, frame), surface = k ? surfaceOf(k) : 'floor';
    live = art; liveKey = k;
    liveBox = h('div', { class: 'live', 'data-s': surface }, FLOORED.has(surface) ? h('i', { class: 'floor', 'aria-hidden': 'true' }) : null, art.el,
      words !== null ? h('span', { class: `say${said ? ' said' : ''}` }, h('span', { class: 'pv', dir: 'auto' }, words || h('em', {}, 'New line'))) : null);
    return liveBox;
  }
  /* Worked out once it's in the page, since the tray's height comes from the window. */
  function sizeLive() {
    if (!live || !liveBox) return;
    const tall = liveBox.clientHeight || 120, wide = liveBox.clientWidth || 120, words = el.classList.contains('w');
    const p = v.pet(), s = showing(p, liveKey), surface = liveBox.dataset.s as Surface;
    live.setSlot(s);
    faceWall(live.el, p, surface, s);
    standOff(live.el, p, surface, live.size(tall * .82, words ? 80 : wide - 8), s.scale);
  }

  function tryRow(sel: PoseKey | null) {
    const p = v.pet(), m = sheetOf(v.now.page), lead = m ? m.tries : COMMON_TRIES;
    const offered = ACTS.filter(([a]) => v.maker.canAct(p, a));
    const first = lead.flatMap(a => offered.filter(x => x[0] === a));
    const btn = (a: string, words: string) => button(words, () => v.tryIt(a), { class: v.now.tried === a ? 'on' : null, 'data-t': a, 'data-k': `try-${a}` });
    const all: HTMLButtonElement = button('All actions', () => {
      if (v.popover.anchor === all) { v.popover.close(); return; }
      const panel = h('div', { class: 'allact', role: 'dialog', 'aria-label': 'All actions' }, h('b', {}, 'All actions'),
        h('div', {}, ...offered.map(([a, words]) => button(words, () => { v.popover.close(false); v.tryIt(a); }, { class: v.now.tried === a ? 'on' : null, 'data-t': a }))));
      v.popover.show(panel, all);
    }, { class: 'more', 'data-all': true, 'data-k': 'all-actions' });
    const screen = v.host.tryOnScreen;
    const action = v.now.tried ?? (sel && v.maker.canAct(p, sel) ? sel : null);
    return h('div', { class: 'try' }, h('b', {}, 'Try'), ...first.map(([a, words]) => btn(a, words)), all,
      screen ? h('span', { class: 'grow' }) : null,
      screen ? button('Try on my screen', () => { screen(p.id, action ?? 'wave'); }, { class: 'btn sm screen', 'data-screen': true, 'data-k': 'screen' }) : null);
  }

  function poseTray(p: MakerBuddy, key: PoseKey) {
    const slot = slotOf(p, key), own = slot.kind === 'own' ? slot : null, n = own ? own.frames.length : 0;
    const tried = v.now.tried, shown = tried ? tryOf(tried, k => hasArt(p, k)).pose : key, motion = motionOf(key, n);
    const said = tried && tryOf(tried, k => hasArt(p, k)).say ? linesOf(p, tryOf(tried, k => hasArt(p, k)).say!)[0] ?? '' : null;
    const note = own ? ownNote(key, n)
      : slot.kind === 'none' ? noArtNote(p.name || '', key)
      : `Works already, using ${slot.from ? label(slot.from) : 'the main image'}.`;
    const uses = usedFor(p, key), usesShown = el.clientWidth > 900 ? 3 : 2;
    const preview = liveOf(p, shown, said, false, tried ? 0 : frameIn(v, key, n));
    const playBtn = h('button', { type: 'button', class: 'btn sm go', 'data-play': true, 'data-k': 'play', disabled: motion === 'still', title: motion === 'still' ? 'One frame, so there is nothing to play' : null }, 'Play');
    const player = createPlayer(v.io, i => { if (!tried) live?.show(i); }, () => { playBtn.textContent = player.running && motion === 'loop' ? 'Pause' : 'Play'; });
    const fps = () => p.poses[key]?.fps || 6;
    stop = () => player.stop();
    playBtn.addEventListener('click', () => {
      /* Play shows this pose, so a Try on show makes way first */
      if (tried) { v.now.tried = null; v.drawTray(); el.querySelector<HTMLElement>('[data-play]')?.click(); return; }
      if (player.running && motion === 'loop') { player.stop(); return; }
      v.now.held = null;
      v.maker.act(p.id, key);
      player.play(motion, n, fps());
    });
    const speedChange = (x: number) => { v.maker.setSpeed(p, key, x); if (player.running && motion === 'loop') player.play(motion, n, fps()); };
    el.className = 'tray';
    el.replaceChildren(
      preview,
      h('div', { class: 'tape' },
        h('header', {}, h('h3', {}, POSE[key].label), note ? noteOf(note) : null),
        h('p', { class: 'cap uf' }, ...uses.length
          ? ['Used for', ...uses.slice(0, usesShown).map(x => usedLink(x.k)), uses.length > usesShown ? moreUses(uses.map(x => x.k)) : null]
          : [UNBUILT.has(key) ? 'Nothing says lines over this yet.' : 'No lines use this art.']),
        frameStrip(v, p, key, own)),
      h('div', { class: 'knobs' },
        own ? rangeOf('Speed', 1, 24, own.fps, x => `${x} fps`, speedChange) : null,
        own ? rangeOf('Scale', 40, 250, Math.round(own.scale * 100), x => `${x}%`, x => { v.maker.setScale(p, key, x / 100); v.resized(); }) : null,
        own && ON_FLOOR.has(key) ? liftOf(p, key) : null,
        own ? h('div', { class: 'row' }, playBtn, button('Clear pose', () => confirmClear(p, key, own.frames.length), { class: 'btn sm', 'data-clear': true, 'data-k': 'clear' })) : null),
      tryRow(key));
    if (!tried && motion === 'loop' && v.now.held !== key && v.io.moves()) player.play(motion, n, own!.fps);
  }

  /* Lift needs her art measured first. It shows once that's done, and never for art that can't be read. */
  function liftOf(p: MakerBuddy, key: PoseKey) {
    const px = v.maker.poseLift(p, key), r = v.maker.liftRange(p, key);
    if (px === null || !r) {
      void v.maker.measureLift(p, key).then(() => {
        const sel = v.now.sel;
        if (v.maker.current() === p && isPose(sel) && sel.pose === key && v.maker.poseLift(p, key) !== null) v.drawTray();
      });
      return null;
    }
    /* the buddy's own, from Look, goes under it */
    const own = Math.round((p.lift?.floor || 0) * (p.size || 120));
    const all = (x: number) => { row.title = own ? `${signed(x + own)} in all, with ${signed(own)} from the floor for every pose from Look` : ''; };
    const row = rangeOf('Lift', Math.min(r.min, px), Math.max(r.max, px), px, signed, x => { v.maker.setPoseLift(p, key, x); all(x); v.resized(); });
    all(px);
    return row;
  }

  /* The tray is one height, so a long note runs to its end here and opens whole on a click. */
  function noteOf(note: string) {
    const b: HTMLButtonElement = button(note, () => {
      if (v.popover.anchor === b) { v.popover.close(); return; }
      v.popover.show(h('div', { class: 'note-all', role: 'dialog', 'aria-label': 'About this pose' }, note), b);
    }, { class: 'note', title: note, 'data-note': true, 'data-k': 'note' });
    return b;
  }
  const usedLink = (k: Situation) => button(WHEN[k], () => v.pick({ sit: k, i: 0 }), { class: 'lk', 'data-sit': k, 'data-k': `uf-${k}` });
  function moreUses(all: Situation[]) {
    const b: HTMLButtonElement = button(`and ${all.length - (el.clientWidth > 900 ? 3 : 2)} more`, () => {
      if (v.popover.anchor === b) { v.popover.close(); return; }
      v.popover.show(h('div', { class: 'uses-all', role: 'dialog', 'aria-label': 'Used for' }, h('b', {}, 'Used for'),
        ...all.map(k => button(WHEN[k], () => { v.popover.close(false); v.pick({ sit: k, i: 0 }); }, { class: 'pick', 'data-sit': k }))), b);
    }, { class: 'lk', 'data-more-uses': true, 'data-k': 'more-uses' });
    return b;
  }

  /* An evening's frames could go with this, so it asks first, in the same spot. */
  function confirmClear(p: MakerBuddy, key: PoseKey, n: number) {
    const anchor = el.querySelector<HTMLElement>('[data-clear]')!;
    const stay = button('Cancel', () => v.popover.close(), { class: 'btn sm go' });
    const panel = h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': `Clear ${label(key)}?` },
      h('h2', {}, `Clear ${label(key)}?`),
      h('p', {}, `${n} frame${n === 1 ? '' : 's'} will go. This can't be undone.`),
      h('div', { class: 'row' }, stay, button('Clear', () => { v.popover.close(false); v.maker.clearPose(p, key); }, { class: 'btn sm bad' })));
    v.popover.show(panel, anchor, () => {}, stay);
  }

  function lineTray(p: MakerBuddy, k: ReturnType<typeof sitOf>, i: number) {
    const list = linesOf(p, k.k), text = list[i] ?? '', art = artOf(p, k);
    const tried = v.now.tried, shown = tried ? tryOf(tried, k => hasArt(p, k)).pose : art;
    const said = tried ? (tryOf(tried, k => hasArt(p, k)).say ? linesOf(p, tryOf(tried, k => hasArt(p, k)).say!)[0] ?? '' : text) : text;
    const others = art ? usedFor(p, art).filter(x => x.k !== k.k).length : 0, realArt = art ? slotOf(p, art).kind === 'own' : false;
    el.className = 'tray w';
    const field = h('textarea', { class: 'field', maxlength: LIMIT.line, rows: 2, dir: 'auto', 'aria-label': `${WHEN[k.k]}: line ${i + 1}`, placeholder: `Type what ${p.name || 'this buddy'} says`, 'data-k': 'field' });
    field.value = text;
    const count = h('span', { class: 'count' });
    const counted = () => { const left = LIMIT.line - field.value.length; count.textContent = left <= 40 ? `${left} left` : ''; };
    counted();
    const source = h('p', { class: 'cap src' });
    const sourceNow = () => source.replaceChildren(...hasOwnLines(p, k.k)
      ? ['Own lines. ', useDefaults(k.k)]
      : ['Default lines, until you change one']);
    sourceNow();
    field.addEventListener('input', () => { typed(p, k.k, i, field, sourceNow, position); counted(); });
    field.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      if (field.value.trim() && linesOf(p, k.k).length < LIMIT.lines) addLine(v, k.k);
    });
    const position = h('span', {}, `Line ${i + 1} of ${Math.max(list.length, i + 1)}`);
    el.replaceChildren(
      liveOf(p, shown, said, spoken-- > 0),
      h('div', { class: 'tape' },
        h('header', {}, h('h3', {}, WHEN[k.k]), position, count),
        h('p', { class: 'cap' }, ...rich(v, capOf(p, k)), silent(p, k) ? `. ${saidOnce(k)}` : ''),
        field),
      h('div', { class: 'knobs' },
        h('div', { class: 'row' },
          button('Say it', () => { spoken = 1; v.now.tried = null; v.drawTray(); }, { class: 'btn sm go', 'data-say': true, 'data-k': 'say-it' }),
          list.length < LIMIT.lines ? button('Add a line', () => addLine(v, k.k), { class: 'btn sm', 'data-add-line': true, 'data-k': 'add-line' }) : null,
          button('Remove', () => removed(p, k.k, i), { class: 'btn sm', 'data-rm': true, 'data-k': 'rm-line' })),
        art ? h('div', { class: 'row' }, button(`${realArt ? 'Edit' : 'Add'} ${label(art)} art`, () => v.pick({ pose: art }), { class: 'btn sm wide', 'data-edit-art': art, 'data-k': 'edit-art' })) : null,
        h('small', {}, !art ? "Said over whatever calm pose is showing, so there's no art to edit here."
          : others ? `Shared: ${others} other ${others > 1 ? 'situations use' : 'situation uses'} ${label(art)}.` : `Only these words use ${label(art)}.`),
        source),
      tryRow(art));
  }

  /* Own lines could be an evening's writing, so it asks first, in the same spot. */
  function useDefaults(k: Situation) {
    const b: HTMLButtonElement = button('Use the defaults', () => {
      v.popover.show(...confirmOf('Use the defaults?', `Your own lines for "${WHEN[k]}" will go. This can't be undone.`, 'Use defaults', () => {
        v.maker.useDefaultLines(k); v.now.sel = { sit: k, i: 0 }; v.drawBoard(); v.drawTray();
      }, v, b));
    }, { class: 'lk', 'data-restore': true, 'data-k': 'restore' });
    return b;
  }

  function removed(p: MakerBuddy, k: ReturnType<typeof sitOf>['k'], i: number) {
    if (i < linesOf(p, k).length) v.maker.removeLine(k, i);
    const n = linesOf(p, k).length;
    v.now.sel = { sit: k, i: Math.max(0, Math.min(i, n - 1)) };
    v.drawBoard(); v.drawTray();
  }

  /* Words update everywhere as they're typed. Nothing is redrawn, so the caret stays put. */
  function typed(p: MakerBuddy, k: ReturnType<typeof sitOf>['k'], i: number, field: HTMLTextAreaElement, sourceNow: () => void, position: HTMLElement) {
    const had = linesOf(p, k).length;
    if (!v.maker.setLine(k, i, field.value)) return;
    if (i >= had) { addWord(v, el.ownerDocument.querySelector('.board')!, k, i); position.textContent = `Line ${i + 1} of ${i + 1}`; }
    for (const w of el.ownerDocument.querySelectorAll(`.board .say[data-sit="${k}"][data-i="${i}"] > span`)) {
      if (field.value) { w.textContent = field.value; w.setAttribute('dir', 'auto'); } else w.replaceChildren(h('em', {}, 'New line'));
    }
    const pv = el.querySelector('.pv');
    if (pv) { if (field.value) pv.textContent = field.value; else pv.replaceChildren(h('em', {}, 'New line')); }
    sourceNow();
    v.mark();
  }

  function promptTray(p: MakerBuddy, file: string) {
    const list = v.maker.imagePromptsFor(p) ?? [], x = list.find(q => q.file === file);
    const key = x && x.key !== 'main' ? x.key as PoseKey : null;
    el.className = 'tray w prompt';
    const text = h('textarea', { class: 'field', readonly: true, 'aria-label': `Prompt for ${file}.png`, 'data-prompt-text': true });
    text.value = x?.text ?? '';
    el.replaceChildren(
      liveOf(p, key, null),
      h('div', { class: 'tape' },
        h('header', {}, h('h3', {}, x?.label ?? file), h('code', {}, `${file}.png`), x && x.frames > 1 ? h('span', {}, `Frame ${x.frame} of ${x.frames}`) : null),
        x?.note ? h('p', { class: 'cap' }, x.note) : null,
        text),
      h('div', { class: 'knobs' },
        h('div', { class: 'row' },
          /* read now, since a field on the page can change it while this is open */
          button('Copy prompt', () => { const q = v.maker.imagePromptsFor(p)?.find(y => y.file === file); if (q) v.copy(q.text, `${file} prompt`); }, { class: 'btn sm go', 'data-k': 'copy-prompt' }),
          v.maker.peekKit(p).mode === 'tags' ? button('Copy negative prompt', () => v.copy(NEGATIVE, 'negative prompt'), { class: 'btn sm', 'data-k': 'copy-negative' }) : null),
        key ? h('div', { class: 'row' }, button(`Go to ${label(key)} art`, () => v.pick({ pose: key }), { class: 'btn sm wide', 'data-k': 'to-art' })) : null,
        h('small', {}, 'Save the picture with the name above, so it finds its pose.')),
      tryRow(key));
  }

  function draw() {
    stop(); stop = () => {};
    const p = v.pet(), sel = v.now.sel;
    keepFocus(el, () => keepScroll(el, ['.fs-roll'], () => {
      if (isPrompt(sel)) promptTray(p, sel.prompt);
      else if (isLine(sel)) lineTray(p, sitOf(sel.sit), sel.i);
      else poseTray(p, sel.pose);
    }), 'add-frames');
    sizeLive();
    showPicked(el);
  }

  return {
    el, draw, resized: sizeLive,
    stop() { stop(); stop = () => {}; }
  };
}
export type Tray = ReturnType<typeof createTray>;
