/* The book is data, so a typo is a bug no compiler sees. These checks run at load and as tests:
   every name resolves, every behaviour can be reached and left, and every pose has a fallback. */
import { POSE, POSES, type PoseKey } from '@buddies/buddy-file';
import { ANIMS } from './anims';
import { BOOK } from './behaviours';
import { CONDITIONS } from './conditions';
import { CUES } from './cues';
import { LINES } from './data';
import { MOTIONS } from './motions';
import { lively, type Pace } from './pace';
import type { Behaviour, Book, Pick, Rule, Then } from './runner';

export interface Names {
  motions: string[]; cues: string[]; conditions: string[]; anims: string[]; moves: string[]; lines: string[];
  durations: string[]; weights: string[];
}
/* where the world starts, and where a buddy should always be able to get back to */
const START = 'air', REST = 'idle';

const rulesOf = (e: string | Rule[] | Then | undefined): Rule[] => !e ? [] : typeof e === 'string' ? [{ to: e }] : e;

/* Where a behaviour can go next, by name. */
function exits(book: Book, name: string, b: Behaviour) {
  const out: string[] = [];
  if (b.then === 'pick') out.push(...(book.picks[b.on[0]!] || []).map(p => p.to));
  else if (b.then === 'queued') out.push(REST);
  else out.push(...rulesOf(b.then).flatMap(r => r.to ? [r.to] : []));
  for (const e of Object.values(b.events || {})) out.push(...rulesOf(e).flatMap(r => r.to ? [r.to] : []));
  if (b.main.chance) out.push(b.main.chance.to);
  return out;
}
/* A motion can raise any of the book's own events. */
const bookExits = (book: Book) => Object.values(book.events).flatMap(e => rulesOf(e).flatMap(r => r.to ? [r.to] : []));

