# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Breaking:** `adam://exc/{refId}` resource is metadata only (deadline/status/title/url — no `instructionText`); use `adam_get_exercise` with `confirm:true` for instruction bodies
- Tool `refId` accepts `adam://{type}/{id}` and pinned `https://adam.unibas.ch/go/{type}/{id}` (digits still work); titles and non-ADAM URLs are rejected
- Default/fixture startup no longer loads Playwright; `adam-provider-browser` is dynamic-import only for `--browser`

### Fixed

- `adam_session_status` / `adam-mcp status` report `holderPid` for a live bound session holder; stale/dead/unbound records stay null (ADR 0009)
- `adam_search` for `pdf` / `PDF` / `.pdf` returns enrolled `type=file` hits (title/extension/mime; not only crs/fold page text)
- After `confirm:true`, `adam_extract_file_text` never returns silent empty text; empty/whitespace or cap-window-empty extracts fail closed with a reason (ADR 0014)
- Live `adam_get_forum` / `adam://frm` thread summaries parse from ILIAS forum HTML when present; missing HTML stays honest-empty; `threadId` posts fail closed instead of inventing bodies (ADR 0012)
- Enrolled walk memo clears on `login()` / `close()`; mid-walk `forbidden` / `stale_id` / `unauthorized` abort and are not memoized (ADR 0015 / 0016)
- `adam_get_course` reports `listingState` and truncation (`truncated` / `totalChildrenHint`) instead of a silent child cap (ADR 0015)
- Upstream HTTP and `page.goto` status map to typed ADAM errors (`unauthorized`, `forbidden`, `not_found`, retryable `provider_unavailable`) (ADR 0016)
- `resources/read` failures reuse the tool `fail()` recovery line (`code: message (retryable=…)`) for `forbidden` / `stale_id` / `unauthorized` / `provider_unavailable`
- Bare `ILIASSESSID=…` is redacted (not only `Cookie:`-prefixed forms)

### Security

- Browser mode refuses `ADAM_ALLOW_TEST_ORIGIN=1`; test origins stay fixture-only

## [0.2.0] - 2026-09-16

### Added

- Phase B read-only forum: `adam_get_forum` + `adam://frm/{refId}` (ADR 0012); post bodies require `confirm:true`
- ADR 0010 protocol correctness: strict digits-only cursor (`InvalidParams`), resource `not_found` → `ResourceNotFoundError`, structured-output validation against advertised schemas, server `instructions`
- ADR 0011 bounds/cancellation: `MAX_PAGE_CHARS` + `PageContent.truncated`, cooperative `AbortSignal` on all providers (cancelled walks never memoized), `retryable=false` for unknown bugs, password/api_key/matriculation redaction + URL-aware `deepRedact`
- Bounded live re-verify guide (`docs/live-reverify.md`) for the post-population ADAM pass; no premature type expansion (`sess/htlm/wiki/grp` still gated on live sighting)

### Changed

- Trust surface: ConfirmGate on `adam_get_exercise`; all ADAM `resources/read` payloads use UntrustedContent + deepRedact; permanent oversize/soap/html failures are `retryable: false`; client type hint on `adam_get_forum` fail-closed; docs confirm lists aligned (page + extract + forum threadId + exercise); live B-frm demoted to meta-only until HTML parse (#37)
- Session holder lifecycle P0s / ADR 0009 amend: re-login stops and awaits the prior holder; stop waits for PID/CDP; liveness bound to process identity (#38)

### Fixed

- `adam_get_file` preserves listing title on download abort (ADR 0013, #40)

## [0.1.0] - 2026-09-07

### Added

- Soft backlog A2-news-browser: browser `listNews` `onProgress` during live page walk (fixture parity)
- Phase A-thin AT6: harden `adam_list_calendar` provenance (page-inferred stays page; unlabeled≠exc; dedup exc>calendar>page)
- Phase A-thin AT5: harden `adam_get_exercise` (exc fail-closed; no invented deadlines; labeled synthetic 100021)
- Phase A-thin AT4: `adam_list_news` reliability (enrolled news-on/off; provenance; since; progress)
- Phase A-thin AT3: enrolled-tree `adam_search` ranking (title before body; catalog-only isolation)
- Phase A-thin AT1/AT2: cross-course deadline aggregation via `adam_list_calendar` (source/confidence/provenance)
- CI status badge on the README
- Expanded [CONTRIBUTING.md](CONTRIBUTING.md) (CoC, fixture-first PRs, setup, issue routing, review rules)
- Feature request issue template for Uni Basel ADAM workflows
- Local stdio MCP server for University of Basel ADAM (community project)
- Fixture catalog provider and optional Chrome `--browser` session path
- Tools: course/folder/page/file/search/calendar/news/exercise/session surfaces, plus prompts (`what_changed`, `prepare_my_week`, `study_this`)
- Setup docs and host snippets (Cursor, Claude Desktop, VS Code, Windsurf, Claude Code)
- CI matrix: Ubuntu / Windows / macOS × Node 20 / 22 (test, typecheck, build, audit)
- SECURITY.md, CODE_OF_CONDUCT.md, CONTRIBUTING.md, GPL-3.0-or-later + NOTICE

### Security

- Read-only tool surface; object type `tst` denied
- No PDF bytes sent to the model; download cancel covered in tests
- HTTPS host allowlist pinned to `https://adam.unibas.ch`
