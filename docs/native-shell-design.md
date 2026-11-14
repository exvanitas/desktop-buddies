# Native shell design

Stage 4 step 3. One exe that lasts through stage 6.

## The rule
**The exe reports facts and does what it's told. Every decision lives in the `app` folder.**

Each new exe gets a fresh Smart App Control verdict. App folder changes get none. So the exe holds general building blocks with no policy: no menu text, no window filtering by taste, no buddy logic. If a choice might change, it belongs in the app.

Builds that never reach the owner's PC face no verdict. So the exe is proven on a Windows runner in GitHub Actions first, as many times as it takes, and only a passing build gets downloaded.

## Identity
| | |
|---|---|
| Name | Desktop Buddies |
| Exe | `desktop-buddies.exe` |
| Id | `dev.exvanitas.desktop-buddies` |
| Library and settings | `%APPDATA%\dev.exvanitas.desktop-buddies` |
| WebView2 data | `%LOCALAPPDATA%\dev.exvanitas.desktop-buddies`, or `<folder>-webview` beside `--data-dir` |

The exe icon is a stand-in for now. Tray and window icons load from the app folder, so they can change without an exe.

## How it starts
1. The exe takes the single-instance lock. A second launch hands its arguments to the first, then exits.
2. It opens one page: `hub.html`, hidden. If the `app` folder or that page is missing, it shows a plain error and exits.
3. The hub decides everything else: overlays, tray menu, windows, what to load.

The hub stays open for the whole run. It keeps the SharedWorker alive through monitor changes, and overlays no longer have to relay for each other. It's one more page, so measure what it costs.

Hidden doesn't mean throttled. Measured on the runner, the hub's page reports `visible` and its timers run at full rate, and after six minutes hidden with no overlays open the worker's timer held 62 ticks a second and cursor events still arrived at once. The workflow's `soak` input repeats that.

Flags: `--app-dir`, `--data-dir`, `--log`, `--seconds` (off unless given), `--devtools`. Anything else, and every raw argument, reaches the app through `shell_info`, so `--buddies 6` needs nothing from the exe. A path ending in `.buddy` or `.buddy.json` counts as a file to open.

From API 2 a second launch's arguments never reach the log: the exe logs `second launch: args 6, files 1, flags --data-dir --log`, counts and which of its own flags were there, and the hub the same with the app's flags too. API 1 logged them whole. The start line still names the app and data folders, which is the person's own log saying where their own things are.

## The contract
`window.__BUDDIES__` is the `boot` value a page was opened with. `shell_info` carries `api`, so the app can tell which exe it's on and say so if it needs a newer one. This app knows API 2 and still runs on API 1: see [API 2](#api-2).

**Commands**

