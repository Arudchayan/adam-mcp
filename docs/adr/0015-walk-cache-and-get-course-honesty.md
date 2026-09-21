# ADR 0015 - Enrolled-walk cache ownership and get_course listing honesty

## Context

`search` / `list_calendar` / `list_news` share a browser-provider memo of the enrolled walk
(`collectLivePages`). The memo was invalidated on `close()` only, so a successful walk
before `login()` could be reused after a new SWITCH session. Mid-walk `unauthorized`
(session expiry on a child page) was counted as an ordinary skip, memoized as
`partial`, and returned to the caller as a successful short list. Separately,
`getCourse` applied `listingItemsOrEmpty` but omitted `listingState`, so
`children: []` on an unknown course listing looked like a truly empty course. Children
sliced at `MAX_COURSE_CHILDREN` (100) had no truncation signal.

## Decision

1. **Walk-cache ownership.** `BrowserAdamProvider` owns `livePagesMemo`,
   `livePagesInflight`, and `walkEpoch`. A memo entry is valid only for the current
   epoch. `login()` and `close()` bump the epoch and clear memo + inflight so an
   in-flight walk started under a prior auth cannot become the cached result.
2. **What may be memoized.** Only a completed `WalkResult` is stored. Cancelled walks
   stay uncached (ADR 0011). `unauthorized` mid-walk is rethrown to the
   search/calendar/news caller and is never memoized as partial. Ordinary per-page
   failures may still skip and set `partial`.
3. **get_course honesty.** Course snapshots that embed `children` also carry
   `listingState` / `listingSignals` / optional `notice` (same semantics as
   `list_children`, ADR 0005). When the listing is not `ok`, `children` is `[]` and
   callers must not treat that as empty unless `listingState === "empty"`. When the
   pre-slice child count exceeds `MAX_COURSE_CHILDREN`, set `truncated: true` and
   `childrenTotalHint` to the pre-slice count; otherwise `truncated: false`.
4. **Fixture parity.** Fixture `getCourse` embeds resolved children with the same
   honesty fields (catalog is complete → `ok` or `empty`, never silent unknown).

## Consequences

- Re-login always forces a fresh enrolled walk for search/calendar/news.
- Session expiry during a walk surfaces as `unauthorized` (re-login), not a quiet
  partial cache hit.
- Models and hosts can distinguish empty courses from unknown listings on
  `adam_get_course` without calling `list_children`. MCP `adamObjectOutputSchema` is
  `.passthrough()`, so new fields flow without a schema edit; documenting them in
  the schema remains a follow-up.

## Tests

- Memo does not survive `login()` (re-walk opens increase).
- Mid-walk `unauthorized` rejects and is not memoized as partial.
- Unknown course listing returns `listingState: "unknown"` with `children: []`.
- >100 parseable children sets `truncated: true` and `childrenTotalHint`.
- Fixture `getCourse` exposes `listingState` with embedded children.

## Non-goals

- No parallel Chrome, no new tools, no SOAP/HTML enable. No change to confirm gates,
  `tst` deny, or empty-extract fail-closed. MCP schema prose for the new get_course
  fields is deferred to the MCP owner.
