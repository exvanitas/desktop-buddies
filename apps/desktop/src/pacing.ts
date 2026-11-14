/* Frames on the display's beat. The world ticks on a 16 ms timer of its own, which drifts against
   the display, so frames drawn as they arrive show two ticks in one display frame now and then, and
   none in another. An overlay keeps the last few and draws two ticks behind the world, between the two
   frames either side of that moment. Only where she, her bubble, her name and the effects are moves
   between them; everything else is the later frame's. Where the two don't show one movement she's
   drawn as one or the other, never between, the later from the earlier one's tick on: a new stage
   (placed by a call, a bring or a drop, or doing or showing something else), a turn or flip, a new
   line or a name, out of view, or, as a backstop, farther than any move goes in a tick. Held in the
   hand, she's drawn as the newest frame has her, so the drag doesn't lag. */
import { bodyOf, type BodyParts, type Frame, type ParticleFrame, type PetFrame } from '@buddies/engine';

/* the world's tick */
export const TICK_MS = 16;
/* Farther than this in one tick, in CSS pixels, and she was placed, not moved. A throw's fastest is
   45 physical pixels a tick; at a scale under 1 that's at most 90 here. */
export const PLACED = 120;

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const TRANSLATE = /^translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)(.*)$/;
/* A transform that starts with a translate, moved between two that differ only there, or with the
   rest of it the newer one's. */
function between(a: string | null, b: string | null, u: number, rest: 'same' | 'newer' = 'same'): string | null {
  const ma = a && TRANSLATE.exec(a), mb = b && TRANSLATE.exec(b);
  if (!ma || !mb || (rest === 'same' && ma[3] !== mb[3])) return b;
  return `translate(${lerp(+ma[1]!, +mb[1]!, u).toFixed(1)}px,${lerp(+ma[2]!, +mb[2]!, u).toFixed(1)}px)${mb[3]}`;
}
/* The turn a surface gives her, and which way she faces: the first and the last of her body's
   transform. Rounding a corner or catching a wall is drawn over a few ticks within one stage, the
   turn moving at most 17 degrees a tick in the probe runs: one tick turning more was a snap. */
const TURN = /^rotate\(([-\d.e]+)deg\)/;
export const TURN_MAX = 30;
const turn = (body: string | null) => body ? parseFloat(TURN.exec(body)?.[1] ?? '0') : 0;
const across = (a: number, b: number) => (((b - a) % 360) + 540) % 360 - 180;
const facing = (body: string | null) => body ? Math.sign(parseFloat(body.slice(body.lastIndexOf('scale(') + 6))) : 0;

/* Is `b` one movement on from `a`, so anything between them is somewhere she went, with what she said
   and her name where they were? */
function moved(a: PetFrame, b: PetFrame) {
  const ab = a.bubble, bb = b.bubble;
  return !b.grab && !a.grab && !a.off && !b.off && a.size !== null && a.stage === b.stage && a.size === b.size && a.origin === b.origin
    && Math.abs(across(turn(a.body), turn(b.body))) <= TURN_MAX && facing(a.body) === facing(b.body)
    && ab.text === bb.text && ab.from === bb.from && ab.hidden === bb.hidden && ab.below === bb.below && ab.pop === bb.pop && !ab.at === !bb.at
    && a.tag.text === b.tag.text && a.tag.hidden === b.tag.hidden
    && Math.hypot(b.box.l - a.box.l, b.box.t - a.box.t) <= PLACED;
}

/* Her body between two frames: every number of its transform, the animation's own turn, move and
   scale as well as her surface's turn, which goes the short way, a turn being drawn over a few ticks.
   Each end is that frame's own. A frame from before the numbers came only has its string: then the
   surface's turn goes between, and the rest is the later frame's. */
function drawnBetween(a: PetFrame, b: PetFrame, u: number): Pick<PetFrame, 'body' | 'parts'> {
  if (u >= 1) return { body: b.body, parts: b.parts };
  const p = a.parts, q = b.parts;
  if (p && q) {
    const parts: BodyParts = { turn: p.turn + across(p.turn, q.turn) * u, dx: lerp(p.dx, q.dx, u), dy: lerp(p.dy, q.dy, u), pivot: lerp(p.pivot, q.pivot, u), rot: lerp(p.rot, q.rot, u), sx: lerp(p.sx, q.sx, u), sy: lerp(p.sy, q.sy, u) };
    return { body: bodyOf(parts), parts };
  }
  const ta = turn(a.body), tb = turn(b.body);
  return { body: ta === tb || !b.body ? b.body : b.body.replace(TURN, `rotate(${(ta + across(ta, tb) * u).toFixed(2)}deg)`), parts: b.parts };
}

