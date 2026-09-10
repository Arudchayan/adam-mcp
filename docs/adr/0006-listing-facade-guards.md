# ADR 0006 - Listing facade guards and broader HTML fail-closed

## Context

B10 denies object type `tst` and providers filter it, but the MCP facade trusted
provider output: a provider bug could surface `tst` rows. The fixture also stored
full `ExerciseObject` records (with `units`) in its catalog, so `list_children`
and `search` returned exercise units (`instructionText`, `deadline`,
`ownStatus`); listing schemas are `.passthrough()`, so the extras reached the
model. Separately, `looksLikeHtml` only inspected an 80-byte prefix, so an ADAM
login/error page whose markup starts with `<form`, `<body`, or `<meta` could be
treated as file bytes during local extract.

## Decision

- `sanitizeListingItems` (mcp results) runs on every listing surface:
  `adam_list_courses`, `adam_list_children`, `adam_search`, and the
  `adam://me/courses` / `adam://fold/{refId}` resources. It drops
  `isDeniedObjectType` rows, strips `units` from remaining rows, and reduces
  `totalHint` / `listingSignals.contentItemCount` by the dropped count so
  listing metadata stays consistent.
- Fixture listings and search emit summary rows (`childSummary`) instead of
  catalog records; `getExercise` remains the only source of units.
- `looksLikeHtml` scans the first 1024 bytes and treats `<!doctype`, `<html`,
  `<?xml`, or a `<body` / `<form` / `<script` / `<meta` tag (or an HTML content
  type) as HTML, so extract refuses a login/error page instead of ingesting it.

## Consequences

- Listing surfaces cannot leak denied types or exercise units even if a
  provider regresses; tests inject both through a fixture provider and assert
  the MCP payload stays clean.
- `looksLikeHtml` may classify unusual plain-text payloads (no content type,
  literal `<script` / `<meta` in the first KB) as HTML. Browser extract fails
  closed and tells the student to open the canonical ADAM URL; `text/plain`
  content types are still extracted.
- No new tools, no write paths, and no change to the read-only annotations.
