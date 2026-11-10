# Shimeji parity notes

Read from source and config only. Nothing downloaded was run, so every statement about behaviour comes from reading code, not from watching an app. Bare numbers are line references to `desktop-buddies/engine.js`, which are the same in the main checkout and the spike branch (the copies differ only in line endings). `sim.js` means `spike/overlay/web/sim.js` on the spike branch. Companion table: `parity.json`.

## Sources

| Name used here | Repo, commit | State | License |
|---|---|---|---|
| fork | DalekCraft2/Shimeji-Desktop `bded6e1d47` | Active. Main source for config and numbers | NOASSERTION |
| classic | gil/shimeji-ee `0a24ef484f` | Kilkakon 1.0.13 base, last push 2019. Used to confirm the fork did not change the rules | NOASSERTION |
| libshijima | pixelomer/libshijima `361f452f3e` | Active, not taking contributions | GPL-3.0 |
| Shijima-Qt | pixelomer/Shijima-Qt `57723f1d7a` | **Archived and discontinued**, says its README | GPL-3.0 |
| popeto | HallowHound/popeto `c448c69882` | Created 2026-10-30, 2 stars. Closest design to ours, but unproven | MIT |
| eSheep | Adrianotiger/desktopPet `167ece600a` | Active, 1168 stars | MIT |
| clawd | Hert4/clawd-window `fea00f0126` | Tauri app, small | none stated |
| wl_shimeji | CluelessCatBurger/wl_shimeji `787b5a072a` | Active, Wayland only. Skimmed | GPL-2.0 |

Compare behaviour only. libshijima, Shijima-Qt and wl_shimeji are GPL and clawd states no license, so copy nothing from them.

## What should change stage 3

The main finding: **Shimeji is the wrong model for our windows.** Classic and Shijima have one terrain window, shared by every mascot. Our plan wants every window, which is what popeto, eSheep and clawd do. Take feel and numbers from Shimeji, and take window structure from popeto and eSheep.

1. **Store a normal, not a side.** A screen's left wall is climbed from inside, with the buddy facing left. A window's left side is climbed from outside, with the buddy facing right, which is the orientation of a screen's *right* wall. The fork picks by facing for this reason: `lookRight ? activeIE.left : activeIE.right`, and the opposite for the work area. `'left' | 'right'` cannot carry over, and render depends on it (868, 872).
2. **Add `ceil` as a window surface.** A window's bottom edge is a ceiling in Shimeji. The plan and tracker list tops and sides only. This costs little at stage 3 and our crawl and hang states already exist.
3. **Keep a position along the surface, not absolute x and y.** `{ surface, t }` lets the owner move or resize. Fork, popeto and eSheep all scale position along the edge on resize. This replaces `fit()` (899-904).
4. **Bind per buddy, by owner id.** With one global window, any focus change drops every mascot on the old window. The plan's `id` covers this; do not add a global "active window".
5. **One "still on my surface?" check, run after carrying.** The order per tick is: move with the owner, then test, then fall if off. Close, minimize, cover, unplug, walking off an end, and a too-fast move all become one path, like Shimeji's `LostGroundException`. The engine has no such concept today.
6. **Add grip limits to the carry step.** Shimeji stops carrying past a limit, so the mascot falls. See numbers below. Also protects against teleporting when a window snaps or jumps monitor.
7. **Air collision must be swept and one-way.** Tests at 731, 741 and 745 are half-planes, which only work for the outer rectangle. Window edges are lines. A 1000 px fall reaches 35 px per frame, so a point test skips them. Tops catch only when moving down, sides only when faced. The spike already made floors one-way (`sim.js` line 10). The fork also scans 80 px above the path so a rising window still catches.
8. **Query at the buddy instead of pre-clipping edges.** The plan clips by z-order into uncovered parts. popeto and eSheep both keep whole windows plus z-order and test the spot under the pet. That needs no rebuild on z-order change. Recommendation: `{ rect, z, terrain }`, plus `isOn(p)` and `covered(z, p)`.
9. **Separate blockers from platforms.** Maximized and fullscreen windows should hide what is behind them without being walkable. By the code, popeto and clawd drop them from the list entirely, so windows behind stay solid. Classic gets this right: a maximized window ends the search.
10. **Link corners.** Each rectangle's four edges should know their neighbours, replacing the `P.x === 0` sentinel (716) and the `world.w / 2` guess (675). Shimeji corners are a 64 px snap hidden by a pose change, so corners need no geometry.
11. **Monitors: open shared edges, plus a dead-zone rule.** Classic ignores shared edges for falling but keeps them as walls for walkers, so a mascot can climb an invisible wall mid-desktop. popeto marks them `open`, which is better. Mixed monitor sizes leave areas with no floor, and monitors get unplugged, so stage 3 needs a recovery rule. Options: Shimeji's respawn above the top, or popeto's nearest monitor. eSheep clamps back on display change.
12. **Speeds versus physical pixels.** World units are physical pixels (`sim.js` line 2), and areas carry a scale. Speeds, gravity and grip limits need that scale or buddies move slower on a high-DPI monitor.

