# Desktop Buddies

An English desktop-pet maker inspired by batanghwamyeon2.netlify.app, written from scratch, with Shimeji-style per-pose frames.

## Run locally
From the repository root, `pnpm dev`. To build, `pnpm build`, which puts a static site in `apps/maker/dist`. You can open its `index.html` directly, or host the folder by dragging it onto Netlify Drop.

## Files
- `src/web-host.ts` joins the engine to a page. Everything it needs from the browser is passed in.
- `packages/art` is image processing, shared with the desktop app's Manager.
- `src/export.ts` builds the standalone desktop page. `src/player.ts` is that page's script, built once into a single bundle that the export embeds.
- `src/panel.js` is the settings panel, including the pose-frame editor. It's DOM only, and stays plain JavaScript because the Peel Maker's view replaces it.
- `src/app.ts` is page glue: the world, and the browser's half of the Maker's I/O.

`packages/maker-core` is what the Maker does, with no page of its own: the state and every change to it, saving and loading (IndexedDB, or memory in tests), the file flows, the prompt kit, and the code-drawn sample (Pip, with a full pose set). A first start holds no buddy: the samples are offered, never added. The desktop app can host the Maker because of this split: a new view only needs `createMaker()`.

The simulation, terrain, drawing and file format live in `packages/` too.

## Poses
Each buddy has a **main image** plus optional frame sets for its poses, listed in `POSES` in `packages/buddy-file/src/schema.ts`: the basics, movement, being dragged, walls and ceiling, reactions, activities, transitions and personality.
An empty pose borrows from a related pose; for example, cry falls back to sit, then stand, then the main image. If nothing is found, it animates the main image procedurally. For walls and the ceiling, that means rotating the main image onto the surface.

Optional poses are different: everything outside the Core tier needs its own frames. A buddy with no dance frames never dances, and **Try an action** doesn't offer it.

Some poses play once and hand on, like **Stand up** and **Stand from sit**. Start and end them on the main pose so they join without a pop. With no frames they're skipped. **Sit down** and **Fall asleep** play on the way in, from standing, so they start on the main pose and end on Sit or Sleep. Each way down can have its own stand up (**Up from sleep**, **Up from a trip**, **Up from dizzy**, **Up from knockout**); without one she uses **Stand up**. **Roll** is drawn already rolling. Without it she spins Stand like a wheel.

A timed pose with several frames, like Wave, finishes the pass it's in before she moves on, if that takes 3 seconds or less.

The **Signature move** is a character's own: give it frames, and a `signature` entry in its buddy file can set how often it comes up and what it says.

Frames drawn on the same canvas size as the main image keep a consistent scale automatically. Every pose also has its own Speed (fps) and Scale sliders.

## Shimeji import
Drag a Shimeji folder in, or click **Import Shimeji images** and pick every image in its `img` folder (`shime1.png … shime46.png`). A dragged folder names the buddy after itself; picked images make one called Shimeji. The standard Shimeji-ee numbering is mapped to poses (see `SHIMEJI_MAP` in `packages/engine/src/data.ts`). The mapping is approximate, so adjust any pose afterwards.

## Prompt kit (AI assets + dialogue)
Open a buddy, then open **Prompt kit**. Two fields drive everything:
- **Personality & description**: who the buddy is.
- **Appearance** (optional): how the buddy looks.

1. **Dialogue.** Click **Copy dialogue prompt** and paste it into any chatbot. The prompt lists all 33 situations the buddy talks in (`SITUATIONS` in `packages/buddy-file/src/schema.ts`) and asks for JSON back in the character's voice. Paste the reply and click **Apply**. Any situation the reply leaves out keeps the default lines. If Appearance was blank, the prompt also asks for one, and Apply fills it in.
2. **Images.** Each pose frame gets a prompt built as: quality tags + "always add" style + appearance + pose + expression + framing (full body, plain white background). Pose, framing and background words in the appearance are dropped, because each pose supplies its own. An expression in the appearance becomes the buddy's default expression for neutral poses (stand, walk, sit, hang). Poses with their own emotion (cry, angry, sleep, …) replace it.
   - Two styles: **Tags** for Anima / Stable Diffusion (includes a negative prompt) and **Sentences** for chat-style image AIs.
   - Essentials (11 images) are shown first. **Show more** reveals all 31 frames.
3. **Upload generated images** named after poses (`main.png`, `walk_1.png`, `cry_2.png`, …). Plain backgrounds are removed automatically. A lone `stand.png` becomes a blink frame mixed into the idle loop.
   - **Size matching:** each pose is scaled so the character's body covers the same area as in the main image. Only the largest connected shape counts, so floating music notes, zzz or tears don't shrink it. Sitting poses get a small extra nudge (`AREA_ADJ` in `packages/maker-core/src/prompts.ts`). **Match sizes to main image** (under Pose frames) re-runs this for poses you added earlier. Fine-tune any pose with its Scale slider.

Templates live in `packages/maker-core/src/prompts.ts` (`POSE_PROMPTS`, emotion presets `E`, and the `EMO_WORDS` / `DROP_WORDS` lists).

## Buddy files
**Save buddy file** exports a `.buddy` file that holds every image and pose. **Import buddy file** loads one back in, and reads older `.buddy.json` files too. Each buddy has a `character` id, made once, that stays with it through export, import and Call Another. Older files get one on import. A file with anything unknown or out of range is refused.

## Desktop page export
**Export desktop page** (in the Everyone section) saves one `.html` file with every buddy and no editor. Images are stored once and re-encoded as WebP. On that page, right-click a buddy for **Call another**, **Chase my cursor**, **Everyone dance**, **Dismiss** and **Dismiss all**. A dismissed buddy says a goodbye line (the `bye` situation) and vanishes in stars. When everyone is gone, a **Bring buddies back** button appears. Add `#transparent` to the page's address for a see-through background (OBS browser source, wallpaper apps). The maker itself keeps the normal right-click menu.

## Group interactions
When two calm buddies meet on the floor they greet each other, hug, or bump and apologize, each in its own voice (`greet`, `hug`, `bump`, `bumped` lines).

## Debugging
In the console, `buddies.pause()`, `buddies.step(n)` and `buddies.pets` let you freeze and step the simulation. `buddies.tools` holds what the browser check calls directly. Nothing in `src` reads it.
