# State machine design

Stage 4 step 2, built. The code is in `packages/engine/src`: `runner.ts`, `behaviours.ts` for the data, and `motions.ts`, `cues.ts`, `conditions.ts` and `anims.ts` for what the data names.

## The problem
`pet.js` has 27 states wired by hand, and 24 end on a plain timer. A pose always loops, so nothing can play once and hand off. Adding a behaviour means editing the state table, `decideFloor`, the `floorOnly` list and the alias ladder in `act()`. Window behaviours and the new animations would each make that worse.

## The idea
Behaviours become data. Physics stays code. Shimeji works the same way: actions are sequences described in a config, run by a small engine.

| Term | Means |
|---|---|
| **Clip** | A pose played once, ending on its last frame |
| **Step** | A pose held until something ends it: a timer, arriving, or an event |
| **Motion** | A named piece of physics in code: `walk`, `climb`, `crawl`, `air`, `held`, `chase` |
| **Behaviour** | Data: where it's allowed, how often it's picked, and its steps |
| **Event** | Something from outside: grabbed, lost surface, hit, clicked, petted |
| **Picker** | The weighted choice of what's next, per surface kind |

```ts
const sit: Behaviour = {
  on: ['floor'],
  weight: 1.5,
  main: { pose: 'sit', hold: 'sit' },   // `hold` reads a duration from the pace table
  exit: { clip: 'stand_from_sit' },
  then: 'pick',
};

const climb: Behaviour = {
  on: ['wall'],
  main: { pose: 'climb', motion: 'climb', hold: 'climb' },
  events: { top: 'crawl', bottom: 'idle' },
};
```

## Rules
1. **Art that isn't there is skipped.** A clip with no frames doesn't play, so a buddy without the new art behaves as it does today, and nobody has to draw everything.
2. **Events beat clips.** Grabbing her or losing her surface cuts any clip at once. Exit clips only play on a normal ending.
3. **Clips start and end on the base pose,** so they join without a pop. This is a rule for artists, and one of the questions for the artist.
4. **One place per behaviour.** Its surfaces replace `floorOnly`. Named aliases replace the `act()` ladder.
5. **Picks are tables.** One per surface kind: floor, window top, wall, ceiling. Each entry can carry a condition, like "a monitor is stacked below" or "she's been awake a while". Weights and durations come from the pace table, so a calmer pace is only a new table.
6. **Motions are registered.** Adding one doesn't touch the runner.
7. **Characters can add behaviours as data only.** A `signature` move is an entry in the buddy file, checked by the same validator, and never code.
8. **Behaviours are checked at load.** Every behaviour is reachable, none is a dead end, and every pose has a fallback. These run as tests too.

## Required and optional slots
Every pose slot is marked one of two ways:

- **Required:** the main loops need it. If a character has no art for it, it falls back as it does today, ending at the main image, so a one-image buddy still walks, climbs and gets thrown.
- **Optional:** a character without the art never does it. The picker leaves that behaviour out, and any menu that offers it hides it. Dance, sing, eat, laugh, the `face_away` loop and `signature` are examples.

The tiers on the core loops page set the default: Core is required, and Personality is optional. Feel clips are already skipped when they're missing. `think` is in the Feel tier, as `look_around`, so it's optional too.

This changes behaviour on purpose: today a buddy with no `dance` frames borrows another pose and still dances. So it lands as its own step after the migration, in a reviewed commit that re-records the traces it affects. Keep it out of the migration, where a changed trace must mean a bug.

## A bonus
Because behaviours are data, the core loops page and `core-loops.md` can be generated from them. The diagrams then can't drift from what the engine does.

## How it gets built
1. Write the runner, with its own tests.
2. Move states across in groups, each proven by the golden traces, keeping the order of random numbers: resting, reactions, movement, climbing, air and held.
3. Delete the old table, `floorOnly` and the `act()` ladder.
4. Turn on required and optional slots, as its own reviewed commit.
5. Only then add what's new: play-once clips and the new pose slots from the recommended set.

If the runner can't keep the random order for some state, stop and report it. Changing a recorded trace is a decision, not a fix.

## Getting onto windows
Stage 5. Terrain joins a window's edges only to each other, so a buddy reaches one by jumping. `aim.ts` works the jump out, and only asks: it moves nothing and draws no random numbers.

| Move | What it is |
|---|---|
| `hop` | A pick and an action. She takes off for a top, or a side she'll grab, at an arc `aim.ts` has flown ahead of time |
| `hopWalk` | A behaviour. She walks to a spot on her surface that puts a window in reach, then hops. If the spot goes or her time runs out, she picks again |
| `leapOff` | At the end of a window top, walking or running. `weights.edgeLeap` is the odds. Otherwise she does what she always did |

- **What she aims at:** a stretch of a top with nothing in front of it (`terrain.open`), at least `reach.ledge` of her widths, with nothing in front in her body's space (`terrain.crowded`). Or a side facing her, tall enough to hold, the same way.
- **The arc:** each arc is stepped as `airTick` steps, and counts only if the first thing it meets is the target. So a side in the way, an underside or the screen's edge rules it out. All of her stays on her own screen. A side is judged where she'd really meet it and where the clamp would put her, not where she meant to go.
- **In the air:** nothing steers her. `P.aim` is kept so a side hop holds on when she hits a wall, and so the flight runs in whole frames: time is saved up and spent one frame at a time, so she flies the arc that was planned at any tick. Without an aim a flight takes the tick as it comes. If the target moved, she meets whatever is there.
- **Planning:** the sim is shared, so one buddy plans per tick, and the rest go without till the next. The move a pick chooses reuses the plan its condition found. Windows out of reach are skipped before any arc is flown, a search looks at the nearest first and stops at `reach.flights`, and for walks each window gets a share, so a hopeless one can't use it all up.
- **Windowless worlds:** `hop` and `hopWalk` carry `canHop` and `canWalkToHop`, which are false without windows, and a leap needs a window top. Nothing is drawn for any of them, so the golden traces don't move.
- **Tuning:** `reach` in the pace table has the limits and the flight cap, and `weights` has `hop`, `hopWalk`, `hopSide` and `edgeLeap`.

## Not in this step
The desktop pace default (stage 6), importing Shimeji's XML behaviours (later, and this model would make it possible).