Other code that reads `world.w`, `world.h` or `P.surf`, and needs changing:

- Effects: puddle 541, tears 547, crumbs 579
- `pairs` 367 and 370, which compares only x, so buddies on different windows would meet
- `chase` 510-511, `ceilGo` 761, `act('drop')` 757, `floorOnly` 759
- Walk direction bias 491, climb choice 501, `click` 822-823, `petted` 833, `shy` 847
- Bubble and tag clamps 890, 896

Stage 5 notes:

- The plan says "no polling". eSheep hooks `EVENT_OBJECT_LOCATIONCHANGE` per window and filters on `objectId == 0 && childId == 0`, but keeps a 100 ms timer as a fallback. popeto rescans every 25 ms tick, clawd every 100 ms. Plan on the filter and a fallback.
- popeto reads `DWMWA_EXTENDED_FRAME_BOUNDS`, as our plan does. Shijima-Qt uses `GetWindowRect`, which includes the invisible resize border.

## Numbers that define the feel

Shimeji ticks every 40 ms, 25 per second (fork `Manager.TICK_INTERVAL`; libshijima README says "designed to run at 25 FPS"). Shijima-Qt runs 4 subticks per 40 ms. Pose `Velocity` is px per tick (`Pose.apply`). `Duration` is in ticks (`ActionBase`). Ours is px per 16.67 ms frame, with `dt` capped at 3, so ours runs in slow motion below 20 fps.

| | Shimeji | Ours | Source |
|---|---|---|---|
| Gravity | 2 px/tick², with drag | 0.6 px/frame² = 2160 px/s², no drag | `actions.xml` Falling; `Fall.java`; 11 |
| Air drag | x 0.05, y 0.1 per tick | none | same |
| Terminal fall | 20 px/tick = **500 px/s** | none | 2 / 0.1 |
| Walk | 2 px/tick = 50 px/s | 1.1 = 66 px/s (59 to 74 with `P.sp`) | `actions.xml`; 492 |
| Run | 4 = 100 px/s | 3 = 180 px/s | `actions.xml`; 497 |
| Dash | 8 = 200 px/s | chase up to 3.4 = 204 px/s | `actions.xml`; 509 |
| Creep | average 7.8 px/s | none | computed |
| Climb wall | stop-start, average **16 px/s**, 2.24 s cycle | 0.85 = **51 px/s**, steady | computed; 655 |
| Ceiling | same as wall, 16 px/s | 0.8 = 48 px/s | computed; 671 |
| Jump | Homing, 20 px/tick = 500 px/s at target | Ballistic, vy -10 to -14 | `Jump.java`; 760 |
| Edge leap | vx 15 to 20, vy -20 to -25 px/tick | none | `actions.xml` |

Fall simulated from both formulas:

| Drop | Shimeji | Ours |
|---|---|---|
| 100 px | 0.48 s, 359 px/s | 0.30 s, 648 px/s |
| 300 px | 0.96 s, 460 px/s | 0.53 s, 1152 px/s |
| 600 px | 1.56 s, 492 px/s | 0.75 s, 1620 px/s |
| 1000 px | 2.36 s, 499 px/s | 0.97 s, 2088 px/s |

Shimeji floats down. Ours drops about 2.4 times faster over a screen height, and lands 4 times harder.

Frame timing:

| Action | Shimeji | Our import (`SHIMEJI_FPS`, 125) |
|---|---|---|
| Walk | 6 ticks per frame = 4.2 fps | 6 fps |
| Run | 2 ticks = 12.5 fps | 12 fps |
| Bounce | 4 ticks = 6.25 fps | 6 fps |
| Climb | 4 ticks (6.25 fps) during moves, with 16 tick pauses | 5 fps, no pauses |

Rest lengths:

| | Shimeji | Ours |
|---|---|---|
| Stand | 20 to 60 s | 1 to 3.3 s (485) |
| Sit | 20 to 60 s | 2.5 to 7 s (516) |
| Hold wall | 20 to 60 s | 1 to 4 s (665) |
| Hang | 20 to 60 s | 1.3 to 4.3 s (684) |
| After landing | 4 to 8 s | 0.3 to 0.4 s (630) |
| Walk | Until target, up to about 36 s on 1920 px | 2 to 6.3 s (491) |

