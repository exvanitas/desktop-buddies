/* The Maker's one sample buddy, drawn in code: Pip, with a full set of pose frames to show off per-pose
   animation. Pudding and Sprout, one picture each, were samples until 1.0.0; buddies made from them
   keep their own pictures, so they need nothing from here. The drawing goes through `Paper`, so this needs no page of its own. */
import type { Buddy, Pose, PoseKey } from '@buddies/buddy-file';
import type { ArtTools } from './deps';
import { INK, drawFront, drawSide, pipPoses, type Chick, type Side } from './pip';

/* The part of a canvas's 2D context the samples draw with. */
export interface Pen {
  lineJoin: string; lineCap: string; strokeStyle: unknown; fillStyle: unknown; lineWidth: number; globalAlpha: number;
  save(): void; restore(): void; beginPath(): void; closePath(): void; fill(): void; stroke(): void;
  moveTo(x: number, y: number): void; lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, from: number, to: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, from: number, to: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  translate(x: number, y: number): void; rotate(angle: number): void; scale(x: number, y: number): void;
}
/* A fresh square to draw on, and its picture as a data URL. */
export interface Sheet { pen: Pen; png(): string }
export type Paper = (side: number) => Sheet;

export type SampleKind = 'pip';
export const SAMPLES: { kind: SampleKind; name: string; note?: string }[] = [{ kind: 'pip', name: 'Pip', note: 'full pose set' }];

export function createSamples(paper: Paper, art: Pick<ArtTools, 'processBase' | 'processFrames'>) {
  /* One picture of Pip per set of options, drawn once however many poses use it. */
  const drawn = new Map<string, string>();
  function sheet(key: string, draw: (x: Pen) => void) {
    let src = drawn.get(key);
    if (src === undefined) { const c = paper(300), x = c.pen; x.lineJoin = x.lineCap = 'round'; x.strokeStyle = INK; x.lineWidth = 8; draw(x); src = c.png(); drawn.set(key, src); }
    return src;
  }
  const front = (o: Chick) => sheet('f' + JSON.stringify(o), x => drawFront(x, o));
  const side = (o: Side) => sheet('s' + JSON.stringify(o), x => drawSide(x, o));
  const pipSet = () => pipPoses(front, side);

  /* Returns ready-to-use buddy data (processed through the same pipeline as uploads). */
  async function build(_kind: SampleKind): Promise<Buddy> {
    const s = pipSet(); const base = (await art.processBase(s.base))!;
    const poses: Buddy['poses'] = {};
    for (const [k, p] of Object.entries(s.poses)) { const r = (await art.processFrames(p.frames, base.ref))!; poses[k as PoseKey] = { frames: r.frames, fps: p.fps, scale: r.scale } satisfies Pose; }
    return { name: 'Pip', base: base.frame, ref: base.ref, poses, faces: 'right', size: 120, signature: s.signature };
  }
  const thumbs: Record<SampleKind, () => string> = { pip: () => front({}) };
  return { build, thumb: (k: SampleKind) => thumbs[k]() };
}
export type Samples = ReturnType<typeof createSamples>;
