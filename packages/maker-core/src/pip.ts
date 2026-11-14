/* Pip the chick, the Maker's sample buddy, drawn in code on 300 px paper: her parts, her three views
   (front, back, side), and a picture for every pose slot. Each view keeps her body the size it is in
   her main image, so the art pipeline cuts every pose at her own scale. */
import type { PoseKey, Signature } from '@buddies/buddy-file';
import type { Pen } from './samples';

export type Eye = 'open' | 'sad' | 'angry' | 'wide' | 'closed' | 'happy' | 'tight' | 'x' | 'swirl' | 'half' | 'star' | 'dot';
type Wing = 'up' | 'mid' | 'face' | 'down' | 'high' | 'chin' | 'belly' | 'hold' | 'tuck' | 'droop' | 'reach' | 'tap';
/* Standing feet (a and b lift one), sitting feet, feet tucked into a ball, or legs hanging below her. */
type Feet = 'stand' | 'a' | 'b' | 'sit' | 'tuck' | 'dangle' | 'kickA' | 'kickB' | 'swingA' | 'swingB';
/* Her body's outline: standing, half up, sitting, curled into a ball, or puffed up. */
type Body = 'stand' | 'rise' | 'sit' | 'ball' | 'puff';
/* Things drawn with her, where they'd be on her before she's turned: [kind, x, y, size or angle]. */
type Prop = readonly ['seed' | 'bubble' | 'sweat' | 'star' | 'ripple' | 'lines' | 'z', number, number, number?];

export interface Chick {
  body?: Body; squash?: number; back?: boolean;
  look?: number; lookY?: number; eyes?: Eye; mouth?: 'open' | 'small'; blush?: boolean; tears?: 1 | 2; tuft?: 'up' | 'flat';
  wing?: Wing; wingL?: Wing; wingR?: Wing; feet?: Feet;
  /* the whole drawing: turned (degrees, about the paper's middle), upside down, raised */
  turn?: number; flip?: boolean; lift?: number;
  props?: Prop[];
}
/* Side view, facing right (her "Art faces"), on a wall: where her near and far wing reach, and her feet. */
export interface Side { near: 'up' | 'mid' | 'low'; far: 'up' | 'mid' | 'low'; feet: 'a' | 'b' | 'hold'; eyes?: Eye }

export const INK = '#4a3a2e'; const BODY = '#ffd54d', BELLY = '#fff3b8', WING = '#ffc93c', WING_FAR = '#efb12f', FOOT = '#ff9f43', FOOT_FAR = '#ef8a33', BEAK = '#ff8a2a', BLUSH = '#ff8fa8', EYE = '#3a2b22', WATER = '#7fc8ff';
const DEG = Math.PI / 180;

function ell(x: Pen, cx: number, cy: number, rx: number, ry: number, fill: string | null, rot = 0, stroke = true) { x.beginPath(); x.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2); if (fill) { x.fillStyle = fill; x.fill(); } if (stroke) x.stroke(); }
const width = (x: Pen, w: number, f: () => void) => { const was = x.lineWidth; x.lineWidth = w; f(); x.lineWidth = was; };
const alpha = (x: Pen, a: number, f: () => void) => { x.save(); x.globalAlpha = a; f(); x.restore(); };

/* Her body for each outline: middle, half width, half height, and where standing feet go. Every
   standing outline has its bottom at 270, so her feet stay on the same floor. */
function shape(o: Chick) {
  const s = o.squash || 0;
  switch (o.body) {
    case 'rise': return { cy: 178, rx: 113, ry: 94, fy: 270 };
    case 'sit': return { cy: 193, rx: 116, ry: 88, fy: 273 };
    case 'ball': return { cy: 152, rx: 106, ry: 104, fy: 250 };
    case 'puff': return { cy: 160, rx: 120, ry: 110, fy: 270 };
    default: return { cy: 270 - 102 * (1 - s), rx: 110 * (1 + s), ry: 102 * (1 - s), fy: 270 };
  }
}
type Shape = ReturnType<typeof shape>;

