/* Sample buddies drawn in code. Pip comes with a full set of pose frames to show off per-pose
   animation. The drawing goes through `Paper`, so this needs no page of its own. */
import type { Buddy, Pose, PoseKey } from '@buddies/buddy-file';
import type { ArtTools } from './deps';

/* The part of a canvas's 2D context the samples draw with. */
export interface Pen {
  lineJoin: string; lineCap: string; strokeStyle: unknown; fillStyle: unknown; lineWidth: number; globalAlpha: number;
  save(): void; restore(): void; beginPath(): void; closePath(): void; fill(): void; stroke(): void;
  moveTo(x: number, y: number): void; lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, from: number, to: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, from: number, to: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
}
/* A fresh square to draw on, and its picture as a data URL. */
export interface Sheet { pen: Pen; png(): string }
export type Paper = (side: number) => Sheet;

export type SampleKind = 'pip' | 'pudding' | 'sprout';
export const SAMPLES: { kind: SampleKind; name: string; note?: string }[] = [{ kind: 'pip', name: 'Pip', note: 'full pose set' }, { kind: 'pudding', name: 'Pudding' }, { kind: 'sprout', name: 'Sprout' }];

type Eye = 'open' | 'sad' | 'angry' | 'wide' | 'closed' | 'happy' | 'tight' | 'x' | 'swirl';
interface Chick { sit?: boolean; look?: number; feet?: 'a' | 'b'; eyes?: Eye; eyeY?: number; wing?: 'up' | 'mid' | 'face' | 'down'; mouth?: 'open'; blush?: boolean; tears?: 1 | 2 }

const INK = '#4a3a2e';

function ell(x: Pen, cx: number, cy: number, rx: number, ry: number, fill: string | null, rot = 0, stroke = true) { x.beginPath(); x.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2); if (fill) { x.fillStyle = fill; x.fill(); } if (stroke) x.stroke(); }

