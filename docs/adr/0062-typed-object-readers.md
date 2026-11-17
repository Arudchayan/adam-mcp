# ADR 0062: Typed object readers from ILIAS 10.12 lab evidence

## Status

Accepted. This ADR defines the contract that the per-type readers plug into. Each reader's own evidence and fields are recorded in an amendment below as it lands.

## Context

ADR 0057 made ILIAS 10.12 containers and content modules identifiable, citable and readable as page text. Issue #165 tracks their deeper structure: session dates and materials, wiki pages, learning-module chapters, glossary terms, data-collection rows, mediacast items, bibliography entries, booking availability, learning-sequence order, exercise peer review, and Private Notes.

The student account's courses contain none of these objects. The local lab runs the same ILIAS 10.12. Its student views were checked against ADAM (labels, panels and KS components matched), so the lab is accepted as student-side evidence. This is the same basis ADR 0060 used for staff views.

## Decision

**One tool, typed detail.** No new tool per type. `adam_read_page` (still confirm-gated) gains:

- `detail`: `{ kind, evidence, ...fields }` from the type's reader.
- `detailStatus`: `read` or `unrecognised`.
- An optional input `subPage` (an opaque id from an earlier `detail`) that reads one sub-page, such as a wiki page or a learning-module chapter.

`adam_list_children` stays the inventory tool for containers.

**Registry.** `packages/provider-browser/src/object-readers/index.ts` maps an object type to a reader. Each reader lives in its own file in that folder.

**Reader contract:**
- Input: the object's already-opened page, an optional `subPage`, and `open()`.
- `open()` loads only routes that `advertisedRoute(s)` accepted. The allowlist requires:
  - the pinned origin and `/ilias.php`
  - the expected `cmdClass`, plus `cmd` when the reader requires one; without one, only `show*`/`view*`/`preview*`/`render*`/`list*`/`infoScreen` commands
  - the same `ref_id`
  - only base keys plus keys the reader declares with value patterns
  - never `rtoken` or other token keys
- At most `MAX_READER_PAGES` (12) extra pages per read.
- Forms are never submitted.
- Output: `{ detail, text? }`, or `undefined` when the markup is not recognised.

**Fail safe:**
- An unrecognised page, a parser exception or a page-budget overrun leaves the plain text in place with `detailStatus: "unrecognised"`.
- Session, permission, cancellation and stale-id errors propagate.
- An unknown `subPage` returns `stale_id`. `subPage` on a type without a reader returns `unsupported_type`.

**Evidence label.** Every lab-built reader returns `evidence: "lab-verified"`. A reader becomes `live-verified` only after it is seen on ADAM.

**Read-only.** No booking, reservation, wiki edit, glossary edit, data-collection entry, peer-review submission, note write, rating or comment.

## Consequences

- One tool contract covers every type, so hosts see no new tools for the readers.
- Lab-built parsers may drift from ADAM's markup. They degrade to text, not to wrong data.
- Fixture parity is added per type as readers land.

## Amendment: readers landed (#165, 17 November 2026)

All readers are lab-verified on ILIAS 10.12 (`tools/ilias-lab`). The student account has no such objects on ADAM. Seed and capture scripts are in `tools/ilias-lab/seed/`; fixtures are in `packages/provider-browser/fixtures/lab/`.

| Type | `detail.kind` | Fields | Navigation (advertised routes only) | PR |
| --- | --- | --- | --- | --- |
| `sess` | `session` | `dateText`, `startsAt`, `endsAt`, `location`, `details`, `description`, `materials[{title,type,refId,url}]` | Materials come from the parent course's listing, expanded at this session. The parent is taken from the breadcrumb and opened at its canonical `/go/crs/{ref}`. The session's own expand link is then followed, scoped to the session's row. Up to 3 pages. | #172 |
| `book` | `booking-pool` | `objects[{title, description, bookable, freeSlots[{dayText,timeText,startsAt,endsAt,available}]}]` | Each bookable object's booking screen (`ilBookingProcessWithScheduleGUI`, `cmd=book`) is a GET week grid. A slot is never picked or confirmed. At most 5 objects, 10 slots each, current week only. | #172, #177 |
| `lso` | `learning-sequence` | `items[{position,title,description,status,current}]` | The learner view only. | #172 |
| `wiki` | `wiki` | `startPage`, `pages[{title, subPage}]`, `pageCount`, `truncated` | The `allPages` view. `subPage` is the numeric page id. It opens the advertised permalink `goto.php/wiki/wpage_{id}_{ref}` (or `/go/wiki/…`), validated by `wikiPermalink` because permalinks are not `ilias.php`. Editor names and logins are never read. | #173 |
| `glo` | `glossary` | `terms[{term, definition}]`, `termCount`, `truncated` | None. Definitions are capped at 1,000 chars. | #173 |
| `lm` | `learning-module` | `chapters[{title, pages[{title, subPage}]}]`, `pageCount` | `subPage` is the page `obj_id`, read through the presentation `cmd=layout` route. | #176 |
| `htlm` | `html-module` | `startFileSet` | `subPage: "start"` reads the start file. The allowed presentation route (`ilHTLMPresentationGUI`) is answered with a same-origin redirect to `deliver.php/<token>/…`. The `/ilias.php` rule applies to the requested route; the final page must still be on the pinned origin. | #176 |
| `copa` | `content-page` | `headings`, `sectionCount` | None. | #176 |
| `dcl` | `data-collection` | `tables[{title, columns, rows, rowCount, truncated}]` | The first page of records (cap 100). Values are untrusted and redacted. | #174 |
| `mcst` | `mediacast` | `items[{title, description?}]` | None. Never media bytes or download URLs. | #174 |
| `bibl` | `bibliography` | `entries[{title, authors, year, citeKey, subPage}]`, `entryCount` | `subPage` is an entry id, read through the advertised `showDetails` route. `sendFile` is never followed. | #174 |
| `itgr` | (listing) | Item groups appear in `adam_list_children`, from `cont_block_id=itgr_{ref}` blocks. This is **live-seen**: 5 item groups on the student's ADAM courses after #174, with no other listing changes. | n/a | #174 |

**Not covered:**
- Booking weeks other than the current one.
- Mediacast descriptions of items other than the one shown.
- Data-collection paging, other views and record details.
- Content-page sections other than headings.
- HTML-module files other than the start file. They are served under per-session `deliver.php` tokens.
- Session materials under a group parent.
- Learning-sequence links to the underlying objects.
