# Desktop Buddies MCP server

Lets Claude Code, Claude Desktop or any MCP host list your buddies, make one wave, or show a line in her bubble. It's one Node file on stdio, with no dependencies and no network: each tool call launches `desktop-buddies.exe --api "<request>"` and reads the reply file the app writes. The protocol is plain JSON-RPC, since that's smaller than the MCP SDK for three tools. The request format is in [docs/local-api.md](../../docs/local-api.md).

Tools: `list_buddies`, `wave` (`buddy`), `say` (`buddy`, `text`).

## First
1. Install Node 22 or later.
2. In the Manager, Settings, turn on "Let other apps ask buddies to do things".
3. The first call asks in the Manager whether to allow the app. Until you pick Allow, calls say they're waiting.

## Options
| Flag | Environment | Default |
|---|---|---|
| `--exe` | `BUDDIES_EXE` | `%LOCALAPPDATA%\Desktop Buddies\desktop-buddies.exe`. Set it to wherever you unzipped the app. |
| `--data` | `BUDDIES_DATA` | `%APPDATA%\dev.exvanitas.desktop-buddies` |
| `--app` | `BUDDIES_APP` | `AI agent`, the name the Manager shows |
| `--timeout` | `BUDDIES_TIMEOUT_MS` | `10000` milliseconds to wait for a reply |

## Claude Code
```
claude mcp add desktop-buddies -s user -- node C:\path\to\desktop-buddies\tools\mcp\server.mjs --exe "C:\path\to\desktop-buddies.exe" --app "Claude Code"
```

## Claude Desktop
In `%APPDATA%\Claude\claude_desktop_config.json`, then restart Claude Desktop:
```json
{
  "mcpServers": {
    "desktop-buddies": {
      "command": "node",
      "args": ["C:\\path\\to\\desktop-buddies\\tools\\mcp\\server.mjs", "--exe", "C:\\path\\to\\desktop-buddies.exe", "--app", "Claude Desktop"]
    }
  }
}
```

## Good to know
- The app's name is a courtesy: any program can claim any name. Only allow names you expect.
- A line is plain text, at most 120 characters, with no links, and an app gets a few a minute.
- If the app isn't running, a call starts it, which says "not running" and quits straight away. Start it yourself first.
- Calls go one at a time: each waits for the one before, up to the timeout.

## Tests
`pnpm test` from the repository root runs `tests/server.test.mjs`, against a stand-in exe. `tests/drive.mjs` is a small MCP host that the Windows end-to-end run uses against the real exe, and `tests/drive.test.mjs` runs it against the stand-in.
