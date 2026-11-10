/* What the engine really does, read from its behaviour book, so the view can't promise otherwise. */
import { POSES, type PoseKey, type Situation } from '@buddies/buddy-file';
import { BOOK, type Behaviour, type Book, type Rule } from '@buddies/engine';
import { ACTS } from '@buddies/maker-core';

type Then = string | Rule[] | undefined;
/* the clips around a behaviour: in, out, and the one played when its own out has no art */
export const clipsOf = (b: Behaviour) => [b.enter, b.exit].flatMap(c => c ? [c.clip, ...c.or ? [c.or] : []] : []);
const targets = (t: Then): string[] => typeof t === 'string' ? [t] : (t || []).flatMap(r => r.to ? [r.to] : []);

/* Everything a behaviour can be sent to by a rule, an event or a pick. */
export function reachedIn(book: Book) {
  const out = new Set<string>();
  for (const list of Object.values(book.picks)) for (const p of list) out.add(p.to);
  for (const e of Object.values(book.events)) targets(e).forEach(t => out.add(t));
  for (const b of Object.values(book.behaviours)) {
    targets(b.then).forEach(t => out.add(t));
    if (b.main.chance) out.add(b.main.chance.to);
    for (const e of Object.values(b.events || {})) targets(e).forEach(t => out.add(t));
  }
  return out;
}

/* Poses that play through and hand on. */
export function onceIn(book: Book) {
  const out = new Set<string>();
  for (const b of Object.values(book.behaviours)) {
    if (b.main.once) out.add(b.main.pose);
    clipsOf(b).forEach(k => out.add(k));
  }
  for (const a of Object.values(book.actions)) if (a.clip) out.add(a.clip);
  return out;
}

const reached = reachedIn(BOOK);
export const ONCE: ReadonlySet<string> = onceIn(BOOK);
/* Behaviours with their art ready that nothing ever starts: they only come when asked for. */
export const UNTRIGGERED: ReadonlySet<string> = new Set(POSES.map(p => p.key as string).filter(k => BOOK.behaviours[k] && !reached.has(k)));
/* Picked by a motion, so they aren't behaviours of their own. See motions.ts. */
const BY_MOTION: readonly PoseKey[] = ['jump', 'thrown', 'dragL', 'dragR', 'roll'];
/* In the schema, with nothing in the engine to show them. */
export const UNBUILT: ReadonlySet<string> = new Set(POSES.map(p => p.key as string).filter(k => {
  const shows = Object.values(BOOK.behaviours).some(b => b.main.pose === k);
  return !shows && !ONCE.has(k) && !BY_MOTION.includes(k as PoseKey);
}));

/* Poses she stands on the floor in, where a Lift means something: a floor behaviour shows them and
   no other one does. An action's clip doesn't count: Struggle is on the floor so it can be tried, and
   plays held. The roll's motion shows Roll when it's drawn. */
export function floorIn(book: Book) {
  const shown = (b: Behaviour) => [b.main.pose, ...clipsOf(b), ...b.main.motion === 'roll' ? ['roll'] : []];
  const all = Object.values(book.behaviours);
  const off = new Set(all.filter(b => b.on.some(o => o !== 'floor')).flatMap(shown));
  return new Set(all.filter(b => b.on.includes('floor')).flatMap(shown).filter(k => !off.has(k)));
}
export const ON_FLOOR: ReadonlySet<string> = floorIn(BOOK);

/* Where each pose happens, so a preview can put the buddy on the right surface. */
export type Surface = 'floor' | 'wall' | 'ceiling' | 'air' | 'held' | 'along' | 'ledge';
const SURFACES: Partial<Record<PoseKey, Surface>> = {
  climb: 'wall', wall: 'wall', crawl: 'ceiling', hang: 'ceiling',
  jump: 'air', fall: 'air', thrown: 'air',
  drag: 'held', dragL: 'held', dragR: 'held', struggle: 'held',
  walk: 'along', run: 'along', dangle_legs: 'ledge'
};
export const surfaceOf = (k: PoseKey): Surface => SURFACES[k] || 'floor';
/* Surfaces a preview draws a floor under. */
export const FLOORED: ReadonlySet<Surface> = new Set(['floor', 'along', 'ledge']);

/* What a Try shows in the preview: the art it ends up on, and the line it starts with. Most is the
   book's. These are moves rather than behaviours, or run to somewhere first. */
const MOVES: Record<string, { pose: PoseKey; say?: Situation }> = {
  jump: { pose: 'jump' }, ceilGo: { pose: 'crawl' }, drop: { pose: 'fall', say: 'drop' }, climbGo: { pose: 'climb', say: 'climb' }
};
/* Motions that pick the pose, as motions.ts does. Air and held pick by speed and swing, and no Try
   starts them. */
const PICKS: Record<string, (has: (k: PoseKey) => boolean) => PoseKey> = { roll: has => has('roll') ? 'roll' : 'stand' };
/* `has`: whether this buddy has her own art for a pose */
export function tryOf(action: string, has: (k: PoseKey) => boolean): { pose: PoseKey; say?: Situation } {
  if (MOVES[action]) return MOVES[action]!;
  const m = BOOK.behaviours[action]!.main, pick = m.motion ? PICKS[m.motion] : undefined;
  return { pose: pick ? pick(has) : m.pose as PoseKey, ...m.say ? { say: m.say as Situation } : {} };
}
export const TRY_ACTIONS: readonly string[] = ACTS.map(([a]) => a);
