# ADR 0016 - Actionable upstream HTTP and permission errors

## Context

`fetchAuthorized` / `probeAuthorized` mapped every non-OK HTTP status to
`not_found`. Playwright `page.goto` timeouts surfaced as unexpected bugs
(`retryable=false` via ADR 0011). Permission pages (“keine Berechtigung” /
“permission denied”) were folded into `isAdamFailurePage` and reported as
“does not exist”. `stale_id` existed in `ADAM_ERROR_CODES` but was unused.

## Decision

1. **HTTP status map** (one taxonomy — `ADAM_ERROR_CODES` + `RETRYABLE_CODES`):
   - 404 → `not_found` (non-retryable)
   - 401 → `unauthorized` (re-login)
   - 403 → `forbidden` (access denied; never not-found wording)
   - 429 / 5xx → `provider_unavailable` (retryable)
2. **Permission HTML** → `forbidden`, not `not_found`.
3. **Ref identity mismatch** (requested ref_id ≠ landed typed ref_id) →
   `stale_id` (wired; was dead).
4. **Typed navigation failures** (Playwright timeout / `net::ERR_*`) →
   retryable `provider_unavailable`. Unknown bugs stay `retryable=false`
   (ADR 0011).
5. **HEAD probe** semantics unchanged (ADR 0013).

## Consequences

Agents see re-login vs permission vs missing vs retry. MCP tool copy that
says “not_found is the only missing-object error” remains true for absence;
`forbidden` / `stale_id` are distinct. On enrolled walks (search/calendar/news),
mid-walk `forbidden` and `stale_id` abort and rethrow like `unauthorized` —
they are never counted as ordinary skips or memoized as a successful partial
(ADR 0015). Optional long serial-queue wait lines go to stderr only.
