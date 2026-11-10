# Plan: a local API, a buddy gallery, and the app's link to it

The project manager and the owner approved these on 2026-11-09. Groundwork is local only. No gallery repo or domain is created until they say so.

## Direction, 2026-11-10
- **The repo:** open source under MIT, with no buddies included: a first run starts with an empty library, and the Manager points to Import and New buddy. Releases are `.exe` builds attached to the repo's GitHub releases, signed through SignPath once the repo is public. See `releases.md`.
- **Before the project goes on the shelf:** test the local API and the MCP server end to end, on a real PC, and polish the animations of the buddy event loop.
- **Later, as a plan:** a Desktop Buddies site on our host, below. It has a landing page, the public gallery of uploaded buddies with a moderation queue behind it, links (the GitHub repo), and a short docs page on making your own buddy and on using the local API and MCP. It follows the public-site standard: analytics and link previews, with the analytics ID injected at deploy and never kept in the repo.

## 1. A local API: apps and AI agents ask buddies to do things

### What a buddy can be asked
- **Read:** the buddies, each with id, name, whether she's out, how many copies, and which actions she can do. Also whether the app is paused or hidden.
- **Do:** visible, harmless, undoable things:
  - play an action from a fixed list (wave, dance, hearts, jump, sleep, eat, chase my mouse);
  - say a line in a speech bubble;
  - later, bring here, call and dismiss.
- **Never:**
  - reading or writing files;
  - importing, exporting or deleting a buddy;
  - changing settings, autostart or the exclude list;
  - opening links or running anything;
  - window titles, screen contents, other apps' windows;
  - the Maker.

A line an app says is plain text: at most 120 characters, a few lines a minute per app. It's marked with a small badge, so the person knows an app said it.

### How a request travels
**Now, with no new exe:** the frozen exe already hands a second launch's arguments to the running app.
- **Request:** `desktop-buddies.exe --api "<one JSON request>"`.
- **Reply:** the hub writes `api/replies/<request id>.json` in its own data folder, where all the app's reads and writes stay, and the caller reads it. Replies older than a minute are deleted.
- **If the app isn't running,** that launch starts it. The hub sees `--api` in its own start arguments, writes a "not running" reply and quits. That's a short tray flicker, accepted for now.

**An MCP server** is a small stdio script in the repo, `tools/mcp`, that turns MCP tool calls into those requests. A local model or agent (Claude Code, Claude Desktop, or any MCP host) adds it as a server. Its tools are `list_buddies`, `act` and `say`.

**With the next exe:**
- a localhost-only HTTP and WebSocket endpoint, on 127.0.0.1 with a random port written to the data folder;
- events (clicked, thrown, landed);
- a built-in `--mcp` stdio mode, so no script is needed.

That's batched with the rest of the "For the next exe" list, and needs a new Smart App Control verdict.

### Consent and safety
- **Off by default.** A Manager setting, "Let other apps ask buddies to do things", is the off switch, and Pause in the tray stops requests too.
- **Each request names its app.** The first request from a new name asks in the Manager: "<app> wants your buddies to wave and talk", Allow or Not now. The answer is remembered, and listed in Settings with Remove.
- **Be honest about what names are.** Any program on the PC can claim any name, so an app's name is a courtesy, not security. The real boundary: only programs already running as the person on this PC can ask, and every action is harmless.
- **Tokens:**
  - The command line has none. Against local programs it adds nothing.
  - HTTP, in the next exe, gets a per-install token on every request, plus a Host header check and no CORS. That stops web pages calling localhost, which is the real risk of an HTTP port.
- **Rate limits** per app, and a log line for every request.
- **Residual, until a later exe gives callers a real identity:** an app's name over a second launch is whatever the caller claims, so any local program can pose as an app that's already allowed. Consent per app is a convenience, not a security line, and the API stays limited to harmless actions until then.
- **`say` is plain text:** control characters are stripped, it's capped at 120 characters, and links are refused, so a buddy can't be made to show a phishing URL. It's never markup.
- **Replies are readable by any local program:** they hold only what's harmless to share (a buddy's id, name, whether she's out, copies, and what she can do). Never paths, settings, or other apps' names and consents.

### The first slice, groundwork now
`--api` with `list`, `act` (wave only at first) and `say`, plus:
- the off-by-default setting and per-app consent;
- reply files;
- the MCP script;
- tests.

No exe change.

