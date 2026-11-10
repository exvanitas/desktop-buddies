/* Timings, in 60 Hz frames unless named otherwise. A pair is a range to pick from. `lively` is how
 the web maker has always run. travelDown and travelUp are weights among what to do next, and only
 count with a monitor stacked below or above. */
export interface Pace {
/* how far a homing jump goes */
  reach: Reach;
idle: Range; walk: Range; run: Range; sit: Range; think: number; sleep: Range;
love: number; cry: number; cryHurt: number; angry: number; shy: number; eat: number; crumbs: Range; dance: number; sing: number;
wave: number; spin: number; roll: number; trip: number; dizzy: number; dizzyShort: number; land: number; landBig: number; chase: number;
tired: number; watch: Range; knockedOut: Range; excited: number; stare: number; faceAway: Range;
  climbGo: number; climb: Range; wall: Range; crawl: Range; hang: Range; hopWalk: Range;
/* how often each thing is picked, against the others in its table */
  weights: Record<string, number>;
  petCool: number; pairCool: Range; pairGreetMs: number; bubbleMs: number; quietMs: number;
}
export type Range = [number, number];
/* In px at scale 1, or px per frame for a speed. `across`, `up` and `down` are how far off a target
 can be. `rises` are the arcs she tries, as height over the higher end of the jump, lowest first.
 `speed` caps how fast she crosses. `ledge` is the narrowest top she'll aim at, in her own widths.
 `flights` is how many arcs one search may try, nearest windows first, and the same again for walks.
 `leapUp` and `leapOut` are her push off the end of a window top. */
export interface Reach { across: number; up: number; down: number; rises: number[]; speed: number; ledge: number; flights: number; leapUp: Range; leapOut: Range }

export const lively: Pace = {
  reach: { across: 700, up: 700, down: 800, rises: [50, 110, 190], speed: 16, ledge: 1.5, flights: 60, leapUp: [4, 8], leapOut: [3, 6] },
  idle: [60, 200], walk: [120, 380], run: [60, 170], sit: [150, 420], think: 170, sleep: [500, 1100],
  love: 150, cry: 300, cryHurt: 200, angry: 170, shy: 160, eat: 240, crumbs: [12, 28], dance: 360, sing: 320,
  wave: 100, spin: 46, roll: 130, trip: 100, dizzy: 170, dizzyShort: 90, land: 16, landBig: 26, chase: 900,
  tired: 120, watch: [180, 420], knockedOut: [200, 320], excited: 150, stare: 200, faceAway: [200, 400],
  climbGo: 1e9, climb: [120, 400], wall: [60, 240], crawl: [150, 420], hang: [80, 260], hopWalk: [900, 1300],
  weights: {
    idle: 3, walk: 5, sit: 1.5, think: .7, sleep: .25, sleepy: 2.5, jump: .45, climbGo: .55, run: .5, dance: .2, sing: .25, eat: .12, roll: .12, spin: .1, ceilGo: .06,
    signature: .15, travelDown: .05, travelUp: .05, hop: 1.5, hopWalk: 1,
    /* personality, only with her art for each */
    excited: .08, laugh: .06, surprised: .04, face_away: .05, tap_screen: .04, stare: .06,
    leap: .12, climbUp: .48, climbDown: .4,
    letGo: .3, crawl: .7,
    /* odds, not table weights: of a hop going for a side when both are there, and of leaving a window top at its end */
    hopSide: .3, edgeLeap: .15
  },
  petCool: 90, pairCool: [900, 1600], pairGreetMs: 700, bubbleMs: 2600, quietMs: 4000
};
