# Desktop Buddies: core loops

Updated 2026-11-09.

How a buddy spends its time, and the animations it needs, drawn from the engine, the Shimeji research and an artist's list.

The state machine landed in stage 4, so a clip can play once and hand off to the next, as Shimeji's sequences do. What's left is mostly art: the moves marked below run today on whatever pose a buddy has.

A behaviour can have a clip on the way in as well as on the way out. One on the way in plays only when she comes to it standing, so she never sits down twice. A timed state whose time runs out lets her own art for it finish the pass it's in first, when that art has more than one frame and the pass ends within 3 seconds, so Wave and Tired end on their last frame. A grab, an event or a request still cuts at once.

## Loops

### Wander

Idle is the hub, and each timer ends in a weighted pick for what comes next. Walking to a wall feeds the climb loop: Shimeji does that on 26.5% of floor picks and we do on 4.3%. The `something?` is still open from the artist's sketch.

| From | To | When | Status |
|---|---|---|---|
| idle | walk |  | In the engine today |
| idle | look around |  | In the engine today |
| idle | jump |  | In the engine today |
| idle | run | picks | In the engine today |
| idle | sit |  | In the engine today |
| idle | emote |  | In the engine today |
| idle | something? |  | Open question |
| walk | climb loop | to a wall | In the engine today |
| jump | land |  | In the engine today |
| run | faceplant | trips | In the engine today |
| faceplant | stand up from a trip | its own art, else stand up | New |
| idle | roll | picks | In the engine today: Stand spun like a wheel, or her Roll art |
| sit | rest loop |  | In the engine today |

Not done yet: look around (in the engine, needs its own art), something? (open question), faceplant (in the engine, needs its own art).

### Climb

The heart of a Shimeji, and already in the engine. Stage 5 uses the same art on windows, so these four drawings pay off twice. Without them she uses a rotated main image.

| From | To | When | Status |
|---|---|---|---|
| walk to wall | climb |  | In the engine today |
| climb | hold wall | pauses | In the engine today |
| climb | crawl ceiling | corner | In the engine today |
| crawl ceiling | hang | stops | In the engine today |
| hang | fall | lets go | In the engine today |
| hold wall | fall | leaps off | In the engine today |
| fall | idle | lands | In the engine today |

### Pick up and throw

How she leaves your hand picks the branch. Struggling is Shimeji's: held still for 10 seconds, or shaken hard, she breaks free. Knocked out, the floor and a real stand up come from an artist's sketch. Today she snaps from dizzy straight to idle.

| From | To | When | Status |
|---|---|---|---|
| held | short drop | low | In the engine today |
| held | free fall | high | In the engine today |
| held | struggle | still, or shaken hard | New |
| held | thrown | fast | In the engine today |
| struggle | free fall | breaks free | New |
| short drop | land |  | In the engine today |
| free fall | land |  | In the engine today |
| free fall | lay on floor |  | New |
| thrown | hit | hard | In the engine today |
| thrown | grab wall | hits a wall | In the engine today |
| grab wall | climb loop |  | In the engine today |
| hit | dizzy |  | In the engine today |
| hit | knocked out | hardest | New |
| lay on floor | stand up |  | New |
| dizzy | stand up from dizzy | drawn low; its own art, else stand up | New |
| knocked out | stand up from knocked out | its own art, else stand up | New |
| land | idle |  | In the engine today |
| stand up | idle |  | New |
| dizzy | idle | snaps up today | In the engine today |

Not done yet: struggle (new), thrown (in the engine, needs its own art), lay on floor (new), knocked out (new), stand up (new).

### Chase

Ours and Shimeji's run the same way, but Shimeji adds two things: a chance to trip, and sitting afterwards to watch the cursor. Those cost one new drawing, and `tired` from the artist's list has a natural home here.

| From | To | When | Status |
|---|---|---|---|
| chase | caught | reaches it | In the engine today |
| chase | faceplant | trips | New |
| chase | tired | gives up | In the engine today |
| caught | happy |  | In the engine today |
| tired | sit |  | In the engine today |
| sit | watch cursor |  | New |
| happy | idle |  | In the engine today |
| faceplant | idle |  | In the engine today |
| watch cursor | idle |  | New |

Not done yet: faceplant (in the engine, needs its own art), tired (in the engine, needs its own art), watch cursor (new).

### Attention

A click in Shimeji only starts a drag, so these reactions are already ours to keep. The artist's list adds a quieter loop: she turns her back, taps on your screen and turns round. It's a good idea with no trigger yet, so it sits in a later tier.

