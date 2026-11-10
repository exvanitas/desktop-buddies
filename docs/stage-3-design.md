# Stage 3: the engine split

Split `engine.js` so the simulation runs with no page attached, replace the single screen rectangle with surfaces, and run one world across monitors. The original web maker must behave exactly as it does today.

The findings behind this are in `docs/parity/notes.md`.

## Rules
- **The web maker doesn't change.** Same behaviour, same look, no build step. `python -m http.server` keeps working, and so do exported pages, which today inline `engine.js` and `style.css` through `export.js`.
- **Classic scripts.** No bundler and no dependencies in the app. Every core file must load in a page and in a worker, so nothing touches `window` or `document` at load time.
- **The exe doesn't change.** Stage 3 is app code only. It runs beside the existing exe, on the boot data and commands that exe already has: `window.__SPIKE__`, `capture`, `log_line`, and the `cursor` event. If something truly needs a Rust change, stop and report it. A new exe faces a fresh Smart App Control verdict.
- **Small units with injected I/O.** Time, randomness and the terrain come in from outside, so tests can drive them.

## Layers
| Layer | Holds | Touches the DOM |
|---|---|---|
| Simulation | Buddies, states, physics, lines, particles, pair meetings. Takes input, gives back a frame description | No |
| Terrain | Rectangles and their surfaces, and the queries over them | No |
| View | Applies a frame to the DOM for one viewport, and turns pointer events into input | Yes |
| Host | Wires them together: in the page for the web maker, a SharedWorker plus one view per monitor for the desktop | Page side only |

`DesktopBuddies.createWorld(opt)` stays as the web maker's entry point, with the same options and control object: `sync`, `act`, `step`, `pets`, `pause`, `poof`, `world`.

A frame carries what `render()` writes today, as the same strings: size, transform, transform origin, image, grab state, bubble and tag placement, particles. Nothing in `render()` measures the DOM, so all of this can be computed in the simulation.

## Terrain
A rectangle: `{ id, kind, rect, z, terrain, scale }`. `kind` is `screen` or `window`. `terrain` is false for a blocker, which hides what's behind it but can't be walked on. Stage 5 needs that for maximized windows.

A surface: `{ id, owner, kind, normal, from, to, at, next, prev }`.
- `kind` is `floor`, `wall` or `ceil`.
- `normal` says which way it faces. Never store left or right: a screen's left wall is climbed from inside, and a window's left side from outside, which is the same pose as a screen's right wall. Render picks facing from the normal.
- `next` and `prev` link corners, replacing the `P.x === 0` sentinel and the `world.w / 2` guess.

A buddy on a surface holds `{ surface, t }`, a place along it, not an absolute position. The owner can then move or resize under it. `t` is a pixel offset from `from`, because the web maker's resize clamps rather than scales. Scaling on window resize can live in the window owner's carry step in stage 5.

**Screens.** Each work area gets a floor, two walls and a ceiling, facing inward, with normal corners. Every monitor is a complete world. Only side-by-side edges are open: a wall shared with a touching monitor is not a wall, so walkers walk across and falling things cross, and a small gap (a taskbar down the side) counts as touching. Floors and ceilings between stacked monitors stay solid for walking, standing and crawling, because the taskbar top is the floor. Windows are stage 5, but the model must already allow them: all four edges of a rectangle, facing outward, with a top edge as a floor and a bottom edge as a ceiling.

**Stacked monitors.** Crossing is deliberate, three ways:
- Being dragged across.
- A hard throw breaks through one floor or ceiling: `BREAK_VY`, 26 px per frame up or down at the release, times `k`.
- Two travel behaviours: drop through the floor, and jump up through the ceiling onto the floor above. They are offered only when a stacked neighbour is there, with low weights in the pace table. On a single rectangle they don't exist, so traces and random order stay exact.

Monitors count as stacked across a taskbar's gap. Something passing through is bound for the far screen until it is inside it, and meets nothing else on the way.

**Queries.** `surfaceById`, `sweep(from, to)` for the first surface crossed, `covered(z, point)`, `behind(surface, point, body)` for her body on a window's edge with something in front reaching into it, and `across(surface, x)` for the stacked monitor beyond a floor or ceiling. Query at the buddy. Do not pre-clip edges by z-order.

