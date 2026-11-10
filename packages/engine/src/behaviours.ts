/* Every behaviour a buddy has, as data. What moves them is in motions, what they set off is in
   cues, and how long they last and how often they're picked is in the pace table. */
import { canShow, hasArt, type Buddy } from '@buddies/buddy-file';
import type { Book } from './runner';

export const BOOK: Book = {
  behaviours: {
    /* resting */
    idle: { on: ['floor'], calm: true, main: { pose: 'stand', hold: 'idle', anim: 'breathe' }, then: 'pick' },
    sit: { on: ['floor'], calm: true, main: { pose: 'sit', hold: 'sit', anim: 'settle' }, enter: { clip: 'sit_down' }, exit: { clip: 'stand_from_sit' }, then: 'pick' },
    think: { on: ['floor'], calm: true, main: { pose: 'think', hold: 'think', say: 'think', cue: 'thoughtDots', anim: 'ponder' }, then: 'pick' },
    sleep: {
      on: ['floor'], main: { pose: 'sleep', hold: 'sleep', say: 'yawn', odds: .6, each: 'snore', anim: 'doze' },
      enter: { clip: 'fall_asleep' }, exit: { clip: 'stand_up_from_sleep', or: 'stand_up' },
      then: [{ say: 'wake', cue: 'rested', to: 'idle' }]
    },

    /* reactions */
    love: { on: ['floor'], main: { pose: 'happy', hold: 'love', say: 'love', cue: 'heartBurst', each: 'heartDrift', anim: 'bounce' }, then: 'idle' },
    cry: { on: ['floor'], main: { pose: 'cry', hold: 'cry', say: 'cry', cue: 'puddle', each: 'tears', anim: 'sob' }, then: 'sit' },
    angry: { on: ['floor'], main: { pose: 'angry', hold: 'angry', say: 'angry', cue: 'angerMark', anim: 'fume' }, then: 'idle' },
    shy: { on: ['floor'], main: { pose: 'shy', hold: 'shy', say: 'shy', cue: 'blush', anim: 'fidget' }, then: 'idle' },
    eat: { on: ['floor'], main: { pose: 'eat', hold: 'eat', say: 'eat', cue: 'crumbsReady', each: 'crumbs', anim: 'chew' }, then: [{ say: 'full', to: 'idle' }] },
    dance: { on: ['floor'], main: { pose: 'dance', hold: 'dance', say: 'dance', each: 'danceNotes', anim: 'groove' }, then: 'idle' },
    sing: { on: ['floor'], main: { pose: 'sing', hold: 'sing', say: 'sing', each: 'singNotes', anim: 'croon' }, then: 'idle' },
    wave: { on: ['floor'], main: { pose: 'wave', hold: 'wave', say: 'hello', anim: 'greet' }, then: 'idle' },
    spin: { on: ['floor'], main: { pose: 'happy', hold: 'spin', say: 'spin', odds: .5, anim: 'whirl' }, then: [{ below: .2, to: 'dizzy' }, { to: 'idle' }] },
    trip: { on: ['floor'], main: { pose: 'sprawl', hold: 'trip', say: 'trip', anim: 'faceplant' }, exit: { clip: 'stand_up_from_sprawl', or: 'stand_up' }, then: [{ say: 'getup', to: 'idle' }] },
    dizzy: {
      on: ['floor'], main: { pose: 'dizzy', hold: 'dizzy', alt: { short: 'dizzyShort' }, cue: 'stars', anim: 'wobble' }, exit: { clip: 'stand_up_from_dizzy', or: 'stand_up', ifDown: true },
      then: [{ when: 'hurt', below: .4, to: 'cry', dur: 'cryHurt' }, { when: 'hurt', say: 'getup', to: 'idle' }, { to: 'idle' }]
    },

    /* movement */
    walk: { on: ['floor'], calm: true, main: { pose: 'walk', motion: 'walk', hold: 'walk', anim: 'stroll' }, then: 'pick' },
    run: { on: ['floor'], main: { pose: 'run', motion: 'run', hold: 'run', chance: { odds: .0025, to: 'trip' }, anim: 'sprint' }, then: 'pick' },
    climbGo: { on: ['floor'], main: { pose: 'run', motion: 'toWall', hold: 'climbGo', anim: 'dash' }, then: 'pick' },
    hopWalk: { on: ['floor'], main: { pose: 'walk', motion: 'toHop', hold: 'hopWalk', anim: 'stroll' }, then: 'pick' },
    chase: {
      on: ['floor'], main: { pose: 'run', motion: 'chase', hold: 'chase', say: 'chase', anim: 'lean' },
      then: [{ when: 'canTire', say: 'tired', to: 'tired' }, { when: 'canWatch', say: 'tired', to: 'watch_cursor' }, { say: 'tired', to: 'sit' }],
      events: { caught: [{ say: 'caught', to: 'love', arg: { line: '' } }] }
    },
    /* on Stand, turned like a wheel, or on her Roll art, which already turns: the motion picks */
    roll: { on: ['floor'], main: { pose: 'stand', motion: 'roll', hold: 'roll', say: 'roll', anim: 'tumble' }, then: [{ to: 'dizzy', arg: { short: true } }] },

    /* after a chase, with the art for it */
    tired: { on: ['floor'], main: { pose: 'tired', hold: 'tired' }, then: [{ when: 'canWatch', to: 'watch_cursor' }, { to: 'sit' }] },
    watch_cursor: {
      on: ['floor'], calm: true, main: { pose: 'watch_cursor', motion: 'watch', hold: 'watch' },
      enter: { clip: 'sit_down', ifDown: true }, exit: { clip: 'stand_from_sit', ifDown: true }, then: 'pick'
    },

    /* a landing too hard to shrug off */
    knocked_out: { on: ['floor'], main: { pose: 'knocked_out', hold: 'knockedOut' }, exit: { clip: 'stand_up_from_knocked_out', or: 'stand_up' }, then: 'idle' },

    /* personality: nothing sets most of these off yet, so they come when asked for */
    excited: { on: ['floor'], main: { pose: 'excited', hold: 'excited' }, then: 'idle' },
    laugh: { on: ['floor'], main: { pose: 'laugh', once: true }, then: 'idle' },
    surprised: { on: ['floor'], main: { pose: 'surprised', once: true }, then: 'idle' },
    face_away: { on: ['floor'], main: { pose: 'face_away', hold: 'faceAway' }, exit: { clip: 'turn_back' }, then: 'idle' },
    tap_screen: { on: ['floor'], main: { pose: 'tap_screen', once: true }, then: 'idle' },
    stare: { on: ['floor'], main: { pose: 'stare', hold: 'stare' }, then: 'idle' },
    signature: { on: ['floor'], main: { pose: 'signature', once: true, cue: 'signatureLine' }, then: 'idle' },

    /* climbing */
    climb: { on: ['wall'], calm: true, main: { pose: 'climb', motion: 'climb', hold: 'climb', chance: { odds: .0012, to: 'leap' }, anim: 'scrabble' }, then: 'wall' },
    wall: { on: ['wall'], calm: true, main: { pose: 'wall', hold: 'wall' }, then: 'pick' },
    crawl: { on: ['ceil'], calm: true, main: { pose: 'crawl', motion: 'crawl', hold: 'crawl', chance: { odds: .0012, to: 'dropDown' }, anim: 'scrabble' }, then: 'hang' },
    hang: { on: ['ceil'], calm: true, main: { pose: 'hang', hold: 'hang', anim: 'dangle' }, then: 'pick' },

    /* air and held */
    air: {
      on: ['air'], main: { pose: 'fall', motion: 'air', anim: 'flight' },
      events: {
        landed: 'land', grabbedWall: 'wall', grabbedCeiling: 'hang',
        slammed: [{ when: 'knockedOut', to: 'knocked_out' }, { to: 'dizzy', arg: { hurt: true } }]
      }
    },
    land: { on: ['floor'], main: { pose: 'land', hold: 'land', alt: { big: 'landBig' }, anim: 'squash' }, then: 'queued' },
    held: { on: ['air'], main: { pose: 'drag', motion: 'held', say: 'held', odds: .5, anim: 'swing' } }
  },
  picks: {
    floor: [
      { to: 'idle' }, { to: 'walk' }, { to: 'sit' }, { to: 'think' },
      { to: 'sleep', when: 'wakeful' }, { to: 'sleep', weight: 'sleepy', when: 'sleepy' },
      { to: 'jump' }, { to: 'climbGo' }, { to: 'run' }, { to: 'dance' }, { to: 'sing' }, { to: 'eat' }, { to: 'roll' }, { to: 'spin' }, { to: 'ceilGo' }, { to: 'signature' },
      { to: 'dropThrough', weight: 'travelDown', when: 'stackedBelow' }, { to: 'jumpThrough', weight: 'travelUp', when: 'stackedAbove' },
      { to: 'hop', when: 'canHop' }, { to: 'hopWalk', when: 'canWalkToHop' }
    ],
    wall: [{ to: 'leap' }, { to: 'climb', weight: 'climbUp', arg: { dir: -1 } }, { to: 'climb', weight: 'climbDown', arg: { dir: 1 } }],
    ceil: [{ to: 'dropDown', weight: 'letGo' }, { to: 'crawl', dir: 'either' }]
  },
  aliases: { climb: 'climbGo', wall: 'climbGo', crawl: 'ceilGo', hang: 'ceilGo', fall: 'drop', land: 'drop' },
  direct: { happy: 'love', stand: 'idle', sprawl: 'trip', air: 'air' },
  actions: {
    jump: { on: ['floor'], move: 'jump' },
    ceilGo: { on: ['floor'], move: 'ceilGo' },
    drop: { move: 'drop' },
    dropThrough: { move: 'dropThrough' },
    jumpThrough: { move: 'jumpThrough' },
    hop: { on: ['floor'], move: 'hop' },
    leapOff: { move: 'leapOff' },
    held: { say: 'dragme' },
    /* poses that are only ever clips, so the maker can try them */
    stand_up: { on: ['floor'], clip: 'stand_up' },
    stand_up_from_sleep: { on: ['floor'], clip: 'stand_up_from_sleep' },
    stand_up_from_sprawl: { on: ['floor'], clip: 'stand_up_from_sprawl' },
    stand_up_from_dizzy: { on: ['floor'], clip: 'stand_up_from_dizzy' },
    stand_up_from_knocked_out: { on: ['floor'], clip: 'stand_up_from_knocked_out' },
    sit_down: { on: ['floor'], clip: 'sit_down' },
    stand_from_sit: { on: ['floor'], clip: 'stand_from_sit' },
    fall_asleep: { on: ['floor'], clip: 'fall_asleep' },
    turn_back: { on: ['floor'], clip: 'turn_back' },
    struggle: { on: ['floor'], clip: 'struggle' }
  },
  events: {
    wall: 'climb', ceiling: 'crawl', floor: 'idle', airborne: 'air', lost: 'air', released: 'air', grabbed: 'held', hovered: 'shy',
    clicked: [
      { when: 'clinging', to: 'dropDown' },
      { when: 'inAir' },
      { when: 'asleep', say: 'wake', cue: 'startled', to: 'idle' },
      { when: 'clickedOut', cue: 'forgiven', to: 'angry' },
      { when: 'angry', say: 'grumpy' },
      { below: .55, to: 'wave' },
      { to: 'spin' }
    ],
    petted: [
      { when: 'asleep', cue: 'sleepyHeart' },
      { when: 'offFloor', cue: 'heart' },
      { when: 'upset', to: 'love', lineOf: 'comfort' },
      { to: 'love' }
    ]
  }
};

/* Can this character do what's named? A menu asks before it offers something. */
export function canDo(buddy: Pick<Buddy, 'poses'>, action: string) {
  const { aliases, direct, behaviours, actions } = BOOK;
  const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  let name = action;
  while (has(aliases, name)) name = aliases[name]!;
  if (has(direct, name)) name = direct[name]!;
  if (has(actions, name)) { const clip = actions[name]!.clip; return !clip || hasArt(buddy, clip); }
  return !has(behaviours, name) || canShow(buddy, behaviours[name]!.main.pose);
}
