# ADR 0015 - Enrolled walk memo lifecycle + getCourse listing honesty

## Context

`collectLivePages` memos the enrolled walk for search / calendar / news (PERF-1).
Invalidation was only `close()`, so a successful `login()` after session expiry
could keep serving a stale memo. Mid-walk `unauthorized` from `openAuthorized`
was counted as `skipped`, marked `partial`, and memoized — agents never saw
“re-login”. Separately, `getCourse` embedded children used `listingItemsOrEmpty`
but omitted `listingState`, so unknown/empty courses looked like truly empty
trees, and the `MAX_COURSE_CHILDREN` slice was silent.

## Alternatives

1. **TTL memo** — expire after N minutes. Still wrong across login; clock skew.
2. **No memo** — correct but re-walks every search/calendar/news call (slow).
3. **Clear on login + close; never memoize cancel/auth failure** (chosen).

## Decision

1. **Ownership.** Memo + inflight live on the `BrowserAdamProvider` instance.
2. **Invalidation.** `login()` and `close()` clear memo and inflight and bump a
   generation so a racing walk cannot rememoize after clear.
3. **Never memoize.** Cancelled walks (ADR 0011) and mid-walk `unauthorized`
   rethrow; they must not become `skipped` + memo. Ordinary per-page failures
   may still skip and set `partial`.
4. **getCourse honesty.** Attach `listingState` / `listingSignals` / `notice`
   like `list_children`. Classify before the embed cap. When children exceed
   `MAX_COURSE_CHILDREN`, set `truncated: true` and `totalChildrenHint`.

## Consequences

- Agents re-login on auth expiry instead of trusting a partial memo.
- Empty vs unknown course children are distinguishable on `adam_get_course`.
- Truncation is visible; MCP schemas already `.passthrough()` on objects.
