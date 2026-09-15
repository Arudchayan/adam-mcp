# Open PASS criteria (Phase A)

**Updated:** 2026-09-14 · **Owner:** QA Lead  
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
| AT4 | Enrolled-only `adam_list_news`; news-on: provenance + HTTPS + `adam://` when resource-backed; news-off: honest empty (no invented activity); `since` filter; A2 progress; no new news tool / Magazin | PR #12 (`b3bb0c0`) |
| AT5 | Fixture `100021` labeled synthetic exc+deadline; `type===exc` fail-closed (no unknown coerce); no invented deadlines; `100020` empty fold ≠ no deadlines; A1 cites + provenance; A2 when long walk; no new exercise tool | PR #13 (`ed40c2c`) |
| AT6 | Extend `adam_list_calendar` only; calendar/exc = explicit SoT; page = page-inferred only (never unlabeled→exc/calendar); `startsAt` only on ISO else omit; dedup same object+day: exc > calendar > page; enrolled-only; A1/A2; keep `100020`/`100021`; browser same rules (FAIL-to-fix: no coerce all exc-page dates to `source:exc`) | PR #14 (`16f08c8`) |

## Open (Phase A-thin)

None — Phase A-thin AT1–AT6 closed via PR #14 / `16f08c8`.

## Soft backlog (closed)

| ID | PASS | Closed |
| --- | --- | --- |
| A2-news-browser | Browser `listNews` emits `onProgress` during live page walk when set (fixture/WalkProgress parity); silent when omitted; AT4 honesty kept | PR #16 (`5593840`) |

## Phase B (closed)

| ID | PASS | Closed |
| --- | --- | --- |
| B-frm | `adam_get_forum` + `adam://frm/{refId}`; ConfirmGate on `threadId`; fail-closed `type===frm`; ADR 0012 + ADR 0008 envelope; labeled synthetic `100040` posts OK; live browser meta-only until HTML parse | PR #34 (`1a7931f`) |

## Keep

| | |
| --- | --- |
| **Fixture lock** | `100020` = empty Exercises **fold**; `100021` = **exc** with deadline (not a folder). Empty fold ≠ no deadlines. `100040` = labeled synthetic **frm** (AT5 style). |
| **Domain unlock** | 2026-09-14 tip `5099529`: live `frm`×1 via list_children; unlock **frm only**. `sess`/`webr` wait-for-inventory; `exc` unchanged; no invented types. |
| **P0–P2 harness** | (#34 @ `bc2ca8a`): P0 `npm test` hold; P1 resource+tool+ConfirmGate+fail-closed+envelope; P2 no writes/post/subscribe; no sess/webr/exc expand. |
| **Soft (not FAIL)** | Browser live thread/post HTML parse deferred — empty `threads` + `threadId` fail-closed until honest parse. |
| **Deferred** | A5 completions still deferred Phase B P1. |

## Queued (baseline B-series)

None — B1–B12 baseline gaps closed via PR #7 / `21728f3`.

## Next

Phase A backlog A1–A4 + A6 closed (A3/A4 = PR #9 / `a5e1fd6`). AT1/AT2 closed (PR #10 / `533d5c5`). AT3 closed (PR #11 / `01069ef`). AT4 closed (PR #12 / `b3bb0c0`). AT5 closed (PR #13 / `ed40c2c`). AT6 closed (PR #14 / `16f08c8`). Soft backlog **A2-news-browser** closed (PR #16 / `5593840`). **A5** completions deferred (Phase B P1). Phase A-thin complete. Phase B **B-frm** shipped fixture-side (PR #34 / `1a7931f`; live `threadId` withheld until HTML parse).
