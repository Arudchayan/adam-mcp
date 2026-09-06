# ADAM ↔ adam-mcp capabilities

Living map of University of Basel ADAM student workflows to MCP coverage. Dated research notes stay under `docs/research/` (not current rules).

Status legend: **yes** | **partial** | **no** | **out** (must not ship) | **live?** (Chrome verification)

**Live pass (2026-09-06, Course Member session):** validated `crs`, standard `fold`, `file`, and News/what-changed on one contentful course; calendar widget present (agenda empty). **Not observed** (do not invent fixtures): `exc`, `frm`, Postbox / Member Work Area, Etherpad, `sess`, `webr`, `htlm` / `lm`.

## 1. Purpose

Map real Uni Basel ADAM student workflows to MCP coverage. Read-only Phase A/B. No writes until Security + academic-integrity review.

## 2. Journeys (P0 / P1 / P2)

### P0 — ship / harden first

| Journey | User need | MCP today | Living checklist |
| --- | --- | --- | --- |
| Study week | Courses → folders/pages → new files → readable text | partial–strong | Harden browser scrape; `what_changed` fidelity; empty-folder ≠ no deadlines |
| Find materials | Title/keyword in enrolled tree; open file/page/link | partial→stronger (AT3) | Title-before-body ranking; enrolled-tree only; cite `https://adam.unibas.ch/go/...`; never claim global search |
| Deadlines | Exercises + dates across courses | partial | First-class aggregation; provenance + confidence; no invented dates |

### P1 — expand reads

| Journey | User need | MCP today | Notes |
| --- | --- | --- | --- |
| Exercise awareness | Instructions, due date, own hand-in status | tool partial (`adam_get_exercise`); **live-unverified** | Phase B blocked until a course with real `exc`; deep-link browser for submit |
| News / what changed | New files & activity when lecturers enable News | partial; **live-seen** on one course | Student QSG: News only if enabled |
| Session / timetable blocks | Class dates in course (`sess`) | uncertain | Live-verify when `sess` appears |

### P2 — later reads

| Journey | User need | MCP today |
| --- | --- | --- |
| Forum read | Lecturer Q&A threads | no — **blocked** until live `frm` |
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
| `fold` Postbox / Member Work Area | Hand-in / peer files | list? / write no | blocked — not observed |
| page / course page | Announcements, dates | yes | smoke + date parse |
| `file` | PDFs/slides | partial (meta + extract) | **done** metadata (2026-09-06) |
| `exc` | Instructions, deadline, status | tool partial | blocked — not observed |
| `sess` | Class meetings | uncertain | blocked — not observed |
| `webr` | External links | uncertain | blocked — not observed |
| `htlm` / `lm` / SCORM | Learning modules | no/uncertain | blocked — not observed |
| `frm` | Forums | no | blocked — not observed |
| `wiki` / `blog` / Etherpad | Collab | no | blocked — not observed |
| `grp` / `svy` / ADAMtools | Groups, surveys | no | discoverability |
| news sideblock | What changed | partial | **done** (one course, 2026-09-06) |
| calendar GUI | Agenda | partial (page walk) | widget seen; agenda empty |
| mail | Messaging | out | skip |
| grades / LP staff views | Scores | out | skip |
| `tst` / ADAM EXAM | Tests/exams | out | deny stays |
| members gallery | Roster | out (off by default) | skip |

Fixture SoT (QA): `100020` = empty Exercises folder; `100021` = `exc` with deadline — empty folder ≠ no deadlines.

## 4. Phase B read expansions (priority)

1. **Cross-course deadlines** — first-class aggregation of exercise + page dates  
2. **Exercise awareness** — instructions, due date, own status; deep-link submit (**blocked** until live `exc`)  
3. **News / what-changed reliability** when News is enabled  
4. **Enrolled-tree search ranking** (AT3 — this PR; not global search)  
5. **Forum thread read** before any write (**blocked** until live `frm`)

Principle: deepen P0 reliability before new object types; forum read before any write; deep-link submit until gated write review.

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