function eye(x: Pen, kind: Eye, cx: number, cy: number, side: number) {
  x.save(); x.lineWidth = 7;
  if (kind === 'open' || kind === 'sad' || kind === 'angry' || kind === 'wide' || kind === 'star') {
    const r = kind === 'wide' ? 1.15 : 1;
    ell(x, cx, cy, 12 * r, 16 * r, EYE, 0, false);
    if (kind === 'star') { x.fillStyle = '#fff'; x.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, d = i % 2 ? 2.4 : 8; x.lineTo(cx - 3 + Math.cos(a) * d, cy - 4 + Math.sin(a) * d); } x.closePath(); x.fill(); }
    else { ell(x, cx - 4, cy - 6, 5, 5, '#fff', 0, false); ell(x, cx + 4, cy + 6, 2.2, 2.2, '#fff', 0, false); }
    if (kind === 'sad') { x.beginPath(); x.moveTo(cx - 16 * side, cy - 30); x.lineTo(cx + 12 * side, cy - 22); x.stroke(); }
    if (kind === 'angry') { x.beginPath(); x.moveTo(cx - 16 * side, cy - 22); x.lineTo(cx + 12 * side, cy - 32); x.stroke(); x.beginPath(); x.moveTo(cx + 14 * side, cy - 30); x.lineTo(cx - 10 * side, cy - 20); x.stroke(); }
  } else if (kind === 'closed') { x.beginPath(); x.arc(cx, cy - 4, 12, .15 * Math.PI, .85 * Math.PI); x.stroke(); }
  else if (kind === 'happy') { x.beginPath(); x.arc(cx, cy + 6, 12, 1.15 * Math.PI, 1.85 * Math.PI); x.stroke(); }
  else if (kind === 'tight') { x.beginPath(); x.moveTo(cx - 12 * side, cy - 9); x.lineTo(cx + 9 * side, cy); x.lineTo(cx - 12 * side, cy + 9); x.stroke(); }
  else if (kind === 'x') { x.beginPath(); x.moveTo(cx - 10, cy - 10); x.lineTo(cx + 10, cy + 10); x.moveTo(cx + 10, cy - 10); x.lineTo(cx - 10, cy + 10); x.stroke(); }
  else if (kind === 'swirl') { x.lineWidth = 5; x.beginPath(); for (let t = 0; t < 14; t += .2) { const r = t * 1.1; x.lineTo(cx + Math.cos(t * side) * r, cy + Math.sin(t * side) * r); } x.stroke(); }
  else if (kind === 'half') { x.fillStyle = EYE; x.beginPath(); x.ellipse(cx, cy + 1, 12, 13, 0, 0, Math.PI); x.closePath(); x.fill(); x.lineWidth = 6; x.beginPath(); x.moveTo(cx - 15, cy + 1); x.lineTo(cx + 15, cy + 1); x.stroke(); }
  else if (kind === 'dot') { ell(x, cx, cy + 2, 8, 9, EYE, 0, false); ell(x, cx - 2, cy - 1, 2.6, 2.6, '#fff', 0, false); }
  x.restore();
}

function wing(x: Pen, w: Wing, sx: number, b: Shape) {
  const k = Math.min(b.rx / 110, 1.06), at = (dx: number, dy: number, rx: number, ry: number, rot: number) => ell(x, 150 + sx * dx * k, b.cy + dy, rx, ry, WING, sx * rot);
  switch (w) {
    case 'up': return at(104, -56, 20, 38, -.75);
    case 'mid': return at(110, -18, 20, 36, -1.2);
    case 'face': return at(52, 0, 22, 30, .4);
    case 'high': return at(98, -84, 18, 38, -.3);
    case 'chin': return at(42, 40, 16, 30, -1.0);
    case 'belly': return at(56, 52, 19, 32, 1.25);
    case 'hold': return at(30, 52, 17, 27, .8);
    case 'tuck': return at(94, 14, 16, 32, .12);
    case 'droop': return at(106, 40, 18, 36, .65);
    case 'reach': return at(84, 4, 24, 36, -.5);
    case 'tap': at(70, 8, 32, 42, -.25); return alpha(x, .55, () => ell(x, 150 + sx * 64 * k, b.cy - 8, 10, 14, '#fff3c4', sx * -.25, false));
    default: return at(100, 22, 20, 36, .35);
  }
}

