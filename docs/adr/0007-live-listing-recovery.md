# ADR 0007 - Live listing recovery: empty-copy parity, frame links, DOM signals

## Context

Live pass (2026-09-10, ILIAS 10.11): `list_children` returned `listingState: unknown`
with zero items for the Multimedia Retrieval folders (`2291290`, `2291292`) and most
courses, so no live `file` / `exc` object was reachable. Investigation found:

- the empty-container regex missed real ILIAS 10 copy ("This object is empty and
  contains no items.", "No Materials Available", "Keine Einträge", "Keine Objekte
  gefunden"), so genuinely empty folders were misreported as `unknown`;
- frame link collection existed (b5fcc69) then was dropped (7eecd74): frame text/html
  merges but frame anchors never became objects;
- `classifyListing` derived from parsed links only, with no DOM evidence, and
  `chromeOnly` was hardcoded;
- `adam_session_status` on a cold start reported `loggedIn: false` from a leftover
  `login.php` tab while the authenticated session was live in the same browser;
- there was no privacy-safe way to inspect what an unknown live folder actually
  rendered.

## Decision

1. **Empty-copy parity.** `EMPTY_CONTAINER_COPY` (extract) is the single pattern used
   by both `isAdamEmptyContainerPage` and the session wait probe, covering the ILIAS
   10 EN/DE list and card copy.
2. **DOM evidence.** `PageSnapshot.dom?: { itemRows, emptyCopy }` is probed in the
   main frame and same-origin content frames. `classifyListing` reports `empty` on
   empty copy, and when DOM rows exist but no ADAM links parsed it reports `unknown`
   with `LISTING_ROWS_UNPARSED_NOTICE` (never `empty`, never invented items).
3. **Frame links.** Same-origin frame anchors merge into `snapshot.links` with
   dedupe by href+text; external/SWITCH frames are excluded.
4. **Probe type cache.** An unknown landing URL never confirms the probed type, so a
   wrong probe no longer poisons later opens.
5. **Status verify-then-report.** `status()` probes the origin when the current tab
   is blank, off-origin, the origin root, or a login page; it waits a bounded time
   for dashboard/login markers and retries once when the page is neither.
6. **Redacted debug capture.** `ADAM_DEBUG_CAPTURE=1` (dir `ADAM_DEBUG_CAPTURE_DIR`,
   default `./scratch`, gitignored) writes structure-only JSON: patternized hrefs,
   tag/class skeleton, DOM counts, frame origins. No page text, cookies, storage
   state, or bytes. Best-effort: capture never breaks a live request.

## Consequences

- Empty folders classify as honest `empty` and no longer burn the full readiness wait.
- Content in frames or async lists can now yield objects; otherwise the notice is
  "rows are visible but unparsed" instead of a misleading "list did not load".
- `status()` may navigate the current tab once — one DCL navigation on a cold,
  foreign, or login tab — and never fabricates a negative on a transient page.
- Debug captures stay local. Do not commit them; strip real ref_ids before sharing.
- No new tools, no writes; read-only annotations unchanged. Async hydration
  (`waitForResponse` on the ILIAS item-list request) stays open until a capture
  shows whether it is required.
