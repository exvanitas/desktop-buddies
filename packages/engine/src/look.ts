/* The look: which art shows, how it's placed, and the frame a view is given. */
import { POSE, hasArt, type ContentBox, type Frame as ImageFrame, type Lift, type PoseKey } from '@buddies/buddy-file';
import type { SurfaceKind } from '@buddies/terrain';
import { ANIMS, createHandOn, type Anim } from './anims';
import { eased, norm, swingOf, type Away, type Corner, type Easing, type Size } from './ease';
import type { Body } from './body';
import type { Character, PetState } from './state';
import { BUBBLE, bubbleSize, type Voice } from './voice';
import { bodyOf, type BodyParts, type ParticleKind, type ParticleOptions, type PetFrame, type Viewport, type WorldState } from './world';

/* a pose worked out through its fallbacks */
interface Resolved { key: PoseKey | null; frames: ImageFrame[]; fps: number; scale: number; bb: ContentBox; exact: boolean; custom: boolean }

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
/* A pose under this share of her standing height is down. Seated art measures 62 to 86% of standing,
   chibis highest, and a standing one 95% and up. */
export const DOWN = .9;
const tall = (r: Resolved) => (r.bb.y1 - r.bb.y0) * r.scale;
const DEG = Math.PI / 180;
/* Which of her lift's values holds her away from each kind of surface. Held or in the air she's on nothing. */
export const LIFT_FROM: Readonly<Record<SurfaceKind, keyof Lift>> = { floor: 'floor', wall: 'wall', ceil: 'ceiling' };
/* An animation whose strength follows a family's art, not the frame's pose. The swing takes a quarter
   when any held art is drawn, since drawn art already leans, so it can't jump as the pose crosses
   to a side pose and back. The tumble stops turning her when Roll is drawn, whatever Stand has. */
const FOLLOWS: Readonly<Record<string, readonly PoseKey[]>> = { swing: ['drag', 'dragL', 'dragR'], tumble: ['roll'] };
function union(a: ContentBox | null, b: ContentBox): ContentBox { if (!a) return b; if (!b) return a; return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }; }