## One tick, per buddy
1. Carry: move with the owner, keeping `t`.
2. Grip: if the carry moved it past the limits, it loses the surface. Per 40 ms tick these are 80 px sideways, 20 px down, 80 px up; on walls, 80 px either way. Time-scale them. Grip applies to window owners only. A screen changing size is a re-fit, as `fit()` is today, or the web maker's resize would drop every buddy.
3. Check: is the surface still there, and is the buddy still on it and uncovered? If not, it falls. Uncovered means nothing in front of her window reaches into her body, the same box a jump checks before it lands or grabs. A covered stretch is no surface while it is covered: she turns back short of it, as at a cut end, and lands or grabs only clear of it.
4. Then run the state.

Closing, minimizing, covering, unplugging, walking off an end and a too-fast move all become step 3. There is one way to lose your footing.

**Air collision is swept and one-way.** A window edge is a line, and a fall reaches 35 px a frame, so point tests skip it. A floor catches only while moving down, a ceiling only while moving up, and a wall only when moving toward its normal. Keep today's outcomes on screen edges: bounce, grab, hurt. That includes a body already past a screen edge, however it got there, such as one let go outside the page: a screen edge has nothing behind it, so it counts as caught.

**Lost buddies.** One rule for anything with no floor below it, including dead zones between monitors and unplugged screens: bring it back above the nearest screen and let it fall. A dead zone is inside the desktop's bounds and off every monitor, so a single rectangle has none.

## Units
World units are physical pixels on the virtual desktop. Each buddy has a scale `k` from the screen it's on, and every size, speed, gravity and grip limit multiplies by `k`. In the web maker `k` is 1 and the world is one rectangle, so nothing moves.

Every overlay draws a buddy at the same apparent size, as the spike does, so it doesn't pop when it crosses between scalings.

## Behaviour that must follow surfaces
These read `world.w`, `world.h` or `P.surf` today and must use the terrain: effects (puddle, tears, crumbs land on the buddy's floor, not the screen's), `pairs` (same surface, not just close in x), `chase`, `ceilGo`, `act('drop')`, the walk bias, `climbGo`, click and pet handling, shy, spawn (new buddies arrive at the top of a screen and land on its floor), and the bubble and tag clamps.

## Pace
The engine's timings go into one table with `lively` as today's values, passed in as an option. Nothing else about the pace changes in this stage. The web maker stays `lively`, and the choice of default for the desktop app is open. The table also holds the weights of the two travel behaviours.

## `.buddy.json` v2
- **Validation in one small module**, used by every import: known fields only, images must be `data:image/png`, `webp`, `jpeg` or `gif`, numbers in range, sane limits on size and frame counts. Reject anything else with the existing toast.
- **Stable character IDs.** `character` is created once and survives export and import. A copy made by Call Another shares it. v1 files upgrade on import.
- **Escape image values** where `panel.js` puts them into `innerHTML` (lines 151, 193 and 217), even though validation now blocks the attack.

## Tests
`node --test`, with no dependencies.

1. **Golden traces first, before any refactor.** Run the original `engine.js` from commit `6e32c15` in a small fake DOM with seeded randomness and a manual clock, and record everything it writes, for scripted scenarios: long idle runs across many seeds, click, pet, drag and throw at varied speeds, hard throws, wall and ceiling grabs, chase, each `act`, two and three buddies meeting, resize, dismiss. The refactored web path must reproduce these traces exactly, so random calls keep their order.
2. **Terrain contract tests**, written against the interface: sweep, corners, one-way catches, normals, open edges, lost buddies, carry and grip.
3. **Multi-monitor tests** on the real layout: 3440x1392 at 100% over 1920x1008 at 150%, offset 720 px. A buddy climbs, crawls, is thrown across by a hard throw, makes both trips, and survives its monitor vanishing.
4. **Validation tests:** hostile files for every field.

If a golden trace genuinely can't hold, stop and report why rather than updating it.

## Out of scope
Window tracking, target walks, homing jumps, edge leaps, the Manager, tray menus and right-click menus in the overlay.

## Done when
- Golden traces pass, and the web maker and an exported page work in a real browser.
- `desktop/` runs the real engine beside the existing exe: a buddy climbs, crawls, hangs, naps and talks across both monitors, and can be dragged and thrown between them.
- The spike's stand-in simulation is gone.
