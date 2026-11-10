/* What behaviours set off: effects and small changes, on entry or every tick. */
import type { Actor } from './actor';

export const CUES: Record<string, (c: Actor, dt: number) => void> = {
  thoughtDots(c) { const s = c.size(); c.fx('text', { text: '…', size: c.fxSize(.2), at: .62, ox: s * .25, follow: () => { const h = c.head(.62); return { x: h.x + s * .25 * c.P.k, y: h.y }; }, max: 150, pop: true }); },
  snore(c, dt) { const { P } = c; if ((P.t | 0) % 55 === 0 && P.t - dt < (P.t | 0)) c.fx('text', { text: 'z', size: c.fxSize(.15) + c.random() * 6, at: .45, ox: c.size() * .2, vx: .35, vy: -.55, sway: .4, max: 110, pop: true }); },
  rested(c) { c.P.awake = 0; },
  signatureLine(c) { const own = c.signature(); if (own && own.line) c.say(own.line); },
  startled(c) { c.fx('text', { text: '!', size: c.fxSize(.22), at: .62, vy: -.6, max: 45, pop: true }); c.P.awake = 0; },
  forgiven(c) { c.P.clicks = []; },
  sleepyHeart(c) { c.fx('heart', { size: c.fxSize(.13), at: .5, vy: -1, max: 60, pop: true }); },
  heart(c) { c.fx('heart', { size: c.fxSize(.15), at: .5, vy: -1.2, max: 60, pop: true }); },
  heartBurst(c) { for (let i = 0; i < 7; i++) c.fx('heart', { size: c.fxSize(c.between(.14, .22)), at: .4, vx: c.between(-2.2, 2.2), vy: c.between(-4.6, -2.2), g: .07, max: c.between(60, 95), pop: true }); },
  heartDrift(c, dt) { const s = c.size(); if (c.random() < .05 * dt) c.fx('heart', { size: c.fxSize(.13), at: .5, ox: c.between(-s * .3, s * .3), vy: -1, sway: .3, max: 70, pop: true }); },
  /* a puddle that spreads under the buddy while it cries, then dries up */
  puddle(c) {
    const { P } = c, w = Math.max(30 * P.k, c.bw() * 1.1), h = Math.max(6 * P.k, w * .16);
    c.world.spawn('puddle', P.x, c.floorY() - h / 2 * P.k, { size: w / P.k, h: h / P.k, grow: 220, max: 1e6, k: P.k, follow: () => ({ x: P.x, y: c.floorY() - h / 2 * P.k }), until: () => P.state === 'cry' });
  },
  /* two streams of tears arcing out of the eyes (eyes guessed at ~40% down the face) */
  tears(c, dt) {
    if (c.random() < .55 * dt) {
      const side = c.random() < .5 ? -1 : 1, sz = c.fxSize(.06);
      c.fx('tear', { size: sz, h: sz * 1.33, at: .12, ox: side * c.geo.cw * .17, vx: side * c.between(1, 2.4), vy: c.between(-2.6, -1.2), g: .22, max: 90, orient: true, floor: c.floorY() - 4 * c.P.k });
    }
  },
  angerMark(c) { const { P } = c; c.fx('anger', { size: c.fxSize(.2), max: 170, pop: true, follow: () => { const h = c.head(.55); return { x: h.x + c.size() * .28 * P.k, y: h.y }; }, until: () => P.state === 'angry' }); },
  blush(c) { c.fx('text', { text: '///', size: c.fxSize(.13), max: 160, follow: () => c.head(.15), until: () => c.P.state === 'shy' }); },
  crumbsReady(c) { c.P.crumbT = 10; },
  /* The snack is in the buddy's own art (eat frames), so no prop is drawn here.
     Crumbs come out in little bursts from the middle of the buddy, where the mouth and
     hands usually are on a chibi. Kept generic on purpose: art varies too much to aim at
     the actual mouth. They scatter both ways, land, sit for a moment, then fade. */
  crumbs(c, dt) {
    const { P } = c;
    P.crumbT -= dt;
    if (P.crumbT > 0) return;
    P.crumbT = c.span(c.pace.crumbs);
    const n = 1 + Math.floor(c.random() * 3);
    for (let i = 0; i < n; i++) {
      const side = c.random() < .5 ? -1 : 1;
      c.fx('crumb', { size: c.fxSize(c.between(.022, .04)), at: c.between(-.02, .1), ox: side * c.geo.cw * c.between(.02, .16), vx: side * c.between(.4, 1.8), vy: c.between(-2.4, -.6), g: .25, vr: c.between(-8, 8), max: 110, floor: c.floorY() - 2 * P.k, rest: 40, color: c.pick(['#c78a4a', '#d9a066', '#b5763a', '#e8bd80']) });
    }
  },
  danceNotes(c, dt) {
    const { P } = c, s = c.size();
    if (c.random() < .035 * dt) c.fx('text', { text: c.pick(['♪', '♫']), size: c.fxSize(.17), at: .55, ox: c.between(-s * .4, s * .4), vy: -1, sway: .5, max: 80, pop: true });
    if (Math.floor(P.t / 60) !== Math.floor((P.t - dt) / 60)) P.dir = -P.dir;
  },
  singNotes(c, dt) { const { P } = c; if (c.random() < .03 * dt) c.fx('text', { text: c.pick(['♪', '♫', '♩']), size: c.fxSize(.16), at: .4, ox: P.dir * c.size() * .25, vx: P.dir * .5, vy: -.8, sway: .4, max: 90, pop: true }); },
  stars(c) {
    const { P } = c;
    for (let i = 0; i < 3; i++) c.fx('star', { size: c.fxSize(.12), max: P.dur, ang: i * 2.1, follow: p => { p.ang! += .12; const h = c.head(.55), s = c.size(); return { x: h.x + Math.cos(p.ang!) * s * .3 * P.k, y: h.y + Math.sin(p.ang!) * s * .08 * P.k }; }, until: () => P.state === 'dizzy' });
  }
};
