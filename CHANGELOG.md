# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- ADR 0010 protocol correctness: strict digits-only cursor (`InvalidParams`), resource `not_found` → `ResourceNotFoundError`, structured-output validation against advertised schemas, server `instructions`
- ADR 0011 bounds/cancellation: `MAX_PAGE_CHARS` + `PageContent.truncated`, cooperative `AbortSignal` on all providers (cancelled walks never memoized), `retryable=false` for unknown bugs, password/api_key/matriculation redaction + URL-aware `deepRedact`
- Bounded live re-verify guide (`docs/live-reverify.md`) for the post-population ADAM pass; no premature type expansion (`sess/htlm/wiki/grp` still gated on live sighting)

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