function pet(a: PetFrame | undefined, b: PetFrame, u: number): PetFrame {
  if (!a) return b;
  /* the later frame from the moment the earlier one's tick has passed: held to the later tick, she'd stand
     still a tick, then step two, as a hand-on starting at a new stage would */
  if (!moved(a, b)) return u > 0 ? b : a;
  /* Straight between two frames: on a corner's curved path the line can cut a little into what she
     rounds, a few pixels against the third of her size the engine already lets a tight corner overlap. */
  const l = lerp(a.box.l, b.box.l, u), t = lerp(a.box.t, b.box.t, u), ab = a.bubble, bb = b.bubble;
  return {
    ...b,
    ...drawnBetween(a, b, u),
    box: { ...b.box, l, t },
    tf: `translate(${l.toFixed(1)}px,${t.toFixed(1)}px)`,
    bubble: { ...bb, tf: between(ab.tf, bb.tf, u), at: ab.at && bb.at ? { x: lerp(ab.at.x, bb.at.x, u), up: lerp(ab.at.up, bb.at.up, u), down: lerp(ab.at.down, bb.at.down, u), her: lerp(ab.at.her, bb.at.her, u), mid: lerp(ab.at.mid, bb.at.mid, u) } : bb.at },
    tag: { ...b.tag, tf: between(a.tag.tf, b.tag.tf, u) }
  };
}
/* an effect turns and grows as it goes: that's the newer frame's */
const fx = (a: ParticleFrame | undefined, b: ParticleFrame, u: number): ParticleFrame => a ? { ...b, tf: between(a.tf, b.tf, u, 'newer') } : b;

/* Two frames, `u` of the way from `a` to `b`. */
export function blend(a: Frame, b: Frame, u: number): Frame {
  const pa = new Map(a.pets.map(p => [p.id, p])), fa = new Map(a.fx.map(p => [p.id, p]));
  return { pets: b.pets.map(p => pet(pa.get(p.id), p, u)), fx: b.fx.map(p => fx(fa.get(p.id), p, u)) };
}

/* No animation frame for this long, and frames are drawn whole as they come. */
export const STALLED_MS = 100;
/* What an overlay does with the world's frames and the page's animation frames. While the world runs
   it asks for every animation frame, frames or not, as it always has. While the world is still
   (paused, hidden or away) it asks only until the last frame that came is drawn, and a frame that
   comes starts it again: a still world sends almost none, so its overlays don't wake 60 times a
   second for nothing. `ask` is requestAnimationFrame; the first is asked for at once. */
export function createDrawing(draw: (f: Frame) => void, clock: () => number, ask: (beat: (now: number) => void) => void) {
  const pacer = createPacer();
  let beaten = -Infinity, asked = false, running = true;
  /* an animation frame, at its time */
  function beat(now: number) {
    asked = false; beaten = clock();
    const f = pacer.frame(now); if (f) draw(f);
    if (running || !pacer.settled()) { asked = true; ask(beat); }
  }
  asked = true; ask(beat);
  return {
    beat,
    /* The world stopped, or started again. */
    still(on: boolean) {
      running = !on;
      if (running && !asked) { asked = true; beaten = clock(); ask(beat); }
    },
    /* A frame from the world, with its tick's time. Asked for no animation frame, it asks, and counts
       that as one: animation frames that don't come for STALLED_MS after that are a page that stopped
       them, and each frame is drawn whole as it comes. */
    arrive(f: Frame, t: number) {
      pacer.receive(f, t, clock());
      if (!asked) { asked = true; beaten = clock(); ask(beat); return; }
      if (clock() - beaten > STALLED_MS) { const n = pacer.newest(); if (n) draw(n); }
    },
    reset: pacer.reset,
    /* whether it's waiting on an animation frame, for tests */
    get asking() { return asked; }
  };
}

