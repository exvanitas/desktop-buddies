# Privacy

Desktop Buddies runs on your PC and keeps everything there. It has no accounts, analytics, ads, purchases, update checks or telemetry, and its own code sends nothing anywhere. The one part that talks to Microsoft is WebView2, Windows' own web view, which the app draws in: see What it sends. This page covers the desktop app, from the Microsoft Store, winget or GitHub, and the web Maker.

## What it reads
- **Your windows.** So buddies can walk on your windows, the app reads which windows are open, where they are, their order front to back, which one is in front, whether each is maximized, always on top, a tool window or layered, and which program each belongs to: the program's file name, like `notepad.exe`, and the window's class, a type name its program gives it. It uses the class and those states to leave out the taskbar, menus, tooltips and overlays. It never reads a window's title or what's in it. It reads them only while buddies are out and Walk on windows is on, and Settings can turn this off or keep buddies off one program.
- **The mouse.** Where the pointer is and whether a button is down, so you can pick buddies up, throw them and right-click them.
- **Whether you're busy.** Whether the PC is locked or away, whether something is full screen, and whether it's on battery, so buddies can rest.
- **Files you give it.** A `.buddy` file or Shimeji folder you open, drop or import, and the pictures you add in the Maker. Nothing else on your disk.

None of this leaves your PC.

## What it keeps
In its data folder, `%APPDATA%\dev.exvanitas.desktop-buddies`:
- `library`: your buddies, their pictures and their lines.
- `settings.json`: who's out, Walk on windows, the programs buddies stay off (by file name), whether other apps may ask buddies to do things, and the name and your answer for each app that has asked.
- `api/replies`: the local API's replies. See below.
- `logs/app.log`: what the app did, for bug reports, capped at 1 MB with one older file kept. Each start writes the full paths of the app's folder and its data folder, which usually include your Windows user name. It stays on your PC unless you attach it to a report yourself, so look it over first.

WebView2, which draws the app's pages, keeps its own data in `%LOCALAPPDATA%\dev.exvanitas.desktop-buddies`, including the Manager's theme.

Start with Windows, off until you turn it on, has Windows start the app when you sign in. In the installer and zip versions it adds a value named `Desktop Buddies`, holding the exe's full path, under `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run`, and turning it off removes it. The Store version uses its package's startup task instead, named Desktop Buddies, which you can also turn on or off in Windows Settings, Apps, Startup.

## What it sends
Nothing from Desktop Buddies' own code. The app, the Maker and pages exported from the Maker fetch nothing and send nothing, and Desktop Buddies' own code will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

The desktop app draws its windows with Microsoft Edge WebView2, a Windows component that Microsoft runs and updates. WebView2 keeps itself up to date, sends Microsoft diagnostic data as Windows' Diagnostic data setting allows (Settings, Privacy & security, Diagnostics & feedback), and sends a crash report to Microsoft if one of its processes crashes. Microsoft describes this in [WebView2 data and privacy](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/data-privacy). If WebView2 is missing, the installer downloads it from Microsoft.

## The local API
Other programs on your PC can ask buddies to wave or say a line. It's **off by default**: Settings turns it on, and Pause in the tray stops requests.
- It listens on no address of any kind, so nothing outside your PC can reach it.
- The first time an app asks, the Manager asks you to allow it. An app's name is whatever that app says it is, so this is a courtesy, not a lock. That's why the API can only do small, visible things: it never reads or writes your files, imports, exports or deletes a buddy, changes settings, opens links or runs anything.
- Replies are files in `api/replies`, and any program on your PC can read them. A reply holds only your buddies' ids and names, whether each is out and how many copies, and which actions she can do, or an error. An error reply, such as "off" or "not running", can be written while the API is off. A list of buddies is written only while it's on and you've allowed the app that asked.

[docs/local-api.md](docs/local-api.md) has the details, and [SECURITY.md](SECURITY.md) the security side.

