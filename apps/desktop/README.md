# Desktop app

Runs Desktop Buddies on the real desktop. One simulation in a SharedWorker serves one overlay per monitor. Each overlay draws its slice, and takes the mouse only over a buddy's visible pixels. A hidden hub page owns the world, the tray menu, the library and the Manager window.

## Run it
From the repository root, `pnpm build`. Then copy `apps/desktop/dist/app` beside `desktop-buddies.exe`, keeping the name `app`, and run the exe:

```
desktop-buddies.exe --seconds 300 --log desktop.log
```

The exe's own flags:

- `--app-dir`: the app folder, if it isn't beside the exe.
- `--data-dir`: the library and settings, if not `%APPDATA%\dev.exvanitas.desktop-buddies`. WebView2's own data goes in a folder beside it, named `<folder>-webview`.
- `--log`: where the log goes. By default it's `logs/app.log` in the data folder, capped at 1 MB with one old file kept.
- `--seconds N`: quit by itself after this. Off unless given.
- `--devtools`: turn on the page inspector.

Anything else reaches the app through `shell_info`. The app takes these:

- `--buddies N`: N copies of the first buddy, for measuring.
- `--mode empty`: overlays with nothing on them, for a baseline.
- `--no-manager`: start without opening the Manager, as smoke and probe runs do.

A start opens the Manager once the library is read, unless Start with Windows is on: the exe's Run entry carries no flag, so that's how a sign-in launch is told apart.

A path ending in `.buddy` or `.buddy.json` is imported into the library and called. If it fails, or it would replace someone, the Manager opens and says why, or asks. A second launch hands its arguments to the first and exits. With no file, it opens the Manager, or focuses it. `--api "<json>"` is another app asking buddies to do something, and never opens the Manager unless it's to ask the person: see [docs/local-api.md](../../docs/local-api.md). `scripts/local-api-check.ps1` checks it by hand on a real PC.

GitHub Actions builds the exe and proves it (the `shell` workflow), by hand or when `src-tauri` or `shell-core` change, so app changes never make a new one. To test a new app folder or check on the existing exe, run the workflow by hand with `reuse` on. Its `soak` input leaves the hub hidden for that many seconds, to see if anything throttles it.

## What's here
- `src/hub.ts`: the hub page. `src/hub-core.ts` is its logic, with no page in it, so tests can drive it. `public/hub.html` is its html.
- `src/overlay.ts`: the page, one per monitor. `public/overlay.html` is its html.
- `src/manager.ts`: the Manager's page, with `public/manager.html`. See below.
- `src/world.ts`: the SharedWorker. `src/host.ts` is its logic, with no worker in it.
- `src/shell.ts`: a typed client for the exe's contract, and the only file that touches `__TAURI__`. `src/shell-fake.ts` is a fake exe for tests, so tests run the real client.
- `src/library.ts`: the library on disk. `src/roster.ts`: who's out, and how many copies. `src/screens.ts`: monitors as the world sees them. `src/tray.ts`: the tray menu. `src/capture.ts`: renewing the mouse lease. `src/hit.ts`: per-pixel hit testing.
- `src/window-terrain.ts`: which real windows are terrain, and how, as rules with no page in them. `src/window-source.ts`: where the hub reads windows from.
- `public/seed.json`: the buddy a first run seeds the library with, as a buddy file. Her id is the one in the file. A build can put any buddy here; tests use `packages/test-support/fixtures/sample.json` instead.
- `src-tauri`: the native shell. `shell-core`: its logic, a plain Rust crate with no Tauri in it. `cargo test` there runs anywhere.
- `shell-check`: the contract check for the Windows runner. A small app folder whose hub calls every command, and a PowerShell driver that does what a page can't. `smoke.ps1` runs the real app and judges it from the log. `manager-probe.ts` is added to the smoke run's own copy of the app, to drive the real client in the real Manager window. It never ships.
- `scripts/measure.ps1` samples RAM, CPU and GPU across the app and its WebView2 processes: `measure.ps1 -Label run -Seconds 30`. `scripts/windows.ps1` reads the overlays' windows from the OS.

The exe serves `app` through its asset provider with no server, so the build makes classic scripts at fixed relative paths: `hub.js`, `overlay.js`, `manager.js` and `world.js`. `library/` in the data folder is served the same way, so `<img src="library/colive0seed/sit.webp">` has the local origin and hit testing can read its pixels.

