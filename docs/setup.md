# Setup

Need Node.js 20+ and Google Chrome. From the repo:

```bash
npm install
npm run setup
```

That builds `packages/mcp/dist/adam-mcp.mjs` and prints snippets with **absolute** paths. Paste into the host. No `cwd` required.

**Install path today:** clone + `npm run setup`. npm publish of `adam-mcp` 0.1.0 is **paused** — do not use `npx adam-mcp` as if it works ([scope.md](scope.md), [ROADMAP.md](ROADMAP.md)).

## Fixture vs live ADAM

`npm run setup` prints two snippets:

- **Fixture** — synthetic catalog. No Chrome login. Use this to confirm the client can call tools.
- **Live ADAM** — same binary with `--browser`. Then:

```bash
npm run login
```

Sign in to ADAM in the Chrome window. After success the window closes and a **detached headless session** keeps ADAM alive; `npm run login` returns to your prompt. The MCP server attaches to that session, so restarting the host does not require re-login.

- `npm run status` - check the session (never opens a window)
- `npm run logout` - stop the headless session
- `npm run logout -- --purge` - also delete the local Chrome profile

ADAM cookies live in RAM inside the headless Chrome process only. After a reboot or a SWITCH timeout, run `npm run login` again. `ADAM_BROWSER_HEADED=1 npm run login` keeps the headed window in-process for debugging instead of handing off to the headless session.

## Common hosts

| Host | Where to paste |
| --- | --- |
| Cursor / Claude Desktop / Windsurf | `mcpServers.adam` object from `npm run setup` |
| VS Code (GitHub Copilot MCP) | `servers.adam` in `.vscode/mcp.json` or user MCP profile |
| Claude Code | printed `claude mcp add` line |

Windows hosts that do not pass `node` through need `cmd /c` (the printed Windows snippet already does this). Fully quit and reopen the host (or reload the VS Code window). Enable the **adam** server.

## First checks

1. Fixture snippet → `adam_list_courses` (synthetic titles; no login).
2. Live: `npm run login` → `--browser` snippet → `adam_session_status` should look signed in.
3. `adam_list_courses` — titles plus `https://adam.unibas.ch/go/crs/{ref_id}`.
4. `adam_read_page` / `adam_extract_file_text` / `adam_get_exercise` with `confirm: true` only for an object you asked to read.

### Failure symptoms

| Symptom | Likely cause |
| --- | --- |
| `unauthorized` / login-required | Run `npm run login`; check `npm run status` |
| `listingState: unknown` | Blank ILIAS content area — do not call it empty; open ADAM URL |
| Tools missing `adam_login` | Fixture provider hides browser-only session tools — expected |
