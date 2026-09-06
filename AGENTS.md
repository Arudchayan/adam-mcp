# Contributor notes

Local stdio MCP server for University of Basel ADAM. Users: [README.md](README.md). Scope: [docs/scope.md](docs/scope.md). Plan: [docs/ROADMAP.md](docs/ROADMAP.md).

This file is for humans and coding agents working in the repo.

## Layout

| Package | Role |
| --- | --- |
| `packages/core` | Types, canonical URLs, pagination, redaction, policy |
| `packages/mcp` | Tools, resources, prompts, stdio entry |
| `packages/provider-fixture` | Default synthetic catalog |
| `packages/provider-browser` | Live ADAM via a dedicated Chrome profile |
| `packages/provider-soap` | Fail closed |
| `packages/provider-html` | Fail closed |

## Commands

```bash
npm test
npm run typecheck
npm run build
npm run setup    # build + print host JSON
npm run login    # Chrome ADAM session
```

Default provider is `fixture`. Live ADAM is `--browser` / `ADAM_PROVIDER=browser`.

## Invariants

- Do not put SWITCH passwords in tools, env, logs, issues, or git.
- No write tools. Object type `tst` is denied.
- `adam_read_page` and `adam_extract_file_text` require `confirm: true` (interim schema gate after the student asked to read — not OS permission, not elicitation, not equated to tool annotations alone). Return text, never file bytes. Real confirms / future writes → MCP elicitation when host supports MRTR; see docs/architecture.md.
- stdout is JSON-RPC only. Logs go to stderr.
- Pin origin to `https://adam.unibas.ch`. No generic URL fetch.
- Do not commit cookies, Chrome profiles, live course files, or private screenshots.
- Enabling SOAP/HTML, adding a tool, or changing extract/session behavior needs an ADR in `docs/adr/`.
- Do not adopt deprecated MCP Sampling / Roots / protocol Logging; do not put MCP OAuth on stdio.

## Phase A quality gates

Fixture-first. SoT:

- [docs/qa/phase-a-test-plan.md](docs/qa/phase-a-test-plan.md)
- [docs/qa/phase-a-mcp-compliance-checklist.md](docs/qa/phase-a-mcp-compliance-checklist.md)

Golden fixture IDs: `100020` = empty Exercises **fold**; `100021` = **exc** with deadline (not a folder). Empty fold ≠ no deadlines.

Close baseline gaps in order when possible: B6–B12 done; A1/A2/A6 done (PR #8 / `e52d947`); A3/A4 done (PR #9 / `a5e1fd6`); AT1/AT2 done (PR #10 / `533d5c5`); AT3 done (PR #11 / `01069ef`). A5 deferred Phase B P1; Phase A-thin AT4 next.

## Review / merge

Prefer small PRs. Docs and fixture PRs: lean review (protocol + QA). Do not wait on the repo owner for routine merges once CI is green and reviewers LGTM — unless the change is publish/tag/npm or expands writes.

Publish / git tags: only after [SECURITY.md](SECURITY.md) checklist is green.

## Docs map

| File | Use |
| --- | --- |
| `README.md` | Users |
| `docs/setup.md` | Host JSON and login |
| `docs/architecture.md` | How the process is wired |
| `docs/scope.md` | Tools and out-of-scope |
| `docs/capabilities.md` | Living ADAM ↔ MCP coverage |
| `docs/ROADMAP.md` | Phased plan |
| `docs/providers.md` | Fixture vs browser |
| `docs/qa/` | Phase A test plan + MCP checklist |
| `docs/fleet-handoff.md` | Lean Grok Bot fleet continuity (optional) |
| `SECURITY.md` | Reports and publish checklist |
| `docs/research/` | Dated notes, **not** current product law |
