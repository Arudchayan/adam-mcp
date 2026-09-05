# Host setup

`adam-mcp` is a **local stdio** process. The host launches it; SWITCH edu-ID stays in Google Chrome. ChatGPT cannot spawn stdio and is **unsupported**. Do not tunnel the ADAM session.

## 1. One command for host JSON

```bash
npm install
npm run setup
```

That builds `packages/mcp/dist/adam-mcp.mjs` and prints snippets with **absolute** paths for this computer. Paste into the host. No `cwd` required.

Then:

```bash
npm run login
```

Complete SWITCH edu-ID in the Chrome window. **Leave that window open** (closing Chrome drops the SWITCH session). Cookies stay in `~/.adam-mcp/chrome-profile` and are never exported.

Check: `npm run status`

## 2. Compiled CLI

`npm run setup` already ran `npm run build`. Manual rebuild: `npm run build`.

Until npm publish, use the printed absolute path. Cursor and other hosts may start the process from a different working directory; absolute `node …/adam-mcp.mjs --browser` avoids that.

## Cursor

Run `npm run setup` and paste the **Cursor / Claude Desktop / Windsurf** JSON (absolute `node` path). That is the supported snippet.

Manual fallback if you did not run setup:

```json
{
  "mcpServers": {
    "adam": {
      "command": "node",
      "args": ["packages/mcp/dist/adam-mcp.mjs", "--browser"],
      "cwd": "/absolute/path/to/Adam_MCP"
    }
  }
}
```

**Windows**

```json
{
  "mcpServers": {
    "adam": {
      "command": "cmd",
      "args": ["/c", "node", "packages/mcp/dist/adam-mcp.mjs", "--browser"],
      "cwd": "C:\\absolute\\path\\to\\Adam_MCP"
    }
  }
}
```

Fully quit and reopen Cursor. Enable the **adam** server. Ask: `Using the ADAM tools, list my courses. Include the ADAM URL for each. Do not guess.`

Contributor path without a build: `npx tsx packages/mcp/src/index.ts --browser` with the same `cwd` (Windows: `cmd /c npx tsx ...`).

## Claude Desktop

Config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Use the same `mcpServers.adam` object as Cursor (Windows still needs `cmd /c`). Restart Claude Desktop after saving.

## VS Code (GitHub Copilot)

Workspace file `.vscode/mcp.json` or the user MCP profile:

```json
{
  "servers": {
    "adam": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/packages/mcp/dist/adam-mcp.mjs", "--browser"]
    }
  }
}
```

On Windows, if `node` is not on PATH for the Copilot agent, use `"command": "cmd"` and `"args": ["/c", "node", "${workspaceFolder}/packages/mcp/dist/adam-mcp.mjs", "--browser"]`.

Reload the window. Enable the ADAM server in Copilot MCP settings.

## Windsurf

Windsurf uses a Cursor-like `mcpServers` map. Paste the Cursor snippet (Windows: `cmd /c`). Restart Windsurf.

## Claude Code

From the repo after `npm run build`:

```bash
claude mcp add adam -- node /absolute/path/to/Adam_MCP/packages/mcp/dist/adam-mcp.mjs --browser
```

Windows (Command Prompt):

```bat
claude mcp add adam -- cmd /c node C:\absolute\path\to\Adam_MCP\packages\mcp\dist\adam-mcp.mjs --browser
```

## What to try first

1. `adam_session_status` — should look signed in.
2. `adam_list_courses` — titles plus `https://adam.unibas.ch/go/crs/{ref_id}`.
3. `adam_read_page` / `adam_extract_file_text` only with `confirm: true` after you asked to read that object.

Never paste the SWITCH password into chat, a terminal prompt from the model, or an MCP tool argument.