## The library
`library/<character>/buddy.json` plus image files, in the data folder. `buddy.json` is a buddy file with each `src` holding an image's name. `unpack` and `pack` in `buddy-file` go between that and one portable `.buddy` file. `settings.json` beside it remembers who was out, with an id repeated once per copy, and `noSeed` once someone has deleted a buddy, so an empty library stays empty. `noSeed` is on disk before the folder goes. `walk` is there when Walk on windows is off, and `exclude` lists the apps to stay off, by exe name. `api` is there when other apps may ask, and `apiApps` holds the person's answer for each app that has. `api/replies/` holds the local API's replies, in 64 fixed slots.

Only a missing `settings.json` is a first run. One that can't be read is tried again, and until it reads nothing is seeded. One that reads but makes no sense counts as read: the first buddy comes out, nothing is seeded, and the next change replaces the file.

Reading settings, reading the library and restoring who's out are one step, tried again whole. Until it finishes, nothing changes who's out, so nothing can be saved over it. Call, another, dismiss and delete answer "Still getting ready", tray items for buddies only say so in the log, and an import comes in without being called.

`library/.incoming`, `library/.outgoing` and `library/.trash` only hold anything during an import or a delete, or after a crash in one. Each start clears them, keeping a whole buddy, and tries again until that works. Nothing is seeded until it has. The exe only serves png, webp, jpg and gif from the library, and only if the bytes really are one.

## The Manager
The hub owns everything. The Manager sends commands, and the hub answers each one and publishes its state. The window holds nothing worth keeping, so it can close at any moment: the hub finishes what it was sent, and the next window reads the result. Each open window costs about 20 MB, so closing really closes it.

- `src/manager-client.ts`: the logic, with no interface in it. Read `state`, `subscribe`, and call the methods.
- `src/manager-view.ts`: Peel, the picked design. It only reads the hub's state and calls the client, and what it can't do from inside a page comes in as `ViewIO`. Its units are in `src/manager/`: `sticker`, `cutline`, `peel` (the movement), `sheet`, `titlebar`, `footer`, `find`, `menu`, `misprints`, `importing`, `replacing`, `settings`, `outlines`. `public/manager.css` is its look, built after `packages/peel/peel.css`, which holds what the Maker shares: tokens, fonts, popovers and small helpers. The window's size is in `src/manager-window.ts`.
- `src/manager-api.ts`: the commands, the answers and the state.
- `src/handed.ts`: files from a drop or `<input type=file>`, sorted into buddy files and Shimeji folders.
- `src/failures.ts`: what went wrong in plain words. Field names match the prototypes' failed import. It only rewords the reasons `read` and `unpack` give, and checks nothing itself.
- `src/wire.ts`: how pages reach the hub.

**Why a BroadcastChannel, not the SharedWorker.** The worker never hears that a port has closed, so a closed Manager would stay on its list. The simulation would also carry app traffic. On a channel, a page that closes just stops listening, and the Maker can join with no change. It needs the same origin and profile the SharedWorker already relies on.

**Dismiss** means every copy, matching the tray. `dismissOne` takes the newest copy, and the ••• menu offers it as Dismiss one.

**Bring here, Give a treat and Chase my mouse** reach every copy of her, and do nothing for someone at home. Bring here drops her in near the top of the monitor under the cursor, at its x, and lets go of her if she's held. A treat plays Eat and a chase plays Chase, and a row's `can` says which of those she has the art for, by the engine's own `canDo`. **Bring everyone here**, in the tray, closes and opens every overlay first, since the exe sets always on top only as one opens, and then brings everyone out. The world keeps them through it. An overlay that won't close carries on as it was, and one that won't open is tried again. Each overlay window the hub opens has its own number `n`, in its boot and its join, and the hub's `leave` names it, so a late leave for the closed window can't take its replacement off the world. Bring everyone here is the tray's alone: a Manager `bring` must name her. Bring draws her where she lands at once, so a paused world shows her there. Everyone at once is its own call, `actAll` in the engine and `act-all` to the world, so no buddy's id can mean everyone.

**The cut line** isn't stored. The page bakes it from the loaded image the first time a buddy is out, and keeps it in memory by image URL. See `docs/design/round-1/peel/DESIGN.md`.

