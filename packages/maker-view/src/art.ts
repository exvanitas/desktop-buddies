/* What a pose shows and how big, worked out from the buddy. Pure. A frame is a square image with its
   content box, so art is drawn at true scale on one baseline, the way the engine draws it. */
import { canShow, type ContentBox, type Frame, type PoseKey } from '@buddies/buddy-file';
import { shown, type MakerBuddy } from '@buddies/maker-core';
import { label } from './captions';

export type Slot =
  | { kind: 'none' }
  | Showing;
export interface Showing {
  kind: 'own' | 'borrow' | 'main' | 'turn';
  /* where the art comes from: its own pose, the pose it borrows, or null for the main image */
  from: PoseKey | null;
  frames: Frame[]; fps: number; scale: number; bb: ContentBox;
  /* the main image turned onto a surface */
  turn: 0 | 90 | 180;
}

const unionOf = (frames: Frame[]): ContentBox => frames.reduce<ContentBox>((u, f) => ({
  x0: Math.min(u.x0, f.bb.x0), y0: Math.min(u.y0, f.bb.y0), x1: Math.max(u.x1, f.bb.x1), y1: Math.max(u.y1, f.bb.y1)
}), frames[0]!.bb);

export function slotOf(p: MakerBuddy, key: PoseKey): Slot {
  if (!canShow(p, key)) return { kind: 'none' };
  const s = shown(p, key);
  if (s.key) {
    const pose = p.poses[s.key]!;
    return { kind: s.own ? 'own' : 'borrow', from: s.key, frames: pose.frames, fps: pose.fps || 6, scale: pose.scale || 1, bb: unionOf(pose.frames), turn: 0 };
  }
  const turn = s.rot === '@wall' ? 90 : s.rot === '@ceil' ? 180 : 0;
  return { kind: turn ? 'turn' : 'main', from: null, frames: [p.base], fps: 1, scale: 1, bb: p.base.bb, turn };
}

/* Stands in for a slot with no art of its own, when something must be drawn anyway. */
export const mainSlot = (p: MakerBuddy): Showing => ({ kind: 'main', from: null, frames: [p.base], fps: 1, scale: 1, bb: p.base.bb, turn: 0 });

/* One sticker per artwork: slots standing on the same art share one, because they are one picture. */
export interface Cell { id: string; keys: PoseKey[]; slot: Showing }
export function cellsOf(p: MakerBuddy, keys: readonly PoseKey[]): Cell[] {
  const out: Cell[] = [], shared = new Map<string, Cell>();
  for (const key of keys) {
    const slot = slotOf(p, key);
    if (slot.kind === 'none') continue;
    if (slot.kind === 'own') { out.push({ id: key, keys: [key], slot }); continue; }
    const id = `${slot.kind}:${slot.from ?? ''}:${slot.turn}`;
    let cell = shared.get(id);
    if (!cell) { cell = { id, keys: [], slot }; shared.set(id, cell); out.push(cell); }
    cell.keys.push(key);
  }
  return out;
}

export const captionOf = (s: Showing) => s.kind === 'own' ? `${s.frames.length} frame${s.frames.length > 1 ? 's' : ''}`
  : s.from ? `Using ${label(s.from)}` : 'Main image';
/* Own art and the main image are full strength. Anything else is printed faint. */
export const printed = (s: Showing) => s.kind === 'borrow';

/* A pose scaled up a little still fits, so art keeps its size against the others. */
const ROOM = 1.15;
export interface ArtBox { w: number; h: number; side: number; left: number; top: number; originX: number; originY: number; turn: number }
/* The picture's content, `height` tall at its own scale, shrunk only if it wouldn't fit. */
export function boxOf(s: Pick<Showing, 'bb' | 'scale' | 'turn'>, height: number, maxWidth = Infinity): ArtBox {
  const across = s.bb.x1 - s.bb.x0, down = s.bb.y1 - s.bb.y0, sideways = s.turn === 90;
  const full = height / ROOM * s.scale;
  const w0 = (sideways ? down : across) * full, h0 = (sideways ? across : down) * full;
  const k = Math.min(1, height / Math.max(h0, .01), maxWidth / Math.max(w0, .01));
  const side = full * k, w = w0 * k, h = h0 * k;
  const originX = (s.bb.x0 + across / 2) * side, originY = (s.bb.y0 + down / 2) * side;
  return { w, h, side, originX, originY, left: w / 2 - originX, top: h / 2 - originY, turn: s.turn };
}
