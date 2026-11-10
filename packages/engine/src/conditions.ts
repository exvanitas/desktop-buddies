/* The questions rules and pick tables can ask. */
import type { Actor } from './actor';

/* a landing this fast (px per frame) knocks her out, if she has the art */
const KNOCKOUT_VY = 40;

export const CONDITIONS: Record<string, (c: Actor) => boolean> = {
  canTire: c => c.hasArt('tired'),
  canWatch: c => c.hasArt('watch_cursor'),
  knockedOut: c => c.P.impact > KNOCKOUT_VY * c.P.k && c.hasArt('knocked_out'),
  hurt: c => !!(c.P.arg && c.P.arg.hurt),
  sleepy: c => c.P.awake > 4000,
  wakeful: c => !(c.P.awake > 4000),
  stackedBelow: c => !!c.stackedBelow(),
  stackedAbove: c => !!c.stackedAbove(),
  canHop: c => c.hops().length > 0,
  canWalkToHop: c => c.walks().length > 0,
  clinging: c => c.place() === 'wall' || c.place() === 'ceil',
  inAir: c => c.place() === 'air',
  offFloor: c => c.place() !== 'floor',
  asleep: c => c.P.state === 'sleep',
  angry: c => c.P.state === 'angry',
  upset: c => c.P.state === 'cry' || c.P.state === 'angry' || c.P.state === 'dizzy',
  clickedOut: c => c.P.clicks.length >= 5
};
