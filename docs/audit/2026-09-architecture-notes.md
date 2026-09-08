# ADAM MCP Architecture & Production-Readiness Audit

**Repo:** Arudchayan/adam-mcp
**Auditor:** Grok Bot via user-Github MCP (get_file_contents only; no clone)
**Audit date:** 2026-09-06 (Europe/Berlin)
**Audience:** Leonidas
**Version audited:** 0.1.0

---

## 1. Architecture summary

### 1.1 Shape

Local-first stdio MCP server for Uni Basel ADAM (ILIAS 10 at https://adam.unibas.ch). Not a hosted proxy; not ChatGPT-attachable.

```
AI host -> stdio JSON-RPC -> packages/mcp (tools/resources/prompts)
  -> packages/core (types, URLs, policy, redaction, extract)
  -> provider-fixture (DEFAULT) | provider-browser (live Chrome)
  -> provider-soap / provider-html (FAIL CLOSED)
```

Cited: docs/architecture.md, AGENTS.md, package.json workspaces.

### 1.2 Monorepo packages

| Package | Role |
| --- | --- |
| packages/core | Types, AdamProvider, URLs, policy (tst deny), local extract, redaction |
| packages/mcp | Tool/resource/prompt registration, schemas, stdio CLI |
| packages/provider-fixture | Default synthetic catalog |
| packages/provider-browser | Live Chrome session + HTML scrape |
| packages/provider-soap | Fail closed stub |
| packages/provider-html | Fail closed stub |

Full src file listing is in section 2.4.

### 1.3 Auth and live adapter model

See docs/adr/0001-browser-session.md and packages/provider-browser/src/*.
Dedicated headed browser profile; attach over localhost debug port file; SerialQueue, no nav quota throw (ADR 0004/0005); HTTPS host allowlist; download cancel policy; login-page detection maps to unauthorized; status tools omit secrets; redaction on tool text and structured payloads (packages/core/src/redaction.ts). No proactive expiry timer — student re-runs login when unauthorized appears.

### 1.4 Provider interface

AdamProvider in packages/core/src/provider.ts: listCourses, getCourse, listChildren, readPage, listFiles, getFile, extractFileText, getExercise, search, listCalendar, listNews.

Wiring: ADAM_PROVIDER or --browser in packages/mcp/src/providers.ts. Default fixture.

### 1.5 Live scrape path (fragility hotspot)

packages/provider-browser/src/extract.ts parses page snapshots (aria labels, link collection, news/date regexes, /go/{type}/{id} refs). Search/calendar/news walks capped at MAX_LIVE_PAGES=48 in browser-provider.ts. ADR 0001 notes DOM selectors will break.

---

## 2. Tool / resource / prompt inventory

Source of truth: packages/mcp/src/server.ts; schemas in packages/mcp/src/schemas.ts; annotations in packages/mcp/src/results.ts.

### 2.1 Tools

| Tool | Confirm / gates | Annotations | Key inputs | Output schema | Provider |
| --- | --- | --- | --- | --- | --- |
| adam_list_courses | — | READ_ONLY_ANNOTATIONS | cursor?, limit? | paginatedObjects | listCourses |
| adam_get_course | — | read-only | refId | adamObject | getCourse |
| adam_list_children | — | read-only | refId, cursor?, limit? | paginatedObjects | listChildren |
| adam_read_page | confirm:true required | read-only + untrusted envelope | refId, confirm | untrustedPage | readPage |
| adam_list_files | — | read-only | refId, cursor?, limit? | paginatedFiles | listFiles |
| adam_get_file | — | read-only | refId, cursor?, limit? | fileObject | getFile |
| adam_extract_file_text | confirm:true; maxPages 1-20 | read-only + untrusted | refId, confirm, maxPages? | untrustedExtract | extractFileText |
| adam_get_exercise | no submit; tst denied elsewhere | read-only | refId | exercise | getExercise |
| adam_search | enrolled walk, not global GUI | read-only | query, cursor?, limit? | paginatedObjects | search |
| adam_list_calendar | inferred dates, not calendar GUI | read-only | from?, to?, cursor?, limit? | paginatedCalendar | listCalendar |
| adam_list_news | best-effort HTML | read-only | since?, cursor?, limit? | paginatedNews | listNews |
| adam_login | browser only | readOnlyHint false, openWorld | timeoutMs? | sessionStatus | session.login |
| adam_session_status | browser only | read-only | {} | sessionStatus | session.status |

READ_ONLY_TOOLS (11) and SESSION_TOOLS (adam_login, adam_session_status) in results.ts. Object type tst denied in packages/core/src/policy.ts. No write/submit tools.

### 2.2 Resources

| Name | URI / template | MIME | Backing |
| --- | --- | --- | --- |
| adam-courses | adam://me/courses | application/json | listCourses |
| adam-course | adam://crs/{refId} | JSON | getCourse |
| adam-folder | adam://fold/{refId} | JSON | listChildren |
| adam-file | adam://file/{refId} | JSON | getFile metadata |
| adam-exercise | adam://exc/{refId} | JSON | getExercise |

adam:// handles are MCP resources; live citations use https://adam.unibas.ch/go/... (docs/architecture.md, docs/scope.md).

### 2.3 Prompts

| Prompt | Args | Choreography |
| --- | --- | --- |
| prepare_my_week | from?, to? | courses + calendar + news; confirm reads; no submit/tests |
| what_changed | since (required) | list_news + list_courses; no PDFs/tests |
| study_this | refId | page/extract/exercise with confirm; untrusted; no assessed write |

### 2.4 Complete packages/*/src file map

```
packages/core/src/
  errors.ts, index.ts, local-extract.ts, local-extract.test.ts,
  origin.ts, pagination.ts, policy.ts, provider.ts, redaction.ts,
  synthetic-pdf.ts, types.ts, urls.ts, urls.test.ts

packages/mcp/src/
  index.ts, providers.ts, providers.test.ts, results.ts, schemas.ts,
  server.ts, server.test.ts, stdio.test.ts

packages/provider-fixture/src/
  catalog.ts, fixture-provider.ts, fixture-provider.test.ts, index.ts

packages/provider-browser/src/
  allowlist.ts, browser-provider.ts, cdp.ts, config.ts, download-guard.ts,
  extract.ts, index.ts, index.test.ts, is-main.ts, login-cli.ts,
  memory-session.ts, playwright-session.ts, safety.test.ts,
  serial-queue.ts, session-feedback.ts, session-feedback.test.ts,
  session-handoff.ts, session-handoff.test.ts, session-types.ts, status-cli.ts

packages/provider-soap/src/   index.ts, index.test.ts
packages/provider-html/src/   index.ts, index.test.ts
```

---

## 3. Tests and CI assessment

### 3.1 CI
See .github/workflows/ci.yml for OS and Node matrix.

### 3.2 Covered areas

Fixture and memory-session unit tests cover allowlist, confirm schemas, stdio surface, extract bounds, and read-only inventory. See packages/*/src/*.test.ts.

### 3.3 Coverage gaps

- No live ADAM HTML in CI (High)
- No golden production markup snapshots (High)
- Resource handlers lack runProvider wrapping (Medium)
- confirm not re-checked in handler body (Low-Med)
- PDF page splitting weak (Medium)
- soap/html wiring smoke thin (Low)
- Expiry and multi-client attach races (Medium)
- No CHANGELOG or MCP contract tests (Medium)


---

## 4. Docs and governance

- architecture.md: accurate