This is the largest feel gap. Shimeji is slow and sits for long stretches; ours is roughly 10 times busier. That suits a web demo. For an all-day desktop pet it also works against the stage 6 idle throttle, which only pays when buddies are still. The change would alter how the web maker feels, so it is a call for the project manager and the owner, and it conflicts with stage 3's "web maker behaves the same" if done early. A pace setting may answer both.

Throw and bounce:

- Velocity is `dx = (dx + delta) / 2` per tick, a running average, unclamped (`Location.set`). Ours uses the last 90 ms, clamped to ±45 (786, 805-806).
- Landing has no physical bounce. Fall ends, Bouncing plays. Ours has wall rebound at 0.35 and ceiling at 0.3 (739, 743).
- Any faced wall stops a fall and grips for 4 s. Ours needs `thrown`, `|vx| > 3` and speed under 34 (734).
- No ceiling catch in the default config. The mascot flies above the top and comes back, because the off-screen test skips the top. Ours catches (742).
- Ours has hurt and dizzy (748); Shimeji has no hard-landing state.
- Grip limits, per 40 ms tick: floor and ceiling lose grip at 80+ px sideways, more than 20 px down, or more than 80 px up. Wall loses it at 80+ px on either axis (`FloorCeiling.move`, `Wall.move`). That is about 2000 px/s and 500 px/s. popeto uses the same numbers. Time-scale these, since ours has no fixed tick.

How often each behaviour is chosen, from `behaviors.xml`. The pick is weighted by `Frequency`, among behaviours whose conditions hold.

| On the work-area floor, mid-screen, total 1510 | | Ours (`decideFloor`, 695, total 12.8) | |
|---|---|---|---|
| Stand | 13.2% | idle | 23.4% |
| Sit | 13.2% | sit | 11.7% |
| Wander | 13.9% | walk + run | 43.0% |
| Go somewhere and sit | 26.5% | | |
| Go to a wall and climb | **26.5%** | climbGo | **4.3%** |
| Multiply | 6.6% | | |
| | | think, sleep, jump, dance, sing, eat, roll, spin, ceilGo | 17.6% |

On a window top (total 1460): stand 13.7%, sit 13.7%, wander 14.4%, go to an edge and sit 27.4%, **leap off 27.4%**, split 3.4%. Mascots do not stay long on a window.

## Window rules

| Case | Classic and fork | Shijima | popeto | eSheep | clawd |
|---|---|---|---|---|---|
| Terrain | One window for all | One, foreground only | All qualifying, per-pet binding | All with title bars | All qualifying |
| Picked by | Top of z-order, skipping non-qualifying | `GetForegroundWindow`, skips own process | `EnumWindows` | `EnumWindows` | `EnumWindows`, 100 ms |
| Walk on top | Yes | Yes | Yes | Yes | Yes |
| Climb sides | Yes, from outside, when faced | Yes | Yes | Border animations if the pet has them | Yes |
| Under the bottom | Yes | Yes | Yes | Not checked | No |
| Window moves | Carried, x scales | Follows dx, dy | Carried, as fork | Carried, x scales, hook driven | Top re-derived each tick; no ride state |
| Too-fast move | Falls | Not checked | Falls | Not checked | Snaps up, falls at 250 px/s |
| Close or minimize | Falls | Falls | Falls | Close falls; minimize not traced | Falls; a climber goes back to walking |
| Focus changes | **Falls** | **Falls** | No effect | No effect | No effect |
| Covered | No such case | No such case | Falls (point test) | Falls | Not checked |
| Maximized | Ends the search, no window terrain | Not filtered | Skipped, not a blocker | Not checked | Skipped, not a blocker |

Getting up onto a window (fork):

- Falling on it, or being dropped there.
- `JumpOnIE*Wall` (freq 50): beside the window, and within a quarter of its height of its bottom. Windows high up the screen are not reachable this way.
- `JumpFromBottomOfIE` (freq 50): on the floor, under the window.
- Climb round from the bottom by `GrabIEBottom*Wall`.

Getting off: walking past an end falls, but target walks stay 64 px inside so this is rare. The normal way is a leap, 27.4% of picks.

Window filters:

