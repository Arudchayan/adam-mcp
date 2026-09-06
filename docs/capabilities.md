# Living doc outline: ADAM ↔ adam-mcp capabilities
Proposed path: `docs/capabilities.md` (living). Dated research stays under `docs/research/YYYY-MM-DD-*.md` (not current rules).

Status legend: **yes** | **partial** | **no** | **out** (must not ship) | **live?** (needs Chrome verification)

## 1. Purpose
Map real Uni Basel ADAM student workflows to MCP coverage. Read-only Phase A/B. No writes until Security + academic-integrity review.

## 2. Journeys (P0 / P1 / P2)

### P0 — ship / harden first
| Journey | User need | MCP today | Living checklist |
|---|---|---|---|
| Study week | Courses → folders/pages → new files → readable text | partial–strong | Harden browser scrape; `what_changed` prompt fidelity; empty-folder ≠ no deadlines |
| Find materials | Title/keyword in enrolled tree; open file/page/link | partial | Ranking/filters; cite `adam.unibas.ch/go/...`; never claim global search |
| Deadlines | Exercises + dates across courses | partial | First-class aggregation; provenance + confidence; no invented dates |

### P1 — expand reads
| Journey | User need | MCP today | Notes |
|---|---|---|---|
| Exercise awareness | Instructions, due date, own hand-in status | partial | Read status only; deep-link browser for submit |
| News / what changed | New files & activity when lecturers enable News | partial | QSG: News only if enabled |
| Session / timetable blocks | Class dates in course (`sess`) | uncertain | Live-verify object listing |

### P2 — later reads
| Journey | User need | MCP today |
|---|---|---|
| Forum read | Lecturer Q&A threads | no |
| Groups / ADAMtools | Study groups, surveys (discover) | no |
| Wiki/blog/Etherpad read | Collab surfaces | no |
| Learning progress (own) | Completion if course enables LP | no |

### Out (do not Phase B)
Writes (submit, post, mail send), gradebook, member gallery, `tst` / ADAM EXAM, file bytes to model, hosted HTTP MCP.

## 3. Object-type matrix (living)

| Type / surface | Typical need | MCP | Live verify? |
|---|---|---|---|
| `crs` | Enrolled courses | yes | smoke |
| `fold` Standard | Materials | yes | smoke |
| `fold` Private | Tutor-only | n/a to members | confirm invisible |
| `fold` Postbox / Member Work Area | Hand-in / peer files | list? / write no | **yes** — listing vs upload UI |
| page / course page | Announcements, dates | yes | smoke + date parse |
| `file` | PDFs/slides | partial (meta + extract) | mime/size/pages |
| `exc` | Instructions, deadline, status | partial | **yes** — units, ownStatus, feedback presence |
| `sess` | Class meetings | uncertain | **yes** |
| `webr` | External links | uncertain | **yes** |
| `htlm` / `lm` / SCORM | Learning modules | no/uncertain | **yes** presence as children |
| `frm` | Forums | no | **yes** structure for Phase B read |
| `wiki` / `blog` / Etherpad | Collab | no | presence only |
| `grp` / `svy` / ADAMtools | Groups, surveys | no | discoverability |
| news sideblock | What changed | partial | **yes** — with/without News enabled |
| calendar GUI | Agenda | partial (page walk) | **yes** — vs page-inferred dates |
| mail | Messaging | out | skip |
| grades / LP staff views | Scores | out | skip |
| `tst` / ADAM EXAM | Tests/exams | out | deny stays |
| members gallery | Roster | out (off by default) | skip |

## 4. Phase B read expansions (priority)
See eng post: top 5. Principle: deepen P0 reliability before new object types; forum read before any write; deep-link submit forever until gated write review.

## 5. Access path note (living)
Browser Chrome session remains the production path. Public SOAP/REST probes on adam.unibas.ch returned 404 (2026-09-06 research). Revisit only if Uni Basel IT documents an API.

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
ADAM Domain owns this file. Update after live Chrome passes. MCP Architect owns protocol shape of new tools/resources. QA owns fixture cases mirroring each live-verified type.
