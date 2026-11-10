/* The runner: plays behaviours, which are data, over motions, which are code. It knows nothing of
   physics or drawing. Everything it touches comes in through the book and the actor, so a test can
   run it with neither. */

/* where a buddy is */
export type Place = 'floor' | 'wall' | 'ceil' | 'air';

/* what a behaviour is entered with */
export interface Arg { dir?: number; line?: string; dur?: number; short?: boolean; big?: boolean; hurt?: boolean }

/* One thing that can happen. Rules are tried in order: `when` must hold and `below` must beat a
   single draw shared by the whole list, and the first that passes runs. */
export interface Rule {
  when?: string;
  below?: number;
  say?: string;
  cue?: string;
  to?: string;
  arg?: Arg;
  /* a coin toss for `arg.dir`, a duration from the pace table, or a line to enter with */
  dir?: 'either';
  dur?: string;
  lineOf?: string;
}
export type Then = 'pick' | 'queued' | string | Rule[];

export interface Step {
  pose: string;
  motion?: string;
  /* played once, for as long as its frames last, instead of holding */
  once?: boolean;
  /* the pace table's duration, and others to use when the argument says so */
  hold?: string;
  alt?: Partial<Record<'short' | 'big', string>>;
  /* said on entry; an argument's own line wins */
  say?: string;
  odds?: number;
  /* a cue on entry, a cue every tick, and how `anim` moves the art */
  cue?: string;
  each?: string;
  anim?: string;
  /* per-tick odds of cutting the step short */
  chance?: { odds: number; to: string };
}
/* A clip around a behaviour's main step, played if the character has the art. `or`: played instead when
   `clip` has none. `ifDown`: only when what she shows for the main pose is clearly lower than her
   standing art, as a Dizzy drawn sitting is. */
export interface Clip { clip: string; or?: string; ifDown?: boolean }
export interface Behaviour {
  on: readonly Place[];
  main: Step;
  /* played before the main step, and only when she comes to it standing, so she never sits down twice */
  enter?: Clip;
  /* played on a normal ending */
  exit?: Clip;
  then?: Then;
  events?: Record<string, string | Rule[]>;
  /* calm buddies chat and meet each other */
  calm?: boolean;
}
/* an entry in a pick table; its weight is named `weight`, or after `to`, in the pace table */
export interface Pick { to: string; weight?: string; when?: string; dir?: 'either'; arg?: Arg }
/* something `act` can be asked for that isn't a behaviour */
export interface Action { on?: readonly Place[]; move?: string; say?: string; clip?: string }

export interface Book {
  behaviours: Record<string, Behaviour>;
  picks: Partial<Record<Place, Pick[]>>;
  /* other names for an action */
  aliases: Record<string, string>;
  /* names that go straight to a behaviour, wherever she is; in the air, once she lands */
  direct: Record<string, string>;
  actions: Record<string, Action>;
  /* what happens on an event no behaviour handles */
  events: Record<string, string | Rule[]>;
}

export interface Motion<A> {
  start?(actor: A, arg: Arg | undefined): void;
  tick?(actor: A, dt: number): void;
  pose?(actor: A): string;
}
/* what the runner keeps on the buddy */
export interface Playing { state: string; t: number; dur: number; arg: Arg | null; next: string | null; clip: { pose: string; then: () => void } | null }

export interface Actor {
  P: Playing;
  random(): number;
  place(): Place;
  say(text: string, from?: string): void;
  line(key: string): string;
  /* a character without the art for an optional pose never does what needs it */
  canShow(pose: string): boolean;
  /* a clip with no frames doesn't play */
  hasArt(pose: string): boolean;
  clipLength(pose: string): number;
  /* How long one pass of her own art for a pose lasts, or 0 when it has one frame or none. */
  loop(pose: string): number;
  /* Is her own art for this pose clearly lower than her standing art? Without art of its own, yes. */
  down(pose: string): boolean;
  /* how the pace table is read */
  duration(name: string): number | [number, number];
  weight(name: string): number;
}
export interface Parts<A> {
  motions: Record<string, Motion<A>>;
  cues: Record<string, (actor: A, dt: number) => void>;
  moves: Record<string, (actor: A) => void>;
  conditions: Record<string, (actor: A) => boolean>;
}

/* The longest a timed step waits for its pass, in 60 Hz frames: 3 s. A gesture's loop (a wave, a
   yawn, a sway) is a second or two, so it always finishes. A pass that would end later, like a
   120-frame loop at 6.5 fps (18 s), ends on time unless it was nearly done, so a queued request
   behind Land or anything else waits 3 s at most. */
