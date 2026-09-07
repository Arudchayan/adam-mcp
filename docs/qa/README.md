# QA docs (Phase A)

**Updated:** 2026-09-06 · **Owner:** QA Lead

Lean source of truth for fixture gates and light security skims. Do not reconstruct from chat transcripts.

| Doc | Purpose |
| --- | --- |
| [phase-a-mcp-compliance-checklist.md](phase-a-mcp-compliance-checklist.md) | Architect checklist SoT (B1–B12, A1–A4+A6; A5 deferred) |
| [phase-a-test-plan.md](phase-a-test-plan.md) | Fixture-first PASS/FAIL cases, goldens, PR order |
| [open-pass-criteria.md](open-pass-criteria.md) | Short notes for gates (A1/A2/A6 closed PR #8 / `e52d947`; A3/A4 closed PR #9 / `a5e1fd6`; AT1/AT2 closed PR #10 / `533d5c5`; AT3 closed PR #11 / `01069ef`; AT4 closed PR #12 / `b3bb0c0`; AT5 closed PR #13 / `ed40c2c`; AT6 closed PR #14 / `16f08c8`; soft backlog A2-news-browser closed this PR; A5 deferred) |
| [security-skim-checklist.md](security-skim-checklist.md) | Light threat-model / SECURITY.md skim on docs & runtime PRs |

## Current Phase A order

B6–B12 done → A1/A2/A6 done (PR #8 / `e52d947`) → A3/A4 done (PR #9 / `a5e1fd6`) → AT1/AT2 done (PR #10 / `533d5c5`) → AT3 done (PR #11 / `01069ef`) → AT4 done (PR #12 / `b3bb0c0`) → AT5 done (PR #13 / `ed40c2c`) → AT6 done (PR #14 / `16f08c8`). Soft backlog A2-news-browser done (this PR). A5 deferred Phase B P1. Phase A-thin complete.

## Fixture goldens (locked)

| ID | Role |
| --- | --- |
| `100001` | Course (news-on) |
| `100011` | File/PDF extract |
| `100020` | Empty Exercises **fold** |
| `100021` | **exc** with deadline (not a folder) |
| `100101` | Course (news-off) |
| `100201` | Catalog-only Magazin isolation |
| `tst` (add) | Fail-closed deny for B10 |

Empty `100020` ≠ no deadlines. Fixture-only for Phase A CI — no live ADAM.
