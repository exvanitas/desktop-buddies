/* The local API: other apps on this PC ask buddies to do harmless things. A request arrives as the
   exe's second launch, `desktop-buddies.exe --api "<one JSON request>"`, and the reply is a file in
   the data folder. Every request is treated as hostile. Nothing here touches the disk, the library
   or settings: the hub hands in what it knows and does what this says. See docs/local-api.md. */

/* What an app may ask a buddy to do. Add an engine action name here to offer it. */
export const API_ACTIONS = ['wave'] as const;
export type ApiAction = (typeof API_ACTIONS)[number];

export const LIMITS = {
  bytes: 2048, /* one request, as UTF-8 */
  app: 40, /* an app's name, in characters */
  text: 120, /* one line to say, after cleaning */
  perApp: 30, /* requests a minute from one app */
  says: 4, /* lines a minute from one app */
  all: 60, /* requests a minute from everyone, since names are free */
  asking: 3, /* apps waiting on the person at once */
  buckets: 256, /* rate counters kept at once */
  windowMs: 60_000
} as const;

/* A request id becomes a file name, so it's plain, long enough to never be a device name, and lower
   case, since Windows would take two that differ only in case for one file. */
export const ID = /^[a-z0-9_-]{8,64}$/;
/* Letters, digits, and . _ - with single spaces between words. */
const APP = /^[A-Za-z0-9._-]+( [A-Za-z0-9._-]+)*$/;
const BUDDY = /^[A-Za-z0-9_-]{1,64}$/;

export type ApiError =
  | 'bad-request' | 'too-big' | 'unknown-action' | 'off' | 'paused' | 'not-ready' | 'rate-limited'
  | 'waiting' | 'not-allowed' | 'busy' | 'no-buddy' | 'not-out' | 'hidden' | 'cant-do'
  | 'too-long' | 'empty' | 'link' | 'not-running' | 'full';

/* What each one tells the caller, in plain words. Nothing here names a person, a path or an app. */
export const MESSAGES: Record<ApiError, string> = {
  'bad-request': 'That request isn\'t one this understands.',
  'too-big': `A request can be at most ${LIMITS.bytes} bytes.`,
  'unknown-action': 'Buddies can\'t be asked to do that.',
  off: 'The person hasn\'t turned this on. It\'s in the Manager\'s settings.',
  paused: 'Buddies are paused.',
  'not-ready': 'Desktop Buddies is still getting ready. Ask again in a moment.',
  'rate-limited': 'Too many requests. Wait a minute.',
  waiting: 'Waiting for the person to allow this app in the Manager.',
  'not-allowed': 'The person didn\'t allow this app.',
  busy: 'Other apps are waiting to be allowed. Ask again later.',
  'no-buddy': 'There\'s no buddy with that id.',
  'not-out': 'She isn\'t out on the desktop.',
  hidden: 'Buddies are hidden.',
  'cant-do': 'She has no art for that.',
  'too-long': `A line can be at most ${LIMITS.text} characters.`,
  empty: 'There\'s nothing to say.',
  link: 'A line can\'t have a link in it.',
  'not-running': 'Desktop Buddies wasn\'t running. Start it, then ask again.',
  full: 'The person has answered as many apps as this keeps. They can remove one in the Manager\'s settings.'
};

export type ApiRequest =
  | { id: string; app: string; do: 'list' }
  | { id: string; app: string; do: 'act'; buddy: string; action: ApiAction }
  | { id: string; app: string; do: 'say'; buddy: string; text: string };
/* `id` is there when the request had one that can be replied to. */
export type Parsed = { ok: true; req: ApiRequest } | { ok: false; error: ApiError; id?: string };

/* A buddy as a reply shows her. Nothing else about her leaves the app. */
export interface ApiBuddy { id: string; name: string; out: boolean; copies: number; can: ApiAction[] }
export type Reply =
  | { v: 1; id: string; ok: true; buddies?: ApiBuddy[] }
  | { v: 1; id: string; ok: false; error: ApiError; message: string };