/* A leg hanging from her hip: its angle from straight down, and how long it looks. */
function leg(x: Pen, hx: number, hy: number, a: number, len: number) {
  const fx = hx + Math.sin(a) * len, fy = hy + Math.cos(a) * len;
  x.beginPath(); x.moveTo(hx, hy); x.lineTo(fx, fy);
  width(x, 14, () => x.stroke());
  x.save(); x.strokeStyle = FOOT; x.lineWidth = 6; x.stroke(); x.restore();
  width(x, 7, () => ell(x, fx + Math.sin(a) * 6, fy + Math.cos(a) * 6, 12, 14, FOOT, -a));
}
const LEGS: Partial<Record<Feet, [number, number, number, number]>> = {
  dangle: [-.12, 40, .12, 40], kickA: [-.55, 36, .18, 40], kickB: [-.18, 40, .55, 36], swingA: [.05, 40, .25, 26], swingB: [-.25, 26, -.05, 40]
};
function feet(x: Pen, f: Feet, b: Shape) {
  const legs = LEGS[f];
  if (legs) { leg(x, 124, b.cy + b.ry - 10, legs[0], legs[1]); leg(x, 176, b.cy + b.ry - 10, legs[2], legs[3]); return; }
  width(x, 7, () => {
    if (f === 'sit') { ell(x, 104, b.fy, 22, 11, FOOT); ell(x, 196, b.fy, 22, 11, FOOT); }
    else if (f === 'tuck') { ell(x, 120, b.cy + b.ry - 8, 17, 9, FOOT); ell(x, 180, b.cy + b.ry - 8, 17, 9, FOOT); }
    else { ell(x, 118, b.fy + (f === 'a' ? -12 : 0), 24, 13, FOOT); ell(x, 182, b.fy + (f === 'b' ? -12 : 0), 24, 13, FOOT); }
  });
}
function tuft(x: Pen, kind: Chick['tuft'], t: number) {
  x.beginPath();
  if (kind === 'up') { x.moveTo(145, t + 6); x.quadraticCurveTo(138, t - 18, 134, t - 36); x.moveTo(150, t + 6); x.lineTo(152, t - 42); x.moveTo(155, t + 6); x.quadraticCurveTo(164, t - 18, 170, t - 34); }
  else if (kind === 'flat') { x.moveTo(146, t + 6); x.quadraticCurveTo(142, t - 8, 128, t - 8); x.moveTo(152, t + 6); x.quadraticCurveTo(160, t - 8, 174, t - 4); }
  else { x.moveTo(150, t + 6); x.quadraticCurveTo(138, t - 26, 156, t - 32); x.moveTo(152, t + 6); x.quadraticCurveTo(166, t - 20, 180, t - 16); }
  width(x, 7, () => x.stroke());
}
/* puffed up: her outline in tufts of fluff */
function fluff(x: Pen, b: Shape) {
  const n = 26, pt = (i: number, r: number) => { const a = i / n * Math.PI * 2; return [150 + Math.cos(a) * b.rx * r, b.cy + Math.sin(a) * b.ry * r] as const; };
  x.beginPath(); x.moveTo(...pt(0, 1));
  for (let i = 0; i < n; i++) { const c = pt(i + .5, 1.07), e = pt(i + 1, 1); x.quadraticCurveTo(c[0], c[1], e[0], e[1]); }
  x.closePath(); x.fillStyle = BODY; x.fill(); x.stroke();
}

