/* Holding the mouse. The exe's capture is a lease that lapses in 1.5 s, so a page that hangs can't
   eat clicks forever. While this page wants the mouse it renews well inside that. */
const RENEW_MS = 500;
/* how often a page should call tick */
export const RENEW_EVERY = 250;

export function createCapture(call: (on: boolean) => void, now: () => number) {
  let held = false, at = 0;
  const send = (on: boolean) => { at = now(); call(on); };
  return {
    /* Asks only when the answer changes. */
    set(on: boolean) { if (on !== held) { held = on; send(on); } },
    /* Call this on a timer, not from frames: a still world sends none. */
    tick() { if (held && now() - at >= RENEW_MS) send(true); }
  };
}
