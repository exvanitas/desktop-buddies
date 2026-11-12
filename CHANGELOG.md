# Changelog

## 1.0.0 (2026-11-12)

### Smoother buddies
- **Corners.** Over a window's corner she's drawn turning round it, not jumping across. Screen corners, catching a wall or ceiling, and leaving one turn over a few frames too.
- **Picking up.** She slides from where you grabbed her to the hold, instead of jumping to it.
- **Dropping.** Let go below the floor, she rises onto it.
- **Rolls** end upright.
- **Personality poses** (Excited, Laugh, Surprised, Face away, Tap the screen, Stare) now play on their own now and then, if she has the art.
- **One-sided art.** A pose with an arm out to one side no longer shifts her body sideways.
- **Hand-ons.** For a buddy without her own art for a moment, one animation now leads into the next over a few frames instead of snapping.
- **Hops** onto windows no longer stall.
- **Frame pacing.** On the desktop, buddies are drawn on the display's beat, so throws, falls and hops no longer hitch.

### Install
- **Install routes.** The README now lists the Microsoft Store and winget, both coming soon, beside the per-user installer and the portable zip, and says plainly that the installer and the zip aren't signed.
- **Privacy.** A new PRIVACY.md says what the app reads, keeps and sends (nothing), and where the Store version keeps its data.
- **Store kit.** docs/store has the Store listing, its screenshots, and the scripts that make them and the sample buddy for a release.

### Checks
- A new Windows check drives the local API and the MCP server end to end, through the real consent button.
- The Windows checks also measure frame pacing on GitHub's runner.

### Known
- Rounding a window corner close to the screen edge, she can overlap that corner for a few frames.

## 0.1.0 (2026-11-10)

The first public version of Desktop Buddies: little characters that live on your Windows desktop.

### What's in it
- **Buddies on your desktop.** One world across every monitor. Buddies walk along your windows, climb the sides, hang underneath, nap and chat, and ride along when you move a window. Drag and throw them; shake one and she struggles free. Sink one into the floor with Lift and she stands over the taskbar.
- **No buddies included.** Import a `.buddy` file someone shared, bring in a Shimeji folder, or make your own.
- **The Manager.** Call and dismiss buddies, call more copies, import, export and delete. Opening a file for a buddy you already have asks first: Replace or Keep both.
- **Right-click a buddy** for her actions: give a treat, chase your mouse, call another, dismiss, edit, export or delete. Arrow keys and Enter work in it.
- **The Maker,** in the app and on the web. Make a buddy from one image or a full set of poses, with lines for what she says, Lift to set her on floors, walls and ceilings, optional transition poses, and a prompt kit for image AIs. The web Maker can export a standalone page with your buddies on it.
- **Your windows as terrain.** The app reads only which windows are open, where, and which app each belongs to, never titles or contents. Settings can turn this off or keep buddies off one app.
- **A local API and an MCP server, off by default.** Turn it on in Settings, and apps or AI agents on your PC can ask buddies to wave or say a line, after you allow each app.
- **No network use.** No accounts, analytics, update checks or telemetry.

### Download
Windows 10 or 11, 64-bit. Unzip it somewhere you'll keep it and run `desktop-buddies.exe`, with the `app` folder beside it.

This build isn't signed yet. Windows may say "Windows protected your PC": choose More info, then Run anyway. If Smart App Control is on, it may block the exe with no way past; you can build it from source instead. Signed builds through SignPath are planned.

### Licence
MIT for the code. The Desktop Buddies name, logo and mascot aren't covered: see TRADEMARKS.md. Credits are in NOTICE.
