/* Speech: what a buddy says, and the bubble it says it in. */
import type { Situation } from '@buddies/buddy-file';
import { LINES } from './data';
import type { Character, PetState } from './state';
import type { Tools } from './tools';
import type { WorldState } from './world';

const APP_LINE_MS = 2000;

/* The bubble as view.css draws it, in CSS pixels: as wide as its line up to `max`, wrapping at spaces
   past that, and a single word too long for a line broken where it must. The engine has no page to
   measure in, so this is a first guess from the text, and the view moves the bubble once it knows
   its real size. A letter counts as one `letter` wide, a wide one more, and a full-width one, as CJK
   is, as two. The badge is `badgeLetter` a letter at its smaller size. */
export const BUBBLE = { max: 240, pad: 12, letter: 8, line: 17, badge: 19, badgeLetter: 6.5, badgePad: 14 };
const FULL = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;
const unit = (c: string) => FULL.test(c) ? 2 : /[WM@%]/.test(c) ? 2 : /[A-Zmw]/.test(c) ? 1.25 : 1;
const units = (word: string) => [...word].reduce((n, c) => n + unit(c), 0);
export function bubbleSize(text: string, from = '') {
  const per = Math.floor((BUBBLE.max - 2 * BUBBLE.pad) / BUBBLE.letter), lines: number[] = [];
  let at = -1; /* units on the line being filled, -1 before the first word */
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let n = units(word);
    if (at >= 0 && at + 1 + n <= per) { at += 1 + n; continue; }
    if (at >= 0) lines.push(at);
    for (; n > per; n -= per) lines.push(per);
    at = n;
  }
  lines.push(Math.max(at, 0));
  const badge = from ? units(`From ${from}`) * BUBBLE.badgeLetter + BUBBLE.badgePad + 2 * BUBBLE.pad : 0;
  const w = lines.length > 1 ? BUBBLE.max : Math.min(BUBBLE.max, Math.max(lines[0]! * BUBBLE.letter + 2 * BUBBLE.pad, badge));
  return { w, lines: lines.length, badge: !!from };
}

export function createVoice(world: WorldState, me: Character, P: PetState, { pick }: Tools) {
  /* `from`: the app that asked for this line, which the bubble shows. Its own lines have none. */
  const bubble = { text: '', from: '', hidden: true, pop: 0, below: false, placed: false, x: 0, y: 0, up: 0, down: 0, her: 0, mid: 0 };
  let timer = 0;
  return {
    bubble,
    /* this buddy's own lines if it has them, else the defaults */
    line(key: string) { const k = key as Situation, own = me.data.lines && me.data.lines[k]; return pick(own && own.length ? own : LINES[k] || ['']); },
    say(t: string, from = '') {
      if (!world.bubbles || !t) return;
      /* Muted, she keeps her own lines to herself. One another app sent is the person's choice for that app. */
      if (!from && (!world.talk || world.quiet.has(me.data.id))) return;
      bubble.text = t; bubble.from = from; bubble.hidden = false; bubble.pop++;
      /* A line from an app can be long, so it stays long enough to read. */
      const ms = from ? Math.max(world.pace.bubbleMs, APP_LINE_MS + t.length * 40) : world.pace.bubbleMs;
      world.cancel(timer); timer = world.after(ms, () => { bubble.hidden = true; });
      P.lastSay = world.now();
    }
  };
}
export type Voice = ReturnType<typeof createVoice>;
