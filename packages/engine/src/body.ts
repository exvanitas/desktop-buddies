/* The body: where a buddy is, what it stands on, and how it gets from one surface to the next. */
import type { Bounds, Point, Rectangle, Surface } from '@buddies/terrain';
import { aims, gripAt, plan, type Aim, type Jumper, type Plan } from './aim';
import { norm } from './ease';
import type { Arg, Place } from './runner';
import { GRAB_SPEED, GRAV, type Character, type PetState } from './state';
import type { Tools } from './tools';
import type { Voice } from './voice';
import type { WorldState } from './world';

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
/* A throw this hard (px per frame, up or down) breaks through one floor or ceiling, where a stacked monitor is beyond it. */
const BREAK_VY = 26;
export const breaks = (vy: number, k: number) => Math.abs(vy) > BREAK_VY * k;

export function createBody(world: WorldState, me: Character, P: PetState, { between, pick, span }: Tools, { say, line }: Voice, emit: (event: string, arg?: Arg) => void) {
  const { random, terrain, pace } = world, { reach } = pace;
  /* a surface, and the footing on it, for code that runs only when there is one */
  const onSurface = () => P.on!;

  /* main-image dimensions drive physics so swapping poses doesn't jitter */
  const bw = (k = P.k) => (me.data.base.bb.x1 - me.data.base.bb.x0) * me.size * k;
  const bh = (k = P.k) => (me.data.base.bb.y1 - me.data.base.bb.y0) * me.size * k;
  const wallExt = (k = P.k) => Math.max(bw(k), bh(k)) / 2 + 2 * k;

  /* ---------- footing ---------- */
  const len = (s: Surface) => s.to - s.from;
  const here = () => P.on ? P.on.surface : null;
  function settle() { const on = onSurface(), p = terrain.pointOn(on.surface, on.t); P.x = p.x; P.y = p.y; }
  function stick(s: Surface, t: number) { P.on = { surface: s, t }; P.pierce = false; P.bound = null; P.aim = null; settle(); }
  const zone = () => (terrain.rectById(P.home) || terrain.home(P)).rect;
  const floorY = () => { const s = here(), r = zone(); return s && s.kind === 'floor' ? s.at : r.y + r.h; };
  /* Which end of `b` joins `a`: true for its from end. */
  const entersLow = (a: Surface, b: Surface) => b.prev === a.id;
  const linkAt = (s: Surface, low: boolean) => terrain.surfaceById(low ? s.prev : s.next);
  /* Past the end of a surface with the same kind beyond it: carry on along that one. */
  function cross(s: Surface, low: boolean) {
    const b = linkAt(s, low)!, t = onSurface().t;
    stick(b, low ? len(b) + t : t - len(s));
  }

  /* Her body there is behind a window in front of hers, at the size she is on that spot's monitor. */
  const behind = (s: Surface, t: number) => terrain.behind(s, terrain.pointOn(s, t), { side: bw() / 2, up: bh(), k: P.k });
  /* Where she'll be held on s, placed for her size. On a window the spot can be on another monitor,
     so it's placed again for her size there, and that monitor is the one footing will find. */
  function spot(s: Surface, place: (k: number) => number) {
    let t = place(P.k);
    if (!onWindow(s)) return { t, screen: null };
    const there = terrain.home(terrain.pointOn(s, t));
    if (there.scale !== P.k) t = place(there.scale);
    return { t, screen: terrain.home(terrain.pointOn(s, t)) };
  }
  type Spot = ReturnType<typeof spot>;
  /* Held there, at her size there: what was checked is what she gets. */
  function hold(s: Surface, at: Spot) { stick(s, at.t); if (at.screen) { P.home = at.screen.id; P.k = at.screen.scale; } }
  /* A step into a stretch that's behind a window doesn't happen. She turns back, as at a cut end. */
  function blocked(was: number) {
    const on = onSurface();
    if (!behind(on.surface, on.t)) return false;
    on.t = was; P.dir = -P.dir; /* she's still where footing settled her */
    return true;
  }
  /* Where she comes out round a corner from a onto b: all of her on it, just past the end. */
  const rounded = (a: Surface, b: Surface) => spot(b, k => { const m = b.kind === 'floor' ? bw(k) / 2 : wallExt(k); return entersLow(a, b) ? m : len(b) - m; });
  /* Nor is a corner taken onto a stretch behind a window: she turns back short of it. */
  function corner(a: Surface, b: Surface) {
    const at = rounded(a, b);
    if (!behind(b, at.t)) return at;
    P.dir = -P.dir;
    return null;
  }

  /* How far along it is and how long it is: this surface, or the screen when in mid-air. */
  function stretch() { const s = here(), r = zone(); return s ? { t: onSurface().t, len: len(s) } : { t: P.x - r.x, len: r.w }; }
  /* walk along floor; returns at walls. True when a window in front turned her back. */
  function move(dt: number, v: number, wantWall?: boolean) {
    if (!P.on) return false;
    const on = onSurface(), s = on.surface, m = bw() / 2, long = len(s), was = on.t;
    on.t += P.dir * (v * P.k) * dt;
    if (blocked(was)) return true;
    if (on.t < m || on.t > long - m) {
      const t = clamp(on.t, m, long - m), low = t < long / 2, end = linkAt(s, low);
      if (end && end.kind === s.kind) { if (on.t < 0 || on.t > long) cross(s, low); else settle(); return; }
      /* An open end: past it the next check finds nothing underfoot. A window's is where it was cut
         off at the monitor, and past that she'd be off every screen, so she turns back. */
      if (!end && !onWindow(s)) return settle();
      on.t = t; settle();
      if (!end) { P.dir = -P.dir; return; }
      if ((P.state === 'walk' || P.state === 'run') && onWindow(s) && random() < pace.weights.edgeLeap!) { P.dir = low ? -1 : 1; return leapOff(); }
      if (wantWall || (P.state === 'walk' && random() < .2)) return !mountWall(s, end);
      P.dir = -P.dir;
    } else settle();
    return false;
  }
  /* How long she's drawn going round a corner, or turning onto what she caught, in frames: from
     facing off one surface to the next, round the corner point. Where she is changes at once. */
  const ROUND = 12;
  function turning(s: Surface, b: Surface) {
    const low = entersLow(s, b), ang = (n: Point) => Math.atan2(n.y, n.x) * 180 / Math.PI;
    /* An inner corner: past it, b runs on towards s's open side. */
    const on = b.kind === 'wall' ? { x: 0, y: low ? 1 : -1 } : { x: low ? 1 : -1, y: 0 };
    P.ease = { n: ROUND, corner: {
      pivot: terrain.pointOn(b, low ? 0 : len(b)), wind: Math.sign(norm(ang(b.normal) - ang(s.normal))),
      na: s.normal, nb: b.normal, inner: on.x * s.normal.x + on.y * s.normal.y > 0
    } };
  }
  /* Up onto a wall from a floor, unless that's behind a window. True when she went. */
  function mountWall(s: Surface, w: Surface) {
    const at = corner(s, w); if (!at) return false;
    const low = entersLow(s, w);
    hold(w, at); turning(s, w);
    if (random() < .4) say(line('climb'));
    emit('wall', { dir: low ? 1 : -1 });
    return true;
  }
  /* Go round a corner onto the next surface, unless that's behind a window. */
  function round(s: Surface, b: Surface) {
    const at = corner(s, b); if (!at) return;
    const low = entersLow(s, b);
    hold(b, at); turning(s, b);
    if (b.kind === 'wall') return emit('wall', { dir: low ? 1 : -1 });
    P.dir = low ? 1 : -1;
    emit(b.kind === 'ceil' ? 'ceiling' : 'floor');
  }
  /* Step off a wall, into the open in front of it. */
  function offWall(s: Surface) { P.x = s.at + s.normal.x * (bw() / 2); P.y += bh() / 2; }
  /* Off a wall or the ceiling into the air, she's drawn turning upright over a few frames, clear of it. */
  function leaving(s: Surface | null) { if (s && s.kind !== 'floor') P.ease = { n: ROUND, away: { n: s.normal, p: terrain.pointOn(s, 0) } }; }
  function leap() { const s = here()!, n = s.normal.x; leaving(s); P.on = null; offWall(s); P.vx = n * between(3, 5) * P.k; P.vy = -between(2, 5) * P.k; P.thrown = P.catches = false; P.dir = n; emit('airborne'); }
  function dropDown() {
    const s = here(); leaving(s);
    if (s && s.kind === 'ceil') { P.y = s.at + bh(); } else if (s && s.kind === 'wall') offWall(s);
    P.on = null; P.vx = 0; P.vy = 0; P.thrown = P.catches = false; P.hard = false;
    if (random() < .6) say(line('drop'));
    emit('airborne');
  }
  /* The stacked monitor under this floor, and over the ceiling above. */
  function floorBelowMe() { const s = here(); return s && s.kind === 'floor' ? terrain.across(s, P.x) : null; }
  function roofOverMe() { const s = here(), c = s && s.kind === 'floor' ? terrain.ceilingAbove(P) : null; return c ? terrain.across(c, P.x) : null; }
  /* The trips between stacked monitors: through this floor, or up through the ceiling and onto
     the floor above it. */
  function dropThrough() {
    if (!floorBelowMe()) return;
    P.on = null; P.vx = 0; P.vy = 2 * P.k; P.thrown = P.catches = false; P.hard = false; P.pierce = true;
    if (random() < .6) say(line('drop'));
    emit('airborne');
  }
  function jumpThrough() {
    const n = roofOverMe(); if (!n) return;
    const rise = P.y - (n.rect.y + n.rect.h) + bh() + 60 * P.k;
    jump(-Math.sqrt(2 * GRAV * P.k * rise), 0);
    P.pierce = true;
  }
  /* Does this floor or ceiling give way? Only for something meaning to go through, and only once. */
  function gives(s: Surface) {
    if (!P.pierce) return false;
    const n = terrain.across(s, P.x); if (!n) return false;
    P.pierce = false; P.bound = { id: n.id, up: s.kind === 'ceil' };
    return true;
  }
  function jump(vy: number, vx: number) { P.on = null; P.vy = vy; P.vx = vx; P.thrown = P.catches = false; P.hard = false; emit('airborne'); }

  /* ---------- homing jumps ---------- */
  const onWindow = (s: Surface) => terrain.rectById(s.owner)!.kind === 'window';
  /* Her, as a jump is worked out: only from a floor. */
  function jumper(): Jumper | null { const s = here(); return s && s.kind === 'floor' ? { x: P.x, y: P.y, k: P.k, side: bw() / 2, up: bh(), ext: wallExt(), zone: zone(), on: s, turn: searches, reach } : null; }
  /* One buddy plans a tick, across the sim: the rest go without till the next. A plan lasts the
     tick, so the move a pick chooses doesn't search again. */
  const free = () => world.planned !== world.tick;
  let mine: (Plan & { tick: number }) | null = null, searches = 0;
  function options(): Plan {
    if (mine && mine.tick === world.tick) return mine;
    const j = jumper(); if (!j || !free()) return { hops: [], walks: [] };
    world.planned = world.tick; searches++;
    mine = { ...plan(terrain, j), tick: world.tick };
    return mine;
  }
  const hops = () => options().hops;
  const walks = () => options().walks;
  /* Off she goes, on the arc she worked out. Nothing steers her after this. */
  function launch(a: Aim) { jump(a.vy, a.vx); P.dir = a.vx < 0 ? -1 : 1; P.aim = a; owed = 0; }
  function hopFrom(all: Aim[]) {
    if (!all.length) return false;
    const tops = all.filter(a => a.way === 'top'), sides = all.filter(a => a.way === 'side');
    launch(pick(sides.length && (!tops.length || random() < pace.weights.hopSide!) ? sides : tops));
    return true;
  }
  /* The window a walk was for, from the spot she walked to. */
  function hopFor(owner: string) { const j = jumper(); world.planned = world.tick; return !!j && hopFrom(aims(terrain, j, owner)); }
  /* One of the nearest windows out of reach, and the spot on this surface to jump for it from. */
  function setOff() { const all = walks().sort((a, b) => Math.abs(a.t - onSurface().t) - Math.abs(b.t - onSurface().t)); P.spot = all.length ? pick(all.slice(0, 3)) : null; }
  /* Off the end of a window top, hard enough to clear it before she's back down to its height. */
  function leapOff() {
    const k = P.k, vy = span(reach.leapUp) * k, frames = 2 * vy / (GRAV * k) - 2;
    jump(-vy, P.dir * Math.max(span(reach.leapOut) * k, (bw() / 2 + 4 * k) / Math.max(1, frames)));
  }

  /* How many times she's been put somewhere rather than gone there: a drawing doesn't carry across. */
  let placed = 0;
  /* The one way to lose your footing, whatever took the ground away. */
  function fall() { leaving(here()); P.on = null; P.vx = 0; P.vy = 0; P.thrown = P.catches = false; P.hard = false; emit('lost'); }
  /* Nothing below and nowhere to land: back above the nearest screen, and let it fall. */
  function recover() {
    placed++;
    const home = terrain.nearest(P), r = home.rect;
    P.home = home.id; P.k = home.scale; P.on = null;
    P.x = clamp(P.x, r.x + bw(), r.x + r.w - bw()); P.y = r.y - bh();
    P.vx = 0; P.vy = 0; P.thrown = P.catches = false; P.hard = false; P.aim = null; P.next = null; P.pierce = false; P.bound = { id: home.id, up: false };
    P.ease = { n: 0 };
    emit('lost');
  }
  /* A carried buddy keeps its grip only so far. These are per 40 ms tick, in px. */
  const GRIP = { side: 80, down: 20, up: 80, wall: 80 };
  function slipped(s: Surface, dx: number, dy: number, dt: number) {
    const f = dt * 16.667 / 40 * P.k;
    if (s.kind === 'wall') return Math.abs(dx) >= GRIP.wall * f || Math.abs(dy) >= GRIP.wall * f;
    return Math.abs(dx) >= GRIP.side * f || dy > GRIP.down * f || -dy > GRIP.up * f;
  }
  /* Carry, grip, check: runs before the state, every tick. */
  function footing(dt: number) {
    const held = P.state === 'held', at = held ? { x: P.hx, y: P.hy } : P;
    if (!held && !terrain.rectById(P.home)) return recover();
    const rect = P.on ? terrain.rectById(P.on.surface.owner) : null;
    const home = rect && rect.kind === 'screen' ? rect : terrain.home(at);
    P.home = home.id; P.k = home.scale;
    if (!P.on) return;
    const s = terrain.surfaceById(P.on.surface.id);
    if (!s) return fall();
    const x = P.x, y = P.y;
    P.on.surface = s; settle();
    const movable = rect!.kind === 'window', t = P.on.t;
    if (movable && slipped(s, P.x - x, P.y - y, dt)) { P.x = x; P.y = y; return fall(); }
    /* Carried onto another monitor, she's the size she is there. */
    if (movable) { const there = terrain.home(P); P.home = there.id; P.k = there.scale; }
    if ((t < 0 && (movable || !s.prev)) || (t > len(s) && (movable || !s.next)) || behind(s, t)) fall();
  }

  /* Where a screen's walls and ceiling leave a body that went past them. */
  const inside = (r: Bounds, m: number, h: number, p: Point = P) => ({ x: clamp(p.x, r.x + m, r.x + r.w - m), y: Math.max(p.y, r.y + h) });
  /* On the way to a screen until inside it, or until a rise runs out of height: whether that's over,
     and her home for the step. */
  function bound(from: Point) {
    const aim = P.bound && terrain.rectById(P.bound.id);
    const over = !aim || terrain.holds(aim.rect, from) || (P.bound!.up && P.vy >= 0);
    return { over, passing: !over, home: over ? terrain.home(from) : aim! };
  }

  /* A step of flight from `from` to `to` by the edges it meets: where it leaves her, and what it met.
     The one rule for a whole step and for where she's drawn partway through one. It changes nothing:
     what meeting an edge does to her is the step's own. */
  function resolve(from: Point, to: Point, vy: number, passing: boolean, home: Rectangle) {
    const m = bw() / 2, h = bh(), body = { side: m, up: h, k: P.k };
    let x = to.x, y = to.y, pierce = P.pierce;
    /* A window edge is met where the path first crosses one. Screen edges keep today's order. */
    const swept = passing ? null : terrain.sweep(from, to, { box: body });
    const edge = swept && swept.surface.kind !== 'floor' ? terrain.rectById(swept.surface.owner)! : null;
    /* A screen wall or ceiling puts her back after the path was swept: for windows, the path ends where it leaves her. */
    const first = edge && edge.kind === 'screen' ? terrain.sweep(from, inside(edge.rect, m, h, to), { box: body, only: 'window' }) || swept : swept;
    const win = first && terrain.rectById(first.surface.owner)!.kind === 'window' ? first : null;
    if (win) { x = win.x; y = win.y; }
    const meet = (kind: Surface['kind']) => win ? (win.surface.kind === kind ? win.surface : null) : terrain.contact(kind, from, { x, y }, body, home, passing);
    /* a floor or ceiling she's meant to go through, once, as `gives` lets her */
    const through = (s: Surface) => { if (!pierce || !terrain.across(s, x)) return false; pierce = false; return true; };
    const wall = meet('wall');
    if (wall) x = terrain.rectById(wall.owner)!.kind === 'screen' ? inside(terrain.rectById(wall.owner)!.rect, m, h, { x, y }).x : wall.at + wall.normal.x * m;
    const ceil = vy < 0 ? meet('ceil') : null;
    if (ceil && !through(ceil)) y = ceil.at + h;
    const floor = meet('floor');
    if (floor && !through(floor)) y = terrain.pointOn(floor, x - floor.from).y;
    return { x, y, win, wall, ceil, floor };
  }

  function airTick(dt: number) {
    const k = P.k, from = { x: P.x, y: P.y };
    if (terrain.lost(from)) return recover();
    const { over, passing, home } = bound(from);
    if (over) P.bound = null;
    P.vy += GRAV * k * dt; P.x += P.vx * dt; P.y += P.vy * dt;
    const h = bh(), speed = Math.hypot(P.vx, P.vy);
    const { x, win, wall, ceil, floor } = resolve(from, P, P.vy, passing, home);
    if (win) { P.x = win.x; P.y = win.y; }
    if (wall) {
      const at = spot(wall, k => gripAt(wall, P.y - bh(k) / 2, wallExt(k)));
      P.x = x;
      /* No grab where she'd be held behind a window, wherever she met it. */
      if ((P.aim?.way === 'side' || (P.catches && Math.abs(P.vx) > 3 * k)) && speed < GRAB_SPEED * k && P.y < wall.to - h * .3 && !behind(wall, at.t)) {
        hold(wall, at); P.ease = { n: ROUND };
        P.thrown = P.catches = P.hard = false; P.vx = P.vy = 0; say(line('grab')); return emit('grabbedWall');
      }
      if (speed >= GRAB_SPEED * k) { say(line('hurt')); P.hard = true; }
      P.vx = -P.vx * .35;
    }
    if (ceil && !gives(ceil)) {
      const at = spot(ceil, k => gripAt(ceil, P.x, wallExt(k)));
      if (P.catches && P.vy < -5 * k && !behind(ceil, at.t)) { hold(ceil, at); P.ease = { n: ROUND }; P.dir = P.vx >= 0 ? 1 : -1; P.thrown = P.catches = P.hard = false; P.vx = P.vy = 0; say(line('grab')); return emit('grabbedCeiling'); }
      P.y = ceil.at + h; P.vy = -P.vy * .3;
    }
    if (floor && !gives(floor)) {
      /* Let go with her feet under it, she's on it at once, and drawn rising to it: 10 px a frame
         on average, over 6 to 20 frames. */
      const under = from.y - floor.at;
      hold(floor, spot(floor, () => P.x - floor.from));
      /* Landed before a turn off a wall or the ceiling was drawn at all, a long tick say: it never
         starts, as it would have ended on landing. */
      if (P.ease && P.ease.away) P.ease = null;
      if (under > 1) P.ease = { n: clamp(under / (10 * k), 6, 20) };
      const vy = P.vy; P.vx = P.vy = 0;
      if (P.hard) { P.hard = P.thrown = P.catches = false; P.next = null; P.impact = vy; say(line('hurt')); return emit('slammed'); }
      P.thrown = P.catches = false;
      emit('landed', { big: vy > 14 * k });
    }
  }

  /* An aimed flight runs in the whole frames it was planned in, whatever the ticks, so the arc she
     flies is the arc that was flown ahead of time. Anything else takes the tick as it comes. */
  let owed = 0;
  function fly(dt: number) {
    if (!P.aim) return airTick(dt);
    owed += dt;
    while (owed >= 1 && P.aim) { owed -= 1; airTick(1); }
  }
  /* Where she's drawn. In an aimed flight, on along her arc by the part of a frame the tick has run
     past its last whole one, so a tick that runs no frame, as one in about 25 at the desktop's 16 ms
     does, still shows her moving. That part of the step is resolved by the rule the whole step will
     be, so a window that moved or closed under her can't put her past what stops her, and along an
     edge she slides on as the step will slide her. */
  function drawnAt(): Point {
    if (!P.aim || P.on) return P;
    const vy = P.vy + GRAV * P.k, to = { x: P.x + P.vx * owed, y: P.y + vy * owed }, { passing, home } = bound(P);
    const { x, y } = resolve(P, to, vy, passing, home);
    return { x, y };
  }

  /* The world changed. A plan from before it is about windows that may be gone. A screen changed
     size: stay on its surface, in reach. Windows carry their buddies instead. */
  /* A monitor that moved, changed size or scale, or came or went. */
  const monitors = () => terrain.screens().map(r => `${r.id} ${r.rect.x} ${r.rect.y} ${r.rect.w} ${r.rect.h} ${r.scale}`).sort().join();
  let seen = monitors();
  function fit() {
    mine = null;
    /* What was being drawn was worked out on the old monitors: she's drawn where she is. */
    const now = monitors(); if (now !== seen) { seen = now; P.ease = { n: 0 }; }
    if (!P.on) return;
    const s = terrain.surfaceById(P.on.surface.id), rect = s && terrain.rectById(s.owner);
    if (!s || rect!.kind !== 'screen') return;
    const m = s.kind === 'floor' ? bw() / 2 : wallExt();
    P.on = { surface: s, t: clamp(P.on.t, m, len(s) - m) }; settle();
  }

  const moves: Record<string, () => void> = {
    dropDown, leap, dropThrough, jumpThrough,
    hop() { hopFrom(hops()); },
    leapOff() { const s = here(); if (s && s.kind === 'floor' && onWindow(s)) leapOff(); },
    jump() { jump(-between(10, 14) * P.k, P.dir * between(1, 3) * P.k); },
    /* a leap, not a throw: it shows Jump and Fall, and catches what it meets as a throw does */
    ceilGo() { P.dir = random() < .5 ? -1 : 1; const c = terrain.ceilingAbove(P), top = c ? c.at : zone().y; jump(-Math.sqrt(2 * GRAV * P.k * (P.y - top)) * 1.08, P.dir * between(.5, 1.5) * P.k); P.catches = true; },
    drop() {
      if (P.surf === 'floor') { const r = zone(); P.on = null; P.bound = { id: P.home, up: false }; P.y = r.y - bh() * .2; P.x = clamp(P.x, r.x + bw(), r.x + r.w - bw()); P.vx = 0; P.vy = 0; P.thrown = P.catches = P.hard = false; emit('airborne'); }
      else if (P.surf !== 'air') dropDown();
    }
  };

  const place = (): Place => { const s = P.surf; return s === 'left' || s === 'right' ? 'wall' : s; };
  /* Brought to the screen under a point, from wherever she was: just over its top at that x, falling
     with nothing thrown and nothing waiting for her landing. */
  function bring(at: Point) {
    placed++;
    const home = terrain.home(at), r = home.rect;
    P.home = home.id; P.k = home.scale; P.on = null; P.bound = { id: home.id, up: false };
    P.x = clamp(at.x, r.x + bw(), r.x + r.w - bw()); P.y = r.y - bh() * .2;
    P.vx = 0; P.vy = 0; P.thrown = P.catches = false; P.hard = false; P.aim = null; P.next = null; P.pierce = false;
    P.ease = { n: 0 };
    emit('airborne');
  }
  /* A new buddy arrives above the primary screen. */
  function arrive() {
    const home = terrain.primary(); P.home = home.id; P.k = home.scale; P.bound = { id: home.id, up: false };
    P.x = home.rect.x + home.rect.w * between(.25, .75); P.y = home.rect.y - between(0, 200) * P.k; P.vy = 2 * P.k;
  }

  return {
    moves, arrive, bring, place, footing, fit, fly, drawnAt, hops, walks, free, hopFor, setOff, placed: () => placed,
    bw, bh, wallExt, here, onSurface, settle, blocked, len, linkAt, cross, round, zone, floorY, stretch, move, jump,
    stackedBelow: floorBelowMe, stackedAbove: roofOverMe
  };
}
export type Body = ReturnType<typeof createBody>;
