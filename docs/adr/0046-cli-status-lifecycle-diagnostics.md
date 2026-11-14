# ADR 0046: Structured status failures, probe-tolerant holder status and abandoned-lock diagnostics

## Status

Accepted

## Context

Issue #123 reported three CLI lifecycle problems on 0.4.0:

1. Right after a successful `adam-mcp login`, `adam-mcp status` waited about 40s and then reported `signing-in` with exit code 1.
2. After an interrupted login, both `login` and `status` waited about 60s on the profile lifecycle lock and then failed with a message that named no lock and no recovery step.
3. A slow origin probe made `status` exit with a raw Playwright `TimeoutError` and its call log instead of JSON.

On Windows the holder identity probe starts `powershell.exe` with a 3-second timeout. During Chrome start-up that probe can time out once. `holderStatus()` then reports a verified holder as not running, and `status()` probes again, gets a match, and reports `signing-in`.

## Decision

- **Status race.** `reconcileHolderProbe` treats a holder as running when its record is **verified** and the identity re-probe matches. Unverified records still report `signing-in`, and mismatched identities still report not running. The record is never trusted without a live identity match.
- **Structured failures.** `adam-mcp status` catches status probe failures and always prints one JSON report with the `adam_session_status` keys, plus `errorCode` and `retryable`, then exits 1. Unauthorized maps to `recoveryAction: "login"`. Anything else maps to `check_status`. The origin navigation in `status()` is mapped through the existing navigation error taxonomy. Navigation error details keep only the first line of Playwright's message and never its call log.
- **Abandoned locks.** The lifecycle owner also writes an `owner-pid` file, removed with the lock. A waiter fails fast, instead of after 60 seconds, when the lock is marked `recovery-required` or its recorded owner PID no longer exists. It names the lock directories and points to `adam-mcp status --verbose` and `docs/session-recovery.md`. Errors never include the absolute profile path, which contains the OS user name.

## Consequences

Locks are still never stolen or removed automatically (ADR 0040). The owner PID is used only to decide that waiting is pointless. A reused PID only falls back to the previous bounded wait. Locks left by older builds have no `owner-pid` and keep the 60-second wait, now with the actionable message. Synthetic tests cover each branch without Chrome or ADAM. The Windows probe latency itself is unchanged.
