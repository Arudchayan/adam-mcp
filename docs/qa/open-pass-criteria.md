# Open PASS criteria (Phase A)

**Updated:** 2026-09-06 · **Owner:** QA Lead  
**SoT companions:** [phase-a-test-plan.md](phase-a-test-plan.md), [phase-a-mcp-compliance-checklist.md](phase-a-mcp-compliance-checklist.md)

Lean notes for gates **not yet closed on main**. Fixture-only. No live ADAM.

## Closed

| ID | PASS | Closed |
| --- | --- | --- |
| B6 | `adam_read_page` / `adam_extract_file_text` return `untrusted: true` + notice string | PR #2 (`1a0d103`) |
| B10 | Synthetic `tst` deny / fail-closed; never return exam body | PR #5 (`8af49c0`) |
| B4 | RPC reject omit/`false` on `adam_read_page` / `adam_extract_file_text`; success only with `confirm: true` | PR #6 (`5982bdd`) |
| B11 | No Sampling / Roots / MCP Logging client APIs; logs stderr/OTel only; no HTTP+SSE listener without ADR | this PR (stdio/server negative asserts) |
| B12 | No MCP OAuth on stdio; auth = Chrome session / env only (fixture: no oauth/authorize tools) | this PR (`ADAM_PROVIDER=fixture` tools/list + wiring) |

## Keep

| | |
| --- | --- |
| **Fixture lock** | `100020` = empty Exercises **fold**; `100021` = **exc** with deadline (not a folder). Empty fold ≠ no deadlines. |

## Queued (baseline B-series)

None — B1–B12 baseline gaps closed once this PR merges.

## Backlog (after baseline)

A1 resource links · A2 progress · A6 resources-for-read-by-id · A3 confirm≠elicitation docs · A4 SDK pin. **A5** completions deferred (Phase B P1).
