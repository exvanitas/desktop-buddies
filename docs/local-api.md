# The local API

Other apps and local AI agents on this PC can ask buddies to do harmless things: list them, make one wave, or show a line in her bubble. It's off until the person turns it on, each app is asked about once, and nothing is reachable from outside the PC. This is the first slice, on the frozen exe, with no exe change. The plan is `roadmap-plan.md`, section 1.

Code: `apps/desktop/src/local-api.ts` decides each request, `api-replies.ts` writes replies, and `hub-core.ts` wires them in. `tools/mcp` is an MCP server on top.

## How a request travels
- **Request:** `desktop-buddies.exe --api "<one JSON request>"`. The exe's single-instance lock hands a second launch's arguments to the running app as `second-launch`, and that launch exits.
- **Reply:** the app writes it to one of 64 fixed slots, `api/replies/<slot>.json` in its data folder, by default `%APPDATA%\dev.exvanitas.desktop-buddies`. Writes are whole, so a file that's there is complete. The caller polls its slot until it holds a reply with its own `id`. See [Reply slots](#reply-slots).
- **App not running:** the launch starts the app. Its hub sees `--api` in its own start arguments, writes a `not-running` reply and quits, before it reads settings, seeds the library, opens the Manager or calls anyone out. It has 2 seconds to write it, then quits whatever happened. That's a short tray flicker.
- **The API never imports.** No request reads, writes or opens a file. But the exe opens any launch argument ending in `.buddy` or `.buddy.json` as a file, which is how a double-click works, and it does that on every launch, `--api` or not. Such a file goes through the app's ordinary file-open, which imports it, or opens the Manager to say why it couldn't. That path is outside the API: any local program can use it by launching the exe with a path, with or without `--api`. Telling the two apart in the app protects nothing, so it doesn't try.
- **No network.** No listener of any kind, on any address.

## Request
Strict JSON: one object, at most 2048 bytes as UTF-8, with exactly the keys its action takes. Anything else is refused.

| Key | Value |
|---|---|
| `v` | `1` |
| `id` | 8 to 64 of `a-z 0-9 _ -`, lower case only, since Windows would take two ids that differ only in case for one file. It names the reply file, so a lower-case UUID is ideal. |
| `app` | The app's name, shown to the person: at most 40 characters of letters, digits, `.`, `_` and `-`, with single spaces between words. |
| `do` | `list`, `act` or `say` |
| `buddy` | For `act` and `say`: her id, from `list` |
| `action` | For `act`: `wave` |
| `text` | For `say`: the line |

```
{"v":1,"id":"6f1c2e4a-0d1b-4c55-9a1e-3f0b7c2d9e10","app":"Claude Code","do":"say","buddy":"colive0seed","text":"Tests pass!"}
```
Its reply lands in `api/replies/29.json`.

## Actions
- **`list`:** every buddy as `{ id, name, out, copies, can }`. `can` is which of the API's actions she has art for.
- **`act`:** `wave`, on every copy of her that's out, through the same route as the Manager's actions. The allow list is `API_ACTIONS` in `local-api.ts`.
- **`say`:** one line in her speech bubble, on her first copy, under a small badge that says "From <app>". The line is cleaned first: control and invisible formatting characters are stripped, line breaks and tabs become spaces, and runs of space are one. Then it must be 1 to 120 characters and have nothing that looks like a link: a scheme (`https://`, `ftp://`), `www.`, `xn--`, or a domain, which is a label, a dot and a TLD of two or more letters (`example.com`, `bit.ly`). Dots that look like dots (`。`, `．`, `｡` and others) count as dots, and it's checked again on a folded copy, so wide or styled letters can't hide one. Sentences, decimals and short abbreviations pass: `Done. Next`, `3.14`, `e.g.`, `U.S.A.`. So does nothing like a file name: `server.js` is refused, as it reads like a domain. The bubble sets text, never markup.

## Reply
```
{"v":1,"id":"…","ok":true}
{"v":1,"id":"…","ok":true,"buddies":[{"id":"colive0seed","name":"Olive","out":true,"copies":1,"can":["wave"]}]}
{"v":1,"id":"…","ok":false,"error":"waiting","message":"Waiting for the person to allow this app in the Manager."}
```
Any program on the PC can read the replies folder. **So a reply holds only these fields:** `v`, `id`, `ok`, and `buddies` with `id`, `name`, `out`, `copies` and `can`, or `error` and `message`. Never a path, a setting, another app's name or answer, a window title or anything on screen. A test checks every reply against this list.

A request with no usable `id`, or too big to read, gets no reply.

