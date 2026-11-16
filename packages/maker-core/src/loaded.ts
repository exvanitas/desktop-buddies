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

/* Fields checked whole, and those checked one entry at a time, so one bad pose doesn't take the rest. */
const WHOLE = ['character', 'name', 'size', 'lift', 'faces', 'ref', 'signature'] as const;
const EACH = ['poses', 'lines', 'kit'] as const;

/* Her, rebuilt from the parts that pass, and whether anything with a value was left out. Null if her
   main image doesn't pass, since there's nothing to show without it. */
export function mend(raw: Fields): { buddy: Buddy; lost: boolean } | null {
  const { id: _, ...v } = raw;
  try { return { buddy: check(v), lost: false }; } catch { /* mended below */ }
  if (!passes({ base: v.base })) return null;
  const out: Fields = { base: v.base };
  let lost = false;
  for (const k of WHOLE) if (v[k] !== undefined) { if (passes({ base: v.base, [k]: v[k] })) out[k] = v[k]; else lost = true; }
  for (const k of EACH) {
    if (v[k] === undefined) continue;
    if (!isObject(v[k])) { lost = true; continue; }
    const kept: Fields = {};
    for (const [key, x] of Object.entries(v[k])) {
      if (passes({ base: v.base, [k]: { [key]: x } })) kept[key] = x;
      /* a pose whose speed or scale is out of range keeps her frames */
      else if (k === 'poses' && isObject(x) && passes({ base: v.base, poses: { [key]: { frames: x.frames } } })) {
        lost = true; kept[key] = { frames: x.frames };
        for (const f of ['fps', 'scale']) if (x[f] !== undefined && passes({ base: v.base, poses: { [key]: { frames: [], [f]: x[f] } } })) (kept[key] as Fields)[f] = x[f];
      } else lost = true;
    }
    if (k === 'poses' || Object.keys(kept).length) out[k] = kept;
  }
  for (const k of Object.keys(v)) if (k !== 'base' && v[k] !== undefined && !(WHOLE as readonly string[]).includes(k) && !(EACH as readonly string[]).includes(k)) lost = true;
  try { return { buddy: check(out), lost }; } catch { return null; }
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
