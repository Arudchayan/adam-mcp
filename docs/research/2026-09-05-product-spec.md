# ADAM MCP product specification

> Archived snapshot, 5 September 2026. Current docs: [README](../../README.md), [scope](../scope.md).

This is a community connector, not a University of Basel service.

## Product

`adam-mcp` is a **local-first, read-only MCP server** that lets a University of Basel student use **their own** AI host (Cursor, Claude Desktop, VS Code Copilot, Windsurf, Claude Code, Codex CLI) against ADAM (ILIAS 10.10 at `https://adam.unibas.ch`).

The completeness bar is Blender MCP, not Vercel MCP:

- Blender: local process + local app (Blender). Auth happens in that app.
- Vercel: hosted `https://mcp.vercel.com` + OAuth. ADAM cannot copy that without putting a SWITCH session on a third-party server.
- ChatGPT: remote HTTPS MCP only. This project **does not claim ChatGPT support** in v1.

Success: after `npx adam-mcp login` (SWITCH in Chrome) and one host config paste, the student can ask “What courses am I in?” and get titles plus canonical ADAM URLs. No password in chat.

## Independent reports (do not collapse)

| Report | Verdict we keep |
| --- | --- |
| MCP product DX | Publish one npm CLI `npx -y adam-mcp`. Windows `cmd /c`. Login is a Chrome sidecar. ChatGPT unsupported. |
| MCP architecture | `serveStdio` dual-era. Tools + resources + prompts + `readOnlyHint` + structured output. Domain stays MCP-free. |
| Repo critique | Keep the provider split. Do not rewrite. Not publishable until packaging, CI, LICENSE, honest tools. |
| Feature inventory | Completeness is a live read-only study workspace (M1–M13), not 80 Canvas tools and not a submit bot. |
| Live ADAM | SOAP Apache 403, WebDAV plugin off, REST 404, ADAM is SAML not OIDC. Live path = session HTML. |
| Trust | Do not tag a public release until the publish checklist is green. CDP, rate limits, `tst` deny, confirmation, docs. |

## Locked decisions

### Transport and distribution

- **Primary:** local stdio. stdout = JSON-RPC only.
- **Users see one package:** `adam-mcp`. Internal workspaces may remain.
- **Install story:** `npx -y adam-mcp` once a compiled `bin` is published. Until then, clone + Node 20 is a contributor path, not the README hero.
- **Hosts documented:** Cursor, Claude Desktop, VS Code, Windsurf, Claude Code. Windows snippets are first-class.
- **ChatGPT:** unsupported. No ngrok, no public tunnel of the ADAM session.
- **Hosted Streamable HTTP + OAuth:** out. Different product.
- **Protocol:** dual-era (`serveStdio`). Do not require 2026-only hosts.

### Auth

- SWITCH edu-ID completes in **headed Google Chrome** with a dedicated profile under `~/.adam-mcp/chrome-profile`.
- No password, TOTP, or cookie in tool args, env-of-the-model, logs, or git.
- MCP `adam_session_status` never returns `profileDir`, cookies, or HTML.
- Chrome remote debugging is **not** a well-known port (`9333` is forbidden). Attach only via the profile’s `DevToolsActivePort` on `127.0.0.1`.

### Live adapter

- **Default provider:** `fixture` (synthetic). Casual clone must not hit production ADAM.
- **Live provider:** dedicated-profile Playwright HTML. SOAP and HTML-crawler packages stay **fail closed**.
- SOAP `login` is a local WS password, not SWITCH. Even if `/soap/server.php` opened, typical students still could not use it.
- Do not copy Stuttgart `cmdNode` values or PFERD’s KIT Shibboleth module.
- Honor `robots.txt`: do not crawl calendar GUI or `ilsearchcontrollergui`.
- Concurrency 1. Rate limit live navigations. HTTPS only. Origin pinned to `https://adam.unibas.ch`.

### MCP surface (v1)

**Tools:** session status, login, list/get courses, list children, read page (confirm), list/get file metadata, local file extract (confirm; text only), read-only exercise, search, calendar, news.

**Resources:** `adam://me/courses`, `adam://crs/{refId}`, `adam://fold/{refId}`, `adam://file/{refId}`, `adam://exc/{refId}`. Canonical `https://adam.unibas.ch/go/...` is a **citation**, not an MCP resource the host can fetch.

**Prompts:** `prepare_my_week`, `what_changed`, `study_this`.

**Annotations:** all read tools `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true`.

**Results:** JSON text **and** `structuredContent`. Each tool advertises an `outputSchema`. Page bodies carry an untrusted-data envelope.

### Three bars (do not mix)

| Bar | Meaning |
| --- | --- |
| **Trust publish** | `SECURITY.md` checklist. Blocks GitHub/npm tags. Does **not** require PDF extract or `get_exercise`. |
| **Shipped MCP surface** | Tools listed under “MCP surface (v1)” plus resources/prompts. Live search/calendar/news walk enrolled objects; they are not ADAM’s global search or calendar GUI. |
| **Product complete** | Feature bible M1–M13, including local PDF extract and read-only `adam_get_exercise`. This is the completeness goal, not the trust gate. |

`confirm: true` on `adam_read_page` is a schema gate so hosts can show the argument. It is **not** a host elicitation modal. Residual confused-deputy risk remains; page text is still wrapped as untrusted data.

### Must ship for “complete” (feature bible M1–M13)

Local session, my courses, course snapshot including page text, folder walk, file metadata, **local** PDF extract after confirm (not bytes to the model), search, what-changed, deadline fusion with inferred labels, read-only exercise objects, provenance on every payload, actionable errors, the three prompts.

Shallow dashboard-only scrapes are a bug. The live browser provider walks the dashboard plus enrolled course/folder/exercise pages (capped). It still must not crawl `ilsearchcontrollergui` or the calendar GUI (`robots.txt`).

### Must not ship

Writes (submit, forum post, mail, enroll). Exam taking (`tst` denied in code). File bytes/base64 to the model. Generic URL fetch. Hosted password proxy. Member gallery / user search. Gradebook scraping. Mass crawl / RAG index of course PDFs. Cookie export.

### Conflict resolutions

| Conflict | Resolution |
| --- | --- |
| Features: PDF extract is MUST. Trust: no bytes to the model. | Local extract after `confirm: true`. Return bounded text + page numbers + untrusted envelope. Never `blob`. |
| Features: `get_exercise` is MUST. Trust: `exc`/`tst` are integrity hazards. | `tst` hard-denied. `exc` is read-only (units, deadline, own status, instruction text). No submit, no others’ files. |
| Trust: confirm every page body. Features: course snapshot needs text. | `adam_get_course` may include a short excerpt. Full page text is `adam_read_page` with `confirm: true`. |
| Architecture: URL elicitation for login. DX: CLI login always works. | `adam-mcp login` is the supported path. URL elicitation is optional later if the host supports it. Never form-elicit passwords. |
| DX: ChatGPT is a user hope. Reality: ChatGPT cannot spawn stdio. | Document as unsupported. Do not tunnel. |

## Publish gate

Do not tag a public npm/GitHub release until `SECURITY.md` checklist is green: full GPL text, CI, fixture default, no fixed CDP port, HTTPS pin, rate limit, `tst` deny, no PDF bytes, stdout hygiene, independent review recorded for the browser-session architecture.

## Review protocol

P0 changes (session, allowlist, new tool, provider enablement, file extract): ADR in `docs/adr/` plus a reviewer who did not author the patch. “The README says not to” is not a control.