- classic: `InteractiveWindows` is a title allowlist, and the committed `conf/settings.properties` says `Notepad/Chat/Steam/Friends`. Any other window is ignored.
- fork: allowlist plus blocklist. With both lists empty, `hasValidTitle` rejects every window. See "Not verified".
- popeto: no configuration. See `parity.json`, "Which windows qualify", plus a list of 12 skipped shell classes. Fullscreen rects are skipped.
- clawd: visible, not minimized, not cloaked, not tool or no-activate, has a title, at least 200x100, not screen-sized.

## Multiplication and spawning

- `SplitIntoTwo` (freq 50, on any floor) plays frames 42 to 46 and spawns a twin via `Breed` on the penultimate frame. `PullUpShimeji` (freq 50, work-area floor only) hauls one up with frames 38 to 41. The puller falls back with vx ±20, and the new one flies up with vy -40.
- Both need `mascot.totalCount < 50` in the config. I saw no cap in the engine itself. popeto caps at 30 by default. Ours caps at 12 (`export.js` line 10).
- `Breed` also takes `BornMascot` (another type), `BornCount`, `BornInterval` and `BornTransient`. `Transform` changes type. Settings: `breeding`, `transients`, `transformation`, all on by default.
- Call Shimeji: the anchor starts at (-4000, -4000), no behaviour qualifies, so `buildNextBehavior` places it 256 px above the top at a random X and uses Fall. With Move Between Screens on, the range is the whole desktop. Ours starts 0 to 200 px above the top, in the middle half (445).
- Left-clicking the tray icon spawns one, with a 1 s debounce. Dismiss All exits the app.
- Behaviours with frequency 0 run only when called: `ChaseMouse`, `Dragged`, `Thrown`, `Fall`, `PullUp`, `Divided`. Fall, Dragged, Thrown and ChaseMouse are marked required.

## Menus and settings

Mascot right-click (`Mascot.java`; items, not exact order): Call Another, Follow Cursor, Restore Windows, Reveal Statistics, Set Behaviour, Allowed Behaviours, Pause, Dismiss, Dismiss Others, Dismiss All Others, Dismiss All.

Tray (`TrayMenuPanel.java`): Call Shimeji, Follow Cursor, Reduce to One, Restore Windows, Allowed Behaviours, Breeding/Cloning, Transients, Transformation, Throwing Windows, Sound Effects, Move Between Screens, Choose Shimeji, Settings, Language, Pause or Resume, Dismiss All.

Settings window (fork): General (tray icon, always show chooser, always show information, draw bounds, opacity, scaling, filter), Interactive Windows (whitelist, blacklist), Window Mode (run inside a window with a background), About.

Settings fields and defaults (`Settings.java`): breeding, transients, transformation, throwing, sounds, multiscreen, all true. Opacity 1.0, scaling 1.0, nearest-neighbour filter, `disabledBehaviors` per image set.

Shijima-Qt puts everything in a Manager window: File (import, show folder, quit), Edit (delete), Settings (multiplication, windowed mode, scale), Help. That is close to our Buddy Manager.

popeto adds: max pets, hide on fullscreen with per-exe exceptions, keep windows on screen, shake windows on hard landing, autostart, plus optional pranks and reminders, all pranks off by default.

Worth keeping from these: a pause while the menu is open, Dismiss Others, "draw bounds" as a debug overlay for stage 5, and a user exclude list.

## Not verified

- **Nothing was run.** No behaviour here was seen live. Multi-monitor and window claims are all from code.
- **Fork default with no settings file.** `hasValidTitle` plus empty defaults means no window is interactive. `conf/settings.properties` is gitignored, so a release may ship one. I could not check a release build.
- **Classic default list.** `Notepad/Chat/Steam/Friends` is what gil's fork commits, which may not match every distribution.
- **Original Shimeji-ee on Google Code** was not read. Classic here means gil's copy, stated to be from Kilkakon 1.0.13.
- **Packs vary.** Numbers are from the default `actions.xml` and `behaviors.xml`. Real packs often change them. Shijima-Qt's `DefaultMascot` differs from the fork in about 340 diff lines; I only spot-checked frequencies and caps there.
- **popeto and clawd maximized claim** is a reading of their filters. I did not trace every later path.
- **eSheep** cells for under the bottom, minimize, maximized and too-fast moves are marked as not checked because I did not trace them.
- **Shijima cells** marked "Yes" rest on libshijima's borders and the shared config, which was not read line by line.
- **wl_shimeji and NeurolingsCE-Qt** were skimmed only. wl_shimeji has one active window via a plugin. NeurolingsCE is a Shijima-Qt fork with active-window edge following.
- **Desktop Goose** was not read. A source copy exists (arkangel-dev/desktop-goose-source), but I did not open it.
