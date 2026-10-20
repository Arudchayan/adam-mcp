# Setup

Need Node.js 22+ and Google Chrome. From the repo:

```bash
npm install
npm run setup -- --client codex --write --login
```

Choose `codex`, `cursor`, `claude-desktop`, `windsurf`, or `vscode`. This builds the server, checks prerequisites, installs the selected configuration with a backup, and verifies sign-in and the course listing. Restart the client and enable **adam**.

`npm run setup -- --client codex` previews only. `--output <path>` chooses a configuration file; it is written only with `--write`. Existing malformed files, directories and symlink targets are refused. Unrelated settings and per-tool approval preferences are preserved. Existing configuration is copied to an adjacent `.adam-backup-<id>` file before installation. TOML/JSON formatting and comments may change; the backup keeps the original bytes. Protect backups as carefully as the original configuration, since other servers may have credentials in it.

To restore, close the client and copy the backup over its configuration file. `--login` can be used separately from `--write`. No sign-in or configuration change is triggered by diagnostics or preview.

For a packaged install, use `adam-mcp setup --client codex --write --login`. The registry release remains pending. The old all-snippet/manual setup path is still available with `npm run setup` in a noninteractive terminal.

## Diagnose a connection

Run `npm run doctor -- --client codex` (packaged: `adam-mcp doctor --client codex`). Add `--json` for machine-readable checks. Doctor checks Node, Chrome in standard locations, the server entry, profile accessibility, the selected config and passive session status. It never starts Chrome. Missing sign-in is a warning, not a broken installation. Fix prerequisite errors before installing configuration.

Session states: `connected` is verified; `disconnected` may have an unverified saved profile; `signing-in` means finish or close the existing window; `signed-out` means explicit local logout. `reason` remains available for existing clients. Run login to verify saved sign-in or open a fresh window when needed.

## Client timeouts

Generated Codex configuration uses an absolute Node executable and entry path, `startup_timeout_sec = 30` and `tool_timeout_sec = 2100`. The latter allows the maximum 30-minute interactive login plus five minutes for queue waiting, browser startup, verification and cleanup; ordinary discovery still has a two-minute server budget. CLI login is the fallback for hosts with shorter timeouts. Do not add undocumented timeout fields to other client configurations. See [the compatibility matrix](client-compatibility.md).

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

When already signed in, login returns without opening a window. Close the sign-in
window or press Ctrl+C to cancel. `npm run login -- --force` opens a fresh window;
`npm run login -- --timeout-ms 120000` limits the interactive wait to two minutes.
`npm run logout` disables automatic reconnection until explicit login. Add
`-- --purge` to remove the dedicated profile. These local commands do not sign you
out of SWITCH in other browsers. See [session recovery](session-recovery.md).

- **Live ADAM** is the only runtime. Chrome is for interactive login and the headless holder. Host config is the snippet from `npm run setup` (see [AGENTS.md](../AGENTS.md)).
- **After editing source:** if the host points at `packages/mcp/dist/adam-mcp.mjs`, rebuild (`npm run build` or `npm run setup`) so the host picks up changes.
- **Live session broken?** Order: `npm run status` / `adam-mcp status` → note `holderPid` → `npm run login` again → if needed `ADAM_BROWSER_HEADED=1 npm run login` → for listing markup only, `ADAM_DEBUG_CAPTURE=1` (structure-only under `scratch/` / `ADAM_DEBUG_CAPTURE_DIR`; never commit captures).
- **Telemetry:** each tool call logs one JSON line to stderr with a `runId` you can correlate with host errors (ADR 0008); stdout stays JSON-RPC only.

## Hosts

These hosts attach a local stdio server today: **Cursor**, **Claude Desktop**, **VS Code** (GitHub Copilot), **Windsurf**, **Claude Code**, the **ChatGPT desktop app**, **Codex CLI**, and the **Codex IDE extension**. Paste the snippet from `npm run setup` (sections below). Fully quit and reopen the host, then enable **adam**.

## Cursor, Claude Desktop, Windsurf

Paste the JSON object printed by `npm run setup` (`mcpServers.adam`).

Generated configuration starts the absolute Node executable directly, so spaces in paths are separate arguments and GUI PATH differences do not affect it.

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

Use the generated table or `setup --client codex --write` so paths and timeout settings match this machine. ADAM login is available through `npm run login` or setup's `--login` option.

## First checks

1. `adam_session_status` — live ADAM should look signed in after `npm run login`.
2. `adam_list_courses` — titles plus `https://adam.unibas.ch/go/crs/{ref_id}`.
3. `adam_read_page` / `adam_extract_file_text` with `confirm: true` only for an object you asked to read.
