# ADR 0040: Cross-process session-holder ownership

## Status

Accepted after independent ownership review; exact-head release checks remain required.

## Decision

Serialize start and stop with an exclusive per-profile lifecycle directory.
Give each start a random generation capability and unique, exclusively created
seed filename. A separate short mutation lock protects record publication,
generation revocation and conditional stale-record removal. Never hold that
short lock while waiting for Chrome, a child process or shutdown.

The child publishes an identity-bound, **unverified** record before launching
Chrome. Only a verified record is reported as running. Startup failure revokes
publication before observing/stopping its own generation. Late children cannot
launch after revocation; published children remain identity-bound for shutdown.
Signal handlers are installed before Chrome launch. A pending record cannot be
removed merely because its holder died and CDP has not appeared: it requires a
generation-specific shutdown acknowledgement written after launch settles and
Chrome closes. Force-killing an unresolved launch therefore blocks replacement
and requires explicit recovery, instead of assuming the browser never spawned.
Interactive and resume launches retain the same lifecycle claim through launch,
verification, closure and handoff. CDP attachment also acquires it. Delegation to
the holder validates that generation capability instead of reacquiring the lock.
Errors during resume verification close the owned context before releasing the
claim. An unsuccessful owned Chrome close preserves the context reference and
the lifecycle directory with a `recovery-required` marker; it never silently
continues into a new handoff. A Chrome launch failure with no verified attachment
also retains ownership, because cleanup cannot be established from the error alone.
Holder exit never deletes shared metadata. Status removes only its exact
observed stale record, rechecked under the publication lock.

## Recovery and compatibility

Locks are not stolen based on age or PID guesses. A crashed lock owner fails
closed. Stop all ADAM MCP clients and dedicated ADAM Chrome processes before
manually removing the two `.adam-holder-lifecycle` / `.adam-holder-mutation`
directories from the dedicated profile. Never remove them while any client is
active. No automatic recursive recovery or deletion of arbitrary paths exists.

Stop all older clients before upgrading: older executables do not honor these
locks. A legacy fixed-path seed is ambiguous and blocks startup; it is never
overwritten, consumed or deleted by a new generation. After all old processes
are stopped, remove that stale handoff locally before retrying. Do not inspect
or share its contents. Mixed-version concurrent use is unsupported.

The lifecycle wait is bounded to 60 seconds and cancellable for startup;
publication-lock acquisition is bounded to two seconds. An abandoned lock can
therefore require explicit recovery rather than silently risking another
process's credentials or ownership evidence.

## Verification

Synthetic foreign-seed and replacement-record interleavings, revoked child
handoffs, legacy handoff refusal and actual cross-process lock exclusion are
covered without live ADAM or credential access. Existing identity-binding,
responding-CDP and disposable child-process shutdown regressions remain required.
