# Project structure

Desktop Buddies is a long-term project, so it gets a proper foundation. The original web maker's engine is kept in `apps/maker/tests/golden/original/`, where the golden tests replay it.

## Layout
```
packages/
  engine/       simulation and states, no DOM
  terrain/      surfaces and queries
  buddy-file/   the file format and its validation
  validate-buddy/ a .buddy checked as hostile data: image headers, caps, the command
  view/         drawing a world to the DOM
  art/          turning uploaded art into frames, and the cut line
  maker-core/   the Maker's rules, no DOM
  maker-view/   the Maker in Peel, DOM on top of maker-core
  peel/         what the Manager and the Maker share: tokens, fonts, small DOM helpers
  test-support/ test helpers, including dom-assert
apps/
  desktop/      Tauri shell, overlays, Manager, tray
  maker/        the Maker UI, for the web today and the desktop app later
docs/           see docs/README.md
```

## Rules
- **Tooling:** a pnpm workspace, TypeScript in strict mode, Vite for the apps, Vitest for tests.
- **Boundaries:** `engine`, `terrain`, `buddy-file` and `maker-core` never touch the DOM. Dependencies point one way: apps use packages, and packages don't use apps.
- **Code style:** small units, injected I/O (time, randomness, terrain), and contract tests for anything with more than one implementation.
- **Stable exe:** each new exe gets a fresh Smart App Control verdict, so the exe is frozen. It reports facts and does what it's told, and every decision lives in the `app` folder beside it. `apps/desktop/src-tauri` and `apps/desktop/shell-core` don't change without a real need and the owner knowing.

## Where a change goes
| To change | Look in |
|---|---|
| How a buddy behaves | `packages/engine/src/behaviours.ts`, as data. See `state-machine-design.md` |
| What counts as a surface | `packages/terrain` |
| The buddy file, Shimeji numbering | `packages/buddy-file`, the only reader and writer |
| What a shared `.buddy` may contain, `pnpm validate-buddy` | `packages/validate-buddy`. See `buddy-format-safety.md` |
| Art processing, Shimeji import, the cut line | `packages/art` |
| What the Maker does | `packages/maker-core`. `packages/maker-view` and `apps/maker/src/panel.js` only draw it |
| How the Maker looks, what's on which sheet, captions | `packages/maker-view`. See its README |
| Peel's tokens and fonts, for both windows | `packages/peel` |
| Drawing a buddy | `packages/view` |
| Which real windows are terrain | `apps/desktop/src/window-terrain.ts`, as data |
| Where windows come from | `apps/desktop/src/window-source.ts`, one small interface |
| The library, the tray, overlays, who's out | `apps/desktop/src/hub-core.ts` and the units beside it |
| How the Manager looks | `apps/desktop/src/manager/` and `public/manager.css`, after `packages/peel`. Spec: `design/round-1/peel/DESIGN.md` |
| How the Maker saves in the app | `apps/desktop/src/maker-store.ts`, and `makerSave` in `hub-core.ts`. See `native-shell-design.md` |
| What a failure says | `apps/desktop/src/failures.ts` |
| Anything in the exe | Stop first. See `native-shell-design.md` |

## Tests
- **Golden traces:** `apps/maker/tests/golden` records what the engine painted, some of it still the original's, and it must keep matching with its fixtures untouched. Changing a trace is a decision, not a fix, and `rerecorded.json` lists each one and why.
- **The Maker's view:** `pnpm test:maker-view` runs the real view on real art in a headless browser, and its captions are tested against the engine.
- **DOM tests:** use `packages/test-support/src/dom-assert.ts`, never plain `assert`. A failing compare on an element took one test worker to 36 GB and froze a workstation.
- **Breaking code on purpose:** commit first, restore in a `finally`, get a clean baseline, and cap the memory with `systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0`. Read `memory.max` inside the scope, because a rejected option can run nothing, or run it uncapped.
- **`pnpm -s` hides output.** Read the exit code, and don't take silence for a pass.
