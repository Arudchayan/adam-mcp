# ADR 0011 - Output bounds, cancellation, retryability, redaction

## Context

22-agent review + live-content unblock: page text was capped at 50k in the browser path but silently (no `truncated` flag); long enrolled walks (`MAX_LIVE_PAGES=48`) ignored `notifications/cancelled`; `fail()` marked unknown bugs `retryable=true` (retry storms); redaction missed `password`/`api_key`/matriculation and used text redaction for URL fields.

## Decision

1. **Bounded page text with honesty.** `MAX_PAGE_CHARS=50_000` in `adam-core` (shared). `PageContent.truncated?: boolean`, `untrustedPageOutputSchema.truncated?`. Fixture `readPage` slices + sets `truncated`; browser `readPage` sets `truncated = snapshot.text.length > MAX_PAGE_CHARS` (extract already caps via `capText`). Truncate after `inferDates` so dates are not hidden.
2. **Cooperative cancellation.** `ObjectOpenOptions.signal?: AbortSignal` (hence `ListOptions.signal`). `throwIfCancelled(signal)` in `adam-core/errors.ts` throws `AdamError(cancelled, retryable=false)`. Fixture checks on entry; browser checks on entry + per walk iteration; cancelled walks are never memoized; walk `catch` rethrows `cancelled` instead of counting as `skipped`. MCP layer extracts signal via `signalFromContext(ctx)` (`ctx.signal` or `ctx.mcpReq.signal`) and threads it to every provider call; `throwIfCancelled` before `readPage`/`extract`/`listCourses`.
3. **Retryability fix.** `fail()` and `runProvider()` fallback for non-`AdamError` is `retryable=false` (was `true`). Only `provider_unavailable` defaults true. New `cancelled` code is non-retryable. Documented per-tool: retry once on `provider_unavailable`, re-`login` on `unauthorized`, never retry `confirmation_required` without user action, never retry `cancelled` automatically.
4. **Redaction breadth.** `redactText` also covers `password/passwd/passwort/api_key/secret` assignments and matriculation numbers; `redactUrl` also strips `password/api_key/secret` query keys. `deepRedact` uses `redactUrl` for `*url` keys, `redactText` elsewhere. Telemetry stays payload-free.

## Consequences

- Large pages are explicit (`truncated:true`); clients can deep-link instead of assuming completeness.
- Cancelled walks free the headless session; no partial memo poisoning.
- No retry storms on bugs/cancels.
- False-positive redaction risk is bounded to secret-like assignments; titles preserved.

## Tests

- `sota.test.ts`: truncation flag, cancelled walks (fixture + browser memo), retryable=false fallback, password/api_key/matriculation redaction, `redactUrl` query stripping.
- Existing caps (`MAX_EXTRACT_BYTES 8MB / CHARS 40k / PAGES 20`, `MAX_PAGE_TEXT 50k`) unchanged.

## Non-goals

- No MRTR/elicitation now (`confirm:true` stays). No subscriptions, icons, completions, HTTP, SOAP/HTML enable. No new object types (`sess/htlm/wiki/grp` still gated on live sighting).