## 2. A buddy gallery site
Part of the later Desktop Buddies site: a landing page, this gallery, links, and a short docs page on making a buddy and on the local API and MCP. Analytics and link previews follow the public-site standard, with the analytics ID injected at deploy, never in the repo.

### Hosting: a static site on our host
It's a static site on our host, under a sub-domain of exvanitas.ai. Its look is the project's own, laid out as a tool. Creating the site and its domain is the owner's step, when it's time.
- **A. (Recommended first)** Static.
  - A gallery repo holds the `.buddy` files and the data, and a static site is built from it and served from our host, for example buddies.exvanitas.ai.
  - **Submissions** are pull requests to that repo, and moderation is review before merge.
  - **Accounts:** GitHub accounts, only for submitting. Downloads need none.
  - **Running costs:** nothing new to run or patch on the server. Big files are served straight from the host's disk.
- **B. Later, if wanted:** a dynamic upload service on the same host, with its own login, storage and a moderation queue. More to run and police.

### Moderation and reports
- Nothing is public before review.
- Every buddy has a report link, to an issue form or email.
- An artist who finds their art can have it removed quickly, through a published takedown contact.

### Licensing, per buddy
- The site records, for each buddy, the artist's name and link, the licence and the uploader.
- The uploader confirms they drew it or have the artist's permission.
- "Art not mine" needs a permission note, or it's rejected.
- The site always credits the artist.

### The `.buddy` file stays data only
The app's reader already does most of this; the gallery adds the rest.
- **Envelope:** JSON with a version; unknown fields refused.
- **Images:** only raster images (PNG, WebP, JPEG, GIF) as data URLs, checked by their bytes. No SVG, which can carry script. No external URLs, nothing fetched.
- **Caps:**
  - file 64 MB, image 8 MB, 120 frames per pose;
  - name 64 characters, a line 300, the prompt kit 4,000;
  - new for the gallery: decoded image size, at most 2048 px a side, and a pixel budget against decompression bombs.
- **Text** is shown as text, never as HTML.
- **A validator,** `pnpm validate-buddy <file>`, runs the app's own reader plus the image checks. CI runs it on every submission, and the app can run it on import.

### Data model
For each buddy:
- **Who and what:** slug, name, artist (name, link), uploader, licence, the "art not mine" flag and its note.
- **About the file:** tags, pose count, file size, SHA-256.
- **History:** versions, created, updated.

**Files:** the `.buddy`, a thumbnail made from the main image, and an optional preview animation.

## 3. The app and the gallery
- **Browse:** a Gallery tab in the Manager reads the gallery's index. That means letting the Manager page fetch from one gallery address. Whether the app folder can allow that, or the exe's page policy blocks it, has to be checked first.
- **Download:** fetch, validate, then import through the existing library path, which validates again.
- **Share:** export a `.buddy`, then open the gallery's submit page in the browser. Opening links may need the next exe.

## Licence and brand
The app is open source and ships no buddies. The code is under MIT. The name, logo, raccoon mascot and official buddies are not covered by it: `TRADEMARKS.md` says forks rename, use their own icon, and don't ship the official buddies.

Releases are signed through SignPath's free signing for open source, once the repo is public: `releases.md` has the policy and the release workflow plan.

## Order and effort
These are rough guesses that include review.
1. **Local API slice, command line plus MCP:** 1 to 2 days. Low risk, because it's off by default with harmless actions.
2. **`.buddy` validator and safety rules:** half a day to a day. Useful now for imports.
3. **Gallery A, repo plus static site:** 2 to 3 days, after the owner creates the repo and picks a domain, and after the answers below.
4. **App browse and download:** about 2 days, after the gallery exists and the fetch question is answered.
5. **Next exe:** HTTP, events, `--mcp`, opening links, and the rest of its list. A new Smart App Control verdict.

## Open questions for the owner and the project manager
1. Which actions may apps ask for at first? Proposed: list, wave, say.
2. Should lines an app says carry a visible badge?
3. **Gallery:**
   - Public from the start, or invite-only at first?
   - Its name, and which sub-domain of exvanitas.ai?
4. Is submitting with a GitHub account fine at first?
5. Content rules: is explicit art allowed? Anything else banned?
6. Which licences should the site offer? Is "art not mine" allowed at all, and with what proof of permission?
7. Who moderates?
8. Should the project manager's name or brand be on the gallery?
