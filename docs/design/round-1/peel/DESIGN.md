# Peel

## The idea
In the library, a buddy is a sticker. You peel it off the sheet and stick it on your screen.

Every buddy on the sheet gets a die-cut white edge that follows its own shape, so any art reads on the backing. Calling a buddy peels it off and leaves the spot it was cut from: a dotted cut line around the buddy's shape, the paler sheet under it, and the real art faded onto that. You can see who's out, and you can still see who they are.

The dotted line is the project manager's idea. Her words: "I would also add a dotted outline for the peeled ones. Make it more clear it's off the sheet, also cute."

The sticker edge lives in the library only. The Maker is the working view, so it shows the art as it will really appear, on a plain backing you can switch between light and dark.

Dark shell by default, because stickers look best on a dark backing. The original maker's lavender, at night. `?theme=light` shows the light version.

## Pose slots
- Own art: full strength on the backing.
- Core with no art: printed faint. "Using Climb wall". It works, and it's clearly not this pose's own art.
- A stand-in that is the main image stays at full strength. It's the buddy's own art.
- Optional with no art: a dashed "Could add" tag under the sheet. Never an empty spot.
- Nothing counts toward 42. The sheet list shows small peeks of what's there and never a total.
- Eight sheets: the schema's groups, with Activities and Windows folded in. **Everything** is the overview and the first thing you see. Sheets scroll when they don't fit.
- The tray along the bottom holds the selected pose: frames, speed, scale, Play. It shrinks when the pose has no frames.
- Frames: "Frame 3 of 8", Earlier, Later, Remove on the picked frame. Over 12 frames, a slider jumps along the strip.
- Try: all 21 actions from today's panel, minus any this buddy has no art for, in the tray at every size. **Try on my screen** sends the real buddy out, in the app. On the web that button opens a drawn desk instead. The preview in the tray puts the buddy on its surface.

## The Maker by moment
A second Maker to compare, in `maker-moments.html`. `maker.html` stays as it was. This is the mix: moments win a quick look, the overview wins an evening of work.

- **It opens on Everything.** The whole buddy on one page, with frame counts and "Using ..." captions, and a "Back to" button for the sheet you were on. The last sheet is remembered per buddy.
- **All words** is the same thing for dialogue: every situation in one list, grouped by moment. Bulk writing stays in Prompt kit.
- **Sheets are for focused work.** Hanging around, Picked up, Up the walls, Feelings, Off for a run, Chasing the mouse, Nap time, Just for fun, Meeting and leaving. These follow `docs/core-loops.md`, except Feelings and Meeting and leaving, renamed so people can find anger and being dismissed. The separate Lines tab is gone.

**A sticker is one artwork: its frames, and the situations that use it.**
- Words never own a picture. A situation is words that point at art, and art carries a small "Used for".
- Slots standing on the main image share one sticker, because they are one picture. A one-image buddy gets one sticker per sheet, not a row of repeats.
- Meeting and leaving, Spin and Roll have no stickers of their own. Their art shows as small references, marked as living on another sheet.
- Picking a word draws a dotted line on the art it uses. That's the same dotted line as a peeled sticker, here meaning "that's where this comes from".
- Picking a word opens its words, never its art. Changing shared art takes a named step, "Edit Wave art", which says how many other situations share it.

**One rule for every click.** A click picks, the tray edits, and only Play, Say it and Try perform.

**Writing a line.** Pick a line and the tray becomes a writer: situation title, when it's said, the full line in an editable field, Say it, Add a line, Remove. Words update everywhere as you type. Long lines wrap in the list and the field, up to the file's 300 characters. Only lines of 26 characters or less ride on the sticker. A buddy's list replaces the default list whole, as in `voice.ts`, so the tray says "Default lines, until you change one", or "Own lines" with "Use the defaults". Removing the last line goes back to the defaults, because that's what the engine does with an empty list.

**Space.** Art sits at the top with no centring. The perforated line is a divider: drag it or use the arrow keys, and each sheet keeps its own setting. Its starting place depends on how much art and how many words the sheet has. Under the art, "How it goes" shows the real sequence, with small art. That's where conditional behaviour gets explained.

**Try.** The sheet's own actions come first, with the other ones behind "All actions".

**Stable size.** Sticker size is worked out from the sheet, the window and the divider, never from what's picked. The tray is one height for art and for words. A buddy with no frames at all gets a slimmer tray, the same in both modes.

**Honest captions.** There's no universal "Plays X". Captions were checked against `behaviours.ts`, `motions.ts`, `body.ts`, `sim.ts` and `host.ts`:

