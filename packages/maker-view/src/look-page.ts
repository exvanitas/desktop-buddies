/* Look: who the buddy is at a glance. The main image at the real size it'll have on your screen, on the
   backing, and everything that changes it on the other side of the perforation. */
import { LIFTS, LIMIT, type Lift } from '@buddies/buddy-file';
import { POSES } from '@buddies/buddy-file';
import { button, h } from '@buddies/peel/dom';
import { readTheme, saveTheme, showTheme, type Theme } from '@buddies/peel/theme';
import { boxOf, cellsOf, mainSlot, slotOf, type Showing } from './art';
import { label } from './captions';
import type { View } from './context';
import { createDivider } from './divider';
import { drawArt } from './draw-art';
import { faceWall, liftAt, signed } from './floor';

/* What the sliders offer. A file may hold a size outside this, and it shows as it is until moved. */
const SIZE = { min: 48, max: 280 };

/* boxOf leaves room above a pose's own scale. Past that room, this is the height that draws at `size`. */
const realSize = (size: number) => size * 1.15;

export function lookPage(v: View, head: HTMLElement, board: HTMLElement) {
  const p = v.pet(), maker = v.maker;
  const art = drawArt(mainSlot(p));
  const fit = () => {
    const wide = stage.clientWidth ? stage.clientWidth - 16 : Infinity, real = realSize(p.size || 120);
    /* the floor her lift puts under the main image, which stays where it is */
    const below = Math.round(liftAt(p, 'floor', art.size(real, wide), 1) * 10) / 10;
    floor.style.top = `${art.el.offsetTop + art.el.offsetHeight + below}px`;
    stage.style.paddingBottom = `${Math.max(6, below + 6)}px`;
    for (const s of sides) s.place();
    sized.textContent = art.el.offsetWidth && art.el.offsetWidth + 1 < mainWidth(real) ? 'Shown smaller here, because this side is too narrow.' : 'The size it will be on your screen.';
  };
  const mainWidth = (height: number) => boxOf(mainSlot(p), height).w;
  const floor = h('i', { class: 'floor', 'aria-hidden': 'true' });
  const stage = h('div', { class: 'stage' }, floor, art.el);
  const sized = h('span', { 'data-real': true });

  const name = h('input', { class: 'in name', maxlength: LIMIT.name, placeholder: 'Name', dir: 'auto', 'aria-label': 'Name', 'data-name': true });
  name.value = p.name || '';
  name.addEventListener('input', () => {
    maker.setName(name.value);
    const who = document.querySelector('.who h1');
    if (who) { who.textContent = p.name || 'No name'; who.setAttribute('title', p.name || ''); }
  });

  const size = h('input', { type: 'range', min: SIZE.min, max: SIZE.max, 'aria-label': 'Size', 'data-size': true, 'data-k': 'size' });
  size.value = String(p.size || 120);
  const sizeOut = h('output', {}, `${p.size || 120} px`);
  size.addEventListener('input', () => { maker.setSize(+size.value); sizeOut.textContent = `${p.size} px`; for (const l of lifts) l.now(); fit(); });

  /* Her lift from each kind of surface, in px at her size: each is a share of her size, so it grows with her. */
  const LABEL: Record<keyof Lift, string> = { floor: 'Floor', wall: 'Walls', ceiling: 'Ceilings' };
  const lifts = LIFTS.map(k => {
    const input = h('input', { type: 'range', 'aria-label': `Lift from ${LABEL[k].toLowerCase()}`, 'data-lift': k, 'data-k': `lift-${k}` });
    const out = h('output', { 'data-lift-out': k });
    const now = () => {
      const at = p.size || 120, most = Math.floor(LIMIT.lift * at), px = Math.round((p.lift?.[k] || 0) * at);
      input.min = String(-most); input.max = String(most); input.value = String(px); out.textContent = signed(px);
    };
    now();
    input.addEventListener('input', () => { maker.setLift(k, +input.value / (p.size || 120)); out.textContent = signed(+input.value); v.resized(); });
    return { now, row: h('div', { class: 'rng lift', 'data-lift-row': k }, h('span', {}, LABEL[k]), input, out) };
  });

  /* Her on a wall and under a ceiling, in the art she'd have there, as the screen draws it: against a
     wall on her left, facing it, and hanging from the ceiling. Each moves by its own lift. */
  const side = (k: 'wall' | 'ceiling', pose: 'wall' | 'hang', words: string) => {
    const slot = slotOf(p, pose) as Showing, drawn = drawArt(slot), H = 112, W = 128, EDGE = 14;
    const box = h('div', { class: 'box' }, h('i', { class: k, 'aria-hidden': 'true' }), drawn.el);
    const el = h('figure', { class: 'side', 'data-s': k }, box, h('figcaption', {}, words));
    faceWall(drawn.el, p, k, slot);
    return {
      el, place() {
        const b = drawn.size(H - EDGE - 8, W - EDGE - 8), px = Math.round(liftAt(p, k, b, slot.scale) * 10) / 10;
        drawn.el.style.left = `${k === 'wall' ? EDGE : (W - b.w) / 2}px`;
        drawn.el.style.top = `${k === 'wall' ? (H - b.h) / 2 : EDGE}px`;
        drawn.el.style.translate = !px ? '' : k === 'wall' ? `${px}px 0px` : `0px ${px}px`;
      }
    };
  };
  const sides = [side('wall', 'wall', 'On a wall'), side('ceiling', 'hang', 'On a ceiling')];

  const faces = (['left', 'right'] as const).map(f => button(f === 'left' ? '◀ Left' : 'Right ▶', () => maker.setFaces(f), { role: 'radio', 'aria-checked': String((p.faces || 'right') === f), 'data-faces': f, 'data-k': `faces-${f}` }));

  const theme = readTheme(v.io.store);
  const pickTheme = (t: Theme) => { showTheme(t); saveTheme(v.io.store, t); v.drawBoard(); };
  const world = h('section', { class: 'kit-part world' });
  v.io.worldSettings?.(world);

  const form = h('aside', { class: 'strip look-form' },
    h('label', { class: 'fld' }, h('span', {}, 'Name'), name),
    h('div', { class: 'fld' }, h('span', {}, 'Art faces'), h('div', { class: 'choice', role: 'radiogroup', 'aria-label': 'Art faces' }, ...faces)),
    h('div', { class: 'fld' }, h('span', {}, 'Size on your screen'), h('div', { class: 'rng wide' }, size, sizeOut)),
    h('div', { class: 'fld' }, h('span', {}, 'Lift, for every pose'), ...lifts.map(l => l.row),
      h('p', { class: 'cap' }, 'How far she stands off the floor, out from walls, and down from ceilings. Below 0 sinks her in. The floor line under her main image and the two pictures below it show each. A pose on the floor can add its own Lift in the tray.')),
    h('div', { class: 'fld' }, h('span', {}, 'Match art'),
      h('div', { class: 'row' }, button('Match sizes to main image', () => void v.busy(() => maker.matchSizes()), { class: 'btn sm', 'data-match': true, 'data-k': 'match' })),
      h('p', { class: 'cap' }, "Rescales every pose so the body is the size it is in the main image. Fine-tune any pose with its Scale slider.")),
    h('div', { class: 'fld' }, h('span', {}, 'This window'),
      h('div', { class: 'choice', role: 'radiogroup', 'aria-label': 'Theme' },
        ...(['dark', 'light'] as const).map(t => button(t === 'dark' ? 'Dark' : 'Light', () => pickTheme(t), { role: 'radio', 'aria-checked': String(theme === t), 'data-theme-choice': t, 'data-k': `theme-${t}` })))),
    v.io.worldSettings ? world : null);

  /* A buddy made of one image is complete, and this is why. */
  const standsIn = cellsOf(p, POSES.map(x => x.key)).filter(c => c.slot.from === null).flatMap(c => c.keys);
  const left = h('div', { class: 'page look-art' },
    stage,
    h('div', { class: 'row' }, button('Change main image', () => v.pickers.open('main'), { class: 'btn sm go', 'data-change-main': true, 'data-k': 'change-main' })),
    h('p', { class: 'cap' }, sized, ' Drop a picture on it to change it, or paste one.'),
    h('div', { class: 'sides' }, ...sides.map(s => s.el)),
    standsIn.length ? h('div', { class: 'spare' }, 'Also stands in for:', ...standsIn.map(k => button(label(k), () => v.pick({ pose: k }), { 'data-art': k, 'data-k': `stands-${k}` }))) : null);
  const spread = h('div', { class: 'spread' }, left);
  spread.append(createDivider(v, left, spread, 'look', .52, 'Share the width between the picture and its settings'), form);
  board.replaceChildren(head, spread);
  fit();
  return { fit };
}
