# ADAM ↔ adam-mcp capabilities

Living map of University of Basel ADAM student workflows to MCP coverage. Dated research notes stay under `docs/research/` (not current rules).

Status legend: **yes** | **partial** | **no** | **out** (must not ship) | **live?** (Chrome verification)

**Live pass (2026-09-06, Course Member session):** validated `crs`, standard `fold`, `file`, and News/what-changed on one contentful course; calendar widget present (agenda empty). **Not observed** then (do not invent fixtures): `exc`, `frm`, Postbox / Member Work Area, Etherpad, `sess`, `webr`, `htlm` / `lm`. Later: `frm` list_children **live-seen** (Domain tip `5099529`; B-frm #34/`1a7931f`); live thread summaries parse from forum HTML when present (posts still ConfirmGate; fail-closed if HTML missing); `webr` **live-seen** 2026-10-02 (`2291288`, `2291289` — `read_page` page-text readable via `https://adam.unibas.ch/go/webr/{id}`, ~2.2KB payloads; no generic fetch); park `sess` as **wait-for-inventory** (not actively hunting).

**Live pass (2026-09-09, ADR 0005 build):** 8 enrolled courses; only Multimedia Retrieval (`2206931`) exposes children — `list_children` → `ok` + 2 folds (`2291290`, `2291292`); the other 7 courses list zero children. Both MM folds report `listingState: unknown` (folder GUI served, no parseable items, no empty copy); `read_page` is chrome-only (538 chars). No `file`/`exc` reachable anywhere (`search pdf` → 0), so file-extract and exercise paths remain live-unverified for lack of live objects, not connector failure. Pre-semester timing (HS 2026) fits truly-empty folders. Re-verify after semester start.

**Live pass (2026-09-10, ADR 0006 build):** all 13 tools exercised through the connected browser server (10 live, `get_file`/`extract_file_text`/`get_exercise` fixture-only because no live file/exc refIds are exposed). Immutable folder state: MM folds still `unknown`, `list_files` empty everywhere. First `adam_session_status` probe after cold start reported `loggedIn: false` from a leftover `login.php` tab while live calls already worked (fixed by ADR 0007 verify-then-report). ADR 0007 also adds ILIAS 10.11 empty-copy parity, frame-link merging, DOM-evidence classification, and `ADAM_DEBUG_CAPTURE=1` redacted captures (`scratch/`, gitignored) so the next live pass can record the unknown fold markup without committing student data.

**Live verification (2026-09-10, ADR 0007 build):** reconnected server confirmed on the merged build. Read-only CDP inspection of MM folds (`2291290`, `2291292`): `tab_view_content` active, `#ilContentContainer > .row > #il_center_col` rendered with **no element children, no text, no rows, no empty copy, and no item-list network request** — ILIAS 10.11 renders an empty Content tab without a message. This is a blank content area, not a hydration failure; added `LISTING_BLANK_CONTENT_NOTICE` (state stays `unknown`; may be empty or not visible to this account). Cold-start first-probe `loggedIn: false` reproduced on the reconnected server; ADR 0007 now re-checks once when the probe lands on a login page.

**Design review (2026-09-10, 22-agent fleet):** independent protocol, session, security, reliability, testing, performance, modeling, UX, OSS, alternatives, and compliance reviews. Gaps raised then: narrow untrusted envelope, frame content merged across origins, prose-only errors without retryability, silent partial walks, login lifecycle (foreground process, headed default), test realism (no captured replay corpus), and consent/retention/i18n. **Closed since:** ADR 0008 (untrusted envelope, same-origin frames only, no silent partial walks, telemetry/dates); ADR 0009 (detached headless session holder — `npm run login` returns, window closes, server restarts are free, `npm run logout` stops it); W5 scrubbed replay corpus; structured ADAM error codes with `retryable` plus `forbidden`/`stale_id` recovery (ADR 0011/0016 and follow-ons). **Still open from that review:** consent/retention/i18n. Live ILIAS inventory and `sess` stay wait-for-inventory (not claimed done here).

**Replay corpus (2026-09-10, W5):** five scrubbed captures of live ILIAS 10.11 pages (dashboard, two courses — one contentful, one blank, two blank folders) live under `packages/provider-browser/fixtures/live/`. Regenerate with `npm run capture:fixtures` against a running holder; the script strips scripts/styles/svg, remaps every ref_id to a stable fake id, keeps only UI/empty-copy text, and keeps `id/class/role/href/aria-label` structure. `live-replay.test.ts` replays them through the memory session; the HTML link parser now detects ILIAS 10 chrome positionally (links outside `<main>`, footer, mainbar nav, breadcrumbs), which is what made blank pages replay identically to live.

**Live pass (2026-09-14, tip 5099529, deep enrolled walk):** 8 courses; `list_children`/`list_files` sighted live `file`×37 and `frm`×1; `get_file` ok; extract confirm (one over 8MiB, one truncated empty — now fail-closed, ADR 0014); `search(pdf|PDF|.pdf)` → crs/fold only (0 typed file hits); news×5 no refs; calendar×8; course-root rescan `exc`/`sess`/`webr`/`htlm`=0; some folds still unknown+blank (not empty); prior narrow 0-file probe superseded (incomplete, not parse-miss). Recording under `scratch/recordings/` gitignored. 2026-10-02 news sideblock replay (ADR 0018): label-only `News` blocks skipped, headline over first-`<a>`, course from typed href/page-URL/breadcrumb only (scrubbed capture `scratch/`, gitignored).

**Live pass (2026-11-14/15, ILIAS 10.12 `8.2.35`, 0.4.0 QA wave):** 8 enrolled courses, student session, counts and shapes only. Child types seen: `fold`×12 (23 including nested), `file`×37, `webr`×8, `exc`×2, `frm`×1, `svy`×1. Results: session survives forced `time_budget` aborts (ADR 0045); breadcrumbs root→parent; course News 0→10 dated items across 7 courses (block_news UI items); exercises give per-assignment units, and `view: all` reaches 8 and 3 assignments (ADR 0052); forum threads carry post/unread counts and latest post; PDF page windows via `startPage` (ADR 0047); 37/37 file rows give extension, size and change time (pages not shown in rows); repository root lists 6 category cards; 8/8 `webr` return destination metadata (ADR 0042); 23 folders give 20 `ok` and 3 structurally `empty`, owner-confirmed empty (ADR 0050); a course-scoped search takes 7–16 s (ADR 0048); the calendar has exc deadlines corroborated by Dashboard Tasks/Calendar and no file-upload noise (ADR 0051). Not seen: `sess`, `grp`, `itgr`, `lso`, `book`, `lm`, `htlm`, `copa`, `wiki`, `glo`, `mcst`, `poll`.

## 1. Purpose

Map real Uni Basel ADAM student workflows to MCP coverage. Read-only Phase A/B. No writes until Security + academic-integrity review.

## 2. Journeys (P0 / P1 / P2)

### P0 — ship / harden first

| Journey | User need | MCP today | Living checklist |
| --- | --- | --- | --- |
| Study week | Courses → folders/pages → new files → readable text | partial–strong | Harden browser scrape; `what_changed` fidelity; empty-folder ≠ no deadlines |
| Find materials | Title/keyword in enrolled tree; open file/page/link | partial→stronger (AT3) | Title-before-body ranking; `pdf`/`.pdf` → `type=file` when files exist; enrolled-tree only; cite `https://adam.unibas.ch/go/...`; never claim global search |
| Deadlines | Exercises + dates across courses | partial→stronger (AT6) | Provenance honesty; unlabeled page≠exc; dedup exc>calendar>page; no invented dates |

### P1 — expand reads

| Journey | User need | MCP today | Notes |
| --- | --- | --- | --- |
| Exercise awareness | Instructions, due date, own hand-in status | **Known** (`adam_get_exercise` per-assignment units + `view`); **live-seen** 2026-11-15 | ADR 0052 views via advertised routes; ADR 0053 `detail: true` reads each assignment page (schedule, own submission; **fixture-only**, live pending); instruction/feedback files not read (#129); submit stays in ADAM |
| News / what changed | New files & activity when lecturers enable News | **Known**; **live-seen** 2026-11-15 (10 items, 7 courses) | course `block_news` UI items, dated, keyed by news_id; block pagination and Dashboard news not read |
| Session / timetable blocks | Class dates in course (`sess`) | uncertain | **Wait-for-inventory** (empty enrolled re-verify; not hunting) |

### P2 — later reads

| Journey | User need | MCP today |
| --- | --- | --- |
| Forum read | Lecturer Q&A threads | **Fixture posts + live HTML threads** (B-frm #34/`1a7931f`; Domain tip `5099529` list_children). Live `threads` from listing HTML; `threadId` bodies ConfirmGate; missing HTML honest-empty / fail-closed |
| Groups / ADAMtools | Study groups, surveys (discover) | no |
| Wiki/blog/Etherpad read | Collab surfaces | no |
| Learning progress (own) | Completion if course enables LP | no |

### Out (do not Phase B)

Writes (submit, post, mail send), gradebook, member gallery, `tst` / ADAM EXAM, file bytes to model, hosted HTTP MCP.

## 3. Object-type matrix (living)

| Type / surface | Typical need | MCP | Live verify? |
| --- | --- | --- | --- |
| `crs` | Enrolled courses | yes | **done** (2026-09-06) |
| `fold` Standard | Materials | yes | **done** (2026-09-06) |
| `fold` Private | Tutor-only | n/a to members | confirm invisible |
| `fold` Postbox / Member Work Area | Hand-in / peer files | list? / write no | gated — needs live refId + capture per §4 principle, parked until sighted |
| page / course page | Announcements, dates | yes | smoke + date parse |
| `file` | PDFs/slides | partial (meta + extract) | **re-confirmed** live metadata 2026-09-14 tip 5099529 (file×37); extract confirm exercised |
| `exc` | Instructions, deadline, status | tool bodies via `adam_get_exercise` + confirm; resource `adam://exc/{refId}` is metadata only (no instructionText) | **live-seen** 2026-11-15: per-assignment units, `view` ongoing/upcoming/past/all (ADR 0052); labeled synthetic `100021` (AT5) |
| `sess` | Class meetings | uncertain | wait-for-inventory — empty enrolled re-verify; not hunting |
| `webr` | External links | partial (read_page) | **live-seen** 2026-10-02 `2291288`/`2291289` via `https://adam.unibas.ch/go/webr/{id}` (`read_page` page-text, ~2.2KB; no generic fetch; no fixture invented) |
| `htlm` / `lm` / SCORM | Learning modules | no/uncertain | gated — needs live refId + capture per §4 principle, parked until sighted |
| `frm` | Forums | **Known** (list + `adam_get_forum` + `adam://frm/{refId}`) | **live-seen** list 2026-09-14 tip 5099529; live threads from HTML when parse succeeds; missing HTML honest-empty / fail-closed posts; fixture `threadId` posts OK |
| `wiki` / `blog` / Etherpad | Collab | no | gated — needs live refId + capture per §4 principle, parked until sighted |
| `svy` | Surveys | partial (list + `read_page` info screen; never submitted) | ADR 0049 — `/go/svy/{id}` citations, `baseClass=ilObjSurveyGUI` landings; synthetic `100130`; **live-seen** as `svy` in listings 2026-11-15 |
| `poll` | Inline course polls | partial (list from vote form + `read_page`; never voted) | ADR 0049 — `/go/poll/{id}` citations; synthetic `100131`; live markup re-verify pending (#124) |
| `root` | Repository root categories | yes (ILIAS 10.12 `.il-card` tiles) | ADR 0049; **live-seen** 2026-11-15 (6 categories, `ok`) |
| `grp` / ADAMtools | Groups | no | gated — needs live refId + capture per §4 principle, parked until sighted |
| news sideblock | What changed | yes | **live-seen** 2026-11-15 (`block_news_{id}` UI items, #141) |
| calendar GUI | Agenda | partial→stronger | Dashboard Tasks + Calendar blocks as `source: calendar` (ADR 0051); full Tasks page on unscoped calendars (ADR 0056, live verification pending); exc deadlines; file-row dates excluded; calendar views and iCal feeds not read (write routes / tokens) |
| Private Notes / Comments | Personal notes | deferred | ADR 0056 — main-bar route seen, 0 notes on the probed account, so item markup is unverified; would be confirm-gated; never `exportNotesHTML` / `setSortation` |
| Learning Progress / Personal Workspace | Progress, own files | unavailable | ADR 0056 — not offered to students on ADAM |
| mail | Messaging | out | skip |
| grades / LP staff views | Scores | out | skip |
| `tst` / ADAM EXAM | Tests/exams | out | deny stays |
| members gallery | Roster | out (off by default) | skip |

Fixture SoT (QA): `100020` = empty Exercises folder; `100021` = `exc` with deadline — empty folder ≠ no deadlines.

## 4. Phase B read expansions (priority)

1. **Cross-course deadlines** — first-class aggregation of exercise + page dates (AT1/AT2 — PR #10 / `533d5c5`)  
2. **Exercise awareness** — harden `adam_get_exercise` (AT5 — PR #13 / `ed40c2c`; labeled synthetic `100021`); deep-link submit still **blocked** until live `exc`  
3. **News / what-changed reliability** when News is enabled (AT4 — PR #12 / `b3bb0c0`)  
4. **Enrolled-tree search ranking** (AT3 — PR #11 / `01069ef`; not global search)  
5. **Forum thread read** — **shipped** read-only fixture path (PR #34 / `1a7931f`; B-frm #35) plus live HTML thread parse; **no write**

Principle: deepen P0 reliability before new object types; Phase B stays gated — no code without a live refId + scrubbed capture (`ADAM_DEBUG_CAPTURE=1`, `scratch/` gitignored) + capabilities.md promotion + fixture mirror. Deep-link submit until gated write review.

## 5. Access path note

Browser Chrome session remains the production path. Public SOAP/REST probes on `adam.unibas.ch` returned 404 (2026-09-06 research). Revisit only if Uni Basel IT documents an API.

## 6. Citations (Uni Basel public)

- https://edutools.unibas.ch/en/edutools-is-adam/
- https://www.unibas.ch/en/Teaching/Designing-Teaching-and-Assessments/Learning-Platform-ADAM.html
- https://adam.unibas.ch/goto_adam_file_1439630_download.html (Student QSG)
- https://adam.unibas.ch/goto_adam_file_1424034_download.html (Folder types)
- https://adam.unibas.ch/goto_adam_file_1505644_download.html (Cooperative objects)
- https://adam.unibas.ch/goto_adam_usr_agreement.html (ToS)
- https://servicekatalog.unibas.ch/services/227
- https://adam.unibas.ch/robots.txt

## 7. Maintenance

ADAM Domain owns this file. Update after live Chrome passes. MCP Architect owns protocol shape of new tools/resources. QA owns fixture cases mirroring each live-verified type — never invent fixtures for types not seen live.