function prop(x: Pen, [kind, cx, cy, s = 0]: Prop) {
  x.save();
  if (kind === 'seed') { x.lineWidth = 5; ell(x, cx, cy, 11, 17, '#6b5a4a', s); x.strokeStyle = '#d9cbb8'; x.lineWidth = 3; x.beginPath(); x.moveTo(cx - Math.sin(s) * 10, cy + Math.cos(s) * -10); x.lineTo(cx + Math.sin(s) * 10, cy + Math.cos(s) * 10); x.stroke(); }
  else if (kind === 'bubble') { x.lineWidth = 4; x.strokeStyle = WATER; alpha(x, .45, () => ell(x, cx, cy, s, s, '#d4efff', 0, false)); ell(x, cx, cy, s, s, null); alpha(x, .9, () => ell(x, cx - s * .35, cy - s * .35, s * .22, s * .22, '#fff', 0, false)); }
  else if (kind === 'sweat') { x.lineWidth = 4; x.fillStyle = WATER; x.beginPath(); x.moveTo(cx, cy); x.quadraticCurveTo(cx + 11, cy + 20, cx, cy + 24); x.quadraticCurveTo(cx - 11, cy + 20, cx, cy); x.fill(); x.stroke(); }
  else if (kind === 'star') { x.lineWidth = 4; x.fillStyle = '#ffe066'; x.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, d = i % 2 ? s * .45 : s; x.lineTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d); } x.closePath(); x.fill(); x.stroke(); }
  else if (kind === 'ripple') { x.strokeStyle = WATER; x.lineWidth = 5; for (const r of [s, s + 13]) { x.beginPath(); x.arc(cx, cy, r, -.5 * Math.PI, .9 * Math.PI); x.stroke(); } }
  else if (kind === 'lines') { x.lineWidth = 6; x.beginPath(); for (const d of [-.5, 0, .5]) { const a = s + d; x.moveTo(cx + Math.cos(a) * 16, cy + Math.sin(a) * 16); x.lineTo(cx + Math.cos(a) * 34, cy + Math.sin(a) * 34); } x.stroke(); }
  else if (kind === 'z') { x.lineWidth = 5; x.beginPath(); x.moveTo(cx - s, cy - s); x.lineTo(cx + s, cy - s); x.lineTo(cx - s, cy + s); x.lineTo(cx + s, cy + s); x.stroke(); }
  x.restore();
}

/* Turned, flipped and raised, about the paper's middle; then what's drawn in it. */
function placed(x: Pen, o: { turn?: number; flip?: boolean; lift?: number }, draw: () => void) {
  x.save(); x.translate(0, -(o.lift || 0)); x.translate(150, 150);
  if (o.turn) x.rotate(o.turn * DEG);
  if (o.flip) x.scale(1, -1);
  x.translate(-150, -150); draw(); x.restore();
}

export function drawFront(x: Pen, o: Chick) {
  placed(x, o, () => {
    const b = shape(o), lx = o.look || 0, ly = o.lookY || 0, ey = b.cy - 18 + ly;
    feet(x, o.feet || (o.body === 'sit' ? 'sit' : o.body === 'ball' ? 'tuck' : 'stand'), b);
    tuft(x, o.tuft, b.cy - b.ry);
    if (o.body === 'puff') fluff(x, b); else ell(x, 150, b.cy, b.rx, b.ry, BODY);
    if (o.back) {
      /* from behind: her tail, and no face */
      x.lineWidth = 6; x.fillStyle = WING; x.beginPath(); x.moveTo(126, b.cy + 58); x.lineTo(136, b.cy + 86); x.lineTo(150, b.cy + 68); x.lineTo(164, b.cy + 86); x.lineTo(174, b.cy + 58); x.closePath(); x.fill(); x.stroke();
    } else {
      alpha(x, .6, () => ell(x, 150 + lx * .4, b.cy + 37, 64, 48, BELLY, 0, false));
      const e = o.eyes || 'open'; eye(x, e, 112 + lx, ey, -1); eye(x, e, 188 + lx, ey, 1);
      alpha(x, o.blush ? .8 : .45, () => { for (const bx of [90 + lx * .7, 210 + lx * .7]) ell(x, bx, b.cy + 18 + ly, o.blush ? 24 : 18, o.blush ? 13 : 10, BLUSH, 0, false); });
      x.lineWidth = 6; x.fillStyle = BEAK;
      const bx = 150 + lx, by = b.cy + 10 + ly;
      if (o.mouth === 'open' || o.mouth === 'small') {
        const m = o.mouth === 'open' ? 1 : .55;
        x.beginPath(); x.moveTo(bx - 16, by - 2); x.lineTo(bx + 16, by - 2); x.lineTo(bx, by - 16); x.closePath(); x.fill(); x.stroke();
        x.fillStyle = '#c0392b'; x.beginPath(); x.moveTo(bx - 14, by + 4); x.lineTo(bx + 14, by + 4); x.lineTo(bx, by + 4 + 14 * m); x.closePath(); x.fill(); x.stroke();
      } else { x.beginPath(); x.moveTo(bx - 16, by - 8); x.lineTo(bx + 16, by - 8); x.lineTo(bx, by + 10); x.closePath(); x.fill(); x.stroke(); }
      x.lineWidth = 8;
      if (o.tears) { x.lineWidth = 4; for (const s of [-1, 1]) { x.fillStyle = WATER; x.beginPath(); const tx = 150 + s * 40 + lx, ty = ey + 18 + (o.tears === 2 ? 14 : 0); x.moveTo(tx, ty); x.quadraticCurveTo(tx + 10, ty + 18, tx, ty + 22); x.quadraticCurveTo(tx - 10, ty + 18, tx, ty); x.fill(); } x.lineWidth = 8; }
    }
    wing(x, o.wingL || o.wing || 'down', -1, b); wing(x, o.wingR || o.wing || 'down', 1, b);
    for (const p of o.props || []) prop(x, p);
  });
}