| From | To | When | Status |
|---|---|---|---|
| click | wave or spin |  | In the engine today |
| five clicks | angry |  | In the engine today |
| hover | shy |  | In the engine today |
| rub | happy |  | In the engine today |
| wave or spin | idle |  | In the engine today |
| angry | idle |  | In the engine today |
| shy | idle |  | In the engine today |
| happy | idle |  | In the engine today |
| idle | face away |  | New |
| face away | tap screen |  | New |
| tap screen | face away |  | New |
| face away | turn back |  | New |
| turn back | idle |  | New |
| idle | stare |  | New |
| stare | idle |  | New |

Not done yet: face away (new), tap screen (new), turn back (new), stare (new).

### Rest

Getting up is what changes. Today she snaps from sitting or sleeping straight into whatever's next, and the artist's clips add a real stand up. Shimeji rests 20 to 60 seconds where we rest 1 to 7, so a calmer pace makes small moves like looking around matter more.

| From | To | When | Status |
|---|---|---|---|
| idle | sit |  | In the engine today |
| idle | sleep |  | In the engine today |
| idle | sit down | from standing | New |
| sit down | sit |  | New |
| idle | fall asleep | from standing | New |
| fall asleep | sleep |  | New |
| sit | stand from sit |  | New |
| sleep | stand up from sleep | its own art, else stand up | New |
| stand from sit | idle |  | New |
| stand up | idle |  | New |
| sit | idle | snaps up today | In the engine today |
| sleep | idle |  | In the engine today |

Not done yet: sit down (new), fall asleep (new), stand from sit (new), stand up (new).

With `fall_asleep` drawn, Sleep can be the nap alone, so a long falling-asleep part doesn't have to fit inside Sleep's 120 frames.

### Windows

Stage 5, shaped by Shimeji, popeto and eSheep. All of it runs on climb and walk art, and all of it is in the engine except dangling her legs on a window's edge, the one new drawing. Until that exists she leaps straight off the end of a top. Every way of losing a window ends in the same fall.

| From | To | When | Status |
|---|---|---|---|
| homing jump | window top |  | In the engine today |
| window top | sit on edge | walks | New |
| sit on edge | leap off |  | New |
| leap off | fall |  | In the engine today |
| climb side | window top | over the top | In the engine today |
| crawl under | hang under |  | In the engine today |
| hang under | fall | lets go | In the engine today |
| window moves | ride along |  | In the engine today |
| ride along | fall | too fast | In the engine today |
| window gone | fall | closed or covered | In the engine today |

Not done yet: sit on edge (new).

### Buddies meeting

Today only two calm buddies on the same floor meet. Shimeji has none of this by default. Collisions and known-character lines are the parked ideas that build on it.

| From | To | When | Status |
|---|---|---|---|
| two meet | greet |  | In the engine today |
| two meet | hug |  | In the engine today |
| two meet | bump |  | In the engine today |
| greet | known lines |  | New |
| bump | collide |  | New |
| collide | throw each other |  | New |
| hug | idle |  | In the engine today |
| known lines | idle |  | New |
| throw each other | idle |  | New |

Not done yet: known lines (new), collide (new), throw each other (new).

## The animation set we recommend

### Core: 21

Required. A complete buddy: every main loop runs on real art. A character without one of these falls back to another pose.

| Animation | From | Slot | Notes |
|---|---|---|---|
| `stand` | Engine, Shimeji, artist | Has a slot | His `idle`. |
| `walk` | Engine, Shimeji, artist | Has a slot | His `walk_side`. Shimeji cycles three images, 1-2-1-3. |
| `run` | Engine, Shimeji, artist | Has a slot |  |
| `jump` | Engine, Shimeji, artist | Has a slot |  |
| `fall` | Engine, Shimeji, artist | Has a slot |  |
| `land` | Engine, Shimeji, artist | Has a slot | Shimeji uses two frames. |
| `sit` | Engine, Shimeji, artist | Has a slot |  |
| `sleep` | Engine, Shimeji, artist | Has a slot |  |
| `drag` | Engine, Shimeji, artist | Has a slot | His `held`. |
| `thrown` | artist | New slot | His tumble. Shimeji reuses its fall. |
| `sprawl` | Engine, Shimeji, artist | Has a slot | His `faceplant`. |
| `dizzy` | Engine, artist | Has a slot |  |
| `climb` | Engine, Shimeji | Has a slot | Also climbs window sides. |
| `wall` | Engine, Shimeji | Has a slot | Also holds window sides. |
| `crawl` | Engine, Shimeji | Has a slot | Also crawls under windows. |
| `hang` | Engine, Shimeji | Has a slot | Hands at the very top of the image. Also hangs under windows. |
| `happy` | Engine, artist | Has a slot |  |
| `wave` | Engine, artist | Has a slot |  |
| `angry` | Engine, artist | Has a slot | His `annoyed` folds in here, unless he wants a milder one too. |
| `cry` | Engine, artist | Has a slot | His `sad` folds in here. The engine draws the tears and puddle. |
| `shy` | Engine | Has a slot | Plays on hover. |