## Errors
| `error` | When |
|---|---|
| `bad-request` | Not JSON, not an object, a wrong or missing key, a key that isn't allowed, a wrong type, or a bad `app`, `buddy` or `v` |
| `too-big` | Over 2048 bytes. Never read, so it has no reply |
| `unknown-action` | A `do` or `action` that isn't offered |
| `not-ready` | The app is still reading the library |
| `off` | The person hasn't turned this on |
| `paused` | Buddies are paused from the tray or the Manager |
| `rate-limited` | Over a limit below |
| `waiting` | A new app: the person is being asked |
| `busy` | Three apps are waiting to be asked already |
| `not-allowed` | The person said Not now |
| `no-buddy` | No buddy has that id |
| `not-out` | She's at home |
| `hidden` | Buddies are hidden, so `act` and `say` would show nothing |
| `cant-do` | She has no art for that action |
| `too-long`, `empty`, `link` | The line, after cleaning |
| `not-running` | The launch started the app, which then quit |
| `full` | The person has answered 100 apps, which is as many as are kept. Removing one makes room |

## Consent
- **Off by default.** Settings, "Let other apps ask buddies to do things". Off also forgets who's waiting. Pause stops requests too.
- **Each app is asked once.** The first request from a new name opens the Manager to a question at the top of the sheet: "<app> wants your buddies to wave and talk", Allow or Not now. Until then every request from it gets `waiting`. At most three apps wait at once.
- **Answers are remembered** in `settings.json` as `apiApps`, matched by name in any case, and listed in Settings with Remove. Removing an answer means that app is asked again. Up to 100 are kept, and none is ever dropped to make room: past that, a new app gets `full`.
- **An API launch never opens the Manager**, except to ask about a new app.

**Names are a courtesy, not security.** Any program on this PC can claim any name, including one the person has allowed. The real line is that only programs already running as the person on this PC can ask at all, and everything they can ask for is visible, harmless and gone in seconds. Until there's real caller identity, which needs the next exe, this API offers nothing more than that.

## Limits
- 30 requests a minute from one app, and 4 lines a minute. Only an app the person has answered has counters, so a made-up name costs nothing to keep.
- 60 requests a minute from everyone, since names are free. At most 256 counters are kept at once, and expired ones go on every request.
- Limits go by a monotonic clock, so moving the PC's clock changes nothing.
- The replies folder never holds more than 64 replies: see below.
- The log says what was asked and what came of it, never the app or the words. The exe itself logs every second launch's arguments, so a request does appear in its own log line. That's the frozen exe, and the log stays in the data folder.

## Reply slots
- A reply's slot is FNV-1a (32-bit, offset basis `0x811c9dc5`, prime `0x01000193`) over the id's characters, which are all ASCII, mod 64, written as two digits: `api/replies/07.json`. `slotOf` in `api-replies.ts` and in `tools/mcp/server.mjs` agree, and a test checks it.
- The reply carries its full `id`. A caller reads its slot and takes the reply only if the id is its own. Anything else there is an older reply, or another request's.
- **Two ids can share a slot.** If another request's reply lands there after yours, yours is overwritten, and you time out. With fresh UUIDs that's rare. The MCP server tries once more with a fresh id when it saw that happen.
- Each slot has at most one write in flight, and a newer reply for a slot replaces one waiting, so the app never holds more than 64 replies to write.
- Nothing is swept, counted or adopted: the folder holds at most 64 replies, from this run or any earlier one, and each is overwritten in time. The folder belongs to the API.
- One limit the app can't lift: if the app is stopped in the middle of the exe writing a reply, the exe can leave a hidden temp file (`.~pid-n`) in the folder, and nothing clears it. That's at most one small file per such stop. Sweeping them is on the next exe's list.

## Never
Paths or files, import, export or delete, settings, autostart or the exclude list, links, running anything, window titles, screen contents, other apps' windows, or the Maker. No request changes a buddy, the library or settings: only the person's answers in the Manager do.

## The MCP server
`tools/mcp/server.mjs`, a small stdio server with tools `list_buddies`, `wave` and `say`. It reads input as bytes and handles one message at a time, with input paused meanwhile, so nothing piles up. A message can be at most 64 KB as bytes, not counting its line end, and a longer one is refused as soon as it's past that and skipped. Ids must be a short string or a number. If writing to the host fails, it stops with exit code 1. Its reply deadline is monotonic. See [its README](../tools/mcp/README.md).

## With the next exe
- A localhost-only HTTP endpoint on 127.0.0.1, on a random port written to the data folder, with a per-install token on every request, a Host header check and no CORS, so web pages can't call it.
- A WebSocket for events: clicked, thrown, landed.
- A built-in `--mcp` stdio mode, so no script is needed.
- Caller identity of some kind, before anything less harmless is offered.

That's batched with the rest of the next exe's list, and needs a new Smart App Control verdict.
