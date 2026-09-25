# Setup

Need Node.js 20+ and Google Chrome. From the repo:

```bash
npm install
npm run setup
```

That builds `packages/mcp/dist/adam-mcp.mjs` and prints snippets with **absolute** paths. Paste into the host. No `cwd` required.

## Live ADAM

`npm run setup` prints one snippet: live ADAM (browser is the default; `--browser` is optional). Then:

```bash
npm run login
```

Sign in to ADAM in the Chrome window. After success the window closes and a **detached headless session** keeps ADAM alive; `npm run login` returns to your prompt. The MCP server attaches to that session, so restarting the host does not require re-login.

If the holder is gone but the Chrome profile is still signed in, the next tool call resumes a headless session (ADR 0017). If ADAM shows the login page, run `npm run login` again.

- `npm run status` - check the session (never opens a window)
- `npm run logout` - stop the headless session
- `npm run logout -- --purge` - also delete the local Chrome profile

After a reboot or a SWITCH timeout, run `npm run login` again if resume does not find a signed-in dashboard. `ADAM_BROWSER_HEADED=1 npm run login` keeps the headed window in-process for debugging instead of handing off to the headless session.

**Install today:** Git tag `v0.2.0` may exist, but `adam-mcp` is **not** on the npm registry yet — `npx -y adam-mcp` / `npm i -g adam-mcp` do not work. Clone this repo and run `npm run setup` (absolute-path host snippets + login helpers). npm publish waits on the [SECURITY.md](../SECURITY.md) checklist. After a future publish, the pack is self-contained (`dist` bundles workspace code).

## Operators (rebuild, incidents)

- **Live ADAM** is the only runtime. Chrome is for interactive login and the headless holder. Host config is the snippet from `npm run setup` (see [AGENTS.md](../AGENTS.md)).
- **After editing source:** if the host points at `packages/mcp/dist/adam-mcp.mjs`, rebuild (`npm run build` or `npm run setup`) so the host picks up changes.
- **Live session broken?** Order: `npm run status` / `adam-mcp status` → note `holderPid` → `npm run login` again → if needed `ADAM_BROWSER_HEADED=1 npm run login` → for listing markup only, `ADAM_DEBUG_CAPTURE=1` (structure-only under `scratch/` / `ADAM_DEBUG_CAPTURE_DIR`; never commit captures).
- **Telemetry:** each tool call logs one JSON line to stderr with a `runId` you can correlate with host errors (ADR 0008); stdout stays JSON-RPC only.

## Hosts

These hosts attach a local stdio server today: **Cursor**, **Claude Desktop**, **VS Code** (GitHub Copilot), **Windsurf**, **Claude Code**, the **ChatGPT desktop app**, **Codex CLI**, and the **Codex IDE extension**. Paste the snippet from `npm run setup` (sections below). Fully quit and reopen the host, then enable **adam**.

ChatGPT on the web cannot attach this server. It only uses remote plugin MCP and does not read `~/.codex/config.toml`. This repo does not ship a remote HTTP or SSE transport, and it does not put MCP OAuth on stdio. ADAM login stays `npm run login` and the local Chrome profile.

## Cursor, Claude Desktop, Windsurf

Paste the JSON object printed by `npm run setup` (`mcpServers.adam`).

Windows hosts that do not pass `node` through need `cmd /c` (the printed Windows snippet already does this).

Fully quit and reopen the host. Enable the **adam** server.

## VS Code (GitHub Copilot)

Workspace `.vscode/mcp.json` or the user MCP profile. `npm run setup` prints a `servers.adam` object.

Reload the window and enable the server in Copilot MCP settings.

## Claude Code

`npm run setup` prints a `claude mcp add` line with the absolute path.

## ChatGPT desktop, Codex CLI, and the Codex IDE extension

The ChatGPT desktop app, Codex CLI, and the Codex IDE extension share `~/.codex/config.toml` and can start this local stdio process. `npm run setup` prints:

```toml
[mcp_servers.adam]
command = "node"
args = ["<absolute path to packages/mcp/dist/adam-mcp.mjs from npm run setup>"]
```

Paste that table into `~/.codex/config.toml`. Windows hosts that do not pass `node` through need `cmd /c` (the printed Windows snippet already does this).

There is no MCP OAuth. ADAM login stays `npm run login` and the local Chrome profile. Do not set `experimental_environment = "remote"` (that would start the process off the machine, away from the Chrome profile).

## First checks

1. `adam_session_status` — live ADAM should look signed in after `npm run login`.
2. `adam_list_courses` — titles plus `https://adam.unibas.ch/go/crs/{ref_id}`.
3. `adam_read_page` / `adam_extract_file_text` with `confirm: true` only for an object you asked to read.