const KEYS: Record<ApiRequest['do'], readonly string[]> = {
  list: ['v', 'id', 'app', 'do'],
  act: ['v', 'id', 'app', 'do', 'buddy', 'action'],
  say: ['v', 'id', 'app', 'do', 'buddy', 'text']
};
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isDo = (d: unknown): d is ApiRequest['do'] => typeof d === 'string' && has(KEYS, d);
export const validApp = (a: unknown): a is string => typeof a === 'string' && a.length <= LIMITS.app && APP.test(a);

/* Control and invisible formatting characters go, line breaks and tabs become spaces, and runs of
   space are one. */
const STRIP = /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g;
/* Dots that read as one in an address bar, made plain before looking. */
const DOTS = /[\u3002\uFF0E\uFF61\u2024\uFE52\u2E3C\u0589\u06D4\u1362\u00B7\u2027\u30FB]/g;
/* A scheme, www., xn--, or a domain: a label, a dot and a TLD of letters, with more labels before
   it if it likes. A one-letter TLD, as in e.g. or U.S.A., or digits, as in 3.14, isn't one. Checked
   on a folded copy too, so wide or styled letters can't hide one. */
const LINKS = [/[a-z][a-z0-9+.-]*:\/\//i, /\bwww\./i, /\bxn--/i,
  /(?<![a-z0-9-])[a-z0-9](?:[a-z0-9-]{0,62})(?:\.[a-z0-9-]{1,63})*\.[a-z]{2,24}(?![a-z0-9-])/i];
export function cleanLine(text: string): { ok: true; text: string } | { ok: false; error: ApiError } {
  const line = text.replace(STRIP, ' ').replace(/\s+/g, ' ').trim();
  if (!line) return { ok: false, error: 'empty' };
  if ([...line].length > LIMITS.text) return { ok: false, error: 'too-long' };
  const plain = line.replace(DOTS, '.'), folded = line.normalize('NFKC').replace(DOTS, '.');
  if (LINKS.some(l => l.test(folded) || l.test(plain))) return { ok: false, error: 'link' };
  return { ok: true, text: line };
}

/* Strict: JSON of a plain object, at most LIMITS.bytes, with exactly the keys its action takes. */
export function parseRequest(raw: string): Parsed {
  if (typeof raw !== 'string') return { ok: false, error: 'bad-request' };
  if (raw.length > LIMITS.bytes || new TextEncoder().encode(raw).length > LIMITS.bytes) return { ok: false, error: 'too-big' };
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return { ok: false, error: 'bad-request' }; }
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: 'bad-request' };
  const r = o as Record<string, unknown>;
  const id = has(r, 'id') && typeof r.id === 'string' && ID.test(r.id) ? r.id : undefined;
  const no = (error: ApiError): Parsed => ({ ok: false, error, ...(id ? { id } : {}) });
  if (!id || r.v !== 1 || !validApp(r.app)) return no('bad-request');
  if (!isDo(r.do)) return no(typeof r.do === 'string' ? 'unknown-action' : 'bad-request');
  const keys = KEYS[r.do], own = Object.keys(r);
  if (own.length !== keys.length || own.some(k => !keys.includes(k))) return no('bad-request');
  const app = r.app as string;
  if (r.do === 'list') return { ok: true, req: { id, app, do: 'list' } };
  if (typeof r.buddy !== 'string' || !BUDDY.test(r.buddy)) return no('bad-request');
  if (r.do === 'act') {
    if (typeof r.action !== 'string') return no('bad-request');
    if (!(API_ACTIONS as readonly string[]).includes(r.action)) return no('unknown-action');
    return { ok: true, req: { id, app, do: 'act', buddy: r.buddy, action: r.action as ApiAction } };
  }
  if (typeof r.text !== 'string') return no('bad-request');
  const line = cleanLine(r.text);
  if (!line.ok) return no(line.error);
  return { ok: true, req: { id, app, do: 'say', buddy: r.buddy, text: line.text } };
}

/* The request after `--api`, or null for a launch that isn't one. A missing one is empty, which
   parses as nothing. */
export function apiArg(args: string[]): string | null {
  const i = args.indexOf('--api');
  return i < 0 ? null : args[i + 1] ?? '';
}

/* How many times each key went in the last minute. Every take drops what has expired everywhere,
   and a new key past `cap` is refused rather than kept, so made-up names can't grow it. */
