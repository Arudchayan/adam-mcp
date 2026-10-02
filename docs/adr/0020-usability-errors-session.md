# ADR 0020 — Usability: resource error parity, type-conflict guidance, session status alignment

## Context

Phase 2 behavior-leaning usability fixes (cou-7 Fixes 2–4 behavior parts).
Phase 1 copy work is reconciled. No new tools/resources/prompts; elicitation
fallback semantics untouched (`packages/mcp/src/elicitation.ts` timeout/shim
unchanged).

Gaps:

1. `mapResourceError` (`packages/mcp/src/server.ts`) threw bare `Error`
   for `unauthorized`/`forbidden`/`stale_id`/`provider_unavailable`, losing
   `code`/`retryable` as structured properties. Tools return the one-line
   `fail()` text `code: msg (retryable=) (runId=)`; resources did not match.
2. `TYPE_CONFLICT` (`packages/mcp/src/schemas.ts`) failed closed with
   "fix one of them — do not guess" but no next step; agents needed an extra
   round-trip to recover. `study_this` prompt had no `type` arg, forcing
   another lookup.
3. `adam_session_status` tool vs `adam-mcp status` CLI JSON keys diverged:
   CLI always emitted `holder` + `profileDir` while the tool schema only
   documents `loggedIn`/`reason`/`holderPid`/`checkedAt` (+ `currentUrl`/`title`
   when present). `docs/session-recovery.md` listed `login-required` and
   `unauthorized` as separate rows with overlapping recovery, and did not
   surface cold-start re-check consistently.
4. Resource templates pin `type` (`crs`/`fold`/`file`/`exc`/`frm`) while tools
   resolve `type: undefined`; cursor `describe` did not say "copy nextCursor
   verbatim".

Repo invariant: enabling SOAP/HTML, adding a tool, or changing
extract/session behavior needs an ADR in `docs/adr/`.

## Decision

1. **Resource error parity (no new error codes).**
   `mapResourceError` keeps `not_found → ResourceNotFoundError`. For
   `unauthorized`/`forbidden`/`stale_id`/`provider_unavailable` it now throws
   `AdamError(code, formatAdamFailText(error, runId), retryable)` — same
   one-line `code: msg (retryable=) (runId=)` text tools return via `fail()`,
   with `code`/`retryable` preserved (not bare `Error`). `unsupported_type`/
   `confirmation_required`/`cancelled` still rethrow unchanged.

2. **TYPE_CONFLICT: fail with next-step text (not forgive).**
   Chose fail-closed over "explicit type wins" because the explicit hint is
   often the wrong half of the mismatch; silently opening `/go/{wrong}/{id}`
   would trade one round-trip for a wrong fetch + `stale_id`/`unsupported_type`
   later. New message: "Explicit type disagrees … Run `adam_search` and pass
   the hit's `type+refId`." `objectTypeHintSchema` describe documents the same
   choice. `study_this` gains optional `type` (`objectTypeHintSchema`) to avoid
   the extra lookup when the caller already knows it; handler echoes the hint
   into the prompt text.

3. **Session alignment (this is the session-behavior change that triggers this ADR).**
   - Tool `adam_session_status` description now documents: always
     `loggedIn`/`reason`/`holderPid`/`checkedAt` (+ `currentUrl`/`title` when
     present); holder `pid`/`generation`/`exe` are bug-report-only.
     Cold-start line kept: "always re-check status after login before listing".
   - CLI `adam-mcp status` default output now mirrors the tool keys; holder
     detail (`holder`, `holderDetail` with `pid`/`generation`/`pidStartTime`/
     `exe`) + `profileDir` move to `--verbose` / bug-report-only.
     `docs/session-recovery.md` folds `login-required`/`unauthorized` into one
     recovery row (same re-login + re-check + retry-once) and documents the
     default-vs-verbose split. Cold-start re-check kept in both tool copy and
     runbook.

4. **Forced-type + cursor: docs-only.**
   Resource descriptions now state they pin `type` (e.g. "Pins `type=crs` (use
   `adam_get_course` / `adam_list_children` tools for other types)") and that
   errors return `code (retryable=)` like tools. Cursor `describe` is now
   "Decimal offset token — copy nextCursor verbatim into cursor, do not invent
   offsets"; Zod `/^\d+$/` check unchanged.

## Consequences

- Resources/read RPC errors for auth/permission/stale/transient now contain
  `code:` + `retryable=` + `runId=` like tools, and carry `AdamError.code` /
  `retryable` for programmatic callers. `not_found` still maps to
  `ResourceNotFoundError` (`-32602`); other codes never look like `-32602`.
- Type mismatches still fail, but the message tells the agent exactly what to
  do (`adam_search`, pass hit's `type+refId`); `study_this` with `type` avoids
  the lookup when already known.
- `adam-mcp status` default JSON is stable and tool-identical; `--verbose`
  (and `session-holder.json`) carries the PID-bind fields for bug reports.
  Help text and runbook updated; no elicitation, extract, or provider semantics
  changed.
- No new tools/resources/prompts; no SOAP/HTML enablement; no elicitation
  fallback change.

## Acceptance

- `npm run typecheck` green.
- `npm test` full: resource-parity asserts check `code:` + `retryable=` +
  `runId=` substring on resources/read auth/permission/stale errors and
  `not_found → -32602`; agent-contracts assert TYPE_CONFLICT next-step text
  and `study_this` optional `type`; status asserts default keys without
  `holder`/`profileDir` and `--verbose` keys with them; `grep` cold-start +
  recovery line on resources.
