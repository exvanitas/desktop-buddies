/* What a buddy is: the pose slots and situations its file can fill, and the shape of the data. */

/* When each line set is spoken — used to brief an AI writing a character's dialogue. */
export const SITUATIONS = {
  chat: 'idle chatter while wandering, talking to the user',
  think: 'musing to itself while thinking',
  hello: 'the user clicks on it',
  love: 'the user pets it; feeling happy',
  comfort: 'the user pets it while it was sad or angry, and it feels better',
  shy: 'the user hovers the mouse over it and stares',
  angry: 'the user clicks it too many times',
  grumpy: 'clicked again while still angry',
  cry: 'feeling sad and lonely, crying',
  hurt: 'thrown too hard, slams into the floor or a wall',
  getup: 'getting back up after tripping or being dizzy',
  trip: 'tripping while running',
  held: 'being picked up and dragged around by the mouse',
  drop: 'falling or being dropped',
  grab: 'catching onto a wall or the ceiling after being thrown',
  climb: 'starting to climb up the side of the screen',
  yawn: 'getting sleepy, about to nap',
  wake: 'woken up from a nap',
  dance: 'starting to dance',
  sing: 'starting to sing (can include lyrics)',
  eat: 'eating a snack',
  full: 'finished eating',
  chase: 'starts chasing the mouse cursor',
  caught: 'catches the mouse cursor',
  tired: 'gives up chasing, out of breath',
  spin: 'spinning around',
  roll: 'rolling along the floor',
  bye: 'is dismissed by the user and leaves the screen (a goodbye)',
  greet: 'meets another desktop pet',
  hug: 'hugs another desktop pet',
  bump: 'bumps into another pet (apologizing)',
  bumped: 'gets bumped by another pet',
  dragme: 'a hint telling the user they can drag it'
} as const;
export type Situation = keyof typeof SITUATIONS;

/* Pose slots. tier = how much a character needs it: core slots are required, and the rest are
   optional, so a character without the art never does what they show. fb = what to show when this pose has no frames.
   '@wall' / '@ceil' = rotate the main image onto that surface. */
