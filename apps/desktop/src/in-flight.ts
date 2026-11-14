/* Work over a list with a few calls out at once. Each call to the exe is a round trip, and with
   one out at a time a save of a thousand small files waits out a thousand round trips back to back.
   With a few out, one's way there and back overlaps the exe's work on the one before. They start in
   the list's order. After a failure no more start: the ones already out are waited for, so nothing
   is still landing once it's over, and the first failure is what it throws. */
export async function inFlight<T>(items: Iterable<T>, most: number, each: (item: T) => Promise<unknown>): Promise<void> {
  const next = items[Symbol.iterator]();
  let failed = false, first: unknown;
  async function lane() {
    while (!failed) {
      const n = next.next();
      if (n.done) return;
      try { await each(n.value); }
      catch (e) { if (!failed) { failed = true; first = e; } }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.floor(most)) }, lane));
  if (failed) throw first;
}
