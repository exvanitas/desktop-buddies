/* What a store hands back, made safe to start from. A store may hold anything: an older Maker's
   state, or a broken one's. Each buddy goes through the checks a .buddy file gets, which look only at
   the fields a buddy has, so a loop or a deep nest in what's saved can't stop them. One that fails is
   never mended: she goes, as she was, into `setAside`, which the Maker never touches again, and the
   person is told. Settings come back to values they can have. Whatever else the store had stays. */
import { check } from '@buddies/buddy-file';
import type { Chatter } from '@buddies/engine';
import type { MakerBuddy, MakerState } from './deps';

export const CHATTER: readonly Chatter[] = ['off', 'low', 'normal', 'high'];

type Fields = Record<string, unknown>;
const isObject = (v: unknown): v is Fields => v !== null && typeof v === 'object' && !Array.isArray(v);
const DEFAULTS = { bubbles: true, chatter: 'normal' as Chatter, names: true };

/* `told` is what to tell the person, if this load set anyone aside. */
export function fromSaved(saved: unknown, uid: () => string): { state: MakerState; told: string | null } {
  const s: Fields = isObject(saved) ? { ...saved } : {};
  const aside: unknown[] = [], names: string[] = [], ids = new Set<string>();
  const pets: MakerBuddy[] = [];
  let unreadable = false;
  if (Array.isArray(s.pets)) {
    for (const raw of s.pets) {
      const buddy = checked(raw);
      if (!buddy) { aside.push(raw); names.push(nameOf(raw)); continue; }
      let id = isObject(raw) && typeof raw.id === 'string' && raw.id ? raw.id : uid();
      while (ids.has(id)) id = uid();
      ids.add(id);
      pets.push({ ...buddy, id });
    }
  } else if (s.pets !== undefined && s.pets !== null) { aside.push(s.pets); unreadable = true; }
  /* Added to, never replaced: whoever an earlier load set aside stays there. */
  if (aside.length) s.setAside = [...s.setAside === undefined ? [] : Array.isArray(s.setAside) ? s.setAside : [s.setAside], ...aside];
  const state = {
    ...s, pets,
    bubbles: typeof s.bubbles === 'boolean' ? s.bubbles : DEFAULTS.bubbles,
    names: typeof s.names === 'boolean' ? s.names : DEFAULTS.names,
    chatter: CHATTER.includes(s.chatter as Chatter) ? s.chatter as Chatter : DEFAULTS.chatter
  } as MakerState;
  const told = unreadable ? "Couldn't read the saved buddies: what was saved is damaged. It's kept as it was, set aside."
    : names.length ? `Couldn't open ${list(names)}: what was saved is damaged. ${names.length === 1 ? "She's kept as she was" : "They're kept as they were"}, set aside.`
    : null;
  return { state, told };
}

/* Her as a file would have her, without her id, or null if a file couldn't. */
function checked(raw: unknown) {
  if (!isObject(raw)) return null;
  const { id: _, ...v } = raw;
  try { return check(v); } catch { return null; }
}
function nameOf(raw: unknown) {
  const n = isObject(raw) ? raw.name : undefined;
  return typeof n === 'string' && n.trim() ? `"${n.trim().slice(0, 64)}"` : 'a buddy with no name';
}
function list(names: string[]) {
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