| Situation | Caption |
|---|---|
| Finished eating | After Eat snack, going to Stand |
| Getting back up, Woken from a nap | After Stand up if it has art, going to Stand. Clicked awake skips Stand up |
| Being carried | Over Held, Swung left or Swung right |
| Catching a wall | With Hold on wall or Hang from ceiling, caught after a throw |
| Falling or dropped | With Falling or Thrown |
| Thrown too hard | On a hard hit, then Dizzy, or Knocked out if it has art |
| Gives up the chase | Going to Tired, else Watch cursor, else Sit, by what has art |
| When you dismiss it | With Wave on the floor. Anywhere else, the pose it's in |
| While wandering | Over any calm pose |

**What the engine and app must provide**
- `dragme` lines exist, but only an action nothing calls can say them. The caption says so. Decide whether something should.
- Dangle legs is in the schema with no behaviour in the engine. Its caption says so, and the tray won't promise "add art and it will". Stare, Face away, Tap the screen, Surprised, Laugh and Excited were here too, with behaviours nothing set off; since the animation audit they are picked now and then on the floor, and their captions promise it.
- A real preview has to respect play-once poses and the two-frame swing, where frame 1 is gentle and frame 2 strong. The prototype plays once and holds the swing art still. Loops still need a real stage. Try here only places the pose on its surface.
- The pose-to-situation table is hand-written in this page. The real one should come from the engine's behaviour book, so captions can't drift.
- Lines stay in the buddy's `lines`. Nothing new in the file format, and no new exe.

Own, borrowed and missing stay as in `maker.html`: full strength, printed faint, "Could also" tag.

**As built, in `packages/maker-view`.** What the page above left open:

- **Prompt kit:** describe the buddy once, then Words, on the left. Pictures on the right, with what only pictures need: style, quality tags, always add. Each image prompt sits beside the art it asks for, or a dashed gap, so what's missing shows. A click on a prompt picks it, and the tray reads it whole.
- **Look:** the main image at the size it'll have on the screen, and what it stands in for. Name, facing, size, Lift, Match sizes and the window's theme are across the perforation. Lift here is her own, for every pose, one value each for the floor, walls and ceilings, since art often sits differently on its side or upside down. Each is a share of her size: up from the floor, out from a wall, down from a ceiling, never held or in the air. A floor line under the main image shows the floor's, and two small pictures under it show the others: her wall art against a wall on her left, facing it, and her hang art under a ceiling, or the main image turned as the screen turns it. The tray's preview holds her off its surface by that surface's value. A pose's own Lift goes on top of the floor's.
- **First step:** the dotted line a sticker leaves, here saying where this one goes. Drop or pick an image, or start from a sample. Nothing exists until there's a picture. The samples keep the die-cut edge, since they're stickers on offer.
- **Save status:** one quiet word when fine. A failure is a misprint under the bar with its title, why, fix and actions, plus Save buddy file, so the work can always get out. A word in the warning colour stays in the bar. Trying again doesn't clear it. Only a real save does.
- **Play:** a loop runs when picked, a play-once pose waits for Play, plays once and holds its last frame, and the two-frame swing shows gentle, strong, gentle and stops. Picking a frame stops the preview on it. Under reduced motion nothing runs by itself, and Play still does.
- **Files with no pose in their names** ask where they go: frames for the picked pose, a new main image, or a new buddy. On the tray they're frames, and on the main image itself a new main image. A dropped set of Shimeji images asks before it makes a new buddy.
- **Stickers:** slots borrowing the same pose share a sticker, as slots on the main image do.
- **In-flight adds:** an add lands on the buddy it started on, or nowhere, and says so. Lines from a chatbot's reply follow the file's own rule: a reply that breaks it is refused whole, and nothing is cut.
- **Facts from the book:** what plays once and what nothing sets off are read from the behaviour book. Captions stay hand-written, and `tests/moments.test.ts` fails if the book or the engine's speech moves under them.
- **Slim tray:** 106 px, not the page's 96, because the writer needs that much.
- **Lift:** a pose she stands on the floor in, with its own art, has Lift in the tray: px off the floor at her size, where 0 is the bottom of the art, measured from its pixels. It moves every frame's box bottom by the same amount, so the file format doesn't change, boxes set by hand keep their offsets from each other, and moving it back gives back exactly what was there. A frame added later stands where its own art ends, plus the lift. A box can't reach past its picture, so art that touches the bottom of its picture can only go down. The preview draws the floor under any pose on the floor.

