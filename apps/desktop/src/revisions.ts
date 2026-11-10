/* Which edition of a buddy a Maker window has. The hub hands one out with each load and save, and a
   save says which it was based on, so it can't land on top of someone else's change. They come from
   one counter, so a buddy deleted and imported again never gets one a window opened before that.
   Each run starts it at a random 52-bit number, not the clock, which can step back: a hub that
   restarted handing out what the last one did is a chance in billions. A window from before gets a
   refusal it might not have needed, which is safe and rare. They're only ever compared for being
   the same. */
import { randomStart } from './random-start';

export function createRevisions(start = randomStart()) {
  let last = start;
  const at = new Map<string, number>();
  /* The window that wrote her last, if nobody has changed her since. Saves run one at a time, so it
     can't be overtaking itself, whatever revision it thinks she's on: it may never have heard the
     last answer, or be closing and unable to wait for it. */
  const wrote = new Map<string, string>();
  const bump = (id: string) => { at.set(id, ++last); return last; };

  return {
    of: (id: string) => at.get(id) ?? bump(id),
    /* Someone other than a Maker window changed her: an import or a delete. */
    changed(id: string) { wrote.delete(id); bump(id); },
    /* This window's save landed. */
    saved(id: string, session: string) {
      wrote.set(id, session);
      return bump(id);
    },
    /* May this save go ahead? `there` says she's on disk. Based on nothing means a new buddy, which
       can't be anyone this run has seen. */
    accepts(id: string, rev: number | null, session: string, there: boolean) {
      if (!there) return rev === null && !at.has(id);
      return (rev !== null && rev === at.get(id)) || wrote.get(id) === session;
    }
  };
}
export type Revisions = ReturnType<typeof createRevisions>;
