# ADAM MCP

[![ci](https://github.com/Arudchayan/adam-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Arudchayan/adam-mcp/actions/workflows/ci.yml)

ADAM MCP connects MCP-compatible AI clients to your University of Basel ADAM courses.

It runs on your machine and uses a dedicated Chrome session to access the ADAM courses available to your account. An MCP client can list courses, find materials, read approved text, and surface deadlines. See [client compatibility](docs/client-compatibility.md) for configuration support and verification status.

This is a community project, not a University of Basel service.

![Demo](docs/demo/demo.gif)

[Watch the demo](docs/demo/adam-mcp-overview.mp4) · [Demo details](docs/demo/README.md)

The demo combines an ADAM session recording with a simulated chat using synthetic course data. It illustrates the workflow; it does not establish client compatibility.

## What you can ask

- Show timestamped course news from this week.
- What deadlines do I have?
- Find the exercise sheet about Fourier transforms.
- Summarize this course page and give me the ADAM link.
- List the material available for this course.

Answers include canonical ADAM URLs (`https://adam.unibas.ch/go/...`).

## Quick start

You need Node.js 22+ and Google Chrome. Use a supported Node.js LTS release.

Install from this repository today. Guided setup checks your installation, configures one client with a backup, opens Chrome for sign-in, and verifies your course listing.

```bash
git clone https://github.com/Arudchayan/adam-mcp.git
cd adam-mcp
npm install
npm run setup -- --client codex --write --login
```

Replace `codex` with `cursor`, `claude-desktop`, `windsurf`, or `vscode`. For VS Code, supply `--output` with the intended workspace's `.vscode/mcp.json` path. Restart your client, enable **adam**, then ask: **What courses am I in? Include their ADAM links.**

Preview without changing settings: `npm run setup -- --client codex`. Diagnose a connection: `npm run doctor -- --client codex`. Credentials stay in the Chrome sign-in window. Setup never asks for them in the terminal or chat.

See [client compatibility](docs/client-compatibility.md) for what has been verified and [the setup guide](docs/setup.md) for manual configuration, backups, and recovery.

### npm installation (pending release)

The package ships a self-contained CLI. Once a reviewed version is published:

```bash
npx -y adam-mcp@0.2.0
# or
npm install -g adam-mcp@0.2.0
adam-mcp
```

After publication, guided client configuration will be available with `adam-mcp setup --client codex --write --login`. This signs in through Chrome and checks the course listing. Registry installation has not yet been verified. See the [release guide](docs/releasing.md) for publication gates.

### Session management

Without a client argument, interactive setup asks which client to use; noninteractive setup prints all supported snippets. Setup previews by default. Add `--write` to install the selected configuration with a backup, and `--login` to sign in and verify courses.

- To sign in separately, run `npm run login` and complete ADAM sign-in in Chrome. The window closes after verification; a background Chrome process keeps the session available. After login, check `adam_session_status`, then call `adam_list_courses`.

Restart the client, then ask:

> What courses am I in? Include the ADAM URL for each.

Login reuses a valid session without opening Chrome. Close the sign-in window or
press Ctrl+C to cancel; failed attempts close their window. Use
`npm run login -- --force` for a fresh window, or `npm run login -- --timeout-ms 120000` for a
two-minute sign-in wait. `npm run logout` stops the local session and disables
automatic reconnection until explicit login. `npm run logout -- --purge` also
removes the dedicated profile; local logout does not sign you out of SWITCH in
other browsers.

Host-specific files (Cursor, Claude Desktop, VS Code, Windsurf, Claude Code, ChatGPT desktop, Codex): [docs/setup.md](docs/setup.md).

## How it works

The client starts ADAM MCP as a local process and communicates over stdio. ADAM MCP reads through your dedicated Chrome session at `https://adam.unibas.ch`. Authentication stays in Chrome; no hosted MCP endpoint is provided.

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
| `adam_login` / `adam_session_status` | Chrome session in the live runtime |

Document and thread text requires approval for the selected object. Your connected model receives the returned text. See [tool contracts](docs/tool-contracts.md) for confirmation, pagination, recovery and completeness rules.

For page, file-text, exercise, and forum-post reads, request the specific object first, then approve the read. Clients with elicitation support can ask for approval interactively; other clients pass `confirm: true`. Declining or cancelling returns no body text. Forum summaries do not require body-read approval. See [tool contracts](docs/tool-contracts.md#confirmation) for the precise contract.

## Limitations

- No writes, mail, grades, or exam (`tst`) objects.
- Search covers titles and available page text in your enrolled course tree. It does not use ADAM’s global search. Dates come from available course content, rather than the ILIAS calendar interface.
- Scanned PDFs are not OCR’d.
- Supported PDFs are parsed page by page, with an 8 MiB transfer cap, 40,000
  text characters, and at most 20 pages (default eight). Empty/malformed files
  fail closed. Formula interpretation and exact visual layout are not guaranteed.
- Course pages and complete cross-course walks refresh after one minute. Restart
  the MCP server for an immediate refresh. Existing pagination retains its
  original snapshot for ten minutes; expired cursors require restarting the list.
- Cross-course reads have a two-minute elapsed budget and report partial results
  when reached. The browser queue admits at most 32 waiting operations and limits
  waiting to 30 seconds. Cancelling a request releases its work when nobody else
  needs it; cached reads reuse navigation and parsing.
- Search, calendar and news accept an enrolled `courseRefId` to narrow discovery. Use `refresh: true` without a cursor for fresh results. `snapshotAt` identifies the listing snapshot; each item's provenance records when it was fetched. Partial results include coverage reasons.
- News with a cutoff includes only items with a known timestamp. Undated news
  remains visible without a cutoff. This does not compare file inventories;
  no matching news is not proof that nothing changed.
- Deadline clock times without an offset use Europe/Zurich. Ambiguous or invalid
  dates/times are omitted. Date-only evidence uses UTC midnight as a representation,
  and does not establish a midnight deadline.

## Privacy

Tool results go to the model your client is already using. Course content is copyrighted.

[SECURITY.md](SECURITY.md) · [threat model](docs/threat-model.md)

## Develop

```bash
npm test
npm run typecheck
npm run check  # tests, typecheck, build, built-package verification, dependency audit
npm run release:check  # also verifies a clean tarball installation
npm run benchmark:reads  # synthetic cached-read timing; no live ADAM access
```

[CONTRIBUTING.md](CONTRIBUTING.md) · [Release guide](docs/releasing.md) · [AGENTS.md](AGENTS.md)

License: GPL-3.0-or-later.