/* Side view, on a wall to her right: wings and feet reach forward onto it, so they, not her beak, are
   her art's right edge. */
const SIDE_WING = { up: [250, 94, -.55], mid: [254, 128, -.15], low: [248, 214, .35] } as const;
const SIDE_FEET = { a: [246, 214], b: [214, 248], hold: [238, 222] } as const;
export function drawSide(x: Pen, s: Side) {
  const cy = 165;
  const wingAt = (w: Side['near'], fill: string) => { const [wx, wy, r] = SIDE_WING[w]; ell(x, wx, wy, 36, 16, fill, r); };
  const footAt = (fy: number, fill: string) => {
    x.beginPath(); x.moveTo(214, fy); x.lineTo(270, fy); width(x, 12, () => x.stroke());
    x.save(); x.strokeStyle = fill; x.lineWidth = 5; x.stroke(); x.restore();
    width(x, 7, () => ell(x, 276, fy, 9, 20, fill));
  };
  const [near, far] = SIDE_FEET[s.feet];
  wingAt(s.far, WING_FAR); footAt(far, FOOT_FAR);
  x.beginPath(); x.moveTo(132, cy - 94); x.quadraticCurveTo(112, cy - 124, 124, cy - 134); x.moveTo(136, cy - 94); x.quadraticCurveTo(146, cy - 122, 162, cy - 124); width(x, 7, () => x.stroke());
  ell(x, 140, cy, 100, 100, BODY);
  alpha(x, .6, () => ell(x, 176, cy + 40, 50, 44, BELLY, 0, false));
  eye(x, s.eyes || 'open', 200, cy - 20, 1);
  alpha(x, .45, () => ell(x, 204, cy + 18, 16, 9, BLUSH, 0, false));
  x.lineWidth = 6; x.fillStyle = BEAK; x.beginPath(); x.moveTo(230, cy - 6); x.lineTo(264, cy + 8); x.lineTo(230, cy + 22); x.closePath(); x.fill(); x.stroke(); x.lineWidth = 8;
  footAt(near, FOOT); wingAt(s.near, WING);
}

/* ---- her poses ---- */
export interface PipSet { base: string; poses: Partial<Record<PoseKey, { fps: number; frames: string[] }>>; signature: Signature }

