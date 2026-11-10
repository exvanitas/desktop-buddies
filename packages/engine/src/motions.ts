/* The physics behaviours name. Each is registered here by name, and the runner never needs to know
   them: adding one touches nothing else. */
import type { Actor } from './actor';
import { passEnd, type Motion } from './runner';
import { GRAV } from './state';

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
/* how long she'll stay held still, in frames of world time: 10 seconds */
const STRUGGLE_AFTER = 600;
/* walking and rolling speeds, in px per frame */
const WALK = 1.1, ROLL = 2.8;
/* The pace that takes a wheel `at` px round its rim, `circ` px all round, on to a whole turn in `left`
   frames (this tick's `dt` among them), within half to twice `v`: of those, the one nearest `v`. It
   goes on to the next turn ahead, a whole one when it's upright with time left. Null when no pace
   gets there in time. On her last tick it lands, however slowly. */
export function wheel(at: number, left: number, dt: number, v: number, circ: number): number | null {
  const L = Math.max(left, dt);
  if (!(circ > 0) || !(L > 0)) return v;
  const next = ((-at % circ) + circ) % circ, upright = next < 1e-6 * circ, last = left <= dt + 1e-9;
  if (last) return upright ? 0 : next / L <= 2 * v ? next / L : null;
  const first = upright ? 1 : 0, lo = Math.max(first, Math.ceil((v / 2 * L - next) / circ - 1e-9)), hi = Math.floor((2 * v * L - next) / circ + 1e-9);
  if (lo > hi) return null;
  const k = Math.min(hi, Math.max(lo, Math.round((v * L - next) / circ)));
  return (next + k * circ) / L;
}

