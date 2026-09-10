# ADR 0008 - Server-wide untrusted envelope, frame origin, telemetry, partial walks

## Context

A 22-agent design review found that the untrusted-content envelope only covered
`adam_read_page` and `adam_extract_file_text`: news summaries, exercise
instruction text, titles, and calendar labels reached the model unmarked.
Separately, frame text and HTML merged into snapshots from **any** frame while
only frame links were origin-checked; redaction missed SAML and Shibboleth
artifacts; every failure reached the model as prose without retryability; walks
swallowed per-page errors, so results could be silently partial; and AT6
calendar dedup ranked source preference above explicit evidence while dropping
corroborating sources. DE date copy such as `22. September 2026` and labels like
`Abgabefrist` were not parsed.

## Decision

1. **Server-wide untrusted envelope.** Every read tool (courses, children,
   files, search, exercise, calendar, news, plus page/extract) returns
   `untrusted: true` and a notice. Listings and structured data use
   `UntrustedContent.DATA_NOTICE`; page text and extracts keep the page notice.
2. **Same-origin frames only.** A frame contributes links, text, and HTML only
   when `sameOrigin(frame.url(), origin)`. Cross-origin frames are skipped
   entirely (ADR 0007 merged text/HTML from any frame; links were already gated).
3. **Redaction expansion.** `redactText`/`redactUrl` also cover Basic auth,
   `SAMLRequest`/`SAMLResponse`/`SAMLart`/`RelayState`, and `_shibsession_*`.
4. **Structured retryability and run ids.** `AdamError` defaults
   `provider_unavailable` to `retryable: true`; failures render
   `code: message (retryable=…)(runId=…)`. Every tool call logs one JSON line to
   stderr: `ts, runId, tool, outcome, ms, code?, retryable?, listingState?,
   partial?, skipped?` (stdout stays JSON-RPC only).
5. **No silent partial walks.** The enrolled walk returns
   `{ pages, partial, skipped }`; a skipped page, an unknown home listing, or
   hitting `MAX_LIVE_PAGES` marks `partial: true` and attaches
   `WALK_PARTIAL_NOTICE` to search/calendar/news results.
6. **Calendar corroboration.** Dedup keeps the same object+day key but ranks
   explicit evidence above source preference (exc > calendar > page on ties) and
   records all contributing sources in `seenIn`.
7. **DE/EN dates.** `inferDates` accepts `22. September 2026`, `22. Sep 2026`,
   and `September 22, 2026`; deadline labels include `Abgabefrist` and `Frist`.

## Consequences

- Prompt-injection surface shrinks: everything ADAM-sourced is marked; external
  iframes can no longer inject text into page snapshots.
- Models can distinguish retryable failures, correlate a call with stderr logs,
  and see when a walk was partial instead of trusting a silently short list.
- Telemetry is local, redacted, and line-oriented; it never carries payload text.
- Calendar output may now prefer an explicit calendar row over an inferred
  exercise row for the same object+day; `seenIn` preserves the corroboration.
- No new tools, no writes; read-only annotations unchanged.
