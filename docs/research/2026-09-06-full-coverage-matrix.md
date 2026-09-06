# Full ADAM capability coverage matrix (Domain)
Date: 2026-09-06  

**Note:** `docs/research/2026-09-05-*` are archived snapshots (not current rules). Current rules: `docs/scope.md`, `docs/capabilities.md`, `docs/ROADMAP.md`.
Product-complete bar = **M1–M13 read-only study workspace**, not full ADAM writes.
Live 2026-09-06: do not invent fixtures for types not yet seen live; multi-method hunt continues.

Sources: `docs/research/2026-09-05-product-spec.md`, `access-research.md`, `visual-validation.md`, `docs/scope.md`, `docs/capabilities.md`, `README.md`.

## (A) Must-ship reads still thin (toward M1–M13)

| Claim | ADAM capability | MCP today | Gap / next | Risk |
| --- | --- | --- | --- | --- |
| Deadline fusion | Cross-course deadlines + page dates | **partial** | First-class aggregation; empty fold ≠ no deadlines | Invented dates |
| Search | Enrolled tree | **partial** | Ranking; never claim global search | Overclaim |
| News / what-changed | File/activity | **partial**; live 1 course | Reliability on/off | Missed updates |
| Exercise read | `exc` | **tool yes**; **live-unverified** | Live `exc` or labeled synthetic | Integrity |
| Calendar honesty | Agenda vs page dates | **partial** | Document limits | False empty |
| Study-week loop | crs/fold/page/file | **strong**; live | Harden scrape | Copyright / injection |

## (B) Valuable unread surfaces (Phase B reads)

| Claim | MCP today | Gate |
| --- | --- | --- |
| Forum read (`frm`) | **no** | Live `frm` |
| `sess` / `webr` / modules | **no** | Live sighting |
| Postbox / MWA **list** | **no** | Live labels; upload = C |
| ADAMtools / wiki / blog / Etherpad read | **no** | Live |
| Own learning progress | **no** | Optional |

## (C) Never / gated

| Item | Stance |
| --- | --- |
| Submit / Postbox upload / forum post | **C gated** — deep-link first |
| `tst` / ADAM EXAM take | **Never** |
| Gradebook, member gallery, mail-as-agent | **Never** |
| File bytes, hosted MCP tunnel, mass RAG | **Never** |
| SOAP/REST student API | Unavailable unless Uni enables |

## Bottom line

1. Finish **(A)** / Phase A fixtures.  
2. **(B)** after live (or synthetic) gates.  
3. **(C)** deny/gated; never expand Phase B into exams/grades/mail/bytes.
