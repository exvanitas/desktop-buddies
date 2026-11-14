/* The buddies: adding, removing, selecting, and what each one is called and looks like. */
import { LIFTS, LIMIT, newCharacter, type Buddy, type Frame, type ImageRef, type Lift } from '@buddies/buddy-file';
import { canDo, type Chatter } from '@buddies/engine';
import type { MakerBuddy, MakerDeps, MakerFile } from './deps';
import type { SampleKind } from './samples';
import type { Session } from './session';

export const MAX = 8;
/* A buddy's size as its file allows it. */
const SIZE = { min: 16, max: 512 };
const CHATTER: readonly string[] = ['off', 'low', 'normal', 'high'];

/* What Try an action and Everyone offer, as [action, label]. */
export const ACTS: readonly [string, string][] = [['love', 'Hearts'], ['wave', 'Wave'], ['cry', 'Cry'], ['angry', 'Angry'], ['shy', 'Shy'], ['sleep', 'Sleep'],
  ['sit', 'Sit'], ['think', 'Think'], ['dance', 'Dance'], ['sing', 'Sing'], ['eat', 'Snack'], ['jump', 'Jump'],
  ['run', 'Run'], ['trip', 'Trip'], ['roll', 'Roll'], ['spin', 'Spin'], ['dizzy', 'Dizzy'], ['chase', 'Chase mouse'],
  ['climbGo', 'Climb wall'], ['ceilGo', 'To ceiling'], ['drop', 'Come down']];
export const ALL: readonly [string, string][] = [['dance', 'Everyone dance'], ['love', 'Everyone hearts'], ['sleep', 'Everyone nap'], ['drop', 'Everyone down']];

export function createRoster(s: Session, deps: MakerDeps) {
  const { art, world, toast, after, samples, readImage } = deps;
  const all = () => s.changed({ scope: 'all' });
  const field = () => s.changed({ scope: 'field' });

  function addPet(d: Partial<Buddy> & Pick<Buddy, 'base'>, quiet?: boolean): MakerBuddy | null {
    const S = s.state;
    if (S.pets.length >= MAX) { toast(`Up to ${MAX} buddies at once`); return null; }
    const p: MakerBuddy = Object.assign({ id: s.uid(), character: newCharacter(), name: `Buddy ${S.pets.length + 1}`, size: 120, faces: 'right' as const, poses: {} }, d);
    p.id = s.uid();
    S.pets.push(p); s.selected = p.id; s.openPose = null; s.save(true); all();
    if (!quiet) after(1300, () => world.act(p.id, 'love'));
    return p;
  }
  async function addFromSrc(src: string, name?: string) {
    const r = await art.processBase(src); if (!r) return toast("Couldn't open that image");
    addPet({ ...(name ? { name } : {}), base: r.frame, ref: r.ref, size: r.photo ? 110 : 120 });
  }
  function setBase(p: MakerBuddy, r: { frame: Frame; ref: ImageRef }) { p.base = r.frame; p.ref = r.ref; s.save(true); all(); }

  return {
    addPet, addFromSrc,
    async addSample(kind: SampleKind) { return addPet(await samples.build(kind)); },
    select(id: string) { s.selected = id; s.openPose = null; all(); },
    /* Undo for buddies just made: they go, and whoever was open before is again, if she's still here. */
    takeBack(ids: string[], open: string | null) {
      const S = s.state, gone = new Set(ids);
      const going = S.pets.filter(p => gone.has(p.id)); if (!going.length) return;
      deps.store.takeBack?.(going);
      S.pets = S.pets.filter(p => !gone.has(p.id));
      s.selected = S.pets.some(p => p.id === open) ? open : S.pets[0] ? S.pets[0].id : null; s.openPose = null;
      s.save(true); all();
    },
    /* Undo for a new main image: hers as it was, if she's still here. */
    restoreMain(p: MakerBuddy, frame: Frame, ref: ImageRef | undefined) {
      if (!s.state.pets.includes(p)) return;
      p.base = frame; if (ref) p.ref = ref; else delete p.ref;
      s.save(true); all();
    },
    /* the selected buddy */
    remove() {
      const p = s.current(); if (!p) return;
      s.state.pets = s.state.pets.filter(x => x.id !== p.id); s.selected = s.state.pets[0] ? s.state.pets[0].id : null; s.openPose = null; s.save(true); all();
    },
    setName(name: string) { const p = s.current(); if (!p || typeof name !== 'string' || name.length > LIMIT.name) return; p.name = name; s.save(); field(); },
    setSize(size: number) { const p = s.current(); if (!p || !(size >= SIZE.min && size <= SIZE.max)) return; p.size = size; s.save(); field(); },
    /* Her lift from one kind of surface, as a share of her size. Kept short, in the file's order, and
       left out at 0, as is the whole lift with none left. A 0 already there goes too. */
    setLift(surface: keyof Lift, share: number) {
      const p = s.current(); if (!p || !LIFTS.includes(surface) || typeof share !== 'number' || !(Math.abs(share) <= LIMIT.lift)) return;
      const to = +share.toFixed(4), next: Lift = {};
      for (const k of LIFTS) { const x = k === surface ? to : p.lift?.[k]; if (x) next[k] = x; }
      const some = Object.keys(next).length > 0;
      if (some ? JSON.stringify(next) === JSON.stringify(p.lift) : !p.lift) return;
      if (some) p.lift = next; else delete p.lift;
      s.save(); field();
    },
    setFaces(faces: string) { const p = s.current(); if (!p || (faces !== 'left' && faces !== 'right')) return; p.faces = faces; s.save(true); all(); },
    /* A new main image from the picker, for the buddy selected when it was asked for, or nobody. */
    async setMainImage(file: MakerFile | null | undefined) {
      const p = s.current(), src = await readImage(file); if (!src) return;
      const r = await art.processBase(src);
      if (!r || !p) return;
      if (!s.state.pets.includes(p)) return toast(`${p.name || 'That buddy'} isn't here any more, so the picture went nowhere. It's still on your disk.`);
      setBase(p, r); world.act(p.id, 'love');
    },
    /* A pasted image swaps the selected buddy's main image, or is a new buddy if none is selected. */
    async pasteImage(file: MakerFile | null | undefined) {
      const p = s.current(), src = await readImage(file); if (!src) return;
      if (!p) return addFromSrc(src);
      const r = await art.processBase(src);
      if (!r) return;
      if (!s.state.pets.includes(p)) return toast(`${p.name || 'That buddy'} isn't here any more, so the picture went nowhere. Paste it again if you still want it.`);
      setBase(p, r);
    },
    /* what's on offer depends on the art */
    canAct: (p: MakerBuddy, action: string) => canDo(p, action),
    canAnyAct: (action: string) => s.state.pets.some(q => canDo(q, action)),
    act(id: string, action: string) { world.act(id, action); },
    /* Everyone at once, where the world has everyone. No id means everyone, so none can by accident. */
    actAll(action: string) { world.actAll?.(action); },
    toggleBubbles() { s.state.bubbles = s.state.bubbles === false; s.save(true); all(); },
    toggleNames() { s.state.names = s.state.names === false; s.save(true); all(); },
    setChatter(level: string) { if (!CHATTER.includes(level)) return; s.state.chatter = level as Chatter; s.save(true); all(); },
    exportPage() { s.save(true); return deps.exportPage(s.state); }
  };
}
