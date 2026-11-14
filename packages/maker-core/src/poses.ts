/* A buddy's poses: which is open, its frames, speed, scale and lift, and what an empty one shows. */
import { LIMIT, POSE, SHIMEJI_MAP, type Buddy, type Frame, type Pose, type PoseKey } from '@buddies/buddy-file';
import type { MakerBuddy, MakerDeps, MakerFile } from './deps';
import { AREA_ADJ } from './prompts';
import type { Session } from './session';

/* The same ranges a buddy file allows. */
const SPEED = { min: .1, max: 60 }, SCALE = { min: .05, max: 10 };
/* How far a pose's own Lift goes either way, in px at its size. */
export const POSE_LIFT = 60;

export interface Shown { key: PoseKey | null; src: string; own: boolean; rot?: string | null }
/* What a pose would show right now: its own art, a fallback's, or the main image. `rot` is the
   surface the main image turns to fit, when that's where the fallbacks end. */
export function shown(p: Pick<Buddy, 'poses' | 'base'>, key: PoseKey): Shown {
  let k: string | null = key;
  while (k && k[0] !== '@') {
    const ps = p.poses[k as PoseKey];
    if (ps && ps.frames.length) return { key: k as PoseKey, src: ps.frames[0]!.src, own: k === key };
    k = POSE[k as PoseKey] ? POSE[k as PoseKey].fb : null;
  }
  return { key: null, src: p.base.src, own: false, rot: k };
}

