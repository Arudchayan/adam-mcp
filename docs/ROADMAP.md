# Roadmap

Living plan for [adam-mcp](https://github.com/Arudchayan/adam-mcp). Product intent: a **local-first, read-only** MCP so Uni Basel students can use their own AI hosts against ADAM. This is a community project, not a University service.

**Confidence.** We have an authenticated Chrome session and a live inventory (2026-09-06). Auth is not the blocker. Remaining uncertainty is **object types not present in the enrolled courses we inspected** (e.g. no live `exc` / `frm` / Postbox on that pass), plus ADAM admin surfaces we have not been asked to cover. See [docs/capabilities.md](capabilities.md).

Archived research under [docs/research/](research/) (2026-09-05) is historical. Current rules: [README](../README.md), [scope.md](scope.md), [SECURITY.md](../SECURITY.md).

## North star

1. **Study-strength reads** — finish the M1–M13 read workspace (courses, folders, pages, files + local extract, search, news, deadlines, read-only exercise, prompts).
2. **More ADAM reads** — only after we observe the object live (or add honest fixture models labeled synthetic).
3. **Writes** — Phase C only after ToS / academic-integrity review; prefer deep-link to ADAM first. Never automate exams (`tst` / ADAM EXAM).

## Phase A — Harden what ships (in progress)

Fixture-first gates from [docs/qa/phase-a-test-plan.md](qa/phase-a-test-plan.md) and [docs/qa/phase-a-mcp-compliance-checklist.md](qa/phase-a-mcp-compliance-checklist.md).

| ID | Work | Status |
| --- | --- | --- |
| Docs / OSS DX | CI badge, CHANGELOG, CONTRIBUTING, capabilities, QA docs | Done (PR #1) |
| B6 | Untrusted notice on page/extract | Done (PR #2) |
| B10 | Synthetic `tst` fail-closed | Next |
| B4 | RPC `confirm: true` reject/success | Queued |
| B11 / B12 | No deprecated MCP primitives; no OAuth on stdio | Queued |
| A1 / A2 / A6 | Resource links, progress, resources-for-read-by-id | After baseline |
| A3 / A4 | confirm vs elicitation docs; pin SDK in architecture.md | After baseline |
| Release | `SECURITY.md` publish checklist → git tag / npm later | Held |

## Phase B — Expand reads

| Priority | Capability | Gate |
| --- | --- | --- |
| P0 | Cross-course deadline aggregation | Honest provenance; empty folder ≠ no deadlines |
| P0 | Search ranking on enrolled tree | Never claim global ADAM search |
| P0 | News / what-changed reliability | Only when News is enabled |
| P1 | Exercise awareness (instructions, due, own status) | Needs live `exc` (or labeled synthetic fixture) |
| P2 | Forum thread **read** | Needs live `frm` |
| Later | `sess` / `webr` / modules / Postbox **list** / ADAMtools discover | After live sighting |

## Phase C — Gated writes (not scheduled)

Deep-link submit first. Optional agent writes only with confirmation, audit, and institutional comfort. **Out for longest / forever:** exam taking, gradebook, mail-as-agent, member gallery, file bytes to the model, hosted session proxy, mass PDF RAG.

## Open-source quality bar

- Fixture default; live ADAM never required for CI
- Cross-OS CI; `npm audit` in workflow
- Threat model + SECURITY publish checklist before tags
- ADRs for session, new tools, provider enablement, extract changes
- No cookies, profiles, or private course material in git

## How to pick up work

1. Read [AGENTS.md](../AGENTS.md) and [scope.md](scope.md).
2. Prefer fixture PRs that close a Phase A checkbox.
3. For new ADAM object types, record a live sighting in capabilities.md (or mark fixture as synthetic).
