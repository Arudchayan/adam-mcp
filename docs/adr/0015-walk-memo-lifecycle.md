# ADR 0015 - Enrolled walk memo lifecycle + getCourse listing honesty

## Context

`collectLivePages` memos the enrolled walk for search / calendar / news (PERF-1).
Invalidation was only `close()`, so a successful `login()` after session expiry
could keep serving a stale memo. Mid-walk `unauthorized` / `forbidden` /
`stale_id` from `openAuthorized` were counted as `skipped`, marked `partial`,
and memoized — agents never saw re-login vs permission vs refresh. Separately,
`getCourse` embedded children used `listingItemsOrEmpty`
but omitted `listingState`, so unknown/empty courses looked like truly empty
trees, and the `MAX_COURSE_CHILDREN` slice was silent.

## Alternatives

1. **TTL memo** — expire after N minutes. Still wrong across login; clock skew.
2. **No memo** — correct but re-walks every search/calendar/news call (slow).
3. **Clear on login + close; never memoize cancel / unauthorized /
   forbidden / stale_id** (chosen).

## Decision

1. **Ownership.** Memo + inflight live on the `BrowserAdamProvider` instance.
   The same ownership covers `typeByRefId` and `fileByRefId`: process-lifetime
   maps keyed by ref_id that are identity-sensitive across sessions.
2. **Invalidation.** `login()` and `close()` clear memo and inflight and bump a
   generation so a racing walk cannot rememoize after clear. They also clear the
   type and file maps so type probes and download-abort titles cannot leak from a
   prior session. Cache writes (`rememberTypes`, `typeByRefId` / `fileByRefId`
   sets) stamp the generation observed when the open or walk started and no-op on
   mismatch, so an in-flight walk that finishes after clear cannot repopulate those
   maps either.
3. **Never memoize.** Cancelled walks (ADR 0011) and mid-walk `unauthorized`,
   `forbidden`, and `stale_id` (ADR 0016) rethrow; they must not become
   `skipped` + memo. Ordinary per-page failures may still skip and set `partial`.
4. **getCourse honesty.** Attach `listingState` / `listingSignals` / `notice`
   like `list_children`. Classify before the embed cap. When children exceed
   `MAX_COURSE_CHILDREN`, set `truncated: true` and `totalChildrenHint`.

## Consequences

- Agents re-login, refresh identity, or treat permission denial instead of
  trusting a partial memo that hid those codes.
- Empty vs unknown course children are distinguishable on `adam_get_course`.
- Truncation is visible; MCP schemas already `.passthrough()` on objects.