### Feel: 15

Transitions and small moves, skipped if a character has no art for them. Most need play-once, so stage 4.

| Animation | From | Slot | Notes |
|---|---|---|---|
| `stand_up` | artist | New slot | Plays once, from sleep, faceplant or knocked out. |
| `stand_up_from_sleep` | An artist | New slot | Plays once instead of `stand_up` after sleep. |
| `stand_up_from_sprawl` | An artist | New slot | Plays once instead of `stand_up` after a faceplant. |
| `stand_up_from_dizzy` | An artist | New slot | Plays once instead of `stand_up` after a Dizzy drawn low. |
| `stand_up_from_knocked_out` | An artist | New slot | Plays once instead of `stand_up` after a knockout. |
| `sit_down` | An artist | New slot | Plays once from standing, before Sit and a Watch cursor drawn sitting. |
| `stand_from_sit` | artist | New slot | Plays once. |
| `fall_asleep` | An artist | New slot | Plays once from standing, before Sleep. |
| `roll` | An artist | New slot | Drawn rolling, so the engine moves her without turning it. Without it she spins Stand like a wheel. |
| `look_around` | Engine, artist | Has a slot | Goes in our `think` slot. |
| `watch_cursor` | Shimeji | New slot | Sits and follows the cursor, two frames. Drawn sitting, she gets up through `stand_from_sit`. |
| `struggle` | Shimeji | New slot | Held still for 10 seconds, or shaken hard, then breaks free. |
| `knocked_out` | artist | New slot | From his sketch, not his list. |
| `dragL` | Engine, Shimeji | Has a slot | The swing when dragged. Shimeji has seven sway frames. Without it she swings on Held. |
| `dragR` | Engine, Shimeji | Has a slot | Same, the other way. |

### Windows: 1

Stage 5, skipped without art. Everything else on windows reuses Core art.

| Animation | From | Slot | Notes |
|---|---|---|---|
| `dangle_legs` | Shimeji | New slot | The one new drawing for windows. Needs a lower anchor so her legs hang past the edge. |

### Personality: 12

Optional. A character without the art never does these, so draw only what suits it.

| Animation | From | Slot | Notes |
|---|---|---|---|
| `dance` | Engine, artist | Has a slot |  |
| `sing` | Engine | Has a slot |  |
| `eat` | Engine | Has a slot | The engine draws the crumbs. |
| `tired` | artist | New slot | Fits the end of a chase. |
| `excited` | artist | New slot | Needs a trigger. |
| `laugh` | artist | New slot | Plays once, needs a trigger. |
| `surprised` | artist | New slot | Plays once, needs a trigger. |
| `face_away` | artist | New slot | Its own loop, needs a trigger. |
| `tap_screen` | artist | New slot | His `click`. Plays once. |
| `turn_back` | artist | New slot | Plays once. |
| `stare` | artist | New slot | Needs a trigger. |
| `signature` | artist | New slot | One move per character, from its personality text. |

## What this means for the artist's list

- **Keep:** most of the artist's list holds up. `thrown` gives her a real tumble where Shimeji reuses its fall, `stand_up` and `stand_from_sit` fix the snap we have today, and `look_around` matters more at a calmer pace.
- **Fold in:** `annoyed` into `angry` and `sad` into `cry`, unless he wants milder versions too.
- **Later:** nine of his clips, including the `face_away` loop, sit in Personality. Most have no trigger yet, and nothing else depends on them.
- **Add:** `climb`, `wall`, `crawl`, `hang` and `shy` to Core, because those loops already exist and are central. `dragL` and `dragR` go in Feel: she swings on Held without them. `sing`, `eat` and `shy` also carry engine behaviour that his list would otherwise lose.

If he has time for four more drawings, it should be `climb`, `wall`, `crawl` and `hang`, then `dragL` and `dragR`.

## Questions for the artist

1. What does `click` mean in the sketch, where it hangs off jump and idle? In the list it's her tapping the screen. Is it also what happens when someone clicks her?
2. What sets off `face_away` and `stare`? Time alone, the cursor going still, or something else?
3. Should walking or running lead into a jump, as the sketch shows? Today a jump is its own pick from idle.
4. Do the play-once clips start and end exactly on the base pose? That decides whether they can join without a pop.
