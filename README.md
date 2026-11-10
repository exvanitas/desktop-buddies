# Desktop Buddies

Little characters that live on your Windows desktop. They walk along your windows, climb the sides, hang underneath, nap, chat and get thrown about. Make your own in the Maker from one picture or a full set of poses, or bring in a Shimeji folder.

No buddies are included. To get one, import a `.buddy` file someone shared, make one in the Maker, or bring in a Shimeji folder. A public gallery to find buddies in is planned.

- **The desktop app:** one world across all your monitors, a Manager to call and dismiss buddies, and the Maker built in.
- **The web Maker:** the same Maker in a browser, which can also export a standalone page with your buddies on it.

Free and open source. See [CHANGELOG.md](CHANGELOG.md) for what's in each version.

## Download and run
Windows 10 or 11, 64-bit.

Download the zip from [Releases](https://github.com/exvanitas/desktop-buddies/releases). Releases aren't signed yet; signing through SignPath is applied for (see the code signing policy in [docs/releases.md](docs/releases.md)). You can also build it from source, below.

1. Unzip the whole folder somewhere you'll keep it, like Documents. Keep the `app` folder next to `desktop-buddies.exe`.
2. Double-click `desktop-buddies.exe`. The Manager opens on an empty library: Import brings in a `.buddy` file or a Shimeji folder, and New buddy opens the Maker. The tray icon, near the clock, opens the Manager again.

To remove it, quit from the tray and delete the folder. Your buddies and settings are in `%APPDATA%\dev.exvanitas.desktop-buddies`, which you can delete too.

### If Windows stops it
Until releases are signed, Windows may warn you.
- **"Windows protected your PC":** click More info, then Run anyway.
- **Smart App Control:** if it's on, it may block the exe outright, and there's no button to get past it. Please don't turn Smart App Control off for this. You can build the exe yourself from this source instead.

## Network use
None. The app, the Maker and exported pages fetch nothing and send nothing: no accounts, analytics, update checks or telemetry. To use your windows as terrain, the app reads which windows are open, where they are and which program each belongs to, never their titles or contents, and none of it leaves your PC. Other apps on your PC can ask buddies to wave or talk only if you turn that on in Settings. See [SECURITY.md](SECURITY.md).

## Build from source
You need Node 22 and pnpm 10. The exe also needs Rust and Windows; the app folder builds anywhere.

```
pnpm install
pnpm dev            # the web Maker, with live reload
pnpm build          # apps/maker/dist, and apps/desktop/dist/app
```

The exe is in `apps/desktop/src-tauri` (`cargo build --release` there, on Windows). Put `apps/desktop/dist/app` beside it as `app`. [apps/desktop/README.md](apps/desktop/README.md) has its flags and how the pieces fit.

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
Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org). Committers, reviewers and approvers: the maintainer, Severian (@severian-dev). This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. The full policy and the release workflow are in [docs/releases.md](docs/releases.md).

## Plans
Before the project rests: an end-to-end test of the local API and the MCP server, and polish on the buddies' animations. Later, a Desktop Buddies site: a landing page, a public gallery of uploaded buddies with moderation, links, and a short guide to making your own buddy and to the local API and MCP.

## Licence
The code is under the [MIT licence](LICENSE). The Desktop Buddies name, logo and mascot are not: see [TRADEMARKS.md](TRADEMARKS.md). Buddies you make are yours. The bundled fonts (DynaPuff, Lexend and Nunito) are under the SIL Open Font License 1.1.

## Credits
- Desktop Buddies is Yarrow's project. She created it, and the original engine and web maker are hers.
- The original was inspired by batanghwamyeon2.netlify.app, and written from scratch.
- Shimeji-style poses follow the idea of Shimeji desktop pets. No Shimeji code is used.
- [NOTICE](NOTICE) has the credits in full.
