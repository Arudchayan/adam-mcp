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
| **Unknown** | May exist on ADAM; **no live sighting yet — gated, not hunting**. Code unlock requires live refId + scrubbed capture (`ADAM_DEBUG_CAPTURE=1`, `scratch/` gitignored) + capabilities.md promotion + fixture mirror. No code without inventory |
| **Wait-for-inventory** | Empty re-verify of enrolled courses found none; **parked** — not actively hunting; unlock when inventory/sighting appears |

We already have an authenticated Chrome session. Gaps are usually **object types not present in the courses inspected so far**, not missing login. When a type is found live, record it in capabilities.md; expansion still requires the capture gate below. `sess` remains **wait-for-inventory** after empty enrolled re-verify. `webr` is **Known/live (page-text only)** from the 2026-10-02 sightings recorded in capabilities.md; no matching scrubbed listing/Weblinks-tab capture was found in the issue #84 repository review. `frm` is **Known/live** 2026-09-14 (tip 5099529).

**Stop rule:** do not expand a type or view without evidence: an enrolled-inventory sighting (live refId + scrubbed capture), or, for views the student account cannot see, a capture from the local ILIAS 10.12 lab ([ilias-lab.md](ilias-lab.md)) labelled **lab-verified** in the ADR, capabilities.md and tool output. No code without evidence.

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
| Release tag / npm | Known | **0.4.0 published** 17 November 2026 ([record](audit/2026-11-17-v0.4.0-publication.md)); **0.3.0 published**; public registry integrity and installed CLI help/refusal verified 11 November 2026. See [publication evidence](audit/2026-10-21-v0.3.0-release-readiness.md). The original publication workflow's propagation-time verification failure remains recorded. |

## Phase A-thin — must-ship reads still incomplete

