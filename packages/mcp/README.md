# adam-mcp

Local-first, read-only MCP server for University of Basel **ADAM** (ILIAS 10). Use **your** AI host (Cursor, Claude Desktop, VS Code Copilot, Windsurf, Claude Code). SWITCH edu-ID stays in Google Chrome.

This is a community project, not an official University of Basel, SWITCH, or ILIAS service. ChatGPT cannot run this stdio server.

## Install

Need **Node.js 20+** and **Google Chrome**. Until this package is on the npm registry, clone the repository and follow `docs/hosts.md` (`npm run login`, then the compiled `packages/mcp/dist/adam-mcp.mjs --browser` snippet).

After a public npm release:

```bash
npx -y adam-mcp login
```

Sign in with SWITCH edu-ID. **Leave that Chrome window open.**

Then point your MCP host at:

```json
{
  "mcpServers": {
    "adam": {
      "command": "npx",
      "args": ["-y", "adam-mcp", "--browser"]
    }
  }
}
```

Windows hosts that do not pass `npx` through: `"command": "cmd"`, `"args": ["/c", "npx", "-y", "adam-mcp", "--browser"]`.

Host-specific recipes (Cursor, Claude Desktop, VS Code, Windsurf, Claude Code), including the clone-from-git path: see the repository `docs/hosts.md`.

Never paste the SWITCH password into chat.

## What it does

Read-only courses, folders, page text, file metadata, local PDF/text extract (no bytes to the model), read-only exercises, shallow search/news/dates. Canonical ADAM URLs. No writes, mail, grades, exams, or cookie export.

Default without `--browser` is a synthetic fixture catalog (no live ADAM).

License: GPL-3.0-or-later.
