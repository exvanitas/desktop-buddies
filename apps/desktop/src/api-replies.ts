/* Replies to the local API, in fixed slots: a reply goes to `api/replies/<slot>.json`, where the
   slot comes from its request id, and carries the full id so the caller can tell it's theirs. The
   folder never holds more than SLOTS reply files, so nothing needs sweeping, counting or adopting.
   One limit only the next exe can lift: a crash in the middle of the exe's own write can leave a
   hidden `.~pid-n` temp file beside them (docs/native-shell-design.md, For the next exe). Writes
   go through the exe's data commands, which keep everything inside the data folder, and any program
   on the PC can read them, so a reply holds only what docs/local-api.md allows.

   Each slot has at most one write in flight, and a newer reply for a slot replaces one waiting, so
   there are never more than SLOTS waiting. Two ids in one slot only mean a caller may find the other
   reply there and time out, which docs/local-api.md tells callers to expect. */
import type { Reply } from './local-api';
import type { Shell } from './shell';

export const REPLIES = 'api/replies';
export const SLOTS = 64;

/* FNV-1a over the id's characters, which are all ASCII, as a two-digit slot. Callers compute the
   same: tools/mcp/server.mjs and scripts/local-api-check.ps1. */
export function slotOf(id: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return String(h % SLOTS).padStart(2, '0');
}
export const replyPath = (id: string) => `${REPLIES}/${slotOf(id)}.json`;

export interface RepliesIO { shell: Pick<Shell, 'dataWrite'>; note(line: string): void }

export function createReplies(io: RepliesIO) {
  const waiting = new Map<string, Reply>(), flying = new Map<string, Promise<void>>();

  /* Writes the newest reply waiting in one slot, then any that came meanwhile, until none has. It
     stops flying in the same step that finds nothing waiting, so a reply can't land in between. */
  function fly(slot: string) {
    const p = (async () => {
      for (;;) {
        const r = waiting.get(slot);
        if (!r) { flying.delete(slot); return; }
        waiting.delete(slot);
        try { await io.shell.dataWrite(`${REPLIES}/${slot}.json`, JSON.stringify(r)); }
        catch (e) { io.note(`api: couldn't write a reply: ${e}`); }
      }
    })();
    flying.set(slot, p);
    return p;
  }

  return {
    write(r: Reply) {
      const slot = slotOf(r.id);
      waiting.set(slot, r);
      return flying.get(slot) ?? fly(slot);
    },
    get waiting() { return waiting.size; },
    get flying() { return flying.size; },
    get settled() { return Promise.all([...flying.values()]).then(() => {}); }
  };
}