export const PASS_WAIT = 180;
/* When a timed step of `dur` frames really ends, with her art's pass `pass` frames long (0 for none):
   at the first pass end at or after its time, so it never waits a whole pass, and only if that comes
   within PASS_WAIT. */
export function passEnd(dur: number, pass: number) {
  if (!pass) return dur;
  const end = Math.ceil(dur / pass - 1e-9) * pass;
  return end - dur > PASS_WAIT ? dur : end;
}

export function createRunner<A extends Actor>(book: Book, parts: Parts<A>, actor: A) {
  const P = actor.P;
  /* counts transitions, so a tick can tell when its motion moved on */
  let entered = 0;
  const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  const holds = (name: string) => parts.conditions[name]!(actor);

  function hold(step: Step, arg: Arg | undefined) {
    if (!step.hold) return;
    if (arg && arg.dur) { P.dur = arg.dur; return; }
    let name = step.hold;
    if (step.alt && arg) { if (arg.short && step.alt.short) name = step.alt.short; if (arg.big && step.alt.big) name = step.alt.big; }
    const v = actor.duration(name);
    P.dur = typeof v === 'number' ? v : v[0] + actor.random() * (v[1] - v[0]);
  }
  function speak(step: Step, arg: Arg | undefined) {
    if (arg && arg.line != null) { if (step.say) actor.say(arg.line); }
    else if (step.say && (step.odds === undefined || actor.random() < step.odds)) actor.say(actor.line(step.say));
  }
  /* the clip to play, if she has art for it and its pose asks for it */
  function drawn(c: Clip | undefined, pose: string) {
    if (!c || (c.ifDown && !actor.down(pose))) return null;
    return actor.hasArt(c.clip) ? c.clip : c.or && actor.hasArt(c.or) ? c.or : null;
  }
  /* the pose a clip that just ended showed, while it hands on */
  let leaving: string | null = null;
  function go(name: string, arg?: Arg) {
    const b = book.behaviours[name]!, step = b.main;
    /* what she showed until now, standing or not */
    const from = b.enter ? leaving ?? (has(book.behaviours, P.state) ? pose() : null) : null;
    P.state = name; P.t = 0; P.dur = 0; P.arg = arg || null; P.clip = null; entered++;
    const enter = from !== null && !actor.down(from) ? drawn(b.enter, step.pose) : null;
    /* she says it as she starts, and the rest begins once she's down */
    if (enter) { speak(step, arg); return clip(enter, () => { P.t = 0; begin(step, arg, false); }); }
    begin(step, arg, true);
  }
  function begin(step: Step, arg: Arg | undefined, talk: boolean) {
    if (step.motion) parts.motions[step.motion]!.start?.(actor, arg);
    if (step.once) P.dur = actor.clipLength(step.pose);
    hold(step, arg);
    if (talk) speak(step, arg);
    if (step.cue) parts.cues[step.cue]!(actor, 0);
  }

  const available = (name: string) => {
    if (has(book.actions, name)) { const clip = book.actions[name]!.clip; return !clip || actor.hasArt(clip); }
    return !has(book.behaviours, name) || actor.canShow(book.behaviours[name]!.main.pose);
  };
  /* Do what's named, if she's somewhere it can be done. If not, she comes down first. */
  function request(name: string, arg?: Arg) {
    const action = has(book.actions, name) ? book.actions[name]! : null, b = has(book.behaviours, name) ? book.behaviours[name]! : null;
    if (!action && !b) return parts.moves[name]?.(actor);
    if (!available(name)) return;
    const on = action ? action.on : b!.on, place = actor.place();
    if (on && !on.includes(place)) {
      P.next = name;
      if (place !== 'air') parts.moves.dropDown!(actor);
      return;
    }
    if (action) {
      if (action.say) actor.say(actor.line(action.say));
      if (action.move) parts.moves[action.move]!(actor);
      if (action.clip) clip(action.clip, () => go('idle'));
      return;
    }
    go(name, arg);
  }
  /* The public way in. */
  function act(a: string) {
    if (P.state === 'held') return;
    if (has(book.direct, a)) {
      const name = book.direct[a]!;
      /* Only falling brings her down, and only `air` falls. */
      if (actor.place() === 'air' && !book.behaviours[name]!.on.includes('air')) { P.next = a; return; }
      return go(name);
    }
    if (has(book.aliases, a)) return act(book.aliases[a]!);
    if (has(book.actions, a) || has(book.behaviours, a)) request(a);
  }

  function to(name: string, arg?: Arg) {
    if (has(book.behaviours, name)) return go(name, arg);
    parts.moves[name]!(actor);
  }
  function argOf(r: { arg?: Arg; dir?: 'either'; dur?: string; lineOf?: string }) {
    if (!r.arg && !r.dir && !r.dur && !r.lineOf) return undefined;
    const a: Arg = { ...r.arg };
    if (r.dir) a.dir = actor.random() < .5 ? -1 : 1;
    if (r.dur) a.dur = actor.duration(r.dur) as number;
    if (r.lineOf) a.line = actor.line(r.lineOf);
    return a;
  }
  function follow(rules: Rule[]) {
    let draw: number | null = null;
    for (const r of rules) {
      if (r.when && !holds(r.when)) continue;
      if (r.below !== undefined) { if (draw === null) draw = actor.random(); if (!(draw < r.below)) continue; }
      if (r.say) actor.say(actor.line(r.say));
      if (r.cue) parts.cues[r.cue]!(actor, 0);
      if (r.to) to(r.to, argOf(r));
      return;
    }
  }
  /* A weighted choice of what's next, from the table for one surface kind. */
  function pick(place: Place) {
    const table = (book.picks[place] || []).flatMap(e => {
      const weight = actor.weight(e.weight || e.to);
      return weight && available(e.to) && (!e.when || holds(e.when)) ? [{ e, weight }] : [];
    });
    let s = table.reduce((sum, x) => sum + x.weight, 0) * actor.random();
    for (const { e, weight } of table) { s -= weight; if (s <= 0) return request(e.to, argOf(e)); }
    const last = table[table.length - 1];
    if (place === 'floor') go('idle'); else if (last) request(last.e.to, argOf(last.e));
  }
  /* A pose played once, ending on its last frame. Any transition cuts it. */
  function clip(pose: string, then: () => void) {
    P.clip = { pose, then }; P.t = 0; P.dur = actor.clipLength(pose); entered++;
  }
  function finish(b: Behaviour) {
    const exit = drawn(b.exit, b.main.pose);
    if (exit) return clip(exit, () => after(b));
    after(b);
  }
  /* A timed step whose time is up lets the pass of her art it's in reach its last frame (passEnd). A
     motion that stops the step sets its time to 0, which ends it at once. */
  function over(step: Step) {
    if (P.t <= P.dur) return false;
    return P.t >= passEnd(P.dur, step.hold ? actor.loop(pose()) : 0) - 1e-6;
  }
  function after(b: Behaviour) {
    const then = b.then;
    if (then === undefined) return;
    if (then === 'pick') return pick(b.on[0]!);
    if (then === 'queued') { const n = P.next; P.next = null; return n ? act(n) : go('idle'); }
    if (typeof then === 'string') return to(then);
    follow(then);
  }

  function pose() {
    if (P.clip) return P.clip.pose;
    const step = book.behaviours[P.state]!.main, motion = step.motion ? parts.motions[step.motion] : null;
    return motion && motion.pose ? motion.pose(actor) : step.pose;
  }

  return {
    go, act, pick, follow, clip,
    /* Something happened. The behaviour's own handling comes first. */
    emit(event: string, arg?: Arg) {
      const b = book.behaviours[P.state]!;
      const e = (b.events && b.events[event]) ?? book.events[event];
      if (e === undefined) return;
      if (typeof e === 'string') to(e, arg); else follow(e);
    },
    tick(dt: number) {
      if (P.clip) {
        /* the art can change or go while it plays */
        const gone = !actor.hasArt(P.clip.pose);
        if (!gone) P.dur = actor.clipLength(P.clip.pose);
        if (gone || P.t > P.dur) {
          const { then, pose } = P.clip; P.clip = null;
          leaving = pose; try { then(); } finally { leaving = null; }
        }
        return;
      }
      const b = book.behaviours[P.state]!, step = b.main, before = entered;
      if (step.motion) parts.motions[step.motion]!.tick?.(actor, dt);
      if (entered !== before) return;
      if (step.each) parts.cues[step.each]!(actor, dt);
      if (step.chance && actor.random() < step.chance.odds * dt) return to(step.chance.to);
      if (step.once && !actor.hasArt(step.pose)) return finish(b);
      if ((step.hold || step.once) && over(step)) finish(b);
    },
    /* what to show now, and which run of a behaviour or clip it is */
    pose, entry: () => entered,
    anim: () => P.clip ? undefined : book.behaviours[P.state]!.main.anim,
    /* does the art stop on its last frame? */
    once: () => !!P.clip || !!book.behaviours[P.state]!.main.once,
    calm: () => !!book.behaviours[P.state]!.calm
  };
}
export type Runner = ReturnType<typeof createRunner>;