| Item | Confidence | Notes |
| --- | --- | --- |
| Cross-course deadline aggregation (AT1/AT2) | Live-unverified | Done (PR #10 / `533d5c5`) — extend `adam_list_calendar`; provenance |
| Search ranking / filters (AT3) | Known (partial) | Done (PR #11 / `01069ef`) — enrolled-tree only; title before body |
| News reliability (AT4) | Known + live (thin) | Done (PR #12 / `b3bb0c0`) — extend `adam_list_news`; news-on/off |
| `adam_get_exercise` browser path (AT5) | Live-unverified | Done (PR #13 / `ed40c2c`) — labeled synthetic `100021` |
| Calendar vs page-inferred dates (AT6) | Known (partial) | Done (PR #14 / `16f08c8`) — unlabeled→page; dedup exc>calendar>page |
| Soft backlog A2-news-browser (`listNews` onProgress) | Known | Done (PR #16 / `5593840`) — browser live-walk progress parity with fixture |

## 0.4.x QA wave (November 2026) — live-verified on ILIAS 10.12

Black-box QA on 0.4.0 filed #118–#133. All bugs are fixed, live-verified and closed. Each change is one PR with tests; ADRs 0045–0052.

| Item | Issue | Status |
| --- | --- | --- |
| Session lost after `time_budget` aborts (last holder tab closed) | #118, #126 | Done (PR #134, ADR 0045) |
| Breadcrumbs root→parent, no duplicates | #122, #126 | Done (PR #135) |
| CLI `status` JSON, post-login race, abandoned locks | #123 | Done (PR #136, ADR 0046) |
| Typed-getter type checks; `svy`/`poll`/root cards | #124 | Done (PR #137, #144, ADR 0049) |
| Forum counts, latest post, post times | #125 | Done (PR #138) |
| Extract `startPage`, `.ipynb`, uploaded HTML, size hint | #121 | Done (PR #139, ADR 0047) |
| Per-assignment exercise units; Past/All views | #120, #129 | Done (PR #140, #149, ADR 0052) |
| Course News blocks | #118 | Done (PR #141) |
| File-row extension/size/date | #122 | Done (PR #142) |
| Search walks containers only | #126 | Done (PR #143, ADR 0048) |
| Calendar: exc deadlines, no file-row dates; Dashboard Tasks/Calendar | #119, #132 | Done (PR #145, #147, ADR 0051) |
| Structurally empty folders | #86 | Done (PR #146, ADR 0050) |
| Web Link destinations | #84 | Live-verified (PR #113, ADR 0042) |
| Sign-in across shutdown | #133 | Not planned: auth cookies are session-scoped (docs/session-recovery.md) |

Epics #127–#132 are closed (November 2026):

| Item | Issue | Status |
| --- | --- | --- |
| Exercise detail: schedule, own submission, files, sample solution, team, evaluation | #129 | Done (PR #152, #162, ADR 0053) |
| Read-only ADAM mail, confirm-gated | #132 | Done (PR #155, ADR 0054) |
| Dashboard News block and bounded News pagination | #132 | Done (PR #156, #158, ADR 0055) |
| Full Tasks page; Private Notes deferred | #132 | Done (ADR 0056) |
| Enrolled courses from the membership overview | — | Done (PR #160, ADR 0059) |
| Local ILIAS 10.12 lab for structure evidence | #128 | Done (PR #161) |
| Staff views: members and grade matrix (lab-verified) | #128 | Done (PR #163, ADR 0060) |
| Containers and content modules typed; groups walked | #127, #130, #131 | Done (PR #164, ADR 0057) |

Evidence-gated remainder (staff confirmation on ADAM, peer review, per-type readers, Opencast/Etherpad, Private Notes): [#165](https://github.com/Arudchayan/adam-mcp/issues/165).

## Phase B — valuable unread surfaces (reads only)

After **live sighting** of each type. Labeled synthetic mirrors allowed for an already-unlocked type only (e.g., AT5 `100021`, B-frm `100040`). Prefer resources for read-by-id; keep tool count tight.

`sess`: parked as **wait-for-inventory** after empty re-verify of enrolled courses — not actively hunting. `webr`: historically live-seen for page text, but listing heuristics and destination metadata remain **capture-gated**, not actively hunting. See [issue #84 evidence boundary](qa/issue-84-web-links.md); this corrects the older blanket wait-for-inventory label without unlocking expansion.

| Item | Confidence | Gate |
| --- | --- | --- |
| Forum thread read (`frm`) | Known + live | Live `frm` Domain 2026-09-14 tip 5099529 `list_children`; live HTML threads when parse succeeds (ADR 0012) |
| Session / timetable (`sess`) | Wait-for-inventory | Live `sess` refId + scrubbed capture (`ADAM_DEBUG_CAPTURE=1`, `scratch/` gitignored); then capabilities.md promotion + fixture mirror (parked; not hunting) |
| Web links (`webr`) | Known + live (page-text only) | Historical sightings in capabilities.md do not supply the scrubbed listing/Weblinks-tab capture needed for new classification heuristics or destination metadata. Require live refId + matching scrubbed capture, then fixture mirror; no generic fetch (capture-gated; not hunting) |
| HTML / LM modules | Unknown | Live `htlm` / `lm` refId + scrubbed capture (`ADAM_DEBUG_CAPTURE=1`, `scratch/` gitignored); then capabilities.md promotion + fixture mirror (gated; not hunting) |
| Postbox / MWA **list** | Unknown | Live Postbox / MWA refId + scrubbed capture (`ADAM_DEBUG_CAPTURE=1`, `scratch/` gitignored); then capabilities.md promotion + fixture mirror; upload = Phase C (gated; not hunting) |
| ADAMtools `grp` / `svy` discover | Unknown | Live `grp` / `svy` refId + scrubbed capture (`ADAM_DEBUG_CAPTURE=1`, `scratch/` gitignored); then capabilities.md promotion + fixture mirror (gated; not hunting) |
| Wiki / blog / Etherpad **read** | Unknown | Live `wiki` / `blog` / Etherpad refId + scrubbed capture (`ADAM_DEBUG_CAPTURE=1`, `scratch/` gitignored); then capabilities.md promotion + fixture mirror (gated; not hunting) |
| Own learning progress | Unknown | Optional; own data only; live LP refId + scrubbed capture (`ADAM_DEBUG_CAPTURE=1`, `scratch/` gitignored); then capabilities.md promotion + fixture mirror (gated; not hunting) |

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
3. Phase B after live gates (synthetic mirrors for already-unlocked types only)  
4. Phase C only with explicit review  

SOAP/REST on public ADAM remain unavailable per historical notes — browser session stays the live path unless Uni Basel documents otherwise.

## How to pick up work

### Published: 0.3.0 — downloads and dependable discovery

- Published: selected single-file CLI downloads (ADR 0027), bounded
  PDF waiting demand and scope-keyed shared discovery (ADR 0028), synthetic benchmarks.
- Exact-commit cross-platform CI, independent review, selected-file live verification
  and installed-client walkthrough are recorded in the
  [release evidence](audit/2026-10-21-v0.3.0-release-readiness.md). Public npm
  availability and installed CLI help/refusal were independently checked on
  11 November 2026; no new publication was performed.
- Deferred: batches, metadata inventory diffs, resumable traversal, OCR and new
  object types. Existing Phase B inventory gates remain in force.

Local onboarding and read controls (ADR 0025) now include guided setup, passive
diagnostics, portable client configuration/timeouts, clear session states,
structured errors, course-scoped discovery and explicit refresh. See the
[production-readiness record](qa/production-readiness.md) for verified outcomes
and outstanding release/client gates.

1. Read [AGENTS.md](../AGENTS.md) and [scope.md](scope.md).  
2. Prefer fixture PRs that close a Phase A checkbox.  
3. Record new live object sightings in [capabilities.md](capabilities.md).