export const MOTIONS: Record<string, Motion<Actor>> = {
  walk: {
    start(c, a) { const { P } = c, w = c.stretch(); P.dir = a && a.dir || (w.t < w.len * .2 ? 1 : w.t > w.len * .8 ? -1 : (c.random() < .5 ? -1 : 1)); },
    tick(c, dt) { c.move(dt, WALK * c.P.sp); }
  },
  run: {
    start(c, a) { c.P.dir = a && a.dir || c.P.dir; },
    tick(c, dt) { c.move(dt, 3 * c.P.sp); }
  },
  toWall: {
    start(c) { const w = c.stretch(); c.P.dir = w.t < w.len / 2 ? -1 : 1; },
    /* turned back by a window in front of the way there, or of the wall: she gives the wall up */
    tick(c, dt) { if (c.move(dt, 2.2 * c.P.sp, true)) c.P.dur = 0; }
  },
  /* To a spot she can jump from, and then the jump. She gives up on a spot that's gone, or one a
     window in front turns her back from. */
  toHop: {
    start(c) { c.setOff(); },
    tick(c, dt) {
      const { P } = c, spot = P.spot, on = P.on!, m = c.bw() / 2;
      if (!spot || spot.t < m || spot.t > c.len(on.surface) - m) { P.dur = 0; return; }
      const dx = spot.t - on.t, v = WALK * P.sp;
      if (Math.abs(dx) > v * P.k * dt) { P.dir = Math.sign(dx); if (c.move(dt, v)) P.dur = 0; return; }
      on.t = spot.t; c.settle();
      if (c.free() && !c.hopFor(spot.owner)) P.dur = 0;
    }
  },
  chase: {
    tick(c, dt) {
      const { P } = c, m = c.world.mouse, dx = m.x - P.x, ground = c.floorY(), k = P.k, bw = c.bw(), bh = c.bh();
      /* a window in front of the way to the cursor ends the chase */
      if (Math.abs(dx) > bw * .3) { P.dir = Math.sign(dx); if (c.move(dt, Math.min(3.4, Math.abs(dx) / k * .05 + 1.2) * P.sp)) P.dur = 0; }
      if (Math.abs(dx) < bw * .4 && m.y > ground - bh * 1.4 && m.y < ground + 5 * k) return c.emit('caught');
      if (Math.abs(dx) < bw * .5 && m.y < ground - bh * 1.4 && m.y > c.zone().y && c.random() < .02 * dt) { c.jump(-Math.min(17 * k, Math.sqrt(2 * GRAV * k * (ground - m.y)) + k), 0); P.next = 'chase'; }
    }
  },
  watch: {
    tick(c) { const dx = c.world.mouse.x - c.P.x; if (dx) c.P.dir = Math.sign(dx); }
  },
  /* On her Roll art, which already turns, at her own pace. On Stand, which the tumble turns like a
     wheel, at the pace nearest hers that ends on whole turns, one at least, when the roll really ends
     (its time, stretched to the end of her Stand pass): she lands upright, and turns by just the
     ground she covers. When no pace within half to twice hers gets there (a big buddy, or a turn round
     late in the roll), the roll runs a pass longer, or a turn's time longer without a pass. How much
     longer it may run is set once, on its first tick: a turn's time at her pace, or a pass if that's
     longer. Walls that keep turning her round can't stretch it past that: then she rolls on at her
     pace and the roll ends when its time is up, upright or not. A tick of no time does nothing. */
  roll: {
    start(c) { c.P.roll = 0; c.P.rollBy = NaN; },
    tick(c, dt) {
      if (!(dt > 0)) return;
      const { P } = c, v = ROLL * P.sp, d = P.dir, circ = Math.PI * c.geo.ch, pass = c.loop('stand');
      let w: number | null = v;
      if (!c.hasArt('roll')) {
        if (Number.isNaN(P.rollBy)) P.rollBy = passEnd(P.dur, pass) + Math.max(pass, circ / v);
        for (let i = 0; i < 64; i++) {
          w = wheel(P.roll * d, passEnd(P.dur, pass) - P.t + dt, dt, v, circ);
          const more = pass || circ / v;
          if (w !== null || passEnd(P.dur + more, pass) > P.rollBy + 1e-6) break;
          P.dur += more;
        }
        if (w === null) w = v;
      }
      c.move(dt, w); P.roll += w * dt * d;
    },
    pose: c => c.hasArt('roll') ? 'roll' : 'stand'
  },
  climb: {
    start(c, a) { if (a && a.dir) c.P.dir = a.dir; },
    tick(c, dt) {
      const { P } = c, on = c.onSurface(), s = on.surface, ext = c.wallExt(), was = on.t;
      on.t += P.dir * .85 * P.sp * P.k * dt;
      if (c.blocked(was)) return;
      if (on.t <= ext) {
        const up = c.linkAt(s, true);
        if (up && up.kind === 'wall') { if (on.t < 0) c.cross(s, true); else c.settle(); }
        else {
          on.t = ext; c.settle();
          if (up && c.random() < .65) return c.round(s, up);
          P.dir = 1;
        }
      } else c.settle();
      if (c.onSurface().surface === s && on.t >= c.len(s) - ext) {
        const down = c.linkAt(s, false);
        if (down && down.kind === 'wall') { if (on.t > c.len(s)) c.cross(s, false); }
        else if (down) return c.round(s, down);
        else P.dir = -1;
      }
    }
  },
  crawl: {
    start(c, a) { if (a && a.dir) c.P.dir = a.dir; },
    tick(c, dt) {
      const { P } = c, on = c.onSurface(), s = on.surface, m = c.wallExt(), long = c.len(s), was = on.t;
      on.t += P.dir * .8 * P.sp * P.k * dt;
      if (c.blocked(was)) return;
      if (on.t < m || on.t > long - m) {
        const t = clamp(on.t, m, long - m), low = t < long / 2, end = c.linkAt(s, low);
        if (end && end.kind === s.kind) { if (on.t < 0 || on.t > long) c.cross(s, low); else c.settle(); }
        /* An open end. A window's is where it was cut off at the monitor: past it she'd be off every
           screen, so she turns back, as on a window's top. */
        else if (!end && c.terrain.rectById(s.owner)!.kind === 'window') { on.t = t; c.settle(); P.dir = -P.dir; }
        else if (!end) c.settle();
        else {
          on.t = t; c.settle();
          if (c.random() < .45) return c.round(s, end);
          P.dir = -P.dir;
        }
      } else c.settle();
    }
  },
  air: {
    start(c) { c.P.on = null; },
    tick(c, dt) { c.fly(dt); },
    pose: c => c.P.thrown && c.hasArt('thrown') ? 'thrown' : c.P.vy < 0 ? 'jump' : 'fall'
  },
  held: {
    start(c) { const { P } = c; P.on = null; P.swing = 0; P.swv = 0; P.still = 0; P.shaken = false; P.aim = null; },
    tick(c, dt) {
      const { P } = c, h = c.dragHistory(), n = h && h.length > 1 ? h[h.length - 1]! : null, o = h && h.length > 1 ? h[0]! : null;
      const vx = n ? (n.x - o!.x) / Math.max(1, (n.t - o!.t) / 16.667) : 0;
      const target = clamp(vx / P.k * 2.4, -55, 55);
      P.swv += ((target - P.swing) * .08 - P.swv * .18) * dt; P.swing += P.swv * dt;
      if (P.t > 420 && c.random() < .004 * dt) c.say(c.line('held'));
      /* held still for 10 seconds, or shaken hard, she struggles and breaks free */
      P.still += dt;
      const shaken = P.shaken; P.shaken = false;
      if ((P.still > STRUGGLE_AFTER || shaken) && c.hasArt('struggle')) c.struggle();
    },
    pose: c => c.P.swing > 10 ? 'dragL' : c.P.swing < -10 ? 'dragR' : 'drag'
  }
};
