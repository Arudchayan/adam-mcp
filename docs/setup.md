# Setup

Need Node.js 20+ and Google Chrome. From the repo:

```bash
npm install
npm run setup
```

That builds `packages/mcp/dist/adam-mcp.mjs` and prints snippets with **absolute** paths. Paste into the host. No `cwd` required.

## Fixture vs live ADAM

`npm run setup` prints two snippets:

- **Fixture** — synthetic catalog. No Chrome login. Use this to confirm the client can call tools.
- **Live ADAM** — same binary with `--browser`. Then:

```bash
npm run login
```

Sign in to ADAM in the Chrome window and leave it open. `npm run status` checks the session.

After publish of `adam-mcp` 0.1.0, `npx -y adam-mcp` / `npm i -g adam-mcp` work: the pack is self-contained (`dist` bundles workspace code). Clone + `npm run setup` still prints absolute-path host snippets and `npm run login` helpers.

## Cursor, Claude Desktop, Windsurf

Paste the JSON object printed by `npm run setup` (`mcpServers.adam`).

Windows hosts that do not pass `node` through need `cmd /c` (the printed Windows snippet already does this).

Fully quit and reopen the host. Enable the **adam** server.

## VS Code (GitHub Copilot)

Workspace `.vscode/mcp.json` or the user MCP profile. `npm run setup` prints a `servers.adam` object.

Reload the window and enable the server in Copilot MCP settings.

## Claude Code

`npm run setup` prints a `claude mcp add` line with the absolute path.

## First checks

1. `adam_session_status` — fixture reports synthetic; live ADAM should look signed in.
2. `adam_list_courses` — titles plus `https://adam.unibas.ch/go/crs/{ref_id}`.
3. `adam_read_page` / `adam_extract_file_text` with `confirm: true` only for an object you asked to read.
