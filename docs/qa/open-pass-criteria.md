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
| A1 | Tool results include `adam://…` handles **and** canonical HTTPS citations | PR #8 (`e52d947`) |
| A2 | Progress notifications on search / calendar / extract (fixture long-walk stub + observer) | PR #8 (`e52d947`) |
| A6 | Read-by-id via resources; existing `adam_get_*` stay thin wrappers; no duplicate get-by-id tools | PR #8 (`e52d947`) |
| A3 | Docs: `confirm:true` = interim schema gate after student asked to read; real confirms/future writes → MCP elicitation when host supports MRTR; not OS permission; not equated to tool annotations alone | PR #9 (`a5e1fd6`) |
| A4 | `docs/architecture.md` pins `@modelcontextprotocol/server` 2.x + protocol era (2025-03-26 / 2026-07-28) | PR #9 (`a5e1fd6`) |
| AT1 | Aggregate deadlines from `exc` + page/calendar SoT across enrolled courses (fixture); keep `100020` empty fold ≠ no deadlines; surface `100021`; **no invented dates** | PR #10 (`533d5c5`) |
| AT2 | Each item: date (or honest omit), `source` ∈ {exc,page,calendar}, `confidence` ∈ {explicit,inferred}, full provenance + HTTPS cite + `adam://` when resource-backed; progress when `progressToken` set | PR #10 (`533d5c5`) |
| AT3 | Enrolled-tree only search; deterministic title-before-body ranking; A1 cites + A2 progress + B10 deny preserved; no new search tool | PR #11 (`01069ef`) |

## Open (Phase A-thin)

| ID | PASS | Notes |
| --- | --- | --- |
| AT4 | Enrolled-only `adam_list_news`; news-on: provenance + HTTPS + `adam://` when resource-backed; news-off: honest empty (no invented activity); `since` filter; A2 progress; no new news tool / Magazin | Extend `adam_list_news` only — fixture news-on `100001` / news-off `100101` / catalog-only `100201` isolation |

## Keep

| | |
| --- | --- |
| **Fixture lock** | `100020` = empty Exercises **fold**; `100021` = **exc** with deadline (not a folder). Empty fold ≠ no deadlines. |

## Queued (baseline B-series)

None — B1–B12 baseline gaps closed via PR #7 / `21728f3`.

## Next

Phase A backlog A1–A4 + A6 closed (A3/A4 = PR #9 / `a5e1fd6`). AT1/AT2 closed (PR #10 / `533d5c5`). AT3 closed (PR #11 / `01069ef`). **A5** completions deferred (Phase B P1). **Phase A-thin AT4:** news reliability via `adam_list_news` (this PR).
