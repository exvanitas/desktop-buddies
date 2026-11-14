# Desktop Buddies

Little characters that live on your Windows desktop. They walk along your windows, climb the sides, hang underneath, nap, chat and get thrown about. Make your own in the Maker from one picture or a full set of poses, or bring in a Shimeji folder.

No buddies are included. To get one, import a `.buddy` file someone shared, make one in the Maker, or bring in a Shimeji folder. A public gallery to find buddies in is planned.

- **The desktop app:** one world across all your monitors, a Manager to call and dismiss buddies, and the Maker built in.
- **The web Maker:** the same Maker in a browser, which can also export a standalone page with your buddies on it.

Free and open source. See [CHANGELOG.md](CHANGELOG.md) for what's in each version.

## Install
Windows 10 or 11, 64-bit, with Microsoft Edge WebView2, which draws the app's windows. It comes with Windows 11 and most up-to-date Windows 10 PCs, and the installer downloads it from Microsoft if it's missing. If the zip version won't open on Windows 10, install the [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) from Microsoft, then start it again. Pick one:

- **winget** (coming soon), once it's in the winget catalogue:
  ```
  winget install --id exvanitas.DesktopBuddies -e
  ```
- **The installer** from [Releases](https://github.com/exvanitas/desktop-buddies/releases): `desktop-buddies-X.Y.Z-setup-x64.exe`. It installs for you alone, with no admin prompt, into `%LOCALAPPDATA%\Desktop Buddies`, and adds Desktop Buddies to the Start menu. A winget upgrade, or a newer setup run with `/S`, installs over the old version and keeps your buddies and Start with Windows. A newer setup run by hand removes the old version first: your buddies stay, but Start with Windows goes off, so turn it back on in the app. Files the new version no longer has may stay in the program folder, which does no harm. Remove it from Installed apps in Windows Settings.
- **The portable zip** from [Releases](https://github.com/exvanitas/desktop-buddies/releases). Unzip the whole folder somewhere you'll keep it, like Documents, keep the `app` folder next to `desktop-buddies.exe`, and run the exe. To remove it, turn Start with Windows off if you turned it on, quit from the tray and delete the folder.

The installer and the zip aren't signed. Windows may say "Windows protected your PC": click More info, then Run anyway. If Smart App Control is on, Windows checks each unsigned version with Microsoft's cloud service and may block it outright, with no way past, and a new version can be blocked where an older one ran. Please don't turn Smart App Control off for this. winget installs the same unsigned installer, so it gets the same checks.

The first start opens the Manager on an empty library: Import brings in a `.buddy` file or a Shimeji folder, and New buddy opens the Maker. The tray icon, near the clock, opens the Manager again.

Your buddies and settings are in `%APPDATA%\dev.exvanitas.desktop-buddies`. Removing the app leaves them there, unless you tick the uninstaller's box to delete them, and you can delete the folder yourself. Before you delete the zip version's folder, turn Start with Windows off, so its startup entry goes too. [PRIVACY.md](PRIVACY.md) has the details.

## Network use
None from Desktop Buddies itself. Its own code, in the app, the Maker and exported pages, fetches nothing and sends nothing: no accounts, analytics, update checks or telemetry. The desktop app draws its windows with Microsoft Edge WebView2, a Windows component Microsoft runs: it updates itself, sends Microsoft diagnostic data as Windows' Diagnostic data setting allows, and sends a crash report if it crashes. See Microsoft's [WebView2 data and privacy](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/data-privacy). To use your windows as terrain, the app reads which windows are open, where they are, their order and states (maximized, always on top and the like), each one's class and which program it belongs to, never their titles or contents, and none of it leaves your PC. Other apps on your PC can ask buddies to wave or talk only if you turn that on in Settings. See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## Build from source
You need Node 22 and pnpm 10. The exe also needs Rust and Windows; the app folder builds anywhere.

```
pnpm install
pnpm dev            # the web Maker, with live reload
pnpm build          # apps/maker/dist, and apps/desktop/dist/app
```

The exe is in `apps/desktop/src-tauri` (`cargo build --release` there, on Windows). Put `apps/desktop/dist/app` beside it as `app`. [apps/desktop/README.md](apps/desktop/README.md) has its flags and how the pieces fit.

## Community
Ask questions, report bugs and show off your buddies on the Milliways Discord server: [discord.gg/HNhFu4bDNj](https://discord.gg/HNhFu4bDNj). Desktop Buddies has its own channel there, #desktop-buddies. Report bugs in #orders, tagged desktop-buddies. [GitHub issues](https://github.com/exvanitas/desktop-buddies/issues) work too.

## Contributing
Issues and pull requests are welcome. Before a pull request, run the checks:

```
pnpm typecheck
pnpm test             # includes the golden traces
pnpm test:browser     # headless, on the builds
pnpm test:manager     # headless, the Manager on the real hub and a fake exe
pnpm test:maker-view  # headless, the Maker's view
```

The browser checks need a Chromium that's already installed: set `CHROME_PATH`, or they look in Playwright's cache. They download nothing.

The golden traces in `apps/maker/tests/golden` record what the engine painted, frame for frame. The engine must match them exactly, and they're never re-recorded to make a test pass. [docs/project-structure.md](docs/project-structure.md) has the layout and the rules, and [docs/README.md](docs/README.md) lists the docs.

By contributing, you agree your contribution is under the MIT licence.

## Code signing policy
The installer and the zip on GitHub aren't signed: a free open-source signing service may be applied for again later.

Committers, reviewers and approvers: the maintainer, Severian (@severian-dev).

Desktop Buddies' own code doesn't transfer any information to other networked systems unless the person using it asks. Microsoft's WebView2 runtime, which it draws with, has its own diagnostics and updates: see [PRIVACY.md](PRIVACY.md). The release workflow is in [docs/releases.md](docs/releases.md).

## Plans
Next: the winget package, a sample buddy that fills every pose slot, and a settled `.buddy` format. Later, a wider local API, and a Desktop Buddies site: a landing page, a public gallery of uploaded buddies with moderation, links, and a short guide to making your own buddy and to the local API and MCP.

## Licence
The code is under the [MIT licence](LICENSE). The Desktop Buddies name, logo and mascot are not: see [TRADEMARKS.md](TRADEMARKS.md). Buddies you make are yours. The bundled fonts (DynaPuff, Lexend and Nunito) are under the SIL Open Font License 1.1.

## Credits
- Desktop Buddies is Yarrow's project. She created it, and the original engine and web maker are hers.
- The original was inspired by batanghwamyeon2.netlify.app, and written from scratch.
- Shimeji-style poses follow the idea of Shimeji desktop pets. No Shimeji code is used.
- [NOTICE](NOTICE) has the credits in full.
