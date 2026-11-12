# Privacy

Desktop Buddies runs on your PC and keeps everything there. It has no accounts, analytics, ads, purchases, update checks or telemetry, and it sends nothing anywhere. This page covers the desktop app, from the Microsoft Store, winget or GitHub, and the web Maker.

## What it reads
- **Your windows.** So buddies can walk on your windows, the app reads which windows are open, where they are, and which program each belongs to: the program's file name, like `notepad.exe`, and the window's type name. It never reads a window's title or what's in it. It reads them only while buddies are out and Walk on windows is on, and Settings can turn this off or keep buddies off one program.
- **The mouse.** Where the pointer is and whether a button is down, so you can pick buddies up, throw them and right-click them.
- **Whether you're busy.** Whether the PC is locked or away, whether something is full screen, and whether it's on battery, so buddies can rest.
- **Files you give it.** A `.buddy` file or Shimeji folder you open, drop or import, and the pictures you add in the Maker. Nothing else on your disk.

None of this leaves your PC.

## What it keeps
In its data folder, `%APPDATA%\dev.exvanitas.desktop-buddies`:
- `library`: your buddies, their pictures and their lines.
- `settings.json`: who's out, Walk on windows, the programs buddies stay off (by file name), whether other apps may ask buddies to do things, and the name and your answer for each app that has asked.
- `api/replies`: the local API's replies, when it's on. See below.
- `logs/app.log`: what the app did, for bug reports, capped at 1 MB with one older file kept. It stays on your PC unless you attach it to a report yourself.

WebView2, which draws the app's pages, keeps its own data in `%LOCALAPPDATA%\dev.exvanitas.desktop-buddies`, including the Manager's theme.

Start with Windows, off until you turn it on, has Windows start the app when you sign in.

## What it sends
Nothing. The app, the Maker and pages exported from the Maker fetch nothing and send nothing. This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

## The local API
Other programs on your PC can ask buddies to wave or say a line. It's **off by default**: Settings turns it on, and Pause in the tray stops requests.
- It listens on no address of any kind, so nothing outside your PC can reach it.
- The first time an app asks, the Manager asks you to allow it. An app's name is whatever that app says it is, so this is a courtesy, not a lock. That's why the API can only do small, visible things: it never reads or writes your files, imports, exports or deletes a buddy, changes settings, opens links or runs anything.
- Replies are files in `api/replies`, and any program on your PC can read them. A reply holds only your buddies' ids and names, whether each is out and how many copies, and which actions she can do, or an error.

[docs/local-api.md](docs/local-api.md) has the details, and [SECURITY.md](SECURITY.md) the security side.

## The Microsoft Store version
The Store version keeps the same files, but Windows puts them in the app's own folder, `%LOCALAPPDATA%\Packages\<the app's package folder>\LocalCache`, under `Roaming\dev.exvanitas.desktop-buddies` and `Local\dev.exvanitas.desktop-buddies`. Uninstalling it removes that folder, and with it the buddies and settings the Store version made. If you ran the zip version first, its folder in `%APPDATA%` is used and kept as it is: delete it yourself if you want it gone.

## The web Maker
The web Maker keeps your buddies in your browser's storage for its page (IndexedDB), and sends nothing. An exported page holds the buddies you chose and fetches nothing.

## Removing your data
Delete the data folders above. The zip version is removed by quitting from the tray and deleting its folder. The Store and winget versions are removed from Windows' Installed apps.

## Questions
Open an issue on [GitHub](https://github.com/exvanitas/desktop-buddies/issues). For a security problem, use private vulnerability reporting instead: see [SECURITY.md](SECURITY.md).

## Where each claim comes from
- Windows read, never titles: `apps/desktop/shell-core/src/tracker.rs` (`Entry`), `apps/desktop/src-tauri/src/platform/win.rs` (`windows_now`). Only while out and walking: `wantWindows` in `apps/desktop/src/hub-core.ts`. Turning it off and staying off a program: `apps/desktop/src/manager/settings.ts`, `apps/desktop/src/window-terrain.ts`.
- The mouse: `apps/desktop/src-tauri/src/watch.rs`. Away, full screen and battery: `apps/desktop/shell-core/src/system.rs`, `apps/desktop/src/shell.ts` (`System`).
- The data folder, settings and log: [apps/desktop/README.md](apps/desktop/README.md) (its flags, and The library), `Settings` in `apps/desktop/src/hub-core.ts`, `apps/desktop/shell-core/src/log.rs` (`CAP`). WebView2's folder: `start` in `apps/desktop/src-tauri/src/main.rs`. Theme: The Manager in [apps/desktop/README.md](apps/desktop/README.md). Start with Windows: `set_autostart` in `apps/desktop/src-tauri/src/platform/win.rs`, changed only by the `autostart` command in `apps/desktop/src/hub-core.ts`, from the tray or the Manager's switch.
- Nothing sent: README's Network use and [SECURITY.md](SECURITY.md). Each app page's Content-Security-Policy lets it connect only to the app itself (`apps/desktop/public/*.html`).
- The local API: [docs/local-api.md](docs/local-api.md), `apps/desktop/src/local-api.ts`, `apps/desktop/src/api-replies.ts`.
- The Store version's folder: the app's paths above, and Microsoft's [How packaged desktop apps run on Windows](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes) (AppData operations, and Uninstallation).
- The web Maker: `indexedDbStore` in `apps/maker/src/app.ts` and `packages/maker-core/src/stores.ts`; exported pages: README's Network use.