export function checkBook(book: Book, names: Names): string[] {
  const problems: string[] = [];
  const known = (list: string[], name: string | undefined, where: string, what: string) => { if (name !== undefined && !list.includes(name)) problems.push(`${where}: no ${what} called ${name}`); };
  const isTarget = (to: string) => Object.prototype.hasOwnProperty.call(book.behaviours, to) || names.moves.includes(to);
  const target = (to: string | undefined, where: string) => { if (to !== undefined && !isTarget(to)) problems.push(`${where}: nowhere called ${to}`); };
  const rule = (r: Rule, where: string) => {
    known(names.conditions, r.when, where, 'condition'); known(names.lines, r.say, where, 'line'); known(names.lines, r.lineOf, where, 'line');
    known(names.cues, r.cue, where, 'cue'); known(names.durations, r.dur, where, 'duration'); target(r.to, where);
  };
  const pick = (p: Pick, where: string) => { target(p.to, where); known(names.conditions, p.when, where, 'condition'); known(names.weights, p.weight || p.to, where, 'weight'); };

  for (const [name, b] of Object.entries(book.behaviours)) {
    const m = b.main;
    if (!Object.prototype.hasOwnProperty.call(POSE, m.pose)) problems.push(`${name}: no pose called ${m.pose}`);
    known(names.motions, m.motion, name, 'motion'); known(names.durations, m.hold, name, 'duration');
    known(names.durations, m.alt && m.alt.short, name, 'duration'); known(names.durations, m.alt && m.alt.big, name, 'duration');
    known(names.lines, m.say, name, 'line'); known(names.cues, m.cue, name, 'cue'); known(names.cues, m.each, name, 'cue'); known(names.anims, m.anim, name, 'anim');
    if (m.chance) target(m.chance.to, name);
    for (const c of [b.enter, b.exit]) for (const k of c ? [c.clip, ...c.or ? [c.or] : []] : []) if (!Object.prototype.hasOwnProperty.call(POSE, k)) problems.push(`${name}: no pose called ${k}`);
    if (b.exit?.ifDown && !b.on.includes('floor')) problems.push(`${name}: gets up only on the floor`);
    if (b.enter && !b.on.includes('floor')) problems.push(`${name}: comes from standing only on the floor`);
    if (b.then === 'pick' && !book.picks[b.on[0]!]) problems.push(`${name}: no pick table for ${b.on[0]}`);
    else if (typeof b.then === 'string' && b.then !== 'pick' && b.then !== 'queued') target(b.then, name);
    else if (Array.isArray(b.then)) b.then.forEach(r => rule(r, name));
    for (const [e, v] of Object.entries(b.events || {})) rulesOf(v).forEach(r => rule(r, `${name} ${e}`));
    if ((m.hold || m.once) && b.then === undefined && !m.motion) problems.push(`${name}: a hold with nothing after it`);
    if (b.then === undefined && !b.events && !m.motion) problems.push(`${name}: a dead end`);
  }
  for (const [place, table] of Object.entries(book.picks)) (table || []).forEach(p => pick(p, `${place} picks`));
  for (const [e, v] of Object.entries(book.events)) rulesOf(v).forEach(r => rule(r, `event ${e}`));
  for (const [a, to] of Object.entries(book.aliases)) if (!Object.prototype.hasOwnProperty.call(book.actions, to) && !Object.prototype.hasOwnProperty.call(book.behaviours, to)) problems.push(`alias ${a}: nothing called ${to}`);
  for (const [a, to] of Object.entries(book.direct)) target(to, `direct ${a}`);
  for (const [a, v] of Object.entries(book.actions)) { known(names.moves, v.move, `action ${a}`, 'move'); known(names.lines, v.say, `action ${a}`, 'line'); if (v.clip && !Object.prototype.hasOwnProperty.call(POSE, v.clip)) problems.push(`action ${a}: no pose called ${v.clip}`); }

  /* Walk the graph: a move always ends in the air. */
  const next = (name: string) => {
    const b = book.behaviours[name]; if (!b) return [START];
    return [...exits(book, name, b), ...(b.main.motion ? bookExits(book) : [])];
  };
  const walk = (from: string[]) => { const seen = new Set<string>(), todo = [...from]; while (todo.length) { const n = todo.pop()!; if (seen.has(n)) continue; seen.add(n); todo.push(...next(n)); } return seen; };
  /* Everything `act` can ask for counts as a way in: that's what menus use. */
  const onFloor = Object.keys(book.behaviours).filter(n => book.behaviours[n]!.on.includes('floor'));
  const reached = walk([START, ...bookExits(book), ...Object.values(book.direct), ...Object.values(book.aliases), ...onFloor]);
  for (const name of Object.keys(book.behaviours)) if (!reached.has(name)) problems.push(`${name}: nothing leads to it`);
  for (const name of Object.keys(book.behaviours)) if (book.behaviours[REST] && !walk([name]).has(REST)) problems.push(`${name}: never gets back to ${REST}`);
  return problems;
}
/* Every pose ends somewhere: at another pose's art, the main image, or a rotation of it. */
export function checkPoses(): string[] {
  const problems: string[] = [];
  for (const { key } of POSES) {
    const seen = new Set<string>();
    let k: string | null = key;
    while (k && k[0] !== '@') {
      if (seen.has(k)) { problems.push(`${key}: its fallbacks go round in a circle`); break; }
      seen.add(k);
      const slot: { fb: string | null } | undefined = POSE[k as PoseKey];
      if (!slot) { problems.push(`${key}: falls back to ${k}, which isn't a pose`); break; }
      k = slot.fb;
    }
  }
  return problems;
}

export const namesOf = (pace: Pace, moves: string[]): Names => ({
  motions: Object.keys(MOTIONS), cues: Object.keys(CUES), conditions: Object.keys(CONDITIONS), anims: Object.keys(ANIMS), moves, lines: Object.keys(LINES),
  durations: Object.keys(pace).filter(k => k !== 'weights' && k !== 'reach'), weights: Object.keys(pace.weights)
});

/* the moves a body offers, which only exist once there's a body */
export const MOVES = ['dropDown', 'leap', 'dropThrough', 'jumpThrough', 'hop', 'leapOff', 'jump', 'ceilGo', 'drop'];

let checked = false;
export function assertBook() {
  if (checked) return;
  const problems = [...checkBook(BOOK, namesOf(lively, MOVES)), ...checkPoses()];
  if (problems.length) throw new Error('the behaviour book has problems:\n' + problems.join('\n'));
  checked = true;
}
