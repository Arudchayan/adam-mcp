# ADR 0021 — Fresh, complete and stable read results

## Context

Review reproductions showed a labelled dotted deadline matching an earlier date,
invalid calendar dates rolling into another month, unknown child listings losing
their incompleteness flag, and provider caches persisting until login or close.

## Decision

- Date parsing lives in `deadlines.ts`, separate from HTML catalog extraction.
  Parse the complete labelled value without matching unrelated page dates.
  Validate calendar components against the resulting date. Date-only evidence
  retains the existing UTC-midnight representation; it does not imply a known
  deadline clock time. Explicit offsets are preserved. Unzoned supported clock
  times use Europe/Zurich; ambiguous and nonexistent DST times are omitted.
- Unknown course/folder branches increment `skipped` and propagate `partial`
  through search, calendar and news. Empty exercise bodies are not mistaken for
  unknown containers. Partial walks and unknown container pages are not memoized.
- Page and complete-walk caches expire after 60 seconds. Repeated reads within
  that interval reuse data. Login, close and logged-out status clear caches.
  Restarting the MCP process is the immediate refresh path, without logging out.
- Browser pagination returns opaque decimal cursor tokens. Each token binds to
  an immutable result snapshot and its query/filter/type. Continuations retain
  original completeness metadata despite cache expiry or another listing.
  Tokens expire after ten minutes, are capped at 256, and clear on session
  invalidation. Expired/mismatched tokens fail `stale_id` with restart guidance.
  In-process fixture pagination keeps its decimal offsets. Hosts must copy tokens.
- Retained page snapshots are capped at 128. No disk cache is added.

## Verification

`deadlines.test.ts`, `unknown-walk.test.ts`, `cache-freshness.test.ts` and the
existing identity, cancellation, listing and MCP boundary suites. All inputs
are synthetic or committed scrubbed captures; no live inventory expansion.
