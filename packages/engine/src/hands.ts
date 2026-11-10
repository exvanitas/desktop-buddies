/* The mouse: pressing, dragging, throwing, rubbing and hovering, as events. */
import { breaks } from './body';
import type { Look } from './look';
import type { PetState } from './state';
import type { Voice } from './voice';
import type { WorldState } from './world';
import type { Arg } from './runner';
import { shakeTracker, type ShakeTracker } from './shake';

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

/* How long a pickup is drawn sliding from where she was pressed to how she's held, in frames. */
const PICKUP = 10;

export function createHands(world: WorldState, P: PetState, { say, line }: Voice, { geo }: Pick<Look, 'geo'>, emit: (event: string, arg?: Arg) => void) {
  const { now, pace } = world;
  let drag: { sx: number; sy: number; moved: boolean; hist: { x: number; y: number; t: number }[]; shake: ShakeTracker } | null = null;
  const rub = { lx: 0, dir: 0, rev: [] as number[], dist: 0 };
  function pressed(x: number, y: number) { drag = { sx: x, sy: y, moved: false, hist: [], shake: shakeTracker() }; }
  function moved(mx: number, my: number) {
    if (drag) {
      /* Drawn first where she was, moved as far as the cursor since the press, so the spot that was
         pressed stays under it, then sliding to the hold. */
      if (!drag.moved && Math.hypot(mx - drag.sx, my - drag.sy) > 5 * P.k) { drag.moved = true; P.next = null; emit('grabbed'); P.ease = { n: PICKUP, by: { x: drag.sx, y: drag.sy } }; }
      if (drag.moved) {
        P.hx = mx; P.hy = my; P.still = 0;
        const t = now(); drag.hist.push({ x: mx, y: my, t });
        if (drag.shake.move(mx, my, t, P.k)) P.shaken = true;
        while (drag.hist.length > 2 && t - drag.hist[0].t > 90) drag.hist.shift();
      }
      return;
    }
    /* rubbing = quick back-and-forth over the buddy */
    const t = now(), dx = mx - rub.lx; rub.lx = mx;
    if (Math.abs(dx) > 1) { const s = Math.sign(dx); if (s !== rub.dir) { rub.dir = s; rub.rev.push(t); } rub.dist += Math.abs(dx); }
    rub.rev = rub.rev.filter(u => t - u < 1300);
    if (rub.rev.length >= 4 && rub.dist > 70) { rub.rev = []; rub.dist = 0; petted(); }
    if (!rub.rev.length) rub.dist = 0;
  }
  function entered() { P.hover = true; }
  function left() { P.hover = false; P.shyDone = false; rub.rev = []; rub.dist = 0; }
  function released() {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) return click();
    const h = d.hist, a = h[0]!, b = h[h.length - 1]!;
    let vx = 0, vy = 0;
    if (h.length > 1 && now() - b.t < 80) { const f = Math.max(1, (b.t - a.t) / 16.667); vx = (b.x - a.x) / f; vy = (b.y - a.y) / f; }
    const k = P.k;
    vx = clamp(vx, -45 * k, 45 * k); vy = clamp(vy, -45 * k, 45 * k);
    const g = geo; // feet below the grab point
    P.x = P.hx; P.y = P.hy + g.ch * .88 * k; P.vx = vx; P.vy = vy;
    const sp = Math.hypot(vx, vy);
    P.thrown = P.catches = sp > 4 * k; P.hard = sp > 26 * k;
    P.pierce = breaks(vy, k); P.bound = null;
    if (P.hard) say(line('drop'));
    emit('released');
  }

  function click() {
    const t0 = now();
    P.clicks = P.clicks.filter(t => t0 - t < 2500); P.clicks.push(t0);
    emit('clicked');
  }
  function petted() {
    if (P.cool > 0 || P.state === 'held') return;
    P.cool = pace.petCool;
    emit('petted');
  }


  /* She breaks free: dropped from the hand, with nothing thrown. */
  function letGo() {
    if (!drag) return;
    drag.hist = [];
    released();
  }
  /* She's taken from the hand: whatever it does next throws nothing. */
  function drop() { drag = null; }
  return { pressed, moved, released, letGo, drop, entered, left, history: () => drag && drag.hist };
}
