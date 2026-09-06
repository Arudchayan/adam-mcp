# QA docs (Phase A)

**Updated:** 2026-09-06 · **Owner:** QA Lead

Lean source of truth for fixture gates and light security skims. Do not reconstruct from chat transcripts.

| Doc | Purpose |
| --- | --- |
| [phase-a-mcp-compliance-checklist.md](phase-a-mcp-compliance-checklist.md) | Architect checklist SoT (B1–B12, A1–A4+A6; A5 deferred) |
| [phase-a-test-plan.md](phase-a-test-plan.md) | Fixture-first PASS/FAIL cases, goldens, PR order |
| [open-pass-criteria.md](open-pass-criteria.md) | Short notes for gates still open (B10 next) |
| [security-skim-checklist.md](security-skim-checklist.md) | Light threat-model / SECURITY.md skim on docs & runtime PRs |

## Current Phase A order

B6 (done) → B10 (done, PR #5) → B4 (this PR) → **B11/B12** → A1/A2/A6 → A3/A4.

## Fixture goldens (locked)

| ID | Role |
| --- | --- |
| `100001` | Course |
| `100011` | File/PDF extract |
| `100020` | Empty Exercises **fold** |
| `100021` | **exc** with deadline (not a folder) |
| `tst` (add) | Fail-closed deny for B10 |

Empty `100020` ≠ no deadlines. Fixture-only for Phase A CI — no live ADAM.
