# Security

## What runs on your PC
- **No network.** The desktop app, the Maker and an exported page fetch nothing and send nothing: no accounts, analytics, update checks or telemetry. This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. Fonts and images are bundled or come from your own files.
- **Your windows.** To let buddies walk on your windows, the app reads which windows are open, where they are, and which program each belongs to. It never reads titles or what's in them, and none of it leaves your PC.
- **Buddy files** are data only: JSON with raster images inside. The reader refuses unknown fields, SVG, external URLs and anything over its size limits, and text in a buddy is always shown as text. `docs/buddy-format-safety.md` has the rules, and `pnpm validate-buddy <file>` checks a file the same way.

## The local API
Other programs on your PC can ask buddies to do small, visible, harmless things: list them, make one wave, or say a line. See `docs/local-api.md`.
- It's **off by default**. Settings turns it on, and Pause in the tray stops requests.
- A request is a second launch of the exe with `--api "<json>"`. There's **no listener** of any kind, on any address, so nothing outside your PC can reach it.
- The first request from each app name asks you in the Manager. An app's name is whatever the caller says, so consent per app is a courtesy, not a security boundary. That's why the API only allows harmless actions: it never reads or writes files, imports, exports or deletes a buddy, changes settings, opens links or runs anything.
- Replies are files in the app's data folder, holding only what's harmless to share.

## The MCP server
`tools/mcp` is a small Node script on stdio that turns MCP tool calls into those same `--api` requests. It has no dependencies and opens no port. It can do only what the local API allows, and only once you've turned the API on and allowed the app.

## The exe isn't signed
Windows may warn about it, and Smart App Control may block it. Build it yourself from this source if you'd rather not trust a download.

## Reporting a problem
Please don't open a public issue for a security problem. Use GitHub's private vulnerability reporting on this repository (Security, then Report a vulnerability). Say what you found, how to reproduce it, and which version or commit. We'll answer as soon as we can.
