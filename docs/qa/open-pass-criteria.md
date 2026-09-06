# Open PASS criteria (Phase A)

**Updated:** 2026-09-06 · **Owner:** QA Lead  
**SoT companions:** [phase-a-test-plan.md](phase-a-test-plan.md), [phase-a-mcp-compliance-checklist.md](phase-a-mcp-compliance-checklist.md)

Lean notes for gates **not yet closed on main**. Fixture-only. No live ADAM.

## Closed

| ID | PASS | Closed |
| --- | --- | --- |
| B6 | `adam_read_page` / `adam_extract_file_text` return `untrusted: true` + notice string | PR #2 (`1a0d103`) |
| B10 | Synthetic `tst` deny / fail-closed; never return exam body | PR #5 (`8af49c0`) |
| B4 | RPC reject omit/`false` on `adam_read_page` / `adam_extract_file_text`; success only with `confirm: true` | this PR (pending merge) |

## Next — B11 / B12

| | |
| --- | --- |
| **B11 PASS** | No Sampling / Roots / MCP Logging client APIs; logs stderr/OTel only |
| **B11 FAIL** | Deprecated primitives or HTTP+SSE adopted |
| **B12 PASS** | No MCP OAuth on stdio; auth = Chrome session / env |
| **B12 FAIL** | OAuth bolted onto local stdio |
| **Keep** | `100020` = empty Exercises **fold**; `100021` = **exc** with deadline (not a folder). Empty fold ≠ no deadlines. |
| **Harness** | `ADAM_PROVIDER=fixture`; extend existing suites. |

## Queued (after B11/B12)

None for baseline B-series after B11/B12.

## Backlog (after baseline)

A1 resource links · A2 progress · A6 resources-for-read-by-id · A3 confirm≠elicitation docs · A4 SDK pin. **A5** completions deferred (Phase B P1).