/* `front` and `side` draw one picture each; the same options give the same picture, drawn once. */
export function pipPoses(front: (o: Chick) => string, side: (s: Side) => string): PipSet {
  const C = front, open = C({}), blink = C({ eyes: 'closed' });
  const rep = <T>(n: number, v: T) => Array.from({ length: n }, () => v);
  /* her ways down, each a picture a stand-up starts from */
  const sit = C({ body: 'sit' }), sitBlink = C({ body: 'sit', eyes: 'closed' }), rise = C({ body: 'rise' });
  const sleep = C({ body: 'sit', eyes: 'closed' });
  const dizzy = (turn: number) => C({ body: 'sit', eyes: 'swirl', mouth: 'open', turn, lift: 2 });
  const sprawl = (feet: Feet) => C({ turn: 96, lift: -25, eyes: 'tight', mouth: 'open', wingL: 'up', wingR: 'tuck', feet });
  const ko = (s: number) => C({ turn: -92, lift: -2, eyes: 'x', mouth: 'small', wing: 'droop', props: [['star', 94 + s, 44, 15], ['star', 150, 28 - s * .4, 12], ['star', 206 - s, 44, 15]] });
  const held = (o: Chick) => C({ lift: 28, feet: 'dangle', wing: 'droop', ...o });
  const ball = (turn: number, o: Chick) => C({ body: 'ball', wing: 'tuck', tuft: 'flat', turn, ...o });
  const climb = (near: Side['near'], far: Side['near'], feet: Side['feet'], eyes?: Eye) => side({ near, far, feet, ...eyes ? { eyes } : {} });
  const hang = (turn: number, eyes?: Eye) => C({ flip: true, wing: 'up', turn, ...eyes ? { eyes } : {} });
  const crawl = (feet: Feet) => C({ flip: true, wing: 'mid', feet });
  const back = (turn = 0) => C({ back: true, turn });

  return {
    base: open,
    signature: { weight: .2, line: 'Peep!' },
    poses: {
      stand: { fps: 4, frames: [...rep(7, open), blink, ...rep(8, open)] },
      walk: { fps: 8, frames: [C({ feet: 'a' }), open, C({ feet: 'b' }), open] },
      run: { fps: 11, frames: [C({ feet: 'a', wing: 'mid', mouth: 'open' }), C({ feet: 'b', wingL: 'up', wingR: 'up', mouth: 'open' })] },
      sit: { fps: 3, frames: [...rep(9, sit), sitBlink, sit, sit] },
      sleep: { fps: 1, frames: [sleep, C({ body: 'sit', eyes: 'closed', props: [['bubble', 178, 214, 8]] }), C({ body: 'sit', eyes: 'closed', props: [['bubble', 184, 220, 15]] }), C({ body: 'sit', eyes: 'closed', props: [['bubble', 178, 214, 8]] })] },
      think: { fps: 2, frames: [...rep(3, C({ look: 12, lookY: -8, wingR: 'chin' })), ...rep(2, C({ look: -10, lookY: -8, wingR: 'chin' })), C({ look: 12, lookY: -8, wingR: 'chin', eyes: 'closed' })] },
      jump: { fps: 8, frames: [C({ lift: 26, feet: 'dangle', wing: 'up', eyes: 'happy', mouth: 'open' }), C({ lift: 26, feet: 'dangle', wing: 'high', eyes: 'happy', mouth: 'open' })] },
      fall: { fps: 8, frames: [C({ lift: 26, feet: 'kickA', wing: 'up', eyes: 'wide', mouth: 'open' }), C({ lift: 26, feet: 'kickB', wing: 'mid', eyes: 'wide', mouth: 'open' })] },
      land: { fps: 12, frames: [C({ squash: .16, eyes: 'tight', wing: 'up' }), C({ squash: .07, wing: 'down' }), open] },
      sprawl: { fps: 3, frames: [sprawl('a'), sprawl('b')] },
      drag: { fps: 3, frames: [held({}), held({ feet: 'swingA' }), held({}), held({ feet: 'swingB' })] },
      dragL: { fps: 6, frames: [held({ turn: 14 }), held({ turn: 30, eyes: 'wide', mouth: 'open', wing: 'mid', feet: 'kickB' })] },
      dragR: { fps: 6, frames: [held({ turn: -14 }), held({ turn: -30, eyes: 'wide', mouth: 'open', wing: 'mid', feet: 'kickA' })] },
      climb: { fps: 6, frames: [climb('up', 'low', 'a'), climb('mid', 'mid', 'hold'), climb('low', 'up', 'b'), climb('mid', 'mid', 'hold')] },
      wall: { fps: 3, frames: [...rep(5, climb('mid', 'up', 'hold')), climb('mid', 'up', 'hold', 'closed'), ...rep(2, climb('mid', 'up', 'hold'))] },
      crawl: { fps: 6, frames: [crawl('a'), crawl('stand'), crawl('b'), crawl('stand')] },
      hang: { fps: 3, frames: [hang(4), hang(0), hang(-4), hang(0), hang(4), hang(0, 'closed'), hang(-4), hang(0)] },
      happy: { fps: 6, frames: [C({ eyes: 'happy', wing: 'up', mouth: 'open' }), C({ eyes: 'happy', wing: 'mid', mouth: 'open' })] },
      wave: { fps: 6, frames: [C({ eyes: 'happy', mouth: 'small', wingR: 'high' }), C({ eyes: 'happy', mouth: 'small', wingR: 'up' })] },
      shy: { fps: 2, frames: [...rep(3, C({ wing: 'face', blush: true })), C({ wingL: 'face', wingR: 'down', blush: true, look: -4, lookY: 4 }), C({ wing: 'face', blush: true })] },
      cry: { fps: 4, frames: [C({ body: 'sit', eyes: 'tight', mouth: 'open', tears: 1 }), C({ body: 'sit', eyes: 'tight', mouth: 'open', tears: 2 })] },
      angry: { fps: 3, frames: [C({ eyes: 'angry', wing: 'mid' }), C({ eyes: 'angry', wing: 'mid', tuft: 'up', mouth: 'small' })] },
      dizzy: { fps: 3, frames: [dizzy(-5), dizzy(5)] },
      eat: { fps: 5, frames: [C({ body: 'sit', wing: 'hold', mouth: 'open', props: [['seed', 150, 226, .3]] }), C({ body: 'sit', wing: 'hold', props: [['seed', 150, 230, .3]] }), C({ body: 'sit', wing: 'hold', eyes: 'happy', mouth: 'small', props: [['seed', 150, 230, .3]] }), C({ body: 'sit', wing: 'hold', eyes: 'happy', props: [['seed', 150, 230, .3]] })] },
      dance: { fps: 5, frames: [C({ eyes: 'happy', wing: 'up', feet: 'a', turn: -7 }), C({ eyes: 'happy', wingL: 'mid', wingR: 'up', mouth: 'small' }), C({ eyes: 'happy', wing: 'up', feet: 'b', turn: 7 }), C({ eyes: 'happy', wingL: 'up', wingR: 'mid', mouth: 'small' })] },
      sing: { fps: 3, frames: [C({ eyes: 'closed', mouth: 'open', wing: 'mid' }), C({ eyes: 'closed', mouth: 'small', wing: 'down', turn: 4 }), C({ eyes: 'closed', mouth: 'open', wing: 'mid' }), C({ eyes: 'closed', mouth: 'small', wing: 'down', turn: -4 })] },
      roll: { fps: 12, frames: [0, 45, 90, 135, 180, 225, 270, 315].map(t => ball(t, { eyes: 'happy' })) },
      thrown: { fps: 10, frames: [0, 90, 180, 270].map(t => ball(t, { eyes: 'tight', mouth: 'open' })) },
      stand_up: { fps: 7, frames: [sit, rise, C({ wing: 'mid' }), open] },
      stand_up_from_sleep: { fps: 4, frames: [sleep, C({ body: 'sit', eyes: 'half' }), C({ body: 'rise', eyes: 'closed', mouth: 'open', wing: 'high' }), C({ eyes: 'half', wing: 'up' }), open] },
      stand_up_from_sprawl: { fps: 7, frames: [sprawl('a'), C({ turn: 60, eyes: 'tight', wing: 'mid' }), C({ turn: 24, lift: -6, eyes: 'tight', wing: 'mid', feet: 'b' }), C({ eyes: 'closed', wing: 'up' }), open] },
      stand_up_from_dizzy: { fps: 6, frames: [dizzy(5), C({ body: 'sit', eyes: 'swirl', turn: -3 }), C({ body: 'rise', eyes: 'tight', turn: 4 }), C({ eyes: 'closed', turn: -2 }), open] },
      stand_up_from_knocked_out: { fps: 6, frames: [ko(0), C({ turn: -50, lift: 4, eyes: 'tight', wing: 'droop' }), C({ body: 'sit', eyes: 'tight' }), C({ body: 'rise', eyes: 'closed' }), open] },
      sit_down: { fps: 8, frames: [open, rise, sit] },
      stand_from_sit: { fps: 8, frames: [sit, rise, open] },
      fall_asleep: { fps: 3, frames: [open, C({ eyes: 'half' }), C({ eyes: 'closed', mouth: 'open', wingR: 'chin' }), C({ body: 'rise', eyes: 'half' }), C({ body: 'sit', eyes: 'half' }), sleep] },
      watch_cursor: { fps: 2, frames: [...rep(3, C({ body: 'sit', look: 16, lookY: -6 })), C({ body: 'sit', look: 16, lookY: -6, eyes: 'closed' }), ...rep(2, C({ body: 'sit', look: 8, lookY: -10 }))] },
      struggle: { fps: 10, frames: [held({ eyes: 'angry', wing: 'up', feet: 'kickA' }), held({ eyes: 'tight', wing: 'mid', feet: 'kickB', turn: 6, mouth: 'open' }), held({ eyes: 'angry', wing: 'up', feet: 'kickA', turn: -6 }), held({ eyes: 'tight', wing: 'mid', feet: 'kickB', turn: 6, mouth: 'open' }), held({ eyes: 'angry', wing: 'up', feet: 'kickA', turn: -6 }), held({ eyes: 'wide', wing: 'high', mouth: 'open' })] },
      knocked_out: { fps: 2, frames: [ko(0), ko(10)] },
      dangle_legs: { fps: 3, frames: [...rep(3, C({ body: 'sit', lift: 50, feet: 'swingA', wing: 'down' })), C({ body: 'sit', lift: 50, feet: 'swingB', wing: 'down' }), C({ body: 'sit', lift: 50, feet: 'swingA', wing: 'down', eyes: 'closed' }), C({ body: 'sit', lift: 50, feet: 'swingB', wing: 'down' })] },
      tired: { fps: 3, frames: [C({ body: 'sit', eyes: 'half', mouth: 'open', wing: 'droop', props: [['sweat', 236, 92]] }), C({ body: 'sit', eyes: 'half', mouth: 'small', wing: 'droop', props: [['sweat', 236, 98]] })] },
      excited: { fps: 8, frames: [C({ eyes: 'star', wing: 'up', mouth: 'open' }), C({ eyes: 'star', wing: 'high', mouth: 'open', feet: 'tuck', lift: 24 }), C({ eyes: 'star', wing: 'up', mouth: 'open' }), C({ eyes: 'star', wing: 'mid', mouth: 'small' })] },
      laugh: { fps: 8, frames: [C({ eyes: 'happy', mouth: 'open', wing: 'belly', turn: -5 }), C({ eyes: 'happy', mouth: 'small', wing: 'belly', turn: 5 }), C({ eyes: 'happy', mouth: 'open', wing: 'belly', turn: -5 }), C({ eyes: 'happy', mouth: 'small', wing: 'belly', turn: 5, tears: 1 }), C({ eyes: 'happy', mouth: 'open', wing: 'belly', tears: 1 }), C({ eyes: 'happy', mouth: 'small' })] },
      surprised: { fps: 8, frames: [open, C({ eyes: 'wide', mouth: 'open', tuft: 'up', wing: 'up', lift: 16, props: [['lines', 226, 84, -.8]] }), C({ eyes: 'wide', mouth: 'open', tuft: 'up', wing: 'mid' }), C({ eyes: 'wide', mouth: 'small' }), C({ eyes: 'wide' })] },
      face_away: { fps: 1, frames: [back(), back(), back(2), back()] },
      turn_back: { fps: 8, frames: [back(), C({ look: 58, wingL: 'down', wingR: 'tuck' }), C({ look: 24 }), open] },
      tap_screen: { fps: 8, frames: [open, C({ wingR: 'reach' }), C({ wingR: 'tap', eyes: 'wide', props: [['ripple', 226, 132, 16]] }), C({ wingR: 'tap', eyes: 'wide', props: [['ripple', 226, 132, 26]] }), C({ wingR: 'reach', mouth: 'small' }), open] },
      stare: { fps: 2, frames: [...rep(7, C({ eyes: 'dot' })), C({ eyes: 'closed' })] },
      signature: { fps: 8, frames: [open, C({ squash: .12, eyes: 'closed', wing: 'tuck' }), C({ body: 'puff', eyes: 'closed', wing: 'tuck', tuft: 'up' }), C({ body: 'puff', lift: 10, eyes: 'happy', mouth: 'open', wing: 'high', feet: 'tuck', props: [['lines', 240, 86, -.7]] }), C({ lift: 10, eyes: 'happy', mouth: 'open', wing: 'mid', props: [['lines', 232, 92, -.7]] }), C({ squash: .08, eyes: 'happy', wing: 'down' }), open] }
    }
  };
}
