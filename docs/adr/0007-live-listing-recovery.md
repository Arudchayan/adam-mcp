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
2. **DOM evidence.** `PageSnapshot.dom?: { itemRows, emptyCopy, contentBlank }` merges the
   main frame and same-origin content frames: the probe that saw the most distinct rows
   wins, and empty copy / blank content only count when no probe saw rows.
   `classifyListing` reports `empty` only when no rows are visible and empty copy is
   present; blank content with no message reports `unknown` with
   `LISTING_BLANK_CONTENT_NOTICE` (it may be empty or not visible to this account);
   visible rows with no parseable ADAM links report `unknown` with
   `LISTING_ROWS_UNPARSED_NOTICE` (never `empty`, never invented items), and
   `chromeOnly` is false whenever rows or blank content are detected.
3. **Frame links.** Anchors from same-origin frames (strict origin equality, not a
   prefix match) merge into `snapshot.links` with dedupe by href+text; external and
   SWITCH/login frames are excluded. Chrome/breadcrumb flags are computed inside the
   frame, so frame nav that matches the chrome selectors stays filtered.
4. **Probe type cache.** An unknown landing URL never confirms the probed type, so a
   wrong probe no longer poisons later opens.
5. **Status verify-then-report.** `status()` probes the origin when the current tab
   is blank, off-origin, the origin root, or a login page; it waits a bounded time for
   dashboard/login markers and retries once when the page is neither. When the probe
   still lands on a login page, it re-checks once after a short bounded delay
   (cold-start bootstrap: the first request after a fresh Chrome launch can render
   `login.php` even though later requests are authenticated). This removes the
   observed leftover-tab false negative and the first-request race; a genuinely
   logged-out session still reports false.
6. **Redacted debug capture.** `ADAM_DEBUG_CAPTURE=1` (dir `ADAM_DEBUG_CAPTURE_DIR`,
   default `./scratch`, gitignored) writes structure-only JSON: patternized hrefs,
   tag/class skeleton with numeric ids masked, DOM counts, frame origins, title
   **length** (never the title). Non-structural parameter values and filename-like
   path segments are masked. No page text, titles, cookies, storage state, or bytes.
   Best-effort: capture never breaks a live request.

## Consequences

- Empty folders classify as honest `empty` and no longer burn the full readiness wait.
- A folder whose Content tab renders blank without a message reports the dedicated
  blank-content notice (possibly empty, possibly not visible to this account) instead
  of the misleading "list did not load".
- Content in frames or async lists can now yield objects; otherwise the notice is
  "rows are visible but unparsed" instead of a misleading "list did not load".
- `status()` may navigate the current tab once — one DCL navigation on a cold,
  foreign, or login tab — and retries transient pages before reporting a negative.
- Debug captures stay local. Do not commit them; strip real ref_ids before sharing.
- No new tools, no writes; read-only annotations unchanged. Async hydration
  (`waitForResponse` on the ILIAS item-list request) stays open until a capture
  shows whether it is required.