| Group | Command | Does |
|---|---|---|
| Shell | `shell_info()` | `{ api, version, platform, args, dataDir }`, and from API 2 `can`: what it does beyond API 1, by name. `packaged: true` when it runs as the Store's MSIX package; any other exe leaves it out |
| | `quit()` | Emits `quitting`, exits shortly after. From API 2, waits for pages that ask, see [API 2](#api-2) |
| | `quit_wait()`, `quit_ready()` | API 2. After `quitting`, the calling page asks to be waited for, then says it's done |
| | `raise({ on })` | API 2. Keeps overlays, then visible always-on-top windows, on top. Off until asked |
| | `log_line({ line })` | Writes to the log |
| | `open_external({ url })` | Default browser, `https` only |
| Windows | `monitors()` | See below |
| | `window_open(spec)` | `kind` is `overlay` or `window` |
| | `window_close`, `window_show`, `window_hide`, `window_focus` | By `label`. From API 2, focus restores a minimized window first |
| | `window_place({ label, x, y, w, h })` | Physical pixels, position first and then size |
| | `window_icon({ label, file })` | A PNG from the app folder |
| | `capture({ on })` | The calling overlay takes the mouse. A lease, see Safety |
| Tray | `tray_set({ tooltip, icon, items })` | Items have `id`, `label`, `checked`, `enabled`, `separator`, `items` for submenus |
| Data | `data_list({ dir })`, `data_read({ path })`, `data_write`, `data_move({ from, to })`, `data_delete({ path })` | Inside the data folder only. Bytes in and out, as raw IPC bodies. Reads and writes are capped at 64 MiB, and writes are atomic. A move never overwrites, and a delete takes a folder whole. Writes, moves and deletes run one at a time |
| | `open_data_folder()` | Opens it in Explorer |
| Files | `save_as({ name, filters, owner?, content })` | Native save dialog. Returns whether it saved. From API 2 the file is swapped in whole, and the dialog belongs to `owner`, a window's label, see [API 2](#api-2) |
| | `take_opened()` | Files passed at launch, read once. Each is `{ name, content, error? }` |
| Windows on screen | `windows_watch({ on })`, `windows_now()` | The tracker, see below |
| System | `system()` | `{ userState, onBattery, saver }` |
| Registry | `autostart({ on? })`, `file_assoc({ on? })` | Read, or set then read. Current user only. Packaged, `autostart` is the package's startup task, which the person can also change in Windows Settings, so it's read again each time; turning it on after they turned it off there is refused. `file_assoc` reads true and refuses a set, since the package declares `.buddy`. Packaged, the data folder is `%LOCALAPPDATA%\Packages\<family name>\LocalState\data` and WebView2's is `LocalState\webview` beside it, never `%APPDATA%`, which Windows would virtualize |

**Events**

| Event | Payload |
|---|---|
| `cursor` | `{ x, y, down, right }` |
| `monitors` | The new list, whenever anything about it changes |
| `tray` | `{ id }` for a menu item |
| `tray-click` | Left click on the icon |
| `windows` | A tracker snapshot, when it changes |
| `system` | When it changes |
| `second-launch` | `{ args }` |
| `open-file` | `{ name, content, error? }`. Held until the first `take_opened`, so a hub still starting loses nothing |
| `data-changed` | `{ path }`, so the Manager and Maker stay in step |
| `quitting` | API 1: nothing. API 2: `{ grace, bound }` in ms |
| `window-closed` | API 2. `{ label }`, when any window the app opened is destroyed, however it closed |

A monitor is `{ i, name, primary, scale, x, y, w, h, full: { x, y, w, h } }`: the work area, then the whole screen. All in physical pixels on the virtual desktop. Poll for changes about once a second, which also catches a moved taskbar.

`window_open(spec)`: `label`, `kind`, `page`, `boot`, then `x y w h` for an overlay or `width height minWidth minHeight center` for a window, then `title resizable decorations transparent shadow alwaysOnTop skipTaskbar visible`, and from API 2 `focused focusable` for a window (an overlay never takes the keyboard, so it refuses them). API 1 refuses any field it doesn't know. Overlays keep what the spike proved: transparent, no decorations, no shadow, always on top, no taskbar entry, `focusable(false)`, click-through until `capture`. Windows must be able to have a custom title bar, and capabilities compile into the exe, so grant dragging, minimize, maximize and close now. Tauri's own drop handler is off on every window, so pages take drops through the web's drag events.

`data_write` and `save_as` send their bytes as the body, so what would be arguments goes in a percent-encoded header: `x-path`, and `x-spec` for `{ name, filters, owner? }`.

## Images from the library
`library/` under the data folder is served through the same asset provider as the app, so `<img src="library/colive0seed/sit.webp">` has the local origin and hit testing can read its pixels. Only that subtree, with the same plain-names check, and only images: see Safety. This delivers the original plan: images as files, no data URLs held in memory or sent in every frame.

## The window tracker
Follows the original plan: `SetWinEventHook`, no polling while nothing changes. A thread with a message pump listens for location change (top-level windows only), show, hide, destroy, cloak, uncloak, foreground, and minimize. The hook only marks the list dirty. A snapshot runs at most every 16 ms while dirty, plus once a second as a backstop for anything missed.

A snapshot: `{ seq, foreground, list }`, top of the z-order first. Each entry: `{ id, x, y, w, h, z, max, topmost, tool, layered, class, exe }`. Bounds come from `DWMWA_EXTENDED_FRAME_BOUNDS`.

- **Dropped by the exe:** invisible, minimized, cloaked, and our own windows. Nothing that could be a taste call.
- **Decided in the app:** shell windows, tool windows, tiny windows, the exclude list, maximized as blocker. Hence `class`, `exe` and the flags.
- **No titles.** Titles hold private things like document names, nothing here needs them, and reading one can hang on a stuck app.

`userState` comes from `SHQueryUserNotificationState`: `normal`, `fullscreen`, `presentation`, `busy`, `away`. Stage 6 hides on it, and the world can pause on `away`.

**In the app.** The hub reads windows through `WindowSource`, and a snapshot goes straight to the host, not through the hub's queue. The host keeps only the latest and merges it with the screens on its next tick, in one `setRects`. It holds the list, so a monitor change cuts the same windows to the new monitors. `window-terrain.ts` has every rule. The tracker only runs while a buddy is out and nothing is hidden, paused or away, and Walk on windows is on. If it can't start, the world is told there are no windows, so nobody stands on something we can't see. A snapshot older than the last one by `seq` is dropped, because a stopped tracker's thread can still be sending. Exe and class names stay out of the log, and so does whatever a source says when it fails.

**Virtual desktops.** Overlays show on every virtual desktop by themselves, so nothing follows the user. Tested on the real PC on 2026-11-06 with the same window setup: the buddy stayed visible on a new empty desktop, and after that desktop closed. Windows on other desktops are cloaked, so the tracker already drops them.

## `.buddy` files
Windows reads the part after the last dot, so `olive.buddy.json` has the extension `.json` and can't have its own double-click. The exe registers `.buddy` under the current user, off until asked. It accepts both as arguments. Exports are `.buddy` from step 4, and imports keep reading both.

## Safety
These are native because a dead page can't do them.

- **The capture lease.** `capture({ on: true })` lasts 1.5 s and the page renews it while it holds the mouse. A page that dies or hangs mid-drag would otherwise leave an invisible window eating every click on that monitor. When a lease runs out, the exe restores click-through and logs it. The lease lock is held across the window call, so the two always change in the same order. That can't deadlock: off the main thread the call only posts to the event loop.
- **Quit is always there.** `tray_set` can't remove it. The exe appends it and handles it, so it works with the hub dead. Menu ids starting `shell:` are the exe's.
- **Pages stay local.** Navigation off the local origin is refused. `window.open` and links go to `open_external`, `https` only. From API 2 the log says only the scheme of a link it sent on or refused, and `open_external`'s refusal names the scheme, never the URL, since a shared gallery link can carry what someone shared. That's enough for gallery sharing: `https` links, nothing else.
- **Scoped files.** Data commands can't leave the data folder: plain names only, the same check as the assets. There is no general file access. `.buddy` files from launch are read by the exe with a size cap, and validated in the app like any import. Containment is by name, so a junction inside the data folder would be followed: pages can't make one, and whatever can already runs as the user. The threat here is a hostile file, not a local process.
- **The library serves images only.** Its files come from `.buddy` files, which can be hostile, and Tauri falls back to `text/html` for bytes it can't name. A page loaded that way would have the local origin and every command. So under `library/`, the asset route takes only `.png`, `.webp`, `.jpg` and `.gif` names, and only returns bytes that start with a real PNG, JPEG, GIF or WEBP signature, which Tauri always names as an image. Like https-only, this stays in the exe. `unpack` refuses the same bytes at import, but that's the app's check, and this is the one a bad app folder can't lose.

WebView2 windows in one data folder must share the same browser arguments, so one helper builds every window. It passes Tauri's defaults plus `--autoplay-policy=no-user-gesture-required`, because sound effects can't be added later without a new exe. Use `--devtools` or the `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` variable for debugging.

The app sets its own CSP with a meta tag in each page, so it can change without an exe.

With no `--log`, the log goes to `logs/app.log` in the data folder, capped at 1 MB with one old file kept. Testers' bug reports will need it.

## Code
- `apps/desktop/src-tauri`: thin Tauri glue, one small module per group.
- `apps/desktop/shell-core`: a plain Rust crate beside it with no Tauri in it: path checks, the data folder, menu specs, snapshot comparison, the lease, argument parsing. `cargo test` runs it anywhere, including here.
- `platform` keeps every OS call behind one module, with stubs for other systems, so macOS stays possible.
- `apps/desktop/src/shell.ts`: a typed client for the contract, the only place that touches `__TAURI__`, plus a fake for tests.
- Keep dependencies few: the single-instance plugin, and the `windows` crate at the version Tauri already pulls in. The save dialog and the registry are plain calls through it, because the dialog plugin brings a JS surface and a file plugin we don't use.

## App side, this step
- `hub.html`: owns the world, the tray menu, overlays and the library. Opens and closes overlays as monitors come and go, and tells the world. Feeds the world the cursor, so overlays stop doing it. It tracks the overlays it wants apart from the ones really open, and whether each is really hidden, and retries what failed, from 2 s up to a minute apart. With no monitors at startup, as at autostart with the display asleep, it waits and starts the world on the first real list.
- Overlays draw and hit test, renew the lease, and take boot data from the hub. Their area comes from the world when they join, because the layout can change while a page loads.
- Library on disk: `library/<character>/buddy.json` plus image files. `buddy-file` gets unpack and pack, so a `.buddy` file stays one portable file. First run seeds the build's first buddy, if it ships one. Each image is named by its bytes, the first 32 hex digits of its SHA-256 plus its type, so a name never holds anything else and URLs need no cache-buster. A new buddy is written in `library/.incoming` and moved in, because a folder with no manifest isn't a buddy. One who's home is changed in place: the images she doesn't have yet, then her manifest, whose atomic write is the moment the new copy takes over, then whatever she no longer uses. A stop before the manifest leaves the old copy whole, and after it the new one, and what's left over goes at her next save. A folder from an older build loads as it is, and its first save here renames it. Each start finishes anything a crash stopped, including an older build's swap through `library/.outgoing`. She's only seeded after that worked and a listing really showed an empty library: a copy that can't go back yet counts as a library, it's retried, and a listing that fails is never read as empty.
- Tray menu, enough to use it with no Manager: call and dismiss per buddy, hide all, pause, open library folder, start with Windows, Quit. Left click opens the Manager.
- Double-click and second launch: import the file into the library and call that buddy. Validation is the existing `read`, and `unpack` then refuses any image whose bytes aren't one of the four formats. The file extension comes from the bytes, not what the file declared.
- Pause the world on `away`.

## The exe and the Manager
Nothing here needed a new exe, but on API 1 two limits shape it.

- **No window-closed event.** The hub doesn't track whether the Manager is open. It asks each time.
- **Focus can't restore a minimized window.** `window_focus` does nothing to one, and says nothing, and `unminimize` isn't in the capabilities. The hub reads Tauri's own `is_minimized`, which `core:window:default` grants, and opens a fresh window. The page holds no state, so nothing is lost but its scroll position.

The save dialog has no owner window, so it isn't modal to the Manager and can end up behind it. The hub allows one at a time.

On API 2 the hub just opens the Manager or focuses it, which restores it, and the export dialog belongs to the Manager.

## Proof
`.github/workflows/shell.yml` replaces the spike workflow and runs on a Windows runner:

1. `cargo test`, and a release build.
2. **The contract check.** `apps/desktop/shell-check` is a small app folder whose hub calls every command through the app's real client and logs results, and a PowerShell driver does what a page can't: read window styles, move a real window, change the work area, launch a second instance, read the registry. There is no test code in the exe.
3. **A smoke run.** The built `app` folder beside the exe, a fresh `--data-dir`, `--seconds`, then judged from the log: no errors, library seeded, an overlay up, a clean exit. It finds the buddy with the real cursor and drags her, so the hit test runs on library images.
4. **The local API end to end.** `api-e2e.ps1`: real `--api` second launches and the MCP server over stdio against the real app, with the Manager's answers given by its own buttons and what she shows read from the overlay. See [local-api.md](local-api.md#checked-end-to-end).

Only native changes start it. To try a new app folder or check on the existing exe, run the workflow by hand with `reuse`.

What the exe and app cost over hours, in four states, is the soak test's job: `.github/workflows/soak.yml`. See [performance.md](performance.md).

The smoke run also takes the real Maker through three runs of the exe on one data folder: opened through the hub's real command, edited, tried on screen, 60 quick saves of a buddy out on the desktop while something reads her images the whole time, a real minimize, a window closed from outside on an unsaved edit, the largest allowed buddy, and a quit in the middle of saving her.

It proves: every data command and its refusals, reads over the cap refused, one winner when moves race for a name, library images served and readable on a canvas, anything else in the library refused, overlay styles and placement, click-through and the lease running out, including on a hung page and after a storm of captures on and off, a real click reaching an overlay without taking focus, window open, place and close, navigation refused, the tracker against real windows (listed with correct bounds and order, a move seen quickly, minimize and close seen, no title in the payload), the `monitors` event, second launch with a file, autostart and file association set and cleared, a double-click through that association, the save dialog, the SharedWorker outliving every overlay, a hung hub, a missing app folder, and a clean exit with no stray processes.

Left for the owner, on the real PC: the Smart App Control verdict, tray clicks, a real monitor unplug, and how it all feels.

## Results
All of the above passed on the owner's PC on 2026-11-06. The exe is built from `5e83023`, and app changes since then needed no new exe.

| | First build | This build |
|---|---|---|
| No buddies | 88 MB | 110 MB, 0.06% CPU |
| One buddy, left alone | 126 MB, about 1% CPU | 145 MB, 1.36% CPU, 2.08% peak |

The hub costs about 20 MB. Memory rises while a buddy is being thrown: 175 MB in one short run.

A monitor turned off and on comes back under a new display name, and without its taskbar for about 1.5 seconds. Overlays are matched to what's there now, so both cases work, but don't rely on either the name or the first work area.

## Not in this exe
Auto-update, an installer, signing, macOS implementations, the local HTTP route for ComfyUI and Forge, moving other apps' windows. Public release will likely need a new exe anyway, and those can go in that one.

## The exe and the Maker
Nothing here needed a new exe either. The hub stays the only writer of the library, and the Maker's page talks to it over the wire.

- **`state.pets` holds who was opened in this window, not the library.** Dropping a buddy from the window never deletes her. `maker-store.ts` remembers each one's text on disk and her revision, and sends a buddy's whole file about a second after the last change, 10 seconds at most from the first, one write at a time per buddy. `send` is the only way anything leaves: an ordinary autosave, a flush and a page's last word are flags on it. The newest edit is the state itself, so nothing waiting can go stale, and a flush only says clean once the newest state, with whatever maker-core was holding back, is what's on disk.
- **Revisions never repeat.** They're handed out by the hub with each load and save, from one counter that starts at the clock, so a window from before a hub restart can't match one from after. A buddy this run has seen can't come back as new. A save based on an old one is refused with nothing written, and the window offers to keep the edit as a new buddy, unless the last write to her was that same window's: saves run one at a time, so it can't be overtaking itself, and it may just never have heard the answer. A first save looks for her on disk, because the shelf skips what couldn't be read. A closing window says so first, and the hub treats anything still to come from it as having nobody to ask: it keeps the edit beside her and tells the Manager.
- **`quitting` gives pages 250 ms on API 1.** Nothing can extend that, and the exe doesn't wait for a page. On API 2 a quit takes the same way as Close, and the exe waits for it: see [API 2](#api-2). The rest of this point is API 1's. The page sends what's waiting, and an edit to one image of a 1 MB buddy with 30 images takes about 100 ms to save on the runner, so that can land. One that changes many images, or a big buddy's, won't. A save cut off leaves the old copy, or the new one, whole, and her next save clears what it left beside her. So a quit can lose up to the last second or so of edits, more for a big buddy, but never the buddy.
- **Closing is one sequence, in `maker-close.ts`.** A modal dialog stops input, and a page-level guard stops drops, pastes and a picker's answer, which inert doesn't reach. It waits for image work, with nothing sent meanwhile, flushes, and destroys the window. Past 5 seconds, or if something failed, it offers Close anyway and Keep editing, and that stays true right up to the window going. If destroying fails, editing and saving come back and it says so. Nothing is given up until the window has really gone.
- **A close from outside goes through the page.** Measured on the runner, a real close gets nothing out on `pagehide`, though headless Chromium does. So the page listens for Tauri's `tauri://close-requested`, which `core:event:default` already allows and which holds the window until the page closes it. Alt+F4 and the taskbar's Close then take the same sequence. The cost: a hung page can't be closed that way, only by Quit in the tray. `pagehide` stays as a last try. If a closing window's save is refused or fails, nobody's there to ask, so the hub keeps the edit beside her if it can, and tells the Manager.
- **A minimized window can't be restored** on API 1, as with the Manager, but this page holds edits. The hub asks it to flush, closes it only if that worked, and opens a fresh one on the same buddy. If it didn't work, the window stays minimized and the Manager says why. On API 2 the hub focuses it, which restores it, and nothing is flushed or closed. A window that went, told by `window-closed` or found gone when focused, is replaced by a fresh one.
- **A save writes only the images that changed.** Each file is flushed on its own, about 10 ms a file on the runner, so a save that writes every image takes time that goes with how many frames she has. Only a new buddy, an import of one, and a folder's first save after an older build do that now. On the runner, for a buddy of 1145 frames and 22 MB, before and after: a rename 15 to 16 s, now 0.5 to 0.6 s; one image changed, 15 s, now 0.6 s; her first save 15.9 s, now 11.4 s; her first save after an older build, 15 s, now 14.3 s, since it also clears the old names. The 59 MB buddy: first save 3.6 s, now 2.6 s; a rename 3.4 s, now 1.8 s. Sixty saves of a new main image on a 1 MB buddy with 30 images: median 515 ms, now 93 ms. The hub's queue, so also the tray and the Manager's commands, waits for each one. What's left of a rename is the hub reading the file, hashing her images and writing her manifest. Image URLs carry no cache-buster, since a name never holds other bytes. Measured on the runner, loading, decoding and drawing all 1146 of her images costs a page 1.4 to 1.6 s with URLs it hasn't seen, with or without a buster, and the Maker's page 0.2 to 0.3 s the second time, so a buster would make every page pay the full cost after every save. The Manager's page gained little from its cache, 1.4 s the second time, but it only shows her main image. A Manager that's open gets a copy of each save over the channel, which costs it the file's size in memory until it's collected, and costs the save nothing measurable.
- **The save dialog takes any bytes,** so the standalone page goes through `save_as` with an `.html` filter, one dialog at a time alongside `.buddy` exports. On API 2 both of the Maker's dialogs belong to its window.

## The exe and the right-click menu
Nothing here needed a new exe. Overlays can't take the focus, so a menu drawn in one couldn't hear Esc or the arrow keys. The menu is a window of its own instead: no decorations, transparent, no shadow, always on top, no taskbar entry, opened hidden. A spike on the owner's PC with this exe (2026-11-09) settled how:

- **Opening a window takes the foreground, even hidden.** So the menu's window opens on the first right-click, never at start, or every launch would leave the keyboard with an invisible window. Until it has been shown, it holds the keyboard that way, so a window nobody wants is owed a close: one made or found after a press or Hide all, or after its 5 seconds to be made ran out, however late it's made; one whose page doesn't come up in 5 seconds or draw a menu in 3; and one where any step failed. A close that fails stays owed and is tried again, after a wait that doubles from 250 ms to 8 s, and at anything that happens meanwhile. Once shown and hidden again with its page up, the window stays open and hidden for the next right-click.
- **Placing, showing and focusing it work.** Over 12 right-clicks with another app in front, the menu had the focus a median 93 ms after the click (116 at most). It was placed exactly, at 150% too, above the overlays, and it was drawn in its new content the moment it showed.
- **A click on a buddy blurs it,** and so does a click anywhere else. The hub also closes it on any press on a buddy, so neither depends on the other.

Only the hub does anything to the window. `buddy-menu.ts` is a pure reducer, from a state and an event to a new state and what to do, with a thin driver that does it and feeds each result back as an event. Events are what people do, what the page says, timers, and the end of every step on the window: done, failed, "already open", or late past its deadline. No step starts while one runs, and each is for one showing. A step past its deadline is given up on, so the next one, often the owed close, can go out though it never answered; its answer, if it ever comes, only tells what became of the window. A showing counts as shown only once its page says it has the keyboard, so a page that died can't keep it: its window is hidden and closed. Every right-click has a deadline of its own. Each window has a label of its own, `buddy-menu-<n>` from a start that's random each run, and every step, answer and page message names it, so an answer about an old window, however late, can only settle that window's close: it never touches the current one. Any window other than the current one is owed a close until a close of it is answered. A step given up on, a hide too, closes its window. A close whose "no window" may predate the window, because the window's open answered after the close went out, doesn't count, and an open given up on that never answers is swept, closed again every 8 seconds, until it answers or a close finds its window, since it could still appear. **If the exe stops answering altogether, nothing in the app can close the window.** `tests/buddy-menu-random.test.ts` runs thousands of seeded interleavings, with failures injected into every step, each step's effect and its answer coming at different times, late or never, pages that die and stay dead, messages signed by the wrong window, and the clock run past every deadline, and checks at each quiet point that no unwanted window is left without a close on its way, that a shown menu is the one wanted, that no choice runs twice or for an old showing, and that in the end every showing was shown or dropped, the keyboard isn't left with a hidden window, and a fresh right-click is shown by a live page that has the keyboard. One right-click can be lost finding out that the kept window's page died while hidden. The exe says nothing when a window goes, so one destroyed from outside while shown is only found at the next thing that happens. A showing goes: her menu drawn in the hidden window, its size back from the page, then the window placed beside her, shown and focused, in that order. A press, a close or another right-click is heard between any two steps, and a step done for a showing nobody wants any more is undone by the next. Any step that fails closes the window, and the next right-click starts from nothing. The page only asks: to close, and for the one choice made in it, which the hub does once and only for that showing. A right-click on another buddy closes it first, as Windows' own menus do. Nothing shows while buddies are hidden or paused. A menu taller than the work area is cut to it and scrolls. The menu has a channel of its own, so the overlays and the hidden page never hear the Manager's and the Maker's traffic. `shell-check/menu-check.ps1` measures the first right-click and the memory the window adds.

## API 2
The next exe, after a taskbar click on the owner's PC raised the taskbar above an overlay and a buddy sunk over the taskbar went under it until a restart. It's unsigned, and gets a fresh Smart App Control verdict. The app folder works on both exes: `shell.ts` has `API = 2` and `MIN_API = 1`, and the hub reads `api` at start.

**On API 1 nothing changes:** the one-pixel rule, no re-raise, capture as before, the menu's lazy open, a fresh window for a minimized one, a quit that doesn't wait. No field or command API 1 doesn't know is ever sent, because it refuses them.

**On API 2:**

- **Kept on top.** `raise({ on })` puts our overlays back at the top of the always-on-top band, then our visible always-on-top windows (the right-click menu) above them, in that order, with `SWP_NOACTIVATE`, no move and no size. A pass is asked for at each foreground change (a WinEvent hook, out of context), once more 150 ms after (a window raises itself after it's activated), and once a second as a safety net for a window that went above ours without taking the foreground. A second is the same pace as the monitor poll: a buddy lost under something comes back within one, for one call per visible window. Turning it off removes the hook and the timers.
  - **Never another app's window.** No window handle is kept between passes. Each pass runs on the main thread, which owns our windows, so none can be destroyed during it, and takes the windows fresh from Tauri's own list: the overlays, and the others that are always on top and showing. Before each call it checks the window belongs to this process. A pass that's already waiting for the main thread isn't asked for twice.
  - **Never over something full screen.** Each pass first asks the shell (`SHQueryUserNotificationState`) and does nothing while a full-screen app, a D3D game, a presentation or a full-screen store app is up. The hub also turns raising on only while `userState` is `normal`, one call at a time, so only the latest wish goes, after the one before it was answered. What the exe raised just before something went full screen stays where it was, as on API 1, where overlays were always on top too.
- **Overlays are tool windows.** tao rewrites the whole extended style whenever one of its flags changes (showing, hiding, click-through), which is why `WS_EX_NOACTIVATE` set by hand didn't last. So each overlay is subclassed on its own thread before it's shown, and every `GWL_EXSTYLE` change passes `WM_STYLECHANGING` first, which adds `WS_EX_TOOLWINDOW` and drops `WS_EX_APPWINDOW`. Whatever tao writes, the bit is in it. `focusable(false)` is untouched, since tao still writes `WS_EX_NOACTIVATE` itself. If the subclass fails the overlay still opens, and the log says so. The app keeps its one-pixel rule regardless.
- **Capture stays as it is.** While she's held, the whole overlay takes the mouse, as on API 1. The report was of Chromium apps flickering black under a held buddy. Chromium's occlusion tracker (`IsWindowVisibleAndFullyOpaque` in `ui/gfx/win/hwnd_util.cc`) counts a window as covering what's under it unless it's `WS_EX_TRANSPARENT`, `WS_EX_TOOLWINDOW` or a see-through layered window, so a held overlay, which loses `WS_EX_TRANSPARENT`, looked to those apps like an opaque window over their whole monitor. A tool window is never counted, held or not, so the tool style should end the flicker. The other way, keeping the overlay click-through while the exe takes the mouse with `SetCapture`, would move every drag from the page's pointer events to the exe's 16 ms cursor poll and can't be proven without Windows. Not worth a half-working version.
- **Windows** take `focused` and `focusable`. The menu's window opens with `focused: false`. It still opens on the first right-click, as on API 1, until a Windows check shows a hidden open no longer takes the foreground.
- **`window-closed`** goes out with the label whenever a window the app opened is destroyed, however it closed. The hub uses it to drop a Maker window that went. The right-click menu doesn't use it yet: its reducer would need a new event and the random tests to cover it.
- **`window_focus`** restores a minimized window, then focuses it. The Manager and Maker are focused instead of reopened.
- **`save_as`** writes the bytes to a new temp file beside the target, same folder so same volume. It's made with `create_new` under a random name (`.~` and 16 hex digits), so it never opens, truncates or follows anything already there. Over a file that's there, Windows' `ReplaceFileW` swaps it in, which keeps the old file's permissions, encryption and attributes, with the old file going to a backup name made free the same exclusive way. The backup goes only once the chosen name holds the new file. With nothing there it's moved in by a move that won't overwrite. A link at the chosen name is refused, never written through, and the error says so. A failed replace is put right from what's on disk: with a backup named, Windows leaves both files under their own names (1175, 1176, any other error), so the temp file goes and the old file stays, or leaves the old file at the backup's name and the new one at the temp's with nothing at the chosen name (1177), so the new one is moved in, or else the old one is moved back. Either way the chosen name holds the old file or the new one. Only if no move there works at all are both kept beside it, and the error names them. The dialog belongs to `owner` if that window is open and showing, or else to the calling window if that's showing. The hub passes the window that asked: `export` and `save-page` carry `owner`. `data_write` makes its temp files the same exclusive way.
- **Quit waits.** `quitting` carries `{ grace: 250, bound: 10000 }`. A page that has something to finish calls `quit_wait`, then `quit_ready`. The exe waits the grace for anyone to ask, then for each that asked, or for its window to go, and never longer than 10 s from the quit. Ten seconds covers an ordinary save (under a second on the runner) and a rename (0.6 s), and is short enough that a stuck page can't keep a quit waiting where someone would notice. A first save of the largest buddy (11.4 s) still won't fit, and that buddy survives anyway, as on API 1.
  - **The Maker quits the way it closes.** It asks to be waited for and starts the same closer as Close: input stops, image work already running finishes, then everything is flushed, an edit that came in meanwhile included. Only then, with every write it sent answered, is the exe told the page is ready. A write past its 30 s reply timeout still counts as out until its answer comes. Past 5 s it offers Keep editing or Close anyway, as Close does, and Close anyway still waits for any write that's out. It never says ready while a write is out: a save that takes too long is ended by the exe's bound, and what it cut off is whole, the old copy or the new. If a close was already under way, that close stays in charge, and a second before the bound whatever it holds goes as a last word, as API 1's quit sends at once.
- **The log** gets no second launch's arguments and no URL from the exe, as above. On both exes, from this app: an overlay's mode only if it's one the app knows, else `unknown`; a file from launch as `launch: a file, imported` and the like, any import with no file name, and its failure in the hub's own words, never a file's name or what it holds; a refusal as its kind and why, never its title, which holds a name; page errors, the world worker's errors and CSP reports as an error's kind and a URL's scheme and host, never the message or the full URL; and a library folder that can't be read by its id and the error's kind, never the parse error, which can quote what the file holds.

What only Windows can prove: each of these on the real exe. The contract check (`api2.*`, `exit.quit_waited`, `log.*`) and the smoke run (`api2.*`, and the Maker's minimized and dialog steps) cover them, and `taskbar-check.ps1` expects her drawn at every reading after each taskbar click on API 2.

## For the next exe
Later, none needed on its own:

- **A safe sweep of stale temp files, in the data folder only.** A crash during a write leaves its hidden temp file beside the target, and listings hide it. A sweep in API 2's review was dropped: it matched by name alone, so in a folder the person picked, like Documents on an export, it could delete an unrelated file that happened to look like ours, nothing tied a file to this app, `--data-dir` could point it anywhere and junctions were followed, and on a network share a local process check can't tell whether another computer is still writing. One that comes back should only ever look inside the data folder, not follow links, and know its own files by more than a name.
- **The network API.** The local HTTP route for ComfyUI and Forge, if the file-based local API isn't enough.
- **The icon.** The exe icon is still a stand-in.

## Done when
- The contract check passes on the runner, and `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- The exe clears Smart App Control on the owner's PC. If it's blocked, stop and report. Don't reroll a build to get past it.
- On the real PC: the seeded buddy loads from the library, the tray works, monitors can change while it runs, and it quits cleanly. RAM and CPU measured against the first numbers.