## Manager
- One sheet, the whole window. No side rail.
- Each buddy has its name, status and button together: At home, On desktop, 2 on desktop. Click the art to Call or Dismiss. With several copies out the button says Dismiss all, and Dismiss one is in the ••• menu. A peeled buddy also has its dotted line. Call another, Edit, Export and Delete are in the ••• menu. For someone out, Bring here, Give a treat and Chase my mouse lead it, and the last two only show when she has the art for them. A line splits what she does on the desktop from her file: Edit, Export and Delete.
- The order never changes.
- Failed import: a dashed misprint at the top of the sheet, with the next step as its button. The button only shows if this window can really do it: reopen a picker, or repeat a command it sent. Two show at once, with the rest behind Show all.
- Menus are placed by script to stay inside the window. They close on scroll, Escape and an outside click.
- Delete asks in the same spot as the menu, and Cancel is the easy way out.
- **0 buddies:** an empty sheet that says what to do.
- **1 buddy:** one large sticker and a drop area, at the minimum window size.
- **200 buddies:** Find, from 10 buddies up. An Out filter would help, and isn't built.
- All art is one height on the sheet. A buddy's size isn't in the hub's row, so Tower isn't taller than Bit here, as it is in the prototype.
- Theme is in Settings, and in the page's own storage. Dark if that fails.
- Walk on windows is in Settings too, a switch that's on by default. Under it, Stay off: a switch for each app with a window open, by exe name, and for any app already on the list. It's the hub's, so it's stored with the other settings, not in the page.

## The spot a sticker leaves
- **Line:** even round dots along the outer silhouette, 5 px off the art at library size. Dots are 2.8 px, 7 px apart. Each loop is split into a whole number of steps, so it closes with no seam or short gap.
- **Inside:** the outline's shape is filled with `--pad`, the sheet under the sticker, a step paler than the sheet. The art sits on it at 78% in dark, 64% in light.
- **Why a pad:** the mud came from fading warm art over dark purple, and yellow over violet goes olive. Over the paler pad, Pip stays a soft butter yellow. The old dark fill is gone. The line now says "it's out", so the art can stay closer to its real colour. It's still clearly not a sticker: no white edge, no shadow, softer colour.
- Dots use `--sun`'s family in dark, the same colour as the status word, so yellow means out.
- One line per buddy, however many copies are out. The count is in the status word.

## The bake
The app bakes the line on demand, in the Manager page, from the image it already loaded. Nothing is stored: no `data_write`, no index, no file format change, no change to the hub, and no new exe. The first time someone is out, `packages/art/src/outline.ts` works out their line, and the page keeps it in memory by image URL. The URL is named by the image's bytes, so it changes when her main image does. A bake that failed isn't kept. It's baked one at a time with a pause between, so a sheet of 200 doesn't hold the page up. The line is worked at 1.5 times its size on the sheet, whatever the image's size, so every buddy costs about the same.

`outline.ts` is pure, over an alpha buffer. `outline-canvas.ts` reads the pixels. Library images and data URLs both read fine, because both have the local origin. Every step:

1. Take alpha at 50% or more as the body. **Soft edges:** glows, drop shadows and feathering fade out below 50%, so the line follows the solid body. A wide glow can reach or cross the line. That's accepted, because the other choice is a line far from the buddy.
2. Drop specks under 0.2% of the body.
3. Separate parts within a third of the art's size get a thin bridge to the body, so a sparkle sits inside the same line. Parts further away get their own small loop.
4. Fill inner holes. Only the outer silhouette counts.
5. Grow by the offset, measured in library pixels, so small and large art get the same gap.
6. Close narrow inlets and blur a little, so fur and pixel steps become a smooth cut. Three box blurs stand in for a gaussian.
7. Trace the contour and resample it evenly. The dots divide each loop into a whole number of steps.

Art on an opaque rectangle has no silhouette, so its line is a rounded rectangle. That's a body filling 96% of its box, so a photo sticker counts. Background removal at upload makes that rare. An image that can't be read, or has no solid body, gets a rounded rectangle round the whole image, never no line.

**Measured**, in headless Chromium on this machine, per buddy, including reading the pixels: 6 to 10 ms on the sample art, 9 ms on `test-soft-pip.webp`, 14 ms on `test-far-part.webp`. Loop counts match `outlines.js` on all eight images checked, and lengths are within 7%.

`bake-outlines.py` and `outlines.js` stay as the prototype's stand-in, and as the reference for those lengths. The prototype has to work from `file://`, where a canvas can't be read.

