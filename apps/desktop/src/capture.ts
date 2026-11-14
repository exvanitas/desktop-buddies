/* Holding the mouse. The exe's capture is a lease that lapses in 1.5 s, so a page that hangs can't
   eat clicks forever. While this page wants the mouse it renews well inside that, on a timer of its
   own, not from frames: a still world sends none. The timer runs only while it holds the mouse, so a
   page that doesn't wakes for nothing. */
const RENEW_MS = 500;
/* how often the timer looks */
export const RENEW_EVERY = 250;

export function createCapture(call: (on: boolean) => void, now: () => number, every: (ms: number, f: () => void) => () => void) {
  let held = false, at = 0, stop: (() => void) | null = null;
  const send = (on: boolean) => { at = now(); call(on); };
  const tick = () => { if (held && now() - at >= RENEW_MS) send(true); };
  return {
    /* Asks only when the answer changes. */
    set(on: boolean) {
      if (on === held) return;
      held = on; send(on);
      if (on && !stop) stop = every(RENEW_EVERY, tick);
      else if (!on && stop) { stop(); stop = null; }
    },
    /* whether its timer is running, for tests */
    get timed() { return stop !== null; }
  };
}
