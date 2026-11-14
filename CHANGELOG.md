# Changelog

## Unreleased
- **Pictures go straight in.** In the Maker, a picture with no pose in its name goes to the pose you have open, or makes a new buddy, without asking where. A note says where it went, with Undo and the other places it could go. Shimeji images make a new buddy at once, with Undo too.
- **Mute.** Settings has Buddies talk, and each buddy's menu has Talks, in the Manager and when you right-click her. Off, she keeps her own lines to herself. Lines other apps send still show; you choose those per app in Settings.
- **Show names.** A switch in Settings hides every buddy's name tag on the desktop.
- **No "Upload files to this site?" for a Shimeji.** Importing a Shimeji no longer opens a folder picker, which made Windows ask that. Drag the folder in, or pick every image in its img folder.
- **Lighter when hidden or paused.** Hidden, paused, or while you're away, the buddies' world stops ticking and their windows stop drawing, instead of doing both 60 times a second with nothing to show. They pick up where they were, and anything that changes meanwhile, like a buddy brought to you, still shows at once.
- **Pip has a picture for every pose slot.** The Maker's sample now climbs, hangs, rolls, tumbles, struggles, stands up from each way down, and has a move of her own, all in her own drawings.
- **Double-click a .buddy file.** A new switch in Settings, Open .buddy files with Desktop Buddies, makes Windows open `.buddy` files with the app, so a double-click imports her. It's off until you turn it on, it's for your Windows account only, and turning it off removes it.
- **One sample in the Maker.** The Maker offers Pip, who has a full set of poses, to start from. Pudding and Sprout aren't offered any more; buddies you made from them keep working as they are.
- **No more growing and shrinking.** A buddy whose poses are cut at different sizes, like the Maker's Pip, could look bigger or smaller for a moment when she changed pose: her new size was drawn before her new picture had loaded. Now the two change together.
- **Imported Shimeji are as sharp as in Shimeji.** A Shimeji set came in a little blurred: the import could cut her pictures half a pixel off, which blended every pixel with its neighbour, made big sets smaller, and her standing picture gently squashed and stretched. Now the import keeps her pictures pixel for pixel at their own size, and a picture shown at its own size or bigger (a display set to 125% or 150%, or a bigger size you pick) is scaled in whole pixels, never blended. Drawn buddies are drawn smooth, as before. A Shimeji imported before this needs importing again to get her sharp pictures.
- **No Microsoft Store version for now.** Desktop Buddies installs from GitHub, with the installer or the zip, and through winget once it's in the catalogue. They aren't signed, so 1.0.0's note on Windows' warnings still holds.

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
- **A per-user installer.** `desktop-buddies-1.0.0-setup-x64.exe` installs Desktop Buddies for you alone, with a Start menu entry and an uninstaller. Uninstalling keeps your buddies. The portable zip is still here.
- **Not signed yet.** Windows may say "Windows protected your PC": choose More info, then Run anyway. Smart App Control may block it with no way past. A Microsoft Store version, signed by Microsoft, and a winget package are coming.
- **Privacy.** A new PRIVACY.md says what the app reads, keeps and sends. Its own code sends nothing; the page also says what Microsoft's WebView2 runtime does by itself.
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
- **No network use by the app itself.** No accounts, analytics, update checks or telemetry in its code. Microsoft's WebView2 runtime has its own diagnostics: see PRIVACY.md.

### Download
Windows 10 or 11, 64-bit. Unzip it somewhere you'll keep it and run `desktop-buddies.exe`, with the `app` folder beside it.

This build isn't signed yet. Windows may say "Windows protected your PC": choose More info, then Run anyway. If Smart App Control is on, it may block the exe with no way past; you can build it from source instead. Signed builds through SignPath are planned.

### Licence
MIT for the code. The Desktop Buddies name, logo and mascot aren't covered: see TRADEMARKS.md. Credits are in NOTICE.
