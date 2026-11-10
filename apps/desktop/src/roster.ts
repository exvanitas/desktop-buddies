/* Who's out, and how many copies of each. Saved as a plain list with an id repeated once per copy,
   so a settings file from before copies reads the same. */

/* The most copies of one buddy, the same as `--buddies` allows. */
export const MAX_COPIES = 24;

/* A copy's id in the world. A character id can't hold `~`, so these can't collide. The first copy
   is the character itself. */
export const copyId = (id: string, n: number) => n ? `${id}~${n}` : id;

export function createRoster() {
  let out = new Map<string, number>();
  const count = (id: string) => out.get(id) || 0;
  return {
    count,
    /* One more, and false if there's no room. */
    add(id: string) {
      if (count(id) >= MAX_COPIES) return false;
      out.set(id, count(id) + 1);
      return true;
    },
    /* The newest copy goes. Returns its world id. */
    drop(id: string): string | null {
      const n = count(id); if (!n) return null;
      if (n > 1) out.set(id, n - 1); else out.delete(id);
      return copyId(id, n - 1);
    },
    /* Every copy goes. Returns their world ids. */
    clear(id: string): string[] {
      const gone = Array.from({ length: count(id) }, (_, i) => copyId(id, i));
      out.delete(id);
      return gone;
    },
    load(ids: string[]) {
      out = new Map();
      for (const id of ids) if (count(id) < MAX_COPIES) out.set(id, count(id) + 1);
    },
    keep(known: Set<string>) { for (const id of out.keys()) if (!known.has(id)) out.delete(id); },
    list: () => [...out].flatMap(([id, n]) => Array.from({ length: n }, () => id))
  };
}