export type Pacer = ReturnType<typeof createPacer>;
/* How far behind the world she's drawn: a tick, and a tick more for a frame held up on its way by a busy page. */
export const BEHIND_MS = 2 * TICK_MS;
/* frames kept to draw between */
const KEPT = 4;
/* arrivals that all come more than a tick later than the clock says before it's set again */
export const RELEARN = 60;
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

/* Each frame carries its tick's time on the world's clock, so one held up on the way, by a busy page
   or the message queue, is still drawn when its tick was. The world's clock is set against the
   page's by the quickest arrival: neither drifts from the other, so a later one is only slower. If
   every arrival for a second is more than a tick slower than that, the page got slower to hear from
   the world, and the clock is set again by the quickest of those. */
export function createPacer() {
  let kept: { f: Frame; t: number }[] = [], settled = true, lag = Infinity;
  const recent: number[] = [];
  /* A frame leaves out an image this overlay has already been sent. Frames can come quicker than
     they're drawn, so the image one brought is kept here for the frames after it, while she's here. */
  const images = new Map<string, string | null>();
  /* What each buddy was last drawn as, and its world time. She's never drawn going back in time:
     let go after a drag, which is drawn as it comes, she waits there for the rest to catch up. */
  const shown = new Map<string, { t: number; p: PetFrame }>();
  return {
    /* a frame from the world with its tick's time on the world's clock, as it arrives, on this page's */
    receive(f: Frame, t: number, now: number) {
      const here = new Set(f.pets.map(p => p.id));
      for (const id of images.keys()) if (!here.has(id)) images.delete(id);
      for (const p of f.pets) { if (p.src === undefined) { if (images.has(p.id)) p.src = images.get(p.id); } else images.set(p.id, p.src); }
      recent.push(now - t); if (recent.length > RELEARN) recent.shift();
      lag = Math.min(lag, now - t);
      if (recent.length === RELEARN && Math.min(...recent) > lag + TICK_MS) lag = Math.min(...recent);
      kept.push({ f, t }); if (kept.length > KEPT) kept.shift();
      settled = false;
    },
    /* Its viewport moved: nothing from before is drawn, and the next frame is taken whole. */
    reset() { kept = []; shown.clear(); settled = true; },
    /* The newest frame whole, for a page whose animation frames have stopped. It counts as drawn. */
    newest(): Frame | null {
      const last = kept[kept.length - 1];
      if (!last) return null;
      const here = new Set(last.f.pets.map(p => p.id));
      for (const id of shown.keys()) if (!here.has(id)) shown.delete(id);
      for (const p of last.f.pets) shown.set(p.id, { t: last.t, p });
      settled = true;
      return last.f;
    },
    /* how many buddies it remembers drawing, for tests */
    remembered: () => shown.size,
    /* Nothing left to draw: the newest frame is drawn, and no one is drawn ahead of the rest. */
    settled: () => settled,
    /* What to draw now, or null when what was last drawn still stands. */
    frame(now: number): Frame | null {
      if (!kept.length || settled) return null;
      const at = now - lag - BEHIND_MS, last = kept[kept.length - 1]!;
      let i = kept.length - 1;
      while (i >= 0 && kept[i]!.t > at) i--;
      let f: Frame;
      if (i === kept.length - 1) { f = last.f; settled = true; }
      else if (i < 0) f = kept[0]!.f;
      else {
        /* A frame the same as the one before isn't sent, so the earlier one stood until a tick before the later. */
        const a = kept[i]!, b = kept[i + 1]!, from = Math.max(a.t, b.t - TICK_MS);
        f = blend(a.f, b.f, clamp((at - from) / (b.t - from), 0, 1));
      }
      const newest = new Map(last.f.pets.map(p => [p.id, p]));
      for (const id of shown.keys()) if (!newest.has(id)) shown.delete(id);
      const pets = f.pets.map(p => {
        const now = newest.get(p.id), was = shown.get(p.id);
        if (now && now.grab) { shown.set(p.id, { t: last.t, p: now }); settled = false; return now; }
        if (was && was.t > at) { settled = false; return was.p; }
        shown.set(p.id, { t: at, p });
        return p;
      });
      return { ...f, pets };
    }
  };
}
