# ADR 0023 — Predictable login windows and explicit logout

## Context

Interactive login could attach to headless Chrome and wait for input in an
invisible window. Closed windows were retried until the full timeout. Error
cleanup was inconsistent. Stopping a holder could be undone by automatic
dead-holder resume on the next read. Windows process identity checks could
repeat long WMIC and PowerShell probes.

## Decision

- Reuse a verified signed-in session without an interactive window. Coalesce
  concurrent login calls in a session instance. CLI `--force` opens a fresh
  sign-in window; `--timeout-ms` sets the interactive wait (10 seconds–30 minutes).
  Status does not attach to or navigate another process's unverified sign-in
  window; it reports `unknown` with finish/close guidance instead.
- Before interactive sign-in, detach and stop an expired headless holder, then
  launch headed Chrome. Do not retry navigation by opening another window.
- Poll ADAM every 300 ms; never snapshot SWITCH credential pages in the polling
  loop or the initial redirect. Off-origin authentication pages produce only a
  synthetic login-required marker. Closing the window, host cancellation, Ctrl+C or a logout request ends
  the wait. Failure closes owned Chrome and disables automatic resume.
- Normal success skips the five-second feedback hold and closes headed Chrome
  before headless handoff. Debug headed mode retains the existing feedback UI.
- Explicit logout writes a non-secret `session-disabled` marker. Reads/status
  cannot launch or resume while it exists; explicit login enables the session.
  This is local disconnect, not a SWITCH-wide web sign-out. `--purge` removes the
  dedicated profile, reports deletion failures honestly and recreates the marker.
- Never kill an unbound process: an unrecorded live debug port asks the user to
  close that sign-in window. Verified holders retain identity-checked shutdown.
  Windows checks use PowerShell first (3-second bound), with WMIC fallback
  (1-second bound), rather than four long probes.
- A logged-out status clears provider caches. Login cancellation is passed from
  MCP context through the provider to the interactive session.

## Verification

Mocked login polling/CLI tests cover no-window reuse, closed windows, timeout,
credential-page avoidance, cancellation, logout and cleanup. Existing holder
race/PID-reuse tests remain mandatory. No live ADAM sign-in is needed for CI;
manual live window/handoff verification remains a separate user-side check.