export function createPoses(s: Session, deps: MakerDeps) {
  const { art, world, toast, readImage } = deps;
  const poses = (pet: MakerBuddy) => s.changed({ scope: 'poses', pet });

  /* Lift is how far a pose's art stands off the floor, in px at its size. The engine stands a pose on
     the bottom of its frames' box, so the lift is that bottom less where the art really ends. Where
     it ends is measured from the pixels, once per picture. */
  const bottoms = new Map<string, number | null>();
  const pxOf = (p: MakerBuddy, ps: Pose) => (p.size || 120) * (ps.scale || 1);
  const framed = (p: MakerBuddy, key: PoseKey) => { const ps = p.poses[key]; return ps && ps.frames.length ? ps : null; };
  /* every frame's own bottom, or null if any isn't known */
  const ends = (ps: Pose) => { const m = ps.frames.map(f => bottoms.get(f.src)); return m.every(x => typeof x === 'number') ? m as number[] : null; };
  function measuredLift(p: MakerBuddy, key: PoseKey) {
    const ps = framed(p, key), m = ps && ends(ps); if (!ps || !m) return null;
    return Math.round((Math.max(...ps.frames.map(f => f.bb.y1)) - Math.max(...m)) * pxOf(p, ps));
  }
  /* Mid-edit it's what the edit applied, which rounding the boxes back can miss by a px. */
  function liftOf(p: MakerBuddy, key: PoseKey) {
    const ps = framed(p, key), px = measuredLift(p, key); if (!ps || px === null) return null;
    return current(ps, pxOf(p, ps))?.at ?? px;
  }
  /* A Lift edit moves every frame's box bottom by the same amount from where it was when the edit
     began, so boxes set by hand keep their offsets from each other, and coming back to where it began
     gives back exactly what was there. Any other change to the frames, or her scale or size, starts
     the next edit afresh, as does opening her again, since that's a new pose. */
  /* `at`: the px this edit last applied, px0 until it applies one */
  interface Edit { frames: Frame[]; y1: number[]; px0: number; at: number; S: number }
  const edits = new WeakMap<Pose, Edit>();
  const current = (ps: Pose, S: number) => { const e = edits.get(ps); return e && e.S === S && e.frames.length === ps.frames.length && e.frames.every((f, i) => f === ps.frames[i]) ? e : null; };
  function editOf(p: MakerBuddy, key: PoseKey): Edit | null {
    const ps = framed(p, key); if (!ps) return null;
    const S = pxOf(p, ps), e = current(ps, S); if (e) return e;
    const px0 = measuredLift(p, key);
    return px0 === null ? null : { frames: [...ps.frames], y1: ps.frames.map(f => f.bb.y1), px0, at: px0, S };
  }
  const bottomsAt = (e: Edit, px: number) => e.y1.map(y => y + (px - e.px0) / e.S);
  /* It stays what the file can hold: the range stops where any box would pass its picture's bottom or
     its own top, so no frame is ever clamped on its own. */
  function rangeOf(p: MakerBuddy, key: PoseKey) {
    const e = editOf(p, key); if (!e) return null;
    const F = e.frames, S = e.S;
    let max = Math.min(POSE_LIFT, Math.floor(e.px0 + Math.min(...e.y1.map(y => 1 - y)) * S + 1e-9));
    let min = Math.max(-POSE_LIFT, Math.ceil(e.px0 + Math.max(...F.map((f, i) => f.bb.y0 - e.y1[i]!)) * S - 1e-9));
    while (max > e.px0 && bottomsAt(e, max).some(y => y > 1)) max--;
    while (min < e.px0 && bottomsAt(e, min).some((y, i) => y < F[i]!.bb.y0)) min++;
    return { min: Math.min(min, e.px0), max: Math.max(max, e.px0) };
  }
  /* Frames are new objects, because one can be shared with another pose or the main image. */
  function lift(p: MakerBuddy, key: PoseKey, px: number) {
    const ps = framed(p, key), e = editOf(p, key), r = rangeOf(p, key);
    if (!ps || !e || !r || !Number.isFinite(px)) return false;
    const to = Math.min(r.max, Math.max(r.min, Math.round(px)));
    if (to === e.at) return false;
    const y1 = bottomsAt(e, to);
    ps.frames.forEach((f, i) => { ps.frames[i] = { src: f.src, bb: { x0: f.bb.x0, y0: f.bb.y0, x1: f.bb.x1, y1: y1[i]! } }; });
    e.frames = [...ps.frames]; e.at = to;
    edits.set(ps, e);
    return true;
  }
  /* The lift a pose has, as a share of its picture, unrounded: what frames added to it take on. */
  const shareOf = (ps: Pose) => { const m = ends(ps); return m && Math.max(...ps.frames.map(f => f.bb.y1)) - Math.max(...m); };
  /* Freshly cut frames were measured as they were cut. */
  const seed = (frames: Frame[]) => { for (const f of frames) bottoms.set(f.src, f.bb.y1); };
  async function measure(frames: Frame[]) {
    for (const src of new Set(frames.map(f => f.src))) if (!bottoms.has(src)) bottoms.set(src, await art.bottomOf(src));
  }

  return {
    togglePose(pet: MakerBuddy, key: PoseKey) { s.openPose = s.openPose === key ? null : key; poses(pet); },
    closePose(pet: MakerBuddy) { s.openPose = null; poses(pet); },
    /* For a view that always has one pose in hand. The view asked, so nothing is announced. */
    pickPose(key: PoseKey | null) { s.openPose = key; },
    /* onto the pose open when they were picked, however long they take to read */
    async addFrames(p: MakerBuddy, chosen: MakerFile[]) {
      const key = s.openPose; if (!key) return;
      const files = chosen.filter(f => /^image\//.test(f.type)).sort((a, b) => art.natSort(a.name, b.name));
      if (!files.length) return;
      const srcs: string[] = []; for (const f of files) srcs.push((await readImage(f))!);
      const r = await art.processFrames(srcs, p.ref); if (!r) return toast("Couldn't read those images");
      /* the art there is measured, so the lift it has can be kept */
      const was = p.poses[key]; if (was && !ends(was)) await measure(was.frames);
      if (!s.state.pets.includes(p)) return toast(`${p.name || 'That buddy'} isn't here any more, so the images went nowhere. They're still on your disk.`);
      /* Read now, not before the wait: another batch may have landed, or the pose been cleared.
         A file holding more than this wouldn't be taken back. */
      const prev = p.poses[key], share = prev && prev.frames.length ? shareOf(prev) : null;
      seed(r.frames);
      const room = LIMIT.frames - (prev ? prev.frames.length : 0), cut = r.frames.slice(0, room);
      if (cut.length < r.frames.length) toast(`A pose holds ${LIMIT.frames} frames, so ${r.frames.length - cut.length} didn't fit`);
      if (!cut.length) return;
      /* Each new frame stands where its own art ends plus the pose's lift, as far as its picture allows.
         The frames already there are left as they are. */
      const fresh = share ? cut.map(f => ({ src: f.src, bb: { x0: f.bb.x0, y0: f.bb.y0, x1: f.bb.x1, y1: Math.min(1, Math.max(f.bb.y0, f.bb.y1 + share)) } })) : cut;
      if (prev && prev.frames.length) prev.frames.push(...fresh);
      else p.poses[key] = { frames: fresh, fps: SHIMEJI_MAP[key] && SHIMEJI_MAP[key]!.length > 1 ? 6 : 4, scale: r.scale };
      s.save(true); poses(p); world.act(p.id, key);
    },
    /* one place earlier or later; off either end, nothing happens */
    moveFrame(p: MakerBuddy, key: PoseKey, i: number, by: -1 | 1) {
      const F = p.poses[key]?.frames, j = i + by; if (!F || !F[i] || j < 0 || j >= F.length) return;
      [F[i], F[j]] = [F[j]!, F[i]!];
      s.save(true); poses(p);
    },
    removeFrame(p: MakerBuddy, key: PoseKey, i: number) {
      const F = p.poses[key]?.frames; if (!F || !F[i]) return;
      F.splice(i, 1);
      if (!F.length) delete p.poses[key];
      s.save(true); poses(p);
    },
    /* Lift, for a view: null until measureLift has read the art. */
    poseLift: liftOf,
    liftRange: rangeOf,
    async measureLift(p: MakerBuddy, key: PoseKey) { const ps = framed(p, key); if (ps) await measure(ps.frames); },
    setPoseLift(p: MakerBuddy, key: PoseKey, px: number) { if (!lift(p, key, px)) return; s.save(); s.changed({ scope: 'field' }); },
    clearPose(p: MakerBuddy, key: PoseKey) { delete p.poses[key]; s.save(true); poses(p); },
    /* Undo for frames just added: the pose as it was, or none, if she's still here. Pass a copy taken
       before, since adding frames adds to the same list. */
    restorePose(p: MakerBuddy, key: PoseKey, was: Pose | undefined) {
      if (!s.state.pets.includes(p)) return;
      if (was) p.poses[key] = was; else delete p.poses[key];
      s.save(true); poses(p);
    },
    setSpeed(p: MakerBuddy, key: PoseKey, fps: number) { const ps = p.poses[key]; if (!ps || !(fps >= SPEED.min && fps <= SPEED.max)) return; ps.fps = fps; s.save(); s.changed({ scope: 'field' }); },
    setScale(p: MakerBuddy, key: PoseKey, scale: number) { const ps = p.poses[key]; if (!ps || !(scale >= SCALE.min && scale <= SCALE.max)) return; ps.scale = scale; s.save(); s.changed({ scope: 'field' }); },
    /* Rescales every pose so the body is the size it is in the main image. */
    async matchSizes() {
      const p = s.current(); if (!p) return;
      const keys = (Object.keys(p.poses) as PoseKey[]).filter(k => p.poses[k]!.frames.length);
      if (!keys.length) return toast('No pose frames yet');
      toast('Measuring…'); let n = 0;
      for (const k of keys) { const m = await art.matchScale(p.base, p.poses[k]!.frames); if (m) { p.poses[k]!.scale = +(m * (AREA_ADJ[k] || 1)).toFixed(3); n++; } }
      s.save(true); s.changed({ scope: 'all' }); toast(`Matched ${n} pose${n === 1 ? '' : 's'} to the main image · fine-tune any with its Scale slider`);
    }
  };
}
