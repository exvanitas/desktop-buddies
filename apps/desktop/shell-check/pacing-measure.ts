/* What the pacing check makes of where an overlay drew her on each animation frame. Shared by the
   Windows probe, the headless run and the tests, so all of them judge the same way. */
import { PLACED } from '../src/pacing';

/* One animation frame: its time; where she was drawn, her anchor (the element's place plus its
   transform's origin, so a new pose isn't a step); whether she was held; and her pose, as her size and
   origin, since a new one is drawn whole at its tick and never blended into. */
export type Sample = [t: number, x: number, y: number, held: number, pose: string];
export interface Pacing {
  /* animation frames, and the display rate their median gap gives */
  frames: number; hz: number;
  /* the share of frames that came within a quarter of the median gap: under 0.9 there's no steady display to judge by */
  steady: number;
  /* frames inside steady motion, and of those, ones where she didn't move, or moved over 1.5 times her neighbours' steps */
  counted: number; still: number; doubled: number;
  /* the largest step inside steady motion, in CSS pixels */
  worst: number;
  /* The moves the probe told her to make: how many, how many of those had their watch end while the
     probe was still watching, so must be judged, and how many of those failed: seen on too few frames,
     or she travelled too little. `travel` is the least any judged move took her, in CSS pixels. */
  issued: number; judged: number; failed: number; travel: number;
}

/* Her pose as a key: her size and origin, the turn a surface gives her (her body's first transform)
   and which way she faces (the sign of its scale). Spaces as a page writes them back or not. */
export function poseKey(size: string | null, origin: string | null, body: string | null) {
  const b = (body || '').replace(/\s+/g, ''), turn = b.slice(0, b.indexOf(')') + 1), scale = /scale\((-?)/.exec(b);
  return `${size} ${(origin || '').replace(/\s+/g, ' ')} ${turn} ${scale ? scale[1] : ''}`;
}

/* After she's told to move, she's watched from LIVE_FROM to LIVE_TO ms on: by then any move has started,
   and none has ended. A watch needs SEEN frames at least, and in it she has to be drawn TRAVEL CSS
   pixels or more from where it first saw her: in the headless runs each ordered move took her 40 or more. */
export const LIVE_FROM = 100, LIVE_TO = 500, SEEN = 10, TRAVEL = 10;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1]! : 0; };

/* `told`: when, on the samples' clock, she was told to move. `stop`: when the probe stopped watching. */
export function measure(samples: Sample[], told: number[] = [], stop = -Infinity): Pacing {
  const gaps = samples.slice(1).map((s, k) => s[0] - samples[k]![0]), gap = median(gaps);
  const steady = gaps.length ? gaps.filter(g => Math.abs(g - gap) <= gap / 4).length / gaps.length : 0;
  /* step k: from frame k to frame k + 1 */
  const step = samples.slice(1).map((s, k) => Math.hypot(s[1] - samples[k]![1], s[2] - samples[k]![2]));
  let counted = 0, still = 0, doubled = 0, worst = 0;
  for (let k = 1; k + 1 < step.length; k++) {
    const before = step[k - 1]!, after = step[k + 1]!, near = [k - 2, k - 1, k, k + 1, k + 2, k + 3].flatMap(i => samples[i] ? [samples[i]!] : []);
    /* Steady motion: moving a pixel or more on both sides; two frames or more from a new pose, which
       is drawn whole at its tick, so the steps before it slow to the last frame before it; nobody's
       hand on her lately; no frame the display itself dropped; and no step a move can't make, as
       being dropped back in at the top is. */
    if (Math.min(before, after) < 1 || near.some(s => s[4] !== near[0]![4]) || [k - 3, k - 2, k - 1, k, k + 1, k + 2].some(i => samples[i]?.[3])
      || [k - 1, k, k + 1].some(i => Math.abs(gaps[i]! - gap) > gap / 4) || Math.max(before, step[k]!, after) > PLACED) continue;
    counted++;
    if (step[k]! < .05) still++;
    else if (step[k]! > 1.5 * (before + after) / 2) doubled++;
    worst = Math.max(worst, step[k]!);
  }
  /* Liveness, which the rest can't see: a frozen overlay has no steady motion to find fault with.
     Every move the probe told her to make whose watch ended before the probe stopped watching is
     judged on its own, from the probe's own list, never from what the samples happen to cover. */
  let judged = 0, failed = 0, travel = Infinity;
  for (const o of told) {
    if (o + LIVE_TO > stop) continue;
    judged++;
    const seen = samples.filter(s => s[0] >= o + LIVE_FROM && s[0] <= o + LIVE_TO), first = seen[0];
    const far = first ? Math.max(...seen.map(s => Math.hypot(s[1] - first[1], s[2] - first[2]))) : 0;
    travel = Math.min(travel, far);
    if (seen.length < SEEN || far < TRAVEL) failed++;
  }
  return { frames: samples.length, hz: gap ? 1000 / gap : 0, steady, counted, still, doubled, worst, issued: told.length, judged, failed, travel: judged ? travel : 0 };
}

/* Unpaced, headless Chromium showed a tick twice or not at all on 4.4 to 9.9% of the display frames
   of steady motion; paced, 0 to 1%, on a busy machine. */
export const UNEVEN_MAX = .02;
/* Liveness first, from the moves the probe issued: fewer than three to judge, or any judged move
   unseen or with too little travel, fails, whatever the display. Only then can the display's timing
   leave nothing to judge evenness by. */
export function verdict(p: Pacing): 'pass' | 'fail' | 'no verdict' {
  if (p.judged < 3 || p.failed) return 'fail';
  if (p.steady < .9 || p.hz < 30 || p.hz > 300) return 'no verdict';
  if (p.counted < 100) return 'fail';
  return (p.still + p.doubled) / p.counted > UNEVEN_MAX ? 'fail' : 'pass';
}
