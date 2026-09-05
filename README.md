# ADAM MCP

Local-first MCP server so University of Basel students can use **their own** AI (Cursor, Claude Desktop, VS Code Copilot, Windsurf, Claude Code) with ADAM.

This is a community project, not an official University of Basel, SWITCH, or ILIAS service. It cannot bypass ADAM permissions. Do not paste SWITCH edu-ID passwords into a model, a terminal, or this repo.

**ChatGPT cannot run this server.** ChatGPT only speaks remote HTTPS MCP. We will not tunnel your ADAM session to the public internet.

Product rules: [`docs/product-spec.md`](docs/product-spec.md). Threat model: [`docs/threat-model.md`](docs/threat-model.md).

## Quick start (one path)

Need **Node.js 20+** and **Google Chrome**.

```bash
git clone https://github.com/Arudchayan/adam-mcp.git
cd Adam_MCP
npm install
npm run setup
npm run login
```

`npm run setup` builds the CLI and prints **absolute-path** MCP snippets for this machine (Cursor, Claude Desktop, Windsurf, VS Code, Claude Code). Paste one snippet into the host. Then sign in with SWITCH edu-ID in the Chrome window and **leave that window open**.

Host details: [`docs/hosts.md`](docs/hosts.md).

Fully quit and reopen the host. Ask: `Using the ADAM tools, list my courses. Include the ADAM URL for each. Do not guess.`

Default without `--browser` is a **synthetic fixture** catalog (no live ADAM). The printed snippets pass `--browser`.

When `adam-mcp` is on npm, the same flow is `npx -y adam-mcp login` plus `"args": ["-y", "adam-mcp", "--browser"]` (Windows: `cmd /c`). Until then, do not guess a registry install.

## What it does

Read-only study workspace: courses, folders, page text (with confirmation), file **metadata**, local PDF/text extract (with confirmation; never bytes), read-only exercises, search/news/dates from the dashboard and enrolled course pages (not ADAM’s global search or calendar GUI), session login/status. Canonical `/go/{type}/{ref_id}` links. No writes, no mail, no grades, no exam objects, no PDF bytes to the model.

Tools, resources (`adam://me/courses`, `adam://crs/{refId}`, `adam://fold/{refId}`, `adam://file/{refId}`, `adam://exc/{refId}`), and prompts (`prepare_my_week`, `what_changed`, `study_this`) are listed in `docs/product-spec.md`.

## Safety

- SWITCH stays in Chrome. Cookies are not exported.
- Tool results go to **your** configured model provider and may leave Switzerland. You choose the host.
- Course content is copyrighted and untrusted (prompt injection). Cite ADAM URLs. Do not submit assessed work from the model.
- Live navigations are rate-limited. `robots.txt` search/calendar crawls are not used.

## Develop

```bash
npm test
npm run typecheck
```

License: GPL-3.0-or-later. See `LICENSE` and `NOTICE`.