**Theme** is the one thing the view keeps, in the page's `localStorage`, because it belongs to the viewer and not the library. Dark if that fails.

**The page's CSP** allows no inline style, so the view sets positions through `.style`, never a `style` attribute.

To see it: `pnpm test:manager` runs the built page in a real headless browser against the real hub on the fake exe, clicks through it and screenshots every state, at both window sizes in both themes. `--shots=dir` keeps the screenshots, `--only=word` picks states, and `--perf` adds the timings for 200 buddies.

**Imports from the Manager** don't call the buddy, because a drop of fifty shouldn't. Pass `{ call: true }` for the other way. A double-clicked file is still called.

**A file for someone already in the library** never replaces her by itself, whichever way it came: picked, dropped, passed at launch or sent to the running app. The hub holds it and asks, "Replace Pip with this file?", with Replace and Keep both. The question sits at the top of the Manager's sheet, and a launched file opens the Manager for it. Keep both adds the file as a new buddy, with a new character, as the Maker's own copy does. Closing it, or Escape, imports nothing. Several wait in order and show one at a time, and only the one shown can be answered. The same file again is the same question, and a double-click's call carries over to it. Replace is refused if she was saved since it asked, and if she was deleted she comes in from the file, since nothing newer is lost. A file she already is, with every image of hers there at its size, asks nothing and says she's up to date. Questions live in the hub, so the Manager can close and open again. A restart drops them, the file can be opened again, and an answer to one from before is refused, since question ids count on from a random start each run. A new question can't be answered for 400 ms, nor from the keyboard by a held Enter or Space, or one pressed before it showed. A click from a pointer only waits the 400 ms, and a press is forgotten when the window loses the keyboard, so a keyup lost elsewhere can't block anything. Fifty files, or 256 million characters of their text (about 256 MB), can wait at once, counting every file queued and not looked at yet, whoever sent it; past that a file is refused at the door. A Shimeji folder is always a new buddy, so it never asks.

**The channel is trusted.** The hub takes commands from any page on its BroadcastChannel. That's same-origin, so only the app's own pages are on it: the Manager, the Maker and the overlays. Nothing there replaces a buddy without the question either: an import asks whenever she's there, whatever revision it names.

**Failures** all land in `state.failures` until cleared, so a window that closed mid-command doesn't lose one. Shimeji art is converted in the page, because it needs a canvas, so a window that closes during that loses that folder and any files after it. Nothing half-written reaches the library.

**New and edit** reach `openMaker` in `src/hub-core.ts`, which opens the Maker's window, or asks a page already open to flush and load that buddy. Saving is in `src/maker-store.ts`: see `docs/native-shell-design.md`.

The tray and the Manager read one list, so they can't disagree. What can't be applied at once, such as a settings file that won't write or a tray that won't update, is tried again with everything else. So is an import that was saved but couldn't be read back. It answers with a failure, because nobody can see it, and the failure clears itself when the buddy appears.

## The log
Lines from the app show what happened: `press`, `release`, `crossed` for a buddy moving between monitors, and `rate` every 10 s with the tick count.

## Why the app sits beside the exe
Smart App Control judges each new unsigned exe, and a build it can't vouch for has no Run anyway. So the exe reports facts, does what it's told and holds no policy, and the app is the `app` folder. Changing the app is a file copy, with no build and no new exe. See `docs/native-shell-design.md`.

## Making a preview
A preview is the frozen exe, the built `app` folder and `preview/README.txt`, for someone to unzip and run. Update that README first, because its first line names the zip's folder. Then build and pack:

```
pnpm --filter @buddies/desktop build
python3 -I apps/desktop/scripts/preview.py --exe <desktop-buddies.exe> --out <preview.zip>
```

It refuses any exe but the one in `preview/exe.sha256`. A new exe gets a new Smart App Control verdict, so changing that file is a decision, not a fix.

A release is packed the same way by the release workflow, with `--release <X.Y.Z>`, which takes the exe that workflow built and adds the licence files. See `docs/releases.md`.

## Build it yourself
Needs Rust and, on Windows, the MSVC Build Tools. From `src-tauri`, run `cargo build --release`.

To type-check from Linux without Windows resources: `SHELL_CHECK_ONLY=1 cargo check --target x86_64-pc-windows-msvc`.
