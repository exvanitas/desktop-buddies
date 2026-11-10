/* The sheets, as data, apart from how a sheet draws. To lay the Maker out another way, change this and
   not the drawing. Each caption says when a line is heard, with {pose} for art it really shows, and the
   first {pose} is the art it points at. Checked against the engine by tests/moments.test.ts: change a
   behaviour and a test fails until the caption is looked at again. A situation only ever points at art.
   `needs` means it's never said without that art. */
import type { PoseKey, Situation } from '@buddies/buddy-file';

export type Has = (k: PoseKey) => boolean;
export type Caption = string | ((has: Has) => string);
export interface SitDef { k: Situation; cap: Caption; needs?: PoseKey }
export interface Moment { t: string; poses: PoseKey[]; tries: string[]; flow: string; sits: SitDef[] }

const S = (k: Situation, cap: Caption, needs?: PoseKey): SitDef => ({ k, cap, ...needs ? { needs } : {} });
/* getting up from one way down: its own clip, or the shared one */
const gotUp = (own: PoseKey) => (has: Has) => has(own) ? `After {${own}}, going to {stand}` : has('stand_up') ? 'After {stand_up}, going to {stand}' : 'Going back to {stand}';

export const MOMENTS: Moment[] = [
  { t: 'Hanging around', poses: ['stand', 'walk', 'think', 'stare', 'face_away', 'tap_screen', 'turn_back'], tries: ['think', 'sit', 'jump'],
    flow: 'A calm buddy takes turns: {stand}, {walk}, {think}, then whatever comes next. {face_away} ends on {turn_back}.',
    sits: [S('chat', 'Over any calm pose'), S('think', has => has('think') ? 'With {think}, or over any calm pose' : 'Over any calm pose'), S('dragme', 'Nothing says this on its own yet')] },
  { t: 'Picked up', poses: ['drag', 'dragL', 'dragR', 'struggle', 'thrown', 'fall', 'dizzy', 'knocked_out', 'stand_up_from_dizzy', 'stand_up_from_knocked_out'], tries: ['drop', 'dizzy'],
    flow: 'Grabbed: {drag}, with {dragL} or {dragR} as it swings. Held still for 10 seconds, or shaken hard: {struggle}. Let go: {fall}, or {thrown} when thrown. A hard hit: {dizzy}, or {knocked_out} on the hardest landings. A {dizzy} drawn low gets up through {stand_up_from_dizzy}, {knocked_out} through {stand_up_from_knocked_out}, and either through {stand_up} without its own.',
    sits: [S('held', 'Over {drag}, {dragL} or {dragR}'), S('drop', 'With {fall} or {thrown}'), S('hurt', has => has('knocked_out') ? 'On a hard hit, then {dizzy} or {knocked_out}' : 'On a hard hit, then {dizzy}')] },
  { t: 'Up the walls', poses: ['climb', 'wall', 'crawl', 'hang', 'dangle_legs'], tries: ['climbGo', 'ceilGo', 'drop'],
    flow: 'Runs to the side: {climb}, stops at {wall}. Round the corner: {crawl}, stops at {hang}. Then lets go and falls.',
    sits: [S('climb', 'With {climb}'), S('grab', 'With {wall} or {hang}, caught after a throw')] },
  { t: 'Feelings', poses: ['wave', 'happy', 'shy', 'angry', 'cry', 'surprised', 'laugh', 'excited'], tries: ['wave', 'love', 'shy', 'angry', 'cry'],
    flow: 'Click: {wave} or a spin. Five clicks: {angry}. Pet: {happy}. Hover and stare: {shy}. {cry} ends sitting down.',
    sits: [S('hello', 'With {wave}'), S('love', 'With {happy}'), S('comfort', 'With {happy}, if it was upset'), S('shy', 'With {shy}'), S('angry', 'With {angry}'), S('grumpy', 'Over {angry}'), S('cry', 'With {cry}')] },
  { t: 'Off for a run', poses: ['run', 'jump', 'land', 'sprawl', 'stand_up_from_sprawl', 'stand_up'], tries: ['run', 'jump', 'trip'],
    flow: '{run} can trip into {sprawl}, then {stand_up_from_sprawl}, or {stand_up} without it. {jump} comes down to {land}.',
    sits: [S('trip', 'With {sprawl}'), S('getup', gotUp('stand_up_from_sprawl'))] },
  { t: 'Chasing the mouse', poses: ['tired', 'watch_cursor'], tries: ['chase'],
    flow: 'Chases with {run}. Catches it: {happy}. Gives up: {tired} if it has art, {watch_cursor} after that if it has art, otherwise {sit}.',
    sits: [S('chase', 'With {run}'), S('caught', 'As it goes to {happy}'), S('tired', has => `Going to {${has('tired') ? 'tired' : has('watch_cursor') ? 'watch_cursor' : 'sit'}}`)] },
  { t: 'Nap time', poses: ['sit_down', 'sit', 'stand_from_sit', 'fall_asleep', 'sleep', 'stand_up_from_sleep'], tries: ['sit', 'sleep'],
    flow: 'From standing, {sit_down} leads into {sit}, and {sit} ends on {stand_from_sit}. From standing, {fall_asleep} leads into {sleep}. {sleep} ends on {stand_up_from_sleep}, or {stand_up} without it, or straight to {stand} if you click it awake.',
    sits: [S('yawn', has => has('fall_asleep') ? 'As {fall_asleep} starts, when she was standing, or else with {sleep}' : 'With {sleep}'), S('wake', has => `${gotUp('stand_up_from_sleep')(has)}. Clicked awake: straight to {stand}`)] },
  { t: 'Just for fun', poses: ['eat', 'dance', 'sing', 'roll', 'signature'], tries: ['dance', 'sing', 'eat', 'spin', 'roll'],
    flow: 'Chosen now and then when calm. A spin is {happy} turning, and it can end {dizzy}. A roll is {roll}, or {stand} tumbling without it, and it ends {dizzy}.',
    sits: [S('eat', 'With {eat}', 'eat'), S('full', 'After {eat}, going to {stand}', 'eat'), S('dance', 'With {dance}', 'dance'), S('sing', 'With {sing}', 'sing'), S('spin', 'With {happy}, spinning'), S('roll', has => has('roll') ? 'With {roll}' : 'With {stand}, rolling')] },
  { t: 'Meeting and leaving', poses: [], tries: ['wave', 'love'],
    flow: 'Two buddies meet: both {wave}, or a {happy} hug, or they bump and {walk} apart. Dismissed: {wave} on the floor, then gone.',
    sits: [S('greet', 'With {wave}'), S('hug', 'With {happy}'), S('bump', 'With {walk}, heading apart'), S('bumped', 'With {walk}, heading apart'), S('bye', "With {wave} on the floor. Anywhere else, the pose it's in")] }
];