export const POSES = [
  { key: 'stand', label: 'Stand / idle', fb: null, tier: 'core', group: 'Basics' },
  { key: 'walk', label: 'Walk', fb: 'stand', tier: 'core', group: 'Basics' },
  { key: 'run', label: 'Run', fb: 'walk', tier: 'core', group: 'Basics' },
  { key: 'sit', label: 'Sit', fb: 'stand', tier: 'core', group: 'Basics' },
  { key: 'sleep', label: 'Sleep', fb: 'sit', tier: 'core', group: 'Basics' },
  { key: 'think', label: 'Think / look up', fb: 'stand', tier: 'feel', group: 'Basics' },
  { key: 'jump', label: 'Jump (going up)', fb: 'fall', tier: 'core', group: 'Movement' },
  { key: 'fall', label: 'Falling', fb: 'stand', tier: 'core', group: 'Movement' },
  { key: 'land', label: 'Landing bounce', fb: 'stand', tier: 'core', group: 'Movement' },
  { key: 'sprawl', label: 'Sprawled / tripped', fb: null, tier: 'core', group: 'Movement' },
  { key: 'drag', label: 'Held (still)', fb: 'fall', tier: 'core', group: 'Being dragged' },
  { key: 'dragL', label: 'Held, swung left', fb: 'drag', tier: 'feel', group: 'Being dragged', hint: '1–2 frames: mild, strong. Without it she swings on Held.' },
  { key: 'dragR', label: 'Held, swung right', fb: 'drag', tier: 'feel', group: 'Being dragged', hint: '1–2 frames: mild, strong. Without it she swings on Held.' },
  { key: 'climb', label: 'Climb wall', fb: '@wall', tier: 'core', group: 'Walls & ceiling', hint: 'Side view, facing the same way as "Art faces", hands reaching forward onto the wall' },
  { key: 'wall', label: 'Hold on wall', fb: 'climb', tier: 'core', group: 'Walls & ceiling', hint: 'Side view, facing the same way as "Art faces", hands reaching forward onto the wall' },
  { key: 'crawl', label: 'Crawl ceiling', fb: '@ceil', tier: 'core', group: 'Walls & ceiling' },
  { key: 'hang', label: 'Hang from ceiling', fb: 'crawl', tier: 'core', group: 'Walls & ceiling' },
  { key: 'happy', label: 'Happy / hearts', fb: 'stand', tier: 'core', group: 'Reactions' },
  { key: 'wave', label: 'Wave / greet', fb: 'happy', tier: 'core', group: 'Reactions' },
  { key: 'shy', label: 'Shy', fb: 'happy', tier: 'core', group: 'Reactions' },
  { key: 'cry', label: 'Cry', fb: 'sit', tier: 'core', group: 'Reactions' },
  { key: 'angry', label: 'Angry', fb: 'stand', tier: 'core', group: 'Reactions' },
  { key: 'dizzy', label: 'Dizzy', fb: 'sprawl', tier: 'core', group: 'Reactions' },
  { key: 'eat', label: 'Eat snack', fb: 'sit', tier: 'personality', group: 'Activities' },
  { key: 'dance', label: 'Dance', fb: 'happy', tier: 'personality', group: 'Activities' },
  { key: 'sing', label: 'Sing', fb: 'happy', tier: 'personality', group: 'Activities' },
  { key: 'roll', label: 'Roll', fb: 'stand', tier: 'feel', group: 'Activities', hint: 'Rolling along the floor, drawn turning. Without it she spins Stand like a wheel.' },
  { key: 'thrown', label: 'Thrown (tumbling)', fb: 'fall', tier: 'core', group: 'Movement' },
  { key: 'stand_up', label: 'Stand up', fb: 'stand', tier: 'feel', group: 'Transitions', hint: 'Plays once, when she gets up from lying or sitting: after sleep, a faceplant, a knockout, or a Dizzy drawn low, unless that one has its own Stand up. End on the main pose.' },
  { key: 'stand_up_from_sleep', label: 'Up from sleep', fb: 'stand_up', tier: 'feel', group: 'Transitions', hint: 'Plays once as she wakes, instead of Stand up. End on the main pose.' },
  { key: 'stand_up_from_sprawl', label: 'Up from a trip', fb: 'stand_up', tier: 'feel', group: 'Transitions', hint: 'Plays once after she trips, instead of Stand up. Start on Sprawled, end on the main pose.' },
  { key: 'stand_up_from_dizzy', label: 'Up from dizzy', fb: 'stand_up', tier: 'feel', group: 'Transitions', hint: 'Plays once after a Dizzy drawn low, instead of Stand up. End on the main pose.' },
  { key: 'stand_up_from_knocked_out', label: 'Up from knockout', fb: 'stand_up', tier: 'feel', group: 'Transitions', hint: 'Plays once after a knockout, instead of Stand up. End on the main pose.' },
  { key: 'sit_down', label: 'Sit down', fb: 'sit', tier: 'feel', group: 'Transitions', hint: 'Plays once from standing, before Sit, and before a Watch cursor drawn sitting. Start on the main pose, end on Sit.' },
  { key: 'stand_from_sit', label: 'Stand from sit', fb: 'stand', tier: 'feel', group: 'Transitions', hint: 'Plays once as she gets up from Sit, and from a Watch cursor drawn sitting. Start on Sit, end on the main pose.' },
  { key: 'fall_asleep', label: 'Fall asleep', fb: 'sleep', tier: 'feel', group: 'Transitions', hint: 'Plays once from standing, before Sleep, so Sleep can be the nap alone. Start on the main pose, end on Sleep.' },
  { key: 'watch_cursor', label: 'Watch cursor', fb: 'sit', tier: 'feel', group: 'Transitions', hint: 'Sits and follows the cursor after a chase. Drawn sitting, she gets up through Stand from sit.' },
  { key: 'struggle', label: 'Struggle', fb: 'drag', tier: 'feel', group: 'Transitions', hint: 'Plays once when held still for 10 seconds or shaken hard, then she breaks free.' },
  { key: 'knocked_out', label: 'Knocked out', fb: 'sprawl', tier: 'feel', group: 'Transitions', hint: 'After the hardest landings.' },
  { key: 'dangle_legs', label: 'Dangle legs', fb: 'sit', tier: 'windows', group: 'Windows', hint: 'Sitting on a window edge. Needs a lower anchor so her legs hang past it.' },
  { key: 'tired', label: 'Tired', fb: 'sit', tier: 'personality', group: 'Personality', hint: 'At the end of a chase.' },
  { key: 'excited', label: 'Excited', fb: 'happy', tier: 'personality', group: 'Personality' },
  { key: 'laugh', label: 'Laugh', fb: 'happy', tier: 'personality', group: 'Personality', hint: 'Plays once.' },
  { key: 'surprised', label: 'Surprised', fb: 'stand', tier: 'personality', group: 'Personality', hint: 'Plays once.' },
  { key: 'face_away', label: 'Face away', fb: 'stand', tier: 'personality', group: 'Personality' },
  { key: 'tap_screen', label: 'Tap the screen', fb: 'stand', tier: 'personality', group: 'Personality', hint: 'Plays once.' },
  { key: 'turn_back', label: 'Turn back', fb: 'stand', tier: 'personality', group: 'Personality', hint: 'Plays once.' },
  { key: 'stare', label: 'Stare', fb: 'stand', tier: 'personality', group: 'Personality' },
  { key: 'signature', label: 'Signature move', fb: 'stand', tier: 'personality', group: 'Personality', hint: 'One move that is this character\'s own. Plays once.' }
] as const;
export type PoseKey = (typeof POSES)[number]['key'];
export type Tier = 'core' | 'feel' | 'windows' | 'personality';
export interface PoseSlot { key: PoseKey; label: string; fb: string | null; tier: Tier; group: string; hint?: string }
export const POSE = Object.fromEntries(POSES.map(p => [p.key, p])) as unknown as Record<PoseKey, PoseSlot>;