export function createLook(world: WorldState, me: Character, P: PetState, { bubble }: Voice, { here, zone, drawnAt }: Pick<Body, 'here' | 'zone' | 'drawnAt'>) {
  /* what the last render worked out, for frames to carry */
  const drawn = { px: 0, size: null as string | null, ox: 0, oy: 0, cx: 0, ay: 0, origin: null as string | null, body: null as string | null, src: null as string | null, grab: false, stage: '', parts: null as BodyParts | null };
  const tag = { text: '', hidden: false, placed: false, x: 0, y: 0 };
  const geo = { cx: 0, cy: 0, ux: 0, uy: -1, ch: 0, cw: 0, top: 0, ext: 0 };
  const cache = new Map<string, Resolved>();
  const handOn = createHandOn();

  /* effect helpers (positions from last render geometry) */
  const head = (k = .3) => ({ x: geo.cx + geo.ux * geo.ch * k * P.k, y: geo.cy + geo.uy * geo.ch * k * P.k });
  const fx = (kind: ParticleKind, o: ParticleOptions & { at?: number; ox?: number; oy?: number }) => { const h = head(o.at == null ? .35 : o.at); o.k = P.k; world.spawn(kind, h.x + (o.ox || 0) * P.k, h.y + (o.oy || 0) * P.k, o); };
  const fxSize = (k: number) => Math.max(12, me.size * k);

  function resolve(key: PoseKey): Resolved {
    if (cache.has(key)) return cache.get(key)!;
    let k: string | null = key, r: Resolved | null = null;
    while (k && k[0] !== '@') {
      const p = me.data.poses && me.data.poses[k as PoseKey];
      if (p && p.frames && p.frames.length) {
        let bb: ContentBox | null = null;
        for (const f of p.frames) bb = union(bb, f.bb);
        r = { key: k as PoseKey, frames: p.frames, fps: p.fps || 6, scale: p.scale || 1, bb: bb!, exact: false, custom: false };
        break;
      }
      const slot: { fb: string | null } | undefined = POSE[k as PoseKey];
      k = slot ? slot.fb : null;
    }
    if (!r) r = { key: null, frames: [me.data.base], fps: 1, scale: 1, bb: me.data.base.bb, exact: false, custom: false };
    r.exact = r.key === key; r.custom = !!r.key;
    cache.set(key, r);
    return r;
  }

  /* `dt`: the world time since the last render, which a hand-on between animations counts down.
     `entry`: which run of a behaviour or clip this is, so starting the same one again hands on too. */
  function render(pose: string, anim: string | undefined, once: boolean, dt = 0, entry = 0) {
    const key = pose as PoseKey;
    const r = resolve(key);
    let fi;
    if ((key === 'dragL' || key === 'dragR') && r.exact && r.frames.length === 2) fi = Math.abs(P.swing) > 30 ? 1 : 0;
    else if (once) fi = Math.min(Math.floor(P.t * r.fps / 60), r.frames.length - 1);
    else fi = Math.floor(P.t * r.fps / 60) % r.frames.length;
    const f = r.frames[fi]!;
    drawn.src = f.src;
    const Sz = me.size * r.scale, bb = r.bb;
    /* Poses line up on the middle of their pictures, as the art pipeline lines them up, so art that
       reaches out to one side doesn't move her body. A main image whose art isn't in the middle of its
       picture moves every pose by as much, so her main image sits where she is (the pipeline's are in
       the middle). On a wall her art's own edge is against it. */
    const cw = (bb.x1 - bb.x0) * Sz, ch = (bb.y1 - bb.y0) * Sz, main = me.data.base.bb;
    let cxU = Sz / 2 + ((main.x0 + main.x1) / 2 - .5) * me.size;
    const A = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, pivot: 0 };
    if (anim) { const fam = FOLLOWS[anim]; ANIMS[anim]!(A, P, fam ? fam.some(k => hasArt(me.data, k)) : r.exact, ch, cw); }

    /* Facing comes from the surface's normal: a wall you lean left on looks the same on any owner. */
    const s = here(), onWall = !!s && s.kind === 'wall', n = onWall ? s.normal.x : 0, k = P.k;
    const at = drawnAt();
    let rot = 0, oy, ox = at.x, oyS = at.y, face = P.dir;
    if (P.state === 'held') { oy = bb.y0 * Sz + ch * .12; ox = P.hx; oyS = P.hy; }
    else if (onWall && r.custom) { cxU = (bb.x0 + bb.x1) / 2 * Sz; oy = (bb.y0 + bb.y1) / 2 * Sz; ox = s.at + n * (cw / 2) * k; face = n > 0 ? -1 : 1; }
    else if (P.surf === 'ceil' && r.custom) { oy = bb.y0 * Sz; }
    else {
      oy = bb.y1 * Sz;
      if (n > 0) { rot = 90; } else if (n < 0) { rot = -90; face = -P.dir; } else if (P.surf === 'ceil') { rot = 180; face = -P.dir; }
    }
    /* Her lift moves the whole drawing along the surface's normal, after everything else: an
       animation turns her where she's drawn. Labels, effects and the hit test all start from here. */
    const lift = s && me.data.lift ? me.data.lift[LIFT_FROM[s.kind]] : 0;
    if (lift) { const off = lift * me.size * k; ox += s!.normal.x * off; oyS += s!.normal.y * off; }
    /* The hand-on settles the animation's own values first, on her surface's frame and facing before
       any easing; then a move being eased draws her middle and whole turn, those final values
       included, from where she was last drawn. Each has its own part, so a turn isn't counted twice. */
    const flip = face === me.natural ? 1 : -1;
    handOn(A, `${entry} ${anim || ''}`, `${r.key} ${P.state === 'held'} ${cxU} ${oy} ${rot} ${k} ${P.placed}`, flip, dt);
    ({ ox, oyS, rot } = moving(ox, oyS, rot, A, { x: (bb.x0 + bb.x1) / 2 * Sz - cxU, y: (bb.y0 + bb.y1) / 2 * Sz - oy }, flip, { w: cw * Math.abs(A.sx) * k, h: ch * A.sy * k, k }));
    drawn.px = Sz; drawn.size = Sz + 'px'; drawn.ox = ox; drawn.oy = oyS; drawn.cx = cxU; drawn.ay = oy;
    drawn.origin = `${cxU.toFixed(1)}px ${oy.toFixed(1)}px`;
    drawn.parts = { turn: rot, dx: A.dx, dy: A.dy, pivot: A.pivot, rot: A.rot, sx: A.sx * flip, sy: A.sy };
    drawn.body = bodyOf(drawn.parts);
    drawn.grab = P.state === 'held';
    drawn.stage = `${P.placed} ${P.state} ${pose} ${entry}`;

    /* geometry for effects & labels */
    const cyRel = ((bb.y0 + bb.y1) / 2 * Sz - oy) * k, a = rot * DEG;
    geo.cx = ox - cyRel * Math.sin(a); geo.cy = oyS + cyRel * Math.cos(a);
    geo.ux = Math.sin(a); geo.uy = -Math.cos(a);
    if (P.state === 'held' || (r.custom && P.surf !== 'floor' && P.surf !== 'air')) { geo.ux = 0; geo.uy = -1; }
    geo.ch = ch; geo.cw = cw;
    const extV = (Math.abs(Math.sin(a)) > .5 ? cw / 2 : ch / 2) * k;
    const top = geo.cy - extV, bottom = geo.cy + extV, z = zone();
    if (!bubble.hidden) {
      /* The first guess, which the view corrects by the bubble's real size. One line of her own keeps
         70 either side of her and 50 above her head. A wider bubble keeps half its width, and each line
         more and an app's badge need their height above. */
      const b = bubbleSize(bubble.text, bubble.from), side = b.lines > 1 || b.badge ? Math.max(70, b.w / 2 + 4) : 70, above = 50 + (b.lines - 1) * BUBBLE.line + (b.badge ? BUBBLE.badge : 0);
      const bx = clamp(geo.cx, z.x + side * k, z.x + z.w - side * k);
      bubble.below = top < z.y + above * k;
      bubble.up = top - 6 * k; bubble.down = bottom + (world.names && me.data.name ? 30 : 8) * k; bubble.her = geo.cx; bubble.mid = geo.cy;
      bubble.x = bx; bubble.y = bubble.below ? bubble.down : bubble.up; bubble.placed = true;
    }
    tag.hidden = !world.names || !me.data.name;
    if (!tag.hidden) { tag.x = clamp(geo.cx, z.x + 40 * k, z.x + z.w - 40 * k); tag.y = Math.min(bottom + 4 * k, z.y + z.h - 20 * k); tag.placed = true; }
  }

  /* Her middle as drawn: the middle of her art, `at` image px from where it's placed, taken through
     the whole drawing: her facing, the animation's own scale, turn and move, and her turn. */
  function middle(ox: number, oyS: number, rot: number, A: Anim, at: { x: number; y: number }, flip: number) {
    const a = A.rot * DEG, b = rot * DEG, x0 = at.x * A.sx * flip, y0 = at.y * A.sy + A.pivot;
    const x1 = x0 * Math.cos(a) - y0 * Math.sin(a) + A.dx, y1 = x0 * Math.sin(a) + y0 * Math.cos(a) - A.pivot + A.dy;
    return { x: ox + (x1 * Math.cos(b) - y1 * Math.sin(b)) * P.k, y: oyS + (x1 * Math.sin(b) + y1 * Math.cos(b)) * P.k };
  }
  /* A move asked for in P.ease, drawn from where she was last drawn: her middle and her whole turn.
     It takes her placement, the animation's final values, where her art's middle is from where it's
     placed and her facing, and gives back the placement to draw with that animation. `size` is her
     drawn box, for keeping it clear of surfaces and on her monitors. */
  let easing: Easing | null = null, turned = 0, drew: { x: number; y: number } | null = null, drewSize: Size | null = null, base: { x: number; y: number } | null = null;
  function moving(ox: number, oyS: number, rot: number, A: Anim, at: { x: number; y: number }, flip: number, size: Size) {
    const ask = P.ease, now = P.awake, to = rot + A.rot, c = middle(ox, oyS, rot, A, at, flip), was = drew || c, wound = to + norm(turned - to); P.ease = null;
    /* A big turn takes longer: 10 degrees a frame on average at most, and round a corner, 20 px a
       frame of the arc her middle swings. */
    const arc = (from: { x: number; y: number }, k: Corner | null) => { if (!k) return 0; const w = swingOf(k, from, c); return Math.abs(w.swing) * DEG * (w.r0 + w.r1) / 2 / P.k; };
    /* Where the surface she's on starts: a window that moves carries a corner's path with it. */
    const origin = () => P.on && world.terrain.pointOn(P.on.surface, 0);
    const start = (from: { x: number; y: number }, n: number, corner: Corner | null, away: Away | null = null): Easing => {
      base = corner && origin();
      return { from: now, n: Math.max(n, Math.abs(wound - to) / 10, arc(from, corner) / 20), rot: wound, c: from, d: { x: from.x - c.x, y: from.y - c.y }, corner: corner && { ...corner, pivot: { ...corner.pivot } }, on: P.on ? P.on.surface.id : null, room: world.terrain.screens().map(r => r.rect), away, size0: drewSize || size };
    };
    /* A move of none is a jump that's meant: she's drawn where she is. Carried by the cursor, she
       starts where she was drawn, moved as far as it has since the press. */
    if (ask && (!ask.n || !drew)) easing = null;
    else if (ask) easing = start(ask.by ? { x: was.x + P.hx - ask.by.x, y: was.y + P.hy - ask.by.y } : was, ask.n, ask.corner || null, ask.away || null);
    /* Come onto a surface the move wasn't heading for, landing say, it ends: she's drawn where she is. */
    else if (easing && P.on && P.on.surface.id !== easing.on) easing = null;
    /* off the surface it was round, the rest of the move is a plain one from where she was drawn */
    else if (easing && easing.corner && !P.on) easing = start(was, easing.n - (now - easing.from), null);
    else if (easing && easing.corner && base) {
      const o = origin()!, dx = o.x - base.x, dy = o.y - base.y;
      if (dx || dy) { easing.corner.pivot.x += dx; easing.corner.pivot.y += dy; easing.c = { x: easing.c.x + dx, y: easing.c.y + dy }; base = o; }
    }
    const e = easing && eased(easing, now, c, to, size);
    drewSize = size;
    if (!e) { easing = null; turned = to; drew = c; return { ox, oyS, rot }; }
    const r = Math.round((e.rot - A.rot) * 100) / 100, off = middle(0, 0, r, A, at, flip);
    turned = e.rot; drew = e.c;
    return { ox: e.c.x - off.x, oyS: e.c.y - off.y, rot: r };
  }

  /* Project this buddy into a viewport. The strings are the ones render() has always written. */
  const px = (v: number, o: number, s: number) => (v - o) / s;
  function frame(vp: Viewport): PetFrame {
    const s = vp.scale, l = px(drawn.ox, vp.x, s) - drawn.cx, t = px(drawn.oy, vp.y, s) - drawn.ay;
    /* A viewport with a size only shows what reaches it. Every viewport draws a buddy at the same
       apparent size, so it doesn't pop when it crosses between scalings. */
    const off = vp.w !== undefined && (drawn.size === null || l + drawn.px * 1.5 < 0 || l - drawn.px * .5 > vp.w || t + drawn.px * 1.5 < 0 || t - drawn.px * .5 > vp.h!);
    return {
      id: me.data.id, size: drawn.size, src: drawn.src, origin: drawn.origin, body: drawn.body, grab: drawn.grab, stage: drawn.stage, parts: drawn.parts, off,
      box: { l, t, size: drawn.px, ox: drawn.cx, oy: drawn.ay },
      tf: drawn.size === null ? null : `translate(${l.toFixed(1)}px,${t.toFixed(1)}px)`,
      bubble: { text: bubble.text, ...(bubble.from ? { from: bubble.from } : {}), hidden: bubble.hidden || off, pop: bubble.pop, below: bubble.below, tf: bubble.placed ? `translate(${px(bubble.x, vp.x, s)}px,${px(bubble.y, vp.y, s)}px) ${bubble.below ? 'translate(-50%,0)' : 'translate(-50%,-100%)'}` : null,
        at: bubble.placed ? { x: px(bubble.x, vp.x, s), up: px(bubble.up, vp.y, s), down: px(bubble.down, vp.y, s), her: px(bubble.her, vp.x, s), mid: px(bubble.mid, vp.y, s) } : null },
      tag: { text: tag.text, hidden: tag.hidden || off || !world.names, tf: tag.placed ? `translate(${px(tag.x, vp.x, s)}px,${px(tag.y, vp.y, s)}px) translate(-50%,0)` : null }
    };
  }


  return {
    geo, head, fx, fxSize, render, frame,
    /* the character changed: art and name start again */
    refresh() { cache.clear(); tag.text = me.data.name || ''; },
    center: () => ({ x: geo.cx, y: geo.cy, s: me.size, k: P.k }),
    /* Is what she shows for this pose, her own art or a fallback's, clearly lower than her standing art? The main image isn't. */
    down(pose: string) { const r = resolve(pose as PoseKey); return !!r.key && tall(r) < DOWN * tall(resolve('stand')); }
  };
}
export type Look = ReturnType<typeof createLook>;
