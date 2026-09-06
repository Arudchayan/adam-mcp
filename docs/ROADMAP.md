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

We already have an authenticated Chrome session. Gaps are usually **object types not present in the courses inspected so far**, not missing login. When a type is found live, promote it in capabilities.md and unlock Phase B work.

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
| A1 / A2 / A6 resource links, progress, read-by-id | Known (design) | Done (this PR) |
| A3 / A4 elicitation docs + SDK pin | Known | Next |
| Release tag / npm | Known | Held on SECURITY.md checklist |

## Phase A-thin — must-ship reads still incomplete

| Item | Confidence | Notes |
| --- | --- | --- |
| Cross-course deadline aggregation | Live-unverified | Page dates + `exc`; provenance required |
| Search ranking / filters | Known (partial) | Enrolled-tree only |
| News reliability | Known + live (thin) | On/off News courses |
| `adam_get_exercise` browser path | Live-unverified | Tool ships; need live `exc` or labeled synthetic |
| Calendar vs page-inferred dates | Known (partial) | Do not invent dates |

## Phase B — valuable unread surfaces (reads only)

After **live sighting** of each type (or honest synthetic fixture). Prefer resources for read-by-id; keep tool count tight.

| Item | Confidence | Gate |
| --- | --- | --- |
| Forum thread read (`frm`) | Unknown → hunting | Live `frm` |
| Session / timetable (`sess`) | Unknown → hunting | Live `sess` |
| Web links (`webr`) | Unknown → hunting | Live `webr`; no generic fetch |
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
