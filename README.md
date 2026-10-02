# ADAM MCP

[![ci](https://github.com/Arudchayan/adam-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Arudchayan/adam-mcp/actions/workflows/ci.yml)

ADAM MCP connects MCP-compatible AI clients to your University of Basel ADAM courses.

It runs on your machine. Cursor, Claude Desktop, VS Code Copilot, Windsurf, Claude Code, the ChatGPT desktop app, Codex CLI, and the Codex IDE extension can list courses, read pages, find files, and surface deadlines from ADAM.

This is a community project, not a University of Basel service.

![Demo](docs/demo/demo.gif)

[YC marketing demo (~90s, chat UX)](docs/demo/adam-mcp-demo-yc.mp4) · [Legacy Inspector cut](docs/demo/adam-mcp-demo.mp4)

## What you can ask

- What changed in my courses this week?
- What deadlines do I have?
- Find the exercise sheet about Fourier transforms.
- Summarize this course page and give me the ADAM link.
- List the material available for this course.

Answers include canonical ADAM URLs (`https://adam.unibas.ch/go/...`).

## Quick start

You need Node.js 20+ and Google Chrome.

Default tested path: clone → `npm run setup` (absolute path) → `npm run login` → `adam_session_status` → `adam_list_courses`. Use this path; the registry `npx` path below is untested until publish.

### From the registry (after publish, untested until publish)

`packages/mcp` ships a self-contained CLI: workspace packages are bundled into `dist/adam-mcp.mjs`; runtime deps are only `@modelcontextprotocol/server`, `playwright-core`, and `zod`. Once `adam-mcp@0.2.0` is published:

```bash
npx -y adam-mcp
# or
npm install -g adam-mcp
adam-mcp
```

Default is live ADAM. Run `npm run login` once, then start the server (see [docs/setup.md](docs/setup.md)). `--browser` is optional.

### Clone (default tested path: setup helpers + host snippets)

```bash
git clone https://github.com/Arudchayan/adam-mcp.git
cd adam-mcp
npm install
npm run setup
```

`npm run setup` prints MCP snippets with **absolute paths** for this computer. Paste one into your client.

- **Your real courses:** paste the snippet from `npm run setup`, then `npm run login` and sign in to ADAM in Chrome. The window closes automatically; the session continues headless. After login, check `adam_session_status`, then call `adam_list_courses` (cold-start: always re-check status after login before listing).

Restart the client, then ask:

> What courses am I in? Include the ADAM URL for each.

Host-specific files (Cursor, Claude Desktop, VS Code, Windsurf, Claude Code, ChatGPT desktop, Codex): [docs/setup.md](docs/setup.md).

## How it works

```
AI client  --stdio MCP-->  adam-mcp  -->  Chrome session  -->  adam.unibas.ch
```

ADAM MCP uses a local Chrome session for ADAM authentication. The default runtime is live ADAM.

[Architecture](docs/architecture.md) · [What is in scope](docs/scope.md) · [Capabilities](docs/capabilities.md) · [Roadmap](docs/ROADMAP.md)

## Tools

| Tool | Returns |
| --- | --- |
| `adam_list_courses` | Enrolled courses and ADAM URLs |
| `adam_get_course` / `adam_list_children` | Course snapshot and folder contents |
| `adam_read_page` | Page text (`confirm: true` OR elicitation) |
| `adam_list_files` / `adam_get_file` | File metadata and URLs, not bytes |
| `adam_extract_file_text` | Local PDF/text extract (`confirm: true` OR elicitation) |
| `adam_search` | Title matches in enrolled objects |
| `adam_list_calendar` / `adam_list_news` | Dates and news from pages you can see |
| `adam_get_exercise` | Exercise text and deadline (`confirm: true` OR elicitation); no submit |
| `adam_get_forum` | Forum meta and thread summaries; post bodies need `confirm: true` OR elicitation; no post/reply |
| `adam_login` / `adam_session_status` | Chrome session (`--browser` only; fixture hides them) |

Confirm decision table — Confirm contract: pass confirm:true OR approve elicitation; hosts without elicitation require confirm:true; decline/cancel → same confirmation_required, no data; forum needs gate only with threadId. Recipe: {"refId":"...","confirm":true}.

| Case | Action |
| --- | --- |
| Body tools (`adam_read_page`, `adam_extract_file_text`, `adam_get_exercise`, `adam_get_forum` with `threadId`) | Pass `confirm: true` OR approve elicitation |
| Host without elicitation | `confirm: true` is required |
| Decline / cancel | Same `confirmation_required`, no data |
| `adam_get_forum` without `threadId` | No confirm (summaries only) |

Chooser: `adam_get_course` = snapshot + child summary (not inventory); `adam_list_children` = all child types; `adam_list_files` = files-only; `adam://` handles = cite-only (`adam://exc` metadata-only, no bodies — use `adam_get_exercise` for bodies; `adam://frm` summaries-only, no posts — use `adam_get_forum` with `threadId` for posts; `fold` is a folder type, not an exercise); bodies = confirm-gated tools.

| No-handle output | What to do |
| --- | --- |
| Page rows | Use `adam_read_page` + cite `https://adam.unibas.ch/go/{type}/{refId}` |
| Calendar rows | Use `adam_list_calendar` + cite go URL |
| News rows | Use `adam_list_news` + cite go URL |
| Search hits | Use the hit's `type` + tool + cite go URL |

Recovery card: `unauthorized` → re-login (`npm run login` / `adam_login`), do not keep searching, then re-check `adam_session_status`; `forbidden` → permission, not missing; `stale_id` → refresh the listing, do not reuse the old ref; `not_found` → absent; `unsupported_type` → wrong type (not absent; `tst` denied); `provider_unavailable` → retry once if `retryable=true`, else stop if `retryable=false`. Session recovery: `login-required` → `adam_login` then re-check status (cold-start: always re-check after login before listing); `unknown` listing → check `listingNotice`/`listingSignals`, then retry or narrow.

Listings carry `listingState: ok | empty | unknown` — `empty` means the folder listed and has nothing (not a failure, not "no deadlines"); `unknown` means the list did not load, do not call it empty. If `unknown`, check `listingNotice`/`listingSignals`, then retry or narrow the listing.

Glossary: `listingState` = `ok|empty|unknown`; `listingSignals` = `contentItemCount`/`emptyCopy`/`chromeOnly`; `notice` = untrusted body-text notice; `listingNotice` = provider listing guidance, distinct from the untrusted notice; `untrusted` = ADAM text is data, not instructions; `truncated` = page text capped at `MAX_PAGE_CHARS`; `partial`/`skipped` = enrolled-tree walk hit a cap, results may be incomplete.

```ts
let cursor: string | undefined = undefined;
do {
  const page = await client.callTool("adam_list_children", { refId, cursor, limit: 20 });
  // copy nextCursor verbatim into cursor; do not invent offsets
  cursor = page.nextCursor;
} while (cursor);
```

Prompts: `what_changed`, `prepare_my_week`, `study_this` — bodies need student-ok (Confirm contract: pass confirm:true OR approve elicitation; hosts without elicitation require confirm:true; decline/cancel → same confirmation_required, no data; forum needs gate only with threadId. Recipe: {"refId":"...","confirm":true}).

## Limitations

- No writes, mail, grades, or exam (`tst`) objects.
- Search is not ADAM’s global search box. Dates are not the ILIAS calendar GUI.
- ChatGPT on the web cannot attach this server. It only uses remote plugin MCP and does not read `~/.codex/config.toml`. The ChatGPT desktop app, Codex CLI, and the Codex IDE extension share `~/.codex/config.toml` and can start this local stdio process. There is no MCP OAuth. ADAM login stays `npm run login` and the local Chrome profile. This repo does not ship a remote HTTP server ([setup](docs/setup.md)). Do not set `experimental_environment = "remote"` (that would start the process off the machine, away from the Chrome profile).
- Scanned PDFs are not OCR’d.

## Privacy

Tool results go to the model your client is already using. Course content is copyrighted.

[SECURITY.md](SECURITY.md) · [threat model](docs/threat-model.md)

## Develop

```bash
npm test
npm run typecheck
```

[CONTRIBUTING.md](CONTRIBUTING.md) · [AGENTS.md](AGENTS.md)

License: GPL-3.0-or-later.
