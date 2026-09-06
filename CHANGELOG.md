# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Phase A-thin AT1/AT2: cross-course deadline aggregation via `adam_list_calendar` (source/confidence/provenance)
- CI status badge on the README
- Expanded [CONTRIBUTING.md](CONTRIBUTING.md) (CoC, fixture-first PRs, setup, issue routing, review rules)
- Feature request issue template for Uni Basel ADAM workflows

## [0.1.0] - 2026-09-05

GitHub Release / `v0.1.0` tag pending Security + Leonidas (not cut yet).

### Added

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
