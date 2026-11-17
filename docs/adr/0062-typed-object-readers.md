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