export function createSamples(paper: Paper, art: Pick<ArtTools, 'processBase' | 'processFrames'>) {
  function cv(): [Sheet, Pen] { const c = paper(300), x = c.pen; x.lineJoin = x.lineCap = 'round'; x.strokeStyle = INK; x.lineWidth = 8; return [c, x]; }

  /* ---- Pip the chick ---- */
  function eye(x: Pen, kind: Eye, cx: number, cy: number, side: number) {
    x.save(); x.lineWidth = 7;
    if (kind === 'open' || kind === 'sad' || kind === 'angry' || kind === 'wide') {
      const r = kind === 'wide' ? 1.15 : 1;
      ell(x, cx, cy, 12 * r, 16 * r, '#3a2b22', 0, false);
      ell(x, cx - 4, cy - 6, 5, 5, '#fff', 0, false);
      ell(x, cx + 4, cy + 6, 2.2, 2.2, '#fff', 0, false);
      if (kind === 'sad') { x.beginPath(); x.moveTo(cx - 16 * side, cy - 30); x.lineTo(cx + 12 * side, cy - 22); x.stroke(); }
      if (kind === 'angry') { x.beginPath(); x.moveTo(cx - 16 * side, cy - 22); x.lineTo(cx + 12 * side, cy - 32); x.stroke(); x.beginPath(); x.moveTo(cx + 14 * side, cy - 30); x.lineTo(cx - 10 * side, cy - 20); x.stroke(); }
    } else if (kind === 'closed') { x.beginPath(); x.arc(cx, cy - 4, 12, .15 * Math.PI, .85 * Math.PI); x.stroke(); }
    else if (kind === 'happy') { x.beginPath(); x.arc(cx, cy + 6, 12, 1.15 * Math.PI, 1.85 * Math.PI); x.stroke(); }
    else if (kind === 'tight') { x.beginPath(); x.moveTo(cx - 12 * side, cy - 9); x.lineTo(cx + 9 * side, cy); x.lineTo(cx - 12 * side, cy + 9); x.stroke(); }
    else if (kind === 'x') { x.beginPath(); x.moveTo(cx - 10, cy - 10); x.lineTo(cx + 10, cy + 10); x.moveTo(cx + 10, cy - 10); x.lineTo(cx - 10, cy + 10); x.stroke(); }
    else if (kind === 'swirl') { x.lineWidth = 5; x.beginPath(); for (let t = 0; t < 14; t += .2) { const r = t * 1.1; x.lineTo(cx + Math.cos(t * side) * r, cy + Math.sin(t * side) * r); } x.stroke(); }
    x.restore();
  }
  function chick(o: Chick = {}) {
    const [c, x] = cv();
    const dy = o.sit ? 26 : 0, lx = o.look || 0;
    if (!o.sit) {
      const fl = o.feet === 'a' ? -12 : 0, fr = o.feet === 'b' ? -12 : 0;
      x.lineWidth = 7; ell(x, 118, 270 + fl, 24, 13, '#ff9f43'); ell(x, 182, 270 + fr, 24, 13, '#ff9f43'); x.lineWidth = 8;
    } else { x.lineWidth = 7; ell(x, 104, 276, 22, 11, '#ff9f43'); ell(x, 196, 276, 22, 11, '#ff9f43'); x.lineWidth = 8; }
    /* tuft */
    x.lineWidth = 7; x.beginPath(); x.moveTo(150, 72 + dy); x.quadraticCurveTo(138, 40 + dy, 156, 34 + dy); x.moveTo(152, 72 + dy); x.quadraticCurveTo(166, 46 + dy, 180, 50 + dy); x.stroke(); x.lineWidth = 8;
    /* body */
    ell(x, 150, 168 + dy, 110, o.sit ? 96 : 102, '#ffd54d');
    x.save(); x.globalAlpha = .6; ell(x, 150, 205 + dy, 64, 48, '#fff3b8', 0, false); x.restore();
    /* wings */
    const wing = (sx: number) => {
      if (o.wing === 'up') ell(x, 150 + sx * 104, 112 + dy, 20, 38, '#ffc93c', sx * -.75);
      else if (o.wing === 'mid') ell(x, 150 + sx * 112, 150 + dy, 20, 36, '#ffc93c', sx * -1.2);
      else if (o.wing === 'face') ell(x, 150 + sx * 52, 168 + dy, 22, 30, '#ffc93c', sx * .4);
      else ell(x, 150 + sx * 100, 190 + dy, 20, 36, '#ffc93c', sx * .35);
    };
    /* face */
    const ey = 150 + dy + (o.eyeY || 0);
    if (o.wing !== 'face') { eye(x, o.eyes || 'open', 112 + lx, ey, -1); eye(x, o.eyes || 'open', 188 + lx, ey, 1); }
    x.save(); x.globalAlpha = o.blush ? .8 : .45; ell(x, 90 + lx, 186 + dy, o.blush ? 24 : 18, o.blush ? 13 : 10, '#ff8fa8', 0, false); ell(x, 210 + lx, 186 + dy, o.blush ? 24 : 18, o.blush ? 13 : 10, '#ff8fa8', 0, false); x.restore();
    x.lineWidth = 6; x.fillStyle = '#ff8a2a';
    const bx = 150 + lx, by = 178 + dy;
    if (o.mouth === 'open') {
      x.beginPath(); x.moveTo(bx - 16, by - 2); x.lineTo(bx + 16, by - 2); x.lineTo(bx, by - 16); x.closePath(); x.fill(); x.stroke();
      x.fillStyle = '#c0392b'; x.beginPath(); x.moveTo(bx - 14, by + 4); x.lineTo(bx + 14, by + 4); x.lineTo(bx, by + 18); x.closePath(); x.fill(); x.stroke();
    } else {
      x.beginPath(); x.moveTo(bx - 16, by - 8); x.lineTo(bx + 16, by - 8); x.lineTo(bx, by + 10); x.closePath(); x.fill(); x.stroke();
    }
    x.lineWidth = 8;
    if (o.tears) { x.lineWidth = 4; [-1, 1].forEach(s => { x.fillStyle = '#7fc8ff'; x.beginPath(); const tx = 150 + s * 40 + lx, ty = ey + 18 + (o.tears === 2 ? 14 : 0); x.moveTo(tx, ty); x.quadraticCurveTo(tx + 10, ty + 18, tx, ty + 22); x.quadraticCurveTo(tx - 10, ty + 18, tx, ty); x.fill(); }); x.lineWidth = 8; }
    wing(-1); wing(1);
    return c.png();
  }
  function pipSet() {
    const open = chick(), blink = chick({ eyes: 'closed' });
    return {
      base: open,
      poses: {
        stand: { fps: 4, frames: [open, open, open, open, open, open, open, blink, open, open, open, open, open, open, open, open] },
        walk: { fps: 6, frames: [chick({ feet: 'a', look: 0 }), chick({ feet: 'b', look: 0 })] },
        run: { fps: 11, frames: [chick({ feet: 'a', wing: 'mid', mouth: 'open' }), chick({ feet: 'b', wing: 'mid', mouth: 'open' })] },
        sit: { fps: 3, frames: [chick({ sit: true })] },
        sleep: { fps: 1, frames: [chick({ sit: true, eyes: 'closed' })] },
        think: { fps: 2, frames: [chick({ eyes: 'open', eyeY: -8, look: 10 })] },
        jump: { fps: 8, frames: [chick({ wing: 'up', eyes: 'happy', mouth: 'open' })] },
        fall: { fps: 8, frames: [chick({ wing: 'up', eyes: 'wide', mouth: 'open' }), chick({ wing: 'mid', eyes: 'wide', mouth: 'open' })] },
        sprawl: { fps: 2, frames: [chick({ sit: true, eyes: 'x', mouth: 'open' })] },
        happy: { fps: 6, frames: [chick({ eyes: 'happy', wing: 'up', mouth: 'open' }), chick({ eyes: 'happy', wing: 'mid', mouth: 'open' })] },
        wave: { fps: 6, frames: [chick({ eyes: 'happy', wing: 'up' }), chick({ eyes: 'happy', wing: 'mid' })] },
        shy: { fps: 2, frames: [chick({ wing: 'face', blush: true })] },
        cry: { fps: 4, frames: [chick({ sit: true, eyes: 'tight', mouth: 'open', tears: 1 }), chick({ sit: true, eyes: 'tight', mouth: 'open', tears: 2 })] },
        angry: { fps: 2, frames: [chick({ eyes: 'angry', wing: 'mid' })] },
        dizzy: { fps: 2, frames: [chick({ sit: true, eyes: 'swirl', mouth: 'open' })] },
        eat: { fps: 5, frames: [chick({ sit: true, eyes: 'happy', mouth: 'open' }), chick({ sit: true, eyes: 'happy' })] },
        dance: { fps: 5, frames: [chick({ eyes: 'happy', wing: 'up', feet: 'a' }), chick({ eyes: 'happy', wing: 'mid', feet: 'b' })] },
        sing: { fps: 3, frames: [chick({ eyes: 'closed', mouth: 'open', wing: 'mid' }), chick({ eyes: 'closed', wing: 'down' })] }
      }
    };
  }

  /* ---- Pudding ---- */
  function pudding() {
    const [c, x] = cv();
    ell(x, 150, 272, 128, 18, '#e8f1ff');
    x.fillStyle = '#ffe08a'; x.beginPath(); x.moveTo(62, 262); x.quadraticCurveTo(70, 120, 92, 96); x.lineTo(208, 96); x.quadraticCurveTo(230, 120, 238, 262); x.quadraticCurveTo(150, 280, 62, 262); x.closePath(); x.fill(); x.stroke();
    x.fillStyle = '#9c5b2a'; x.beginPath(); x.moveTo(92, 96); x.quadraticCurveTo(150, 70, 208, 96); x.quadraticCurveTo(214, 118, 196, 130); x.quadraticCurveTo(186, 112, 176, 136); x.quadraticCurveTo(160, 120, 146, 132); x.quadraticCurveTo(128, 116, 116, 134); x.quadraticCurveTo(100, 120, 92, 96); x.closePath(); x.fill(); x.stroke();
    ell(x, 172, 64, 16, 16, '#ff4d6d'); x.beginPath(); x.moveTo(176, 50); x.quadraticCurveTo(186, 32, 198, 30); x.stroke();
    eye(x, 'open', 118, 190, -1); eye(x, 'open', 182, 190, 1);
    x.save(); x.globalAlpha = .5; ell(x, 96, 222, 18, 10, '#ff8fa8', 0, false); ell(x, 204, 222, 18, 10, '#ff8fa8', 0, false); x.restore();
    x.lineWidth = 6; x.beginPath(); x.arc(140, 214, 10, .1 * Math.PI, .9 * Math.PI); x.stroke(); x.beginPath(); x.arc(160, 214, 10, .1 * Math.PI, .9 * Math.PI); x.stroke();
    return c.png();
  }
  /* ---- Sprout ---- */
  function sprout() {
    const [c, x] = cv();
    x.lineWidth = 7; ell(x, 116, 276, 22, 12, '#5fae5a'); ell(x, 184, 276, 22, 12, '#5fae5a'); x.lineWidth = 8;
    x.beginPath(); x.moveTo(150, 92); x.quadraticCurveTo(146, 60, 150, 44); x.stroke();
    ell(x, 124, 46, 28, 14, '#7dd36f', .5); ell(x, 178, 40, 30, 15, '#7dd36f', -.5);
    ell(x, 150, 182, 96, 96, '#a6e48a');
    x.save(); x.globalAlpha = .55; ell(x, 150, 214, 58, 42, '#e6f8d8', 0, false); x.restore();
    eye(x, 'open', 118, 172, -1); eye(x, 'open', 182, 172, 1);
    x.save(); x.globalAlpha = .5; ell(x, 98, 204, 17, 10, '#ff8fa8', 0, false); ell(x, 202, 204, 17, 10, '#ff8fa8', 0, false); x.restore();
    x.lineWidth = 6; x.fillStyle = '#e8665c'; x.beginPath(); x.moveTo(136, 198); x.quadraticCurveTo(150, 222, 164, 198); x.closePath(); x.fill(); x.stroke();
    return c.png();
  }

  /* Returns ready-to-use buddy data (processed through the same pipeline as uploads). */
  async function build(kind: SampleKind): Promise<Buddy> {
    if (kind === 'pip') {
      const s = pipSet(); const base = (await art.processBase(s.base))!;
      const poses: Buddy['poses'] = {};
      for (const [k, p] of Object.entries(s.poses)) { const r = (await art.processFrames(p.frames, base.ref))!; poses[k as PoseKey] = { frames: r.frames, fps: p.fps, scale: r.scale } satisfies Pose; }
      return { name: 'Pip', base: base.frame, ref: base.ref, poses, faces: 'right', size: 120 };
    }
    const src = kind === 'pudding' ? pudding() : sprout();
    const base = (await art.processBase(src))!;
    return { name: kind === 'pudding' ? 'Pudding' : 'Sprout', base: base.frame, ref: base.ref, poses: {}, faces: 'right', size: 120 };
  }
  const thumbs: Record<SampleKind, () => string> = { pip: () => chick(), pudding, sprout };
  return { build, thumb: (k: SampleKind) => thumbs[k]() };
}
export type Samples = ReturnType<typeof createSamples>;