/* When each situation's lines are spoken, in plain words. */
export const WHEN: Record<Situation, string> = {
  chat: 'While wandering', dragme: 'Inviting you to drag it', think: 'Thinking to itself', hello: 'When you click it', love: 'When you pet it',
  comfort: 'Petted while upset', shy: 'When you hover and stare', angry: 'Clicked too many times', grumpy: 'Clicked again, still cross', cry: 'Feeling lonely',
  hurt: 'Thrown too hard', getup: 'Getting back up', trip: 'Tripping over', held: 'Being carried', drop: 'Falling or dropped', grab: 'Catching a wall',
  climb: 'Starting to climb', yawn: 'Getting sleepy', wake: 'Woken from a nap', dance: 'Starting to dance', sing: 'Starting to sing', eat: 'Eating a snack',
  full: 'Finished eating', chase: 'Starts chasing the mouse', caught: 'Catches the mouse', tired: 'Gives up the chase', spin: 'Spinning', roll: 'Rolling along',
  bye: 'When you dismiss it', greet: 'Meeting a buddy', hug: 'Hugging a buddy', bump: 'Bumping into a buddy', bumped: 'Bumped by a buddy'
};

/* What Try leads with on the pages that aren't a sheet. */
export const COMMON_TRIES = ['love', 'wave', 'dance', 'sleep', 'jump', 'run'];

export const SITS: SitDef[] = MOMENTS.flatMap(m => m.sits);
