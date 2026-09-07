# ADAM MCP roadmap

Living sequencing for University of Basel ADAM coverage. Community project — not a University service.

**SoT:** [capabilities.md](capabilities.md) (living), [scope.md](scope.md) (ships / does not ship).  
`docs/research/2026-09-05-*.md` are **archived historical** snapshots, not current rules.

**Product-complete bar:** M1–M13 **read-only study workspace** (historical product-spec), not a full ADAM write mirror.

## Confidence

| Label | Meaning |
| --- | --- |
| **Known** | In scope.md / shipped tools, and/or observed in a Course Member session |
| **Live-unverified** | Tool or plan exists; not yet seen on live ADAM for this project |
| **Unknown** | May exist on ADAM; no live sighting yet — **actively hunting** via deep walks, in-ADAM search, Magazin/public cats, ADAMtools (not “impossible”) |
| **Wait-for-inventory** | Empty re-verify of enrolled courses found none; **parked** — not actively hunting; unlock when inventory/sighting appears |

We already have an authenticated Chrome session. Gaps are usually **object types not present in the courses inspected so far**, not missing login. When a type is found live, promote it in capabilities.md and unlock Phase B work. Some types (`frm` / `sess` / `webr`) are **wait-for-inventory** after empty enrolled re-verify rather than active hunt.

## Phase A — Harden shipped reads (fixture-first)

Checklist: [qa/phase-a-test-plan.md](qa/phase-a-test-plan.md), [qa/phase-a-mcp-compliance-checklist.md](qa/phase-a-mcp-compliance-checklist.md).

| Item | Confidence | Status |
| --- | --- | --- |
| Docs / OSS DX (badge, CHANGELOG, capabilities, QA docs) | Known | Done (PR #1) |
| B6 untrusted notice on page/extract | Known | Done (PR #2) |
| B10 synthetic `tst` fail-closed | Known (policy) | Done (PR #5, `8af49c0`) |
| B4 confirm RPC | Known (schema) | Done (PR #6, `5982bdd`) |
| B11 / B12 no deprecated MCP / no OAuth on stdio | Known | Done (PR #7, `21728f3`) |
| Empty Exercises fold ≠ no deadlines (`100020` fold / `100021` exc) | Known (fixture SoT) | Locked |
| Study-week `crs` / `fold` / `file` / pages | Known + live | Live pass 2026-09-06 |
| A1 / A2 / A6 resource links, progress, read-by-id | Known (design) | Done (PR #8, `e52d947`) |
| A3 / A4 confirm≠elicitation docs + SDK pin | Known | Done (PR #9 / `a5e1fd6`) |
| Release tag / npm | Known | Done v0.1.0 |

## Phase A-thin — must-ship reads still incomplete

| Item | Confidence | Notes |
| --- | --- | --- |
| Cross-course deadline aggregation (AT1/AT2) | Live-unverified | Done (PR #10 / `533d5c5`) — extend `adam_list_calendar`; provenance |
| Search ranking / filters (AT3) | Known (partial) | Done (PR #11 / `01069ef`) — enrolled-tree only; title before body |
| News reliability (AT4) | Known + live (thin) | Done (PR #12 / `b3bb0c0`) — extend `adam_list_news`; news-on/off |
| `adam_get_exercise` browser path (AT5) | Live-unverified | Done (PR #13 / `ed40c2c`) — labeled synthetic `100021` |
| Calendar vs page-inferred dates (AT6) | Known (partial) | Done (PR #14 / `16f08c8`) — unlabeled→page; dedup exc>calendar>page |
| Soft backlog A2-news-browser (`listNews` onProgress) | Known | Done (PR #16 / `5593840`) — browser live-walk progress parity with fixture |

## Phase B — valuable unread surfaces (reads only)

After **live sighting** of each type (or honest synthetic fixture). Prefer resources for read-by-id; keep tool count tight.

`frm` / `sess` / `webr`: parked as **wait-for-inventory** after empty re-verify of enrolled courses — not actively hunting; wait for inventory.

| Item | Confidence | Gate |
| --- | --- | --- |
| Forum thread read (`frm`) | Wait-for-inventory | Live `frm` (parked; not hunting) |
| Session / timetable (`sess`) | Wait-for-inventory | Live `sess` (parked; not hunting) |
| Web links (`webr`) | Wait-for-inventory | Live `webr`; no generic fetch (parked; not hunting) |
| HTML / LM modules | Unknown → hunting | Live presence |
| Postbox / MWA **list** | Unknown → hunting | Live labels; upload = Phase C |
| ADAMtools `grp` / `svy` discover | Unknown → hunting | Live |
| Wiki / blog / Etherpad **read** | Unknown → hunting | Live |
| Own learning progress | Unknown | Optional; own data only |

## Phase C — gated writes (not default)

Only after ToS / academic-integrity review, ADR, and host elicitation. Prefer deep-link to ADAM first.

| Item | Stance |
| --- | --- |
| Exercise submit / Postbox upload | Gated |
| Forum post / enroll | Gated or never as default |
| Mail send as agent | Prefer never |

## Never (deny)

| Item | Why |
| --- | --- |
| Take `tst` / ADAM EXAM | Integrity — hard deny |
| Gradebook scrape | Privacy |
| Member gallery / user search | Privacy |
| File bytes / base64 to model | Copyright |
| Hosted HTTP MCP / session tunnel | SWITCH session stays local |
| Mass PDF crawl / RAG corpus | Copyright + retention |

## Sequencing

1. Phase A fixture gaps  
2. Phase A-thin read quality  
3. Phase B after live (or synthetic) gates  
4. Phase C only with explicit review  

SOAP/REST on public ADAM remain unavailable per historical notes — browser session stays the live path unless Uni Basel documents otherwise.

## How to pick up work

1. Read [AGENTS.md](../AGENTS.md) and [scope.md](scope.md).  
2. Prefer fixture PRs that close a Phase A checkbox.  
3. Record new live object sightings in [capabilities.md](capabilities.md).
