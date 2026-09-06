# Open PASS criteria (Phase A)

**Updated:** 2026-09-06 · **Owner:** QA Lead  
**SoT companions:** [phase-a-test-plan.md](phase-a-test-plan.md), [phase-a-mcp-compliance-checklist.md](phase-a-mcp-compliance-checklist.md)

Lean notes for gates **not yet closed on main**. Fixture-only. No live ADAM.

## Closed

| ID | PASS | Closed |
| --- | --- | --- |
| B6 | `adam_read_page` / `adam_extract_file_text` return `untrusted: true` + notice string | PR #2 (`1a0d103`) |

## Next — B10 (`tst` deny)

| | |
| --- | --- |
| **PASS** | Synthetic `tst` object exists (not enrolled in happy-path lists). `read` / `get` / `listChildren` / `search` fail closed — **never** return exam/test body. |
| **FAIL** | Exam/test content returned, or `tst` missing from deny path. |
| **Keep** | `100020` = empty Exercises **fold**; `100021` = **exc** with deadline (not a folder). Empty fold ≠ no deadlines. |
| **Harness** | `ADAM_PROVIDER=fixture`; extend existing suites. |

## Queued (after B10)

| ID | PASS | FAIL |
| --- | --- | --- |
| B4 | RPC reject omit/`false` on `adam_read_page` / `adam_extract_file_text`; success only with `confirm: true` | Succeeds without literal `true` |
| B11 | No Sampling / Roots / MCP Logging client APIs; logs stderr/OTel only | Deprecated primitives or HTTP+SSE adopted |
| B12 | No MCP OAuth on stdio; auth = Chrome session / env | OAuth bolted onto local stdio |

## Backlog (after baseline)

A1 resource links · A2 progress · A6 resources-for-read-by-id · A3 confirm≠elicitation docs · A4 SDK pin. **A5** completions deferred (Phase B P1).