export function createRate(now: () => number, windowMs: number = LIMITS.windowMs, cap: number = LIMITS.buckets) {
  const seen = new Map<string, number[]>();
  function prune() {
    const t = now();
    for (const [k, times] of seen) {
      const kept = times.filter(x => t - x < windowMs);
      if (kept.length) seen.set(k, kept); else seen.delete(k);
    }
  }
  return {
    /* True, and counted, if `key` has had fewer than `max` this minute. */
    take(key: string, max: number) {
      prune();
      const kept = seen.get(key) ?? [];
      if (kept.length >= max || (!seen.has(key) && seen.size >= cap)) return false;
      seen.set(key, [...kept, now()]);
      return true;
    },
    get size() { prune(); return seen.size; }
  };
}

export type Consent = 'allow' | 'deny' | undefined;
/* What the hub knows and does. All of it is synchronous, so one request is decided at once. */
export interface ApiHost {
  now(): number;
  note(line: string): void;
  on(): boolean;
  ready(): boolean;
  paused(): boolean;
  hidden(): boolean;
  consent(app: string): Consent;
  /* Ask the person about a new app: asked, or busy with too many waiting, or full with as many
     answers as are kept. */
  ask(app: string): 'asked' | 'busy' | 'full';
  buddies(): ApiBuddy[];
  act(buddy: string, action: ApiAction): void;
  say(buddy: string, text: string, app: string): void;
}

/* Decides each request and says what to reply, or null when there's nobody to reply to. The log
   says what was asked and what came of it, never the app or the words. */
export function createLocalApi(host: ApiHost) {
  const rate = createRate(host.now);
  const reply = (id: string, error: ApiError): Reply => ({ v: 1, id, ok: false, error, message: MESSAGES[error] });
  const done = (id: string, buddies?: ApiBuddy[]): Reply => ({ v: 1, id, ok: true, ...(buddies ? { buddies } : {}) });

  function decide(req: ApiRequest): Reply {
    const { id, app } = req;
    if (!host.ready()) return reply(id, 'not-ready');
    if (!host.on()) return reply(id, 'off');
    if (host.paused()) return reply(id, 'paused');
    /* Consent first, so only an app the person answered has counters: the rest are bounded by the
       limit for everyone and the few that can wait. */
    const said = host.consent(app);
    if (said === 'deny') return reply(id, 'not-allowed');
    if (said !== 'allow') { const a = host.ask(app); return reply(id, a === 'asked' ? 'waiting' : a); }
    const key = app.toLowerCase();
    if (!rate.take('app ' + key, LIMITS.perApp)) return reply(id, 'rate-limited');
    if (req.do === 'list') return done(id, host.buddies());
    const b = host.buddies().find(x => x.id === req.buddy);
    if (!b) return reply(id, 'no-buddy');
    if (!b.out) return reply(id, 'not-out');
    if (host.hidden()) return reply(id, 'hidden');
    if (req.do === 'act') {
      if (!b.can.includes(req.action)) return reply(id, 'cant-do');
      host.act(b.id, req.action);
      return done(id);
    }
    if (!rate.take('say ' + key, LIMITS.says)) return reply(id, 'rate-limited');
    host.say(b.id, req.text, app);
    return done(id);
  }

  return {
    get buckets() { return rate.size; },
    handle(raw: string): Reply | null {
      const p = parseRequest(raw), id = p.ok ? p.req.id : p.id;
      if (!rate.take('all', LIMITS.all)) {
        host.note('api: refused rate-limited, everyone');
        return id ? reply(id, 'rate-limited') : null;
      }
      if (!p.ok) {
        host.note(`api: refused ${p.error}${p.id ? '' : ', no reply'}`);
        return p.id ? reply(p.id, p.error) : null;
      }
      const r = decide(p.req);
      host.note(`api ${p.req.do}: ${r.ok ? 'done' : r.error}`);
      return r;
    }
  };
}

/* The reply for a launch that started the app, which then quits. */
export function notRunning(raw: string): Reply | null {
  const p = parseRequest(raw), id = p.ok ? p.req.id : p.id;
  return id ? { v: 1, id, ok: false, error: 'not-running', message: MESSAGES['not-running'] } : null;
}
