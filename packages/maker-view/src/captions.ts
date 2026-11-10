/* Reading the sheets for one buddy: what a caption says now, and what art it points at. Pure. */
import { POSE, canShow, type Buddy, type PoseKey, type Situation } from '@buddies/buddy-file';
import { ONCE, UNBUILT, UNTRIGGERED } from './facts';
import { SITS, type SitDef } from './moments';

type Art = Pick<Buddy, 'poses'>;

/* "Stand / idle" is Stand, "Jump (going up)" is Jump, "Held, swung left" is Swung left. */
export const shortLabel = (l: string) => l.replace(/ \/ .*| \(.*/, '').replace('Held, swung ', 'Swung ');
export const label = (k: PoseKey) => shortLabel(POSE[k].label);

export const capOf = (p: Art, s: SitDef) => typeof s.cap === 'function' ? s.cap(k => canShow(p, k)) : s.cap;
export const artsIn = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1] as PoseKey);
export const artsOf = (p: Art, s: SitDef) => artsIn(capOf(p, s));
export const artOf = (p: Art, s: SitDef): PoseKey | null => artsOf(p, s)[0] ?? null;
export const silent = (p: Art, s: SitDef) => !!s.needs && !canShow(p, s.needs);
export const sitOf = (k: Situation) => SITS.find(s => s.k === k)!;
/* The situations whose words use this art. */
export const usedFor = (p: Art, k: PoseKey) => SITS.filter(s => artsOf(p, s).includes(k));

export type Part = string | { pose: PoseKey };
/* A caption in pieces: words and the art they name. */
export function partsOf(text: string): Part[] {
  return text.split(/(\{\w+\})/).filter(Boolean).map(x => /^\{\w+\}$/.test(x) ? { pose: x.slice(1, -1) as PoseKey } : x);
}
export const plain = (text: string) => partsOf(text).map(x => typeof x === 'string' ? x : label(x.pose)).join('');
/* What a sequence says, one step at a time. */
export const stepsOf = (flow: string) => flow.split(/(?<=[.])\s+/).map(x => x.replace(/\.$/, ''));

export const saidOnce = (s: SitDef) => s.needs ? `Saved, and said once ${label(s.needs)} has art` : '';

/* What a pose with no art of its own, and no fallback, really does. Promises nothing it can't keep. */
export function noArtNote(name: string, k: PoseKey) {
  if (UNBUILT.has(k)) return 'Not in the game yet. Art added here is kept for when it is.';
  if (UNTRIGGERED.has(k)) return 'Try can show this once it has art, but nothing sets it off on its own yet.';
  if (k === 'turn_back') return 'Plays after Face away, and nothing sets that off on its own yet.';
  const who = name || 'this buddy';
  if (k === 'dragL' || k === 'dragR') return `Without it ${who} swings on Held. Add art and she leans into the swing.`;
  if (k === 'roll') return `Without it ${who} rolls by spinning Stand like a wheel. Add art and she shows it as she rolls.`;
  if (k.startsWith('stand_up_from_')) return `Without it ${who} gets up through Stand up, if that has art. Add art and this one gets its own.`;
  if (k === 'sit_down') return `Without it ${who} sits at once. Add art and she sits down into Sit from standing.`;
  if (k === 'fall_asleep') return `Without it ${who} drops straight into Sleep. Add art and she dozes off first.`;
  return `${name || 'This buddy'} doesn't do this yet. Add art and it will.`;
}

/* The note beside a pose in the tray. */
export function ownNote(k: PoseKey, frames: number) {
  const hint = POSE[k].hint || '', out: string[] = [];
  if (UNBUILT.has(k)) out.push('Not in the game yet. This art is kept for when it is.');
  else if (UNTRIGGERED.has(k)) out.push('Nothing sets this off on its own yet.');
  if (hint && !/^1.2 frames/.test(hint)) out.push(hint);
  if (ONCE.has(k) && !/plays once/i.test(hint)) out.push('Plays once.');
  if ((k === 'dragL' || k === 'dragR') && frames === 2) out.push('Frame 1 is a gentle swing, frame 2 a strong one.');
  else if ((k === 'dragL' || k === 'dragR') && frames !== 2) out.push('One frame, or two: gentle, then strong.');
  return out.join(' ');
}