**The sticker edge** stays CSS filters, with no `sticker.webp`. This page guessed that would be too heavy for 200. Measured with software rendering, it isn't: 200 buddies paint a new screenful in 51 ms with the filters and 49 ms without, with no scroll frame over 33 ms. `hole.webp` isn't needed either: the pad is the path's fill and the ghost is the normal image.

`?lib=out` calls everyone, and adds three hard cases: a sprite with a separate part, Pip with blurred edges, and Pip with a small part out of reach. Those two test images are in this folder. They're not real buddies.

## Type
Lexend for all working text and pose labels, 400 to 600. DynaPuff only for identity: buddy names on the sheet, the title and sheet headings. Smallest size 10.5 px, on frame numbers. Licenses: SIL OFL 1.1, `fonts/dynapuff-OFL.txt` and `fonts/lexend-OFL.txt`. Latin only here, so names in other scripts need a system fallback in the stack.

## Colour
Dark is the default. Light turns the sheet into mid lilac, not white, because the white edge needs something to stand against. The Maker's backing switches on its own, in both themes.

| Token | Dark | Light |
|---|---|---|
| `--back` | `#211c3d` | `#c9bde6` |
| `--sheet` | `#2e2856` | `#d9cff0` |
| `--sheet-2` | `#3a3369` | `#e7dff7` |
| `--edge` | `#4b4380` | `#a99ad0` |
| `--chip` (buttons in the tray) | `#4b4380` | `#cfc3ea` |
| `--track` (switch, off) | `#4b4380` | `#6c5f9a` |
| `--cream` (text) | `#fbf3e4` | `#2a2040` |
| `--dim` | `#b9b0d6` | `#53476f` |
| `--faint` | `#8f86b4` | `#53476f` |
| `--sun` (Call, Save) | `#ffc24b`, dark text | `#ffc24b`, dark text |
| `--out-ink` (status when out) | `#ffc24b` | `#7a4300` |
| `--warn` | `#ffb08a` | `#94360f` |
| `--die` | `#ffffff` | `#ffffff` |
| `--kiss` (hairline round the edge) | none | `#8a7bbd` |
| `--pad` | `#6a5fa8` | `#f3eefb` |
| `--dot` | `#ffd27a` | `#5f4f96` |
| `--ghost` (art opacity) | `.78` | `.64` |
| `--paper` (Maker backing, light) | `#efe9f6` | `#efe9f6` |
| Maker backing, dark | `#2e2856` | `#2e2856` |

## Contrast
Worked out from the tokens, WCAG ratios. Text needs 4.5, shapes need 3.

| Pair | Dark | Light |
|---|---|---|
| Text on sheet | 12.3 | 10.3 |
| `--dim` on sheet | 6.6 | 5.7 |
| `--dim` on window back | 7.9 | 4.8 |
| `--faint` on window back | 4.8 | 4.8 |
| Status when out, on sheet | 8.4 | 5.4 |
| `--warn` on sheet | 7.6 | 5.1 |
| Dots on sheet | 9.5 | 4.6 |
| Dots on pad | 3.9 | 6.1 |
| White edge on sheet | 13.5 | 1.5 |
| Hairline on white, as rendered | none needed | 3.7 |

- White on lilac can't reach 3 at any tint that still looks light. So in light the edge gets a 1 px `--kiss` hairline, like the cut around a printed sticker.
- Pad on sheet is only 1.3 in light and 2.5 in dark. It's a soft tint, and the dots carry the shape.
- The switch track, off, is 1.9 in dark and 3.2 in light. The knob carries the state in dark, at 14 against the window.

## Motion
A sticker lifts 3 px and tilts 1.5 degrees on hover, and frames flip at real speed in the tray. Call lifts the sticker and the dotted line draws in behind it, 260 ms. Dismiss runs it back. Sprites only run in the tray. All of it is off under reduced motion.

## Windows
| | Default | Minimum |
|---|---|---|
| Manager | 760 x 580 | 560 x 440 |
| Maker | 1180 x 680 | 960 x 600 |

680 tall is what's left on a 1080p screen at 150%. No frame from Windows: the page draws the title bar, with Minimize and Close, and drags from it. Native shadow and snapping. No transparency.

## Reusing it
Two parts: the die-cut edge for mixed art on any ground, and the dotted cut line with its pale pad for "this thing is elsewhere". Both work on any image with transparency. The bottom tray with its own frame strip works in any editor.
