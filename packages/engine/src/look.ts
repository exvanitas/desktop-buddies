/* The look: which art shows, how it's placed, and the frame a view is given. */
import { POSE, hasArt, type ContentBox, type Frame as ImageFrame, type Lift, type PoseKey } from '@buddies/buddy-file';
import type { SurfaceKind } from '@buddies/terrain';
import { ANIMS } from './anims';
import type { Body } from './body';
import type { Character, PetState } from './state';
import { BUBBLE, bubbleSize, type Voice } from './voice';
import type { ParticleKind, ParticleOptions, PetFrame, Viewport, WorldState } from './world';

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
  const drawn = { px: 0, size: null as string | null, ox: 0, oy: 0, cx: 0, ay: 0, origin: null as string | null, body: null as string | null, src: null as string | null, grab: false };
  const tag = { text: '', hidden: false, placed: false, x: 0, y: 0 };
  const geo = { cx: 0, cy: 0, ux: 0, uy: -1, ch: 0, cw: 0, top: 0, ext: 0 };
  const cache = new Map<string, Resolved>();

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

  function render(pose: string, anim: string | undefined, once: boolean) {
    const key = pose as PoseKey;
    const r = resolve(key);
    let fi;
    if ((key === 'dragL' || key === 'dragR') && r.exact && r.frames.length === 2) fi = Math.abs(P.swing) > 30 ? 1 : 0;
    else if (once) fi = Math.min(Math.floor(P.t * r.fps / 60), r.frames.length - 1);
    else fi = Math.floor(P.t * r.fps / 60) % r.frames.length;
    const f = r.frames[fi]!;
    drawn.src = f.src;
    const Sz = me.size * r.scale, bb = r.bb;
    const cw = (bb.x1 - bb.x0) * Sz, ch = (bb.y1 - bb.y0) * Sz, cxU = (bb.x0 + bb.x1) / 2 * Sz;
    const A = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, pivot: 0 };
    if (anim) { const fam = FOLLOWS[anim]; ANIMS[anim]!(A, P, fam ? fam.some(k => hasArt(me.data, k)) : r.exact, ch, cw); }

    /* Facing comes from the surface's normal: a wall you lean left on looks the same on any owner. */
    const s = here(), onWall = !!s && s.kind === 'wall', n = onWall ? s.normal.x : 0, k = P.k;
    const at = drawnAt();
    let rot = 0, oy, ox = at.x, oyS = at.y, face = P.dir;
    if (P.state === 'held') { oy = bb.y0 * Sz + ch * .12; ox = P.hx; oyS = P.hy; }
    else if (onWall && r.custom) { oy = (bb.y0 + bb.y1) / 2 * Sz; ox = s.at + n * (cw / 2) * k; face = n > 0 ? -1 : 1; }
    else if (P.surf === 'ceil' && r.custom) { oy = bb.y0 * Sz; }
    else {
      oy = bb.y1 * Sz;
      if (n > 0) { rot = 90; } else if (n < 0) { rot = -90; face = -P.dir; } else if (P.surf === 'ceil') { rot = 180; face = -P.dir; }
    }
    /* Her lift moves the whole drawing along the surface's normal, after everything else: an
       animation turns her where she's drawn. Labels, effects and the hit test all start from here. */
    const lift = s && me.data.lift ? me.data.lift[LIFT_FROM[s.kind]] : 0;
    if (lift) { const off = lift * me.size * k; ox += s!.normal.x * off; oyS += s!.normal.y * off; }
    const flip = face === me.natural ? 1 : -1;
    drawn.px = Sz; drawn.size = Sz + 'px'; drawn.ox = ox; drawn.oy = oyS; drawn.cx = cxU; drawn.ay = oy;
    drawn.origin = `${cxU.toFixed(1)}px ${oy.toFixed(1)}px`;
    drawn.body = `rotate(${rot}deg) translate(${A.dx.toFixed(1)}px,${A.dy.toFixed(1)}px) translateY(${-A.pivot}px) rotate(${A.rot.toFixed(1)}deg) translateY(${A.pivot}px) scale(${(A.sx * flip).toFixed(3)},${A.sy.toFixed(3)})`;
    drawn.grab = P.state === 'held';

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

  /* Project this buddy into a viewport. The strings are the ones render() has always written. */
  const px = (v: number, o: number, s: number) => (v - o) / s;
  function frame(vp: Viewport): PetFrame {
    const s = vp.scale, l = px(drawn.ox, vp.x, s) - drawn.cx, t = px(drawn.oy, vp.y, s) - drawn.ay;
    /* A viewport with a size only shows what reaches it. Every viewport draws a buddy at the same
       apparent size, so it doesn't pop when it crosses between scalings. */
    const off = vp.w !== undefined && (drawn.size === null || l + drawn.px * 1.5 < 0 || l - drawn.px * .5 > vp.w || t + drawn.px * 1.5 < 0 || t - drawn.px * .5 > vp.h!);
    return {
      id: me.data.id, size: drawn.size, src: drawn.src, origin: drawn.origin, body: drawn.body, grab: drawn.grab, off,
      box: { l, t, size: drawn.px, ox: drawn.cx, oy: drawn.ay },
      tf: drawn.size === null ? null : `translate(${l.toFixed(1)}px,${t.toFixed(1)}px)`,
      bubble: { text: bubble.text, ...(bubble.from ? { from: bubble.from } : {}), hidden: bubble.hidden || off, pop: bubble.pop, below: bubble.below, tf: bubble.placed ? `translate(${px(bubble.x, vp.x, s)}px,${px(bubble.y, vp.y, s)}px) ${bubble.below ? 'translate(-50%,0)' : 'translate(-50%,-100%)'}` : null,
        at: bubble.placed ? { x: px(bubble.x, vp.x, s), up: px(bubble.up, vp.y, s), down: px(bubble.down, vp.y, s), her: px(bubble.her, vp.x, s), mid: px(bubble.mid, vp.y, s) } : null },
      tag: { text: tag.text, hidden: tag.hidden || off, tf: tag.placed ? `translate(${px(tag.x, vp.x, s)}px,${px(tag.y, vp.y, s)}px) translate(-50%,0)` : null }
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
