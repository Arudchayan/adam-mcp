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
| B11 | No Sampling / Roots / MCP Logging client APIs; logs stderr/OTel only; no HTTP+SSE listener without ADR | PR #7 (`21728f3`) |
| B12 | No MCP OAuth on stdio; auth = Chrome session / env only (fixture: no oauth/authorize tools) | PR #7 (`21728f3`) |
| A1 | Tool results include `adam://…` handles **and** canonical HTTPS citations | this PR |
| A2 | Progress notifications on search / calendar / extract (fixture long-walk stub + observer) | this PR |
| A6 | Read-by-id via resources; existing `adam_get_*` stay thin wrappers; no duplicate get-by-id tools | this PR |

## Keep

| | |
| --- | --- |
| **Fixture lock** | `100020` = empty Exercises **fold**; `100021` = **exc** with deadline (not a folder). Empty fold ≠ no deadlines. |

## Queued (baseline B-series)

None — B1–B12 baseline gaps closed via PR #7 / `21728f3`.

## Next

**A3** confirm ≠ elicitation docs · **A4** SDK/protocol pin. **A5** completions deferred (Phase B P1).