/* the part of an image that isn't empty, as fractions of it */
export interface ContentBox { x0: number; y0: number; x1: number; y1: number }
export interface Frame { src: string; bb: ContentBox }
export interface Pose { frames: Frame[]; fps?: number; scale?: number }
/* how the main image was cut, so later frames keep its scale */
export interface ImageRef { ow: number; oh: number; w: number; h: number; cx: number; by: number; side: number }
export interface Kit { mode?: 'tags' | 'text'; appearance?: string; personality?: string; quality?: string; styleTags?: string; styleText?: string }
/* A character's own move, as data: how often it comes up, and what it says. Its art is the signature pose. */
export interface Signature { weight?: number; line?: string }
/* `lift`: every pose drawn this much further from what she's on, one value for each kind of surface,
   since art often sits differently on its side or upside down. Each is a share of `size`: away from the
   floor is up, from a wall is out, from a ceiling is down. Below 0 sinks her in. A pose on the floor adds
   its own on top, in its frames' box bottoms. A value at 0 is left out, and so is `lift` when all are. */
export const LIFTS = ['floor', 'wall', 'ceiling'] as const;
export type Lift = Partial<Record<(typeof LIFTS)[number], number>>;
export interface Buddy {
  character?: string; name?: string; size?: number; lift?: Lift; faces?: 'left' | 'right';
  base: Frame; ref?: ImageRef; poses: Partial<Record<PoseKey, Pose>>;
  lines?: Partial<Record<Situation, string[]>>; kit?: Kit; signature?: Signature;
}

/* Standard Shimeji-ee image numbering (shime1.png … shime46.png), approximate. */
export const SHIMEJI_MAP: Partial<Record<PoseKey, number[]>> = {
  stand: [1], walk: [1, 2, 1, 3], run: [1, 2, 1, 3], sit: [11], sleep: [21], think: [26],
  jump: [22], fall: [4], land: [18, 19], sprawl: [21],
  drag: [1], dragL: [7, 9], dragR: [8, 10],
  climb: [14, 12, 13], wall: [13], crawl: [25, 23, 24], hang: [23]
};
export const SHIMEJI_FPS: Partial<Record<PoseKey, number>> = { walk: 6, run: 12, land: 6, climb: 5, crawl: 5 };

/* Does this character have its own frames for a pose, not a fallback's? */
export const hasArt = (b: Pick<Buddy, 'poses'>, key: string) => !!(b.poses && b.poses[key as PoseKey] && b.poses[key as PoseKey]!.frames.length);
/* Can it show a pose at all? A required pose always can, ending at the main image. */
export const canShow = (b: Pick<Buddy, 'poses'>, key: string) => { const slot = POSE[key as PoseKey]; return !slot || slot.tier === 'core' || hasArt(b, key); };