## The Microsoft Store version
The Store version keeps the same files in its own folder, never in `%APPDATA%`: buddies, settings, replies and the log in `%LOCALAPPDATA%\Packages\<its package family name>\LocalState\data`, and WebView2's files in `LocalState\webview` beside it. It has its own library, with nothing moved over: it doesn't use or change one the zip or installer version made, and those never see its buddies. To move buddies between them, Export in one and Import in the other. Uninstalling the Store version removes its folder, buddies and settings included, so export any buddies you want to keep first. It never touches the zip or installer version's folder.

## The web Maker
The web Maker keeps your buddies in your browser's storage for its page (IndexedDB), and sends nothing. An exported page holds the buddies you chose and fetches nothing.

## Removing your data
Delete the data folders above. The Store and winget versions, and the installer, are removed from Windows' Installed apps. The zip version is removed by deleting its folder: first turn Start with Windows off, from the tray or the Manager, so its startup entry goes too, then quit from the tray. The web Maker's buddies and theme are in your browser's storage for its page: clear that site's data in the browser to remove them.

## Questions
Open an issue on [GitHub](https://github.com/exvanitas/desktop-buddies/issues). For a security problem, use private vulnerability reporting instead: see [SECURITY.md](SECURITY.md).

## Where each claim comes from
- Windows read, never titles: `apps/desktop/shell-core/src/tracker.rs` (`Entry`, `Snapshot`), `apps/desktop/src-tauri/src/platform/win.rs` (`windows_now`). What the class and states leave out: `REAL` in `apps/desktop/src/window-terrain.ts`. Only while out and walking: `wantWindows` in `apps/desktop/src/hub-core.ts`. Turning it off and staying off a program: `apps/desktop/src/manager/settings.ts`, `apps/desktop/src/window-terrain.ts`.
- The mouse: `apps/desktop/src-tauri/src/watch.rs`. Away, full screen and battery: `apps/desktop/shell-core/src/system.rs`, `apps/desktop/src/shell.ts` (`System`).
- The data folder, settings and log: [apps/desktop/README.md](apps/desktop/README.md) (its flags, and The library), `Settings` in `apps/desktop/src/hub-core.ts`, `apps/desktop/shell-core/src/log.rs` (`CAP`). The paths in the log: the `start` line in `apps/desktop/src-tauri/src/main.rs`. WebView2's folder: `start` in `apps/desktop/src-tauri/src/main.rs`. Theme: The Manager in [apps/desktop/README.md](apps/desktop/README.md). Start with Windows: `RUN_KEY`, `RUN_VALUE` and `set_autostart` in `apps/desktop/src-tauri/src/platform/win.rs`, the Store's `windows.startupTask` in `apps/desktop/packaging/msix/AppxManifest.xml` and its row in [docs/native-shell-design.md](docs/native-shell-design.md), changed only by the `autostart` command in `apps/desktop/src/hub-core.ts`, from the tray or the Manager's switch.
- Nothing sent by its own code: README's Network use and [SECURITY.md](SECURITY.md). WebView2's own data: Microsoft's [WebView2 data and privacy](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/data-privacy). Each app page's Content-Security-Policy lets it connect only to the app itself (`apps/desktop/public/*.html`).
- The local API: [docs/local-api.md](docs/local-api.md), `apps/desktop/src/local-api.ts` (the `off` and `not-running` replies), `apps/desktop/src/api-replies.ts`, `apiLaunch` in `apps/desktop/src/hub-core.ts`.
- The Store version's folder: set by the Store package, which gives the app `LocalState\data` as its data folder and `LocalState\webview` for WebView2, and Microsoft's [How packaged desktop apps run on Windows](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes) (Uninstallation).
- The web Maker: `indexedDbStore` in `apps/maker/src/app.ts` and `packages/maker-core/src/stores.ts`; exported pages: README's Network use.
