/* A page for the bubble checks: the real engine on one screen, and the real view drawing it into a
   1280 x 720 viewport. `probe` puts a made-up buddy on the floor at x, has her say a line, and draws
   one frame. The browser run measures what the page shows. */
import { createView } from '../../../../packages/view/src/view';
import { BUDDY, screen, world } from '../../../../packages/engine/tests/support';

export interface Probe { size?: number; x?: number; floor?: number; name?: string; from?: string }

(window as unknown as { probe: unknown }).probe = (text: string, o: Probe = {}) => {
  const w = world([screen('s', 0, 0, 1280, o.floor ?? 680)]), pet = w.add(BUDDY('p', { size: o.size ?? 120, name: o.name ?? 'Pet' }));
  if (!w.until(() => pet.P.surf === 'floor' && pet.P.state !== 'land', 2000)) throw new Error('she never landed');
  const on = pet.P.on!, x = o.x ?? 36;
  on.t = x - on.surface.from; pet.P.x = x;
  pet.go('sit'); pet.P.dur = 1e9; pet.P.chatT = 1e9;
  pet.say(text, o.from ?? ''); w.frame();
  const root = document.getElementById('root')!;
  root.replaceChildren();
  const vp = { x: 0, y: 0, scale: 1, w: 1280, h: 720 };
  createView({ root, input: w.sim.input, viewport: vp }).apply(w.sim.frame(vp));
  /* her visible pixels across: the test buddy's art spans .2 to .8 of her box */
  const f = pet.frame(vp);
  return { her: [f.box.l + .2 * f.box.size, f.box.l + .8 * f.box.size] };
};

/* Two monitors, each with its own overlay, as the desktop has them: `side` puts the second right of
   the first or under it. She's on the first at x, says a line, and each overlay draws one frame. For
   each overlay: her visible pixels across, and its bubble's place in that overlay's own pixels, or
   null when it shows none of it. */
(window as unknown as { pair: unknown }).pair = (text: string, x: number, side: 'right' | 'below' = 'right') => {
  const second = side === 'right' ? screen('b', 1280, 0, 1280, 680) : screen('b', 0, 720, 1280, 680);
  const w = world([screen('a', 0, 0, 1280, 680), second]), pet = w.add(BUDDY('p', { name: '' }));
  if (!w.until(() => pet.P.surf === 'floor' && pet.P.state !== 'land', 2000)) throw new Error('she never landed');
  /* the floor under x, the first monitor's or the second's */
  const floor = w.sim.world.terrain.surfaces().find(s => s.kind === 'floor' && s.at === 680 && s.from <= x && x <= s.to)!;
  pet.P.on = { surface: floor, t: x - floor.from }; pet.P.x = x;
  pet.go('sit'); pet.P.dur = 1e9; pet.P.chatT = 1e9;
  pet.say(text); w.frame();
  const root = document.getElementById('root')!;
  root.replaceChildren();
  return [{ x: 0, y: 0 }, side === 'right' ? { x: 1280, y: 0 } : { x: 0, y: 720 }].map(o => {
    const r = document.createElement('div');
    r.style.cssText = `position:absolute;left:${o.x}px;top:${o.y}px;width:1280px;height:720px;overflow:hidden`;
    root.append(r);
    const vp = { x: o.x, y: o.y, scale: 1, w: 1280, h: 720 };
    createView({ root: r, input: w.sim.input, viewport: vp }).apply(w.sim.frame(vp));
    const f = pet.frame(vp), b = r.querySelector<HTMLElement>('.db-bubble')!, q = b.getBoundingClientRect(), s = r.getBoundingClientRect();
    const shown = !b.hidden && getComputedStyle(b).visibility !== 'hidden' && q.right > s.left && q.left < s.right && q.bottom > s.top && q.top < s.bottom;
    const tail = q.left + parseFloat(getComputedStyle(b, '::after').left) - s.left;
    return { her: [f.box.l + .2 * f.box.size, f.box.l + .8 * f.box.size], bubble: shown ? [q.left - s.left, q.top - s.top, q.right - s.left, q.bottom - s.top].map(n => Math.round(n)) : null, tail };
  });
};
