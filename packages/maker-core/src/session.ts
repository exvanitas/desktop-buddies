/* What every part of the Maker shares: the state, what's selected, and saving. */
import { newCharacter, type PoseKey } from '@buddies/buddy-file';
import type { Change, MakerBuddy, MakerDeps, MakerState, Saved } from './deps';

export const SAVE_DELAY = 250;
const BROWSER_WARNING = "Couldn't save in this browser — buddies will reset on reload";

export function createSession(deps: MakerDeps) {
  const { store, world, toast, after, cancel, random, saveWarning = BROWSER_WARNING } = deps;
  const listeners = new Set<(c: Change) => void>();
  let saveT = 0, warned = false;

  async function persist(state: MakerState) {
    try { await store.save(state); }
    catch (e) { if (!warned) { warned = true; if (saveWarning !== null) toast(saveWarning); } }
  }
  const put = () => { world.sync(session.state); void persist(session.state); };
  async function load(): Promise<Saved> { try { return await store.load(); } catch (e) { return {}; } }

  const session = {
    /* not there until start() has loaded it */
    state: null as unknown as MakerState,
    selected: null as string | null,
    openPose: null as PoseKey | null,
    uid: () => 'b' + random().toString(36).slice(2, 9),
    current: (): MakerBuddy | undefined => session.state.pets.find(p => p.id === session.selected),
    /* now, or after a pause, for values that change as fast as a slider moves */
    save(now?: boolean) { cancel(saveT); if (now) put(); else saveT = after(SAVE_DELAY, put); },
    changed(c: Change) { listeners.forEach(f => f(c)); },
    subscribe(f: (c: Change) => void) { listeners.add(f); return () => { listeners.delete(f); }; },
    /* A buddy a host brought in from elsewhere, selected. Bringing her in isn't a change to her. */
    adopt(p: MakerBuddy) {
      if (!session.state.pets.some(x => x.id === p.id)) session.state.pets.push(p);
      session.selected = p.id; session.openPose = null; session.changed({ scope: 'all' });
    },
    /* Nobody selected, ready for a new buddy. */
    deselect() { session.selected = null; session.openPose = null; session.changed({ scope: 'all' }); },
    async start() {
      session.state = Object.assign({ pets: [], bubbles: true, chatter: 'normal', names: true } as MakerState, await load());
      const S = session.state;
      /* A first run holds no buddy: the samples are offered, never added. */
      S.started = true;
      S.pets.forEach(p => { p.character = p.character || newCharacter(); });
      session.save(true);
      session.selected = S.pets[0] ? S.pets[0].id : null;
      session.changed({ scope: 'all' });
    }
  };
  return session;
}
export type Session = ReturnType<typeof createSession>;
