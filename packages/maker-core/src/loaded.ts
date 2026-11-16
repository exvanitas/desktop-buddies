/* What a store hands back, made safe to start from. A store may hold anything: an older Maker's
   state, or a broken one's. Each buddy goes through the checks a .buddy file gets. One that fails
   keeps every part that passes, and only one with no main image left is dropped. Settings come back
   to values they can have. Whatever else the store had stays as it was. */
import { check, type Buddy } from '@buddies/buddy-file';
import type { Chatter } from '@buddies/engine';
import type { MakerBuddy, MakerState } from './deps';

export const CHATTER: readonly Chatter[] = ['off', 'low', 'normal', 'high'];

type Fields = Record<string, unknown>;
const isObject = (v: unknown): v is Fields => v !== null && typeof v === 'object' && !Array.isArray(v);
const passes = (v: Fields) => { try { check(v); return true; } catch { return false; } };

/* Stands in for her main image while her other parts are tried, so a big picture isn't read again
   for each one. Hers is checked on its own first. */
const STAND_IN = { src: 'data:image/png;base64,AA==', bb: { x0: 0, y0: 0, x1: 1, y1: 1 } };

/* `v` if it passes `ok`, or else whatever of it does: an object each entry that passes, a list each
   item that passes and as many as the list may hold. Undefined if nothing does. `cut` hears of
   anything left out, which is so once `v` fails. */
function prune(v: unknown, ok: (x: unknown) => boolean, cut: () => void): unknown {
  if (ok(v)) return v;
  cut();
  if (Array.isArray(v)) {
    const kept = v.map(x => prune(x, y => ok([y]), cut)).filter(x => x !== undefined);
    while (kept.length && !ok(kept)) kept.pop();
    return kept.length ? kept : undefined;
  }
  if (!isObject(v)) return undefined;
  const out: Fields = {};
  /* Each part is tried alone, so a big one is read once, and then beside what's kept, for a part that
     needs another, as a pose's speed needs her frames. Again while anything new is kept. */
  for (let more = true; more;) {
    more = false;
    for (const [k, x] of Object.entries(v)) {
      if (Object.hasOwn(out, k)) continue;
      const y = prune(x, z => ok({ [k]: z }), cut) ?? (ok({ ...out, [k]: x }) ? x : undefined);
      if (y !== undefined) { out[k] = y; more = true; }
    }
  }
  return Object.keys(out).length && ok(out) ? out : undefined;
}

/* Her, rebuilt from the parts that pass, and whether anything with a value was left out. Null if her
   main image doesn't pass, since there's nothing to show without it. */
export function mend(raw: Fields): { buddy: Buddy; lost: boolean } | null {
  const { id: _, base, ...rest } = raw;
  try { return { buddy: check({ ...rest, base }), lost: false }; } catch { /* mended below */ }
  if (!passes({ base })) return null;
  let lost = false;
  const kept = prune(rest, x => isObject(x) && passes({ ...x, base: STAND_IN }), () => { lost = true; });
  try { return { buddy: check({ ...kept as Fields | undefined, base }), lost }; } catch { return null; }
}

const DEFAULTS = { bubbles: true, chatter: 'normal' as Chatter, names: true };

/* `told` is what to tell the person, if anything: who couldn't be kept, and who was kept in part. */
export function fromSaved(saved: unknown, uid: () => string): { state: MakerState; told: string | null } {
  const s: Fields = isObject(saved) ? { ...saved } : {};
  const dropped: string[] = [], mended: string[] = [], ids = new Set<string>();
  const pets: MakerBuddy[] = [];
  let unreadable = false;
  if (Array.isArray(s.pets)) {
    for (const raw of s.pets) {
      const r = isObject(raw) ? mend(raw) : null;
      if (!r) { dropped.push(nameOf(raw)); continue; }
      let id = isObject(raw) && typeof raw.id === 'string' && raw.id ? raw.id : uid();
      while (ids.has(id)) id = uid();
      ids.add(id);
      pets.push({ ...r.buddy, id });
      if (r.lost) mended.push(nameOf(r.buddy));
    }
  } else if (s.pets !== undefined && s.pets !== null) unreadable = true;
  const state = {
    ...s, pets,
    bubbles: typeof s.bubbles === 'boolean' ? s.bubbles : DEFAULTS.bubbles,
    names: typeof s.names === 'boolean' ? s.names : DEFAULTS.names,
    chatter: CHATTER.includes(s.chatter as Chatter) ? s.chatter as Chatter : DEFAULTS.chatter
  } as MakerState;
  const told = [
    unreadable ? "Couldn't read the saved buddies, so the Maker starts with none." : '',
    dropped.length ? `Couldn't keep ${list(dropped)}: what was saved is damaged.` : '',
    mended.length ? `Kept ${list(mended)}, leaving out a part that was damaged.` : ''
  ].filter(Boolean).join(' ');
  return { state, told: told || null };
}

function nameOf(raw: unknown) {
  const n = isObject(raw) ? raw.name : undefined;
  return typeof n === 'string' && n.trim() ? `"${n.trim().slice(0, 64)}"` : 'a buddy with no name';
}
function list(names: string[]) {
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
