/* What the log may say about things that came from outside: never a full URL, a path, a file's
   name, an error's text or what a file holds. The log is the person's own, and it goes with bug
   reports. */

/* The overlay modes the app knows. Anything else is logged as `unknown`. */
const MODES: readonly unknown[] = ['demo', 'empty'];
export const modeSeen = (mode: unknown) => MODES.includes(mode) ? String(mode) : 'unknown';

/* A URL's scheme and host. A bare word, as a CSP report's `inline` or `eval`, stays as it is. */
export function originOf(url: unknown) {
  const s = String(url ?? '');
  if (/^[a-z-]{1,16}$/.test(s)) return s;
  try {
    const u = new URL(s);
    return u.host ? `${u.protocol}//${u.host}` : u.protocol;
  } catch { return 'unknown'; }
}

/* An error's kind, never its message: a parse error can quote what a file holds. */
export const errorKind = (e: unknown) => e instanceof Error && /^\w{1,40}$/.test(e.name) ? e.name : typeof e;
export const errorSeen = (e: ErrorEvent) => `${errorKind(e.error)} at ${originOf(e.filename)}:${e.lineno}`;
export const rejectionSeen = (e: PromiseRejectionEvent) => errorKind(e.reason);
export const cspSeen = (e: SecurityPolicyViolationEvent) => `${e.violatedDirective} ${originOf(e.blockedURI)}`;
