# Desktop app plan (Shimeji-style)

Status: the original plan, kept as it was written. The project grew from here, so see `docs/README.md` for what's current.

## Goal
A native desktop version of Desktop Buddies. It should be:
- unintrusive and light on the system;
- driven by a tray icon;
- able to treat open windows as terrain, so buddies walk on title bars, climb window sides, jump between windows, and ride windows that move;
- paired with a cute, rounded Buddy Manager for import and export.

## Stack: Tauri 2, Windows first
| | Tauri 2 (chosen) | Electron | Native rewrite |
|---|---|---|---|
| Installer | ~5–10 MB | ~100+ MB | smallest |
| RAM | ~60–100 MB (system WebView2) | ~200+ MB | ~20–40 MB |
| Reuses `engine.js` | yes | yes | no |
| Window detection | small Rust module | Node add-on | built in |

- macOS later.
- Linux: X11 only. Wayland doesn't expose global window positions.

## Architecture
**Overlay**
- One transparent, frameless, always-on-top window per monitor. It has no taskbar entry and covers the screen, taskbar included, so a buddy can be drawn past the work area. The terrain stays the work area.
- The window is one pixel short of its monitor, on the edge across from the taskbar, or the top edge when no taskbar can be told. A borderless, always-on-top window exactly covering a monitor is a full-screen app to Windows, and the taskbar then stops staying on top. That one line is the only place she can't be drawn. `overlayRect()` in `apps/desktop/src/overlay-rect.ts` is the one rule, for opening, placing, drawing and hit testing.
- One overlay rather than one window per buddy, so bubbles, effects and pair interactions work unchanged.

**Click-through**
- The overlay ignores the mouse by default (`set_ignore_cursor_events`).
- Rust polls the cursor about 30 Hz. The overlay catches the mouse only when the cursor is over a buddy's visible pixels, using a low-res alpha mask per frame, not the bounding box.

**Window tracker (Rust, `windows` crate)**
- Enumerate windows that are visible, not minimized and not tool windows. Skip cloaked ones (`DWMWA_CLOAKED`).
- Use `DWMWA_EXTENDED_FRAME_BOUNDS` to get real edges without the invisible resize border.
- Clip by z-order to get the uncovered parts of each window:
  - top edges become platforms;
  - sides become climbable walls.
- Event-driven via `SetWinEventHook`: `EVENT_OBJECT_LOCATIONCHANGE`, `EVENT_SYSTEM_FOREGROUND`, `EVENT_SYSTEM_MINIMIZESTART/END`, and window destroy. No polling.
- The tracker sends surface lists to JS only when something changes.

**Engine refactor**
- `P.surf` changes from `'floor' | 'left' | 'right' | 'ceil' | 'air'` to a surface object `{ kind, id, y | x, from, to }`.
- New behaviours:
  - walk on window tops;
  - jump between windows;
  - climb window sides;
  - step off edges;
  - ride a moving window (follow its id);
  - fall when the window under it closes or minimizes.
- The taskbar top is the floor. Screen edges and the ceiling stay as they are.
- Throwing or moving the user's windows: off by default, or left out entirely (not decided).

## Performance and unintrusiveness
- Pause rendering and hide buddies while a fullscreen app or game is in front.
- Idle throttle: about 5 fps when every buddy is asleep or still. Skip DOM writes when transforms haven't changed.
- Performance setting: Smooth 60 fps, Balanced 30 fps (default), Battery saver.
- Images stored as WebP files in the app data folder and decoded once. No data URLs held in memory.
- No network. The font is bundled.
- No popups or notifications. Start with Windows is optional and off by default.

## Tray menu
- Left-click opens the Buddy Manager.
- Right-click menu:
  - Call a buddy ▸, Dismiss all
  - Hide for 30 min, Make everyone nap
  - Chattiness ▸, Performance ▸
  - Behaviour ▸ (climb windows, ride windows, chase cursor, talk to each other)
  - Start with Windows, Quit
- Per-buddy right-click menu: the same as the exported web page (call another, chase cursor, dismiss, dismiss all).

## Buddy Manager (opening UX)
- Small rounded window (~420×520) in soft pastels, with a bundled rounded font (Nunito, Quicksand, or M PLUS Rounded 1c).
- **First run:** "Drop a buddy here" drop zone, plus a link to the web maker. Pip comes preinstalled.
- **Collection:** a grid of cards, each with an idle preview and Call / Dismiss / ⋯ (Share, Remove).
- **Import:**
  - drag in a `.buddy.json`;
  - or double-click one in Explorer (file association);
  - or a Shimeji `img` folder, through the existing `fromShimeji` converter.
- **Share:** saves a `.buddy.json`, so the web maker and the desktop app go back and forth.
- **Settings:** the tray toggles plus monitor selection.
- **Web maker:** add a "Send to desktop app" button that downloads a `.buddy.json`.

## Milestones
1. **Shell.** Tauri app, overlay, engine embedded, click-through, a minimal tray. Screen edges and taskbar only. Measure CPU and RAM here.
2. **Window awareness.** The tracker, the surface refactor, riding windows, falling when a window closes.
3. **Manager.** Collection UI, import/export, file association, autostart, saved settings.
4. **Polish.** Fullscreen hiding, idle throttle, multi-monitor, installer.

## Open decisions
- Code signing: unsigned installers trigger SmartScreen. A certificate costs roughly $100–300 a year.
- Window throwing: off by default, or omitted entirely?
- Multi-monitor in v1, or primary monitor only?

## Also deferred: local image generation
Link the prompt kit to a local generator:
- **ComfyUI:** an API-format workflow template with `%PROMPT%` / `%NEGATIVE%` / `%SEED%` / `%REF%` placeholders. Start ComfyUI with `--enable-cors-header`.
- **Forge / A1111:** start it with `--api --cors-allow-origins`.
- **Results:** "Generate all" queues every pose with progress. Each pose gets Regenerate and 2–4 candidates, and results go through the existing upload path (background removal + size matching).
- **Consistency:** comes from IP-Adapter, img2img from the main image, or a character LoRA.
