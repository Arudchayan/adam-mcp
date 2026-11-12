# ADR 0043: Owned handoff cleanup on setup failure

## Status

Accepted for 0.4.0 preparation after independent review and maintainer approval
to integrate publicly. Exact-release-commit verification and publication approval
remain required.

## Decision

Place exclusive seed creation, writes, child factory invocation and child setup
inside the generation's cleanup scope. Track ownership only after exclusive
creation succeeds; wait for the file handle to close before cleanup. On failure,
revoke the startup capability and remove only that generation's uniquely named
handoff. Preserve all other generation records, fixed-path legacy seeds and
ambiguous browser evidence.

This depends on ADR 0040's cross-process lifecycle claim and generation-specific
handoffs. It must not be backported as a shared-path check-then-unlink operation.
The synthetic synchronous-factory tests establish cleanup of the injected failure
path, not that a native production spawn failure or real credential exposure was
observed. No real cookies, profiles, Chrome launch or external service is used.
An exclusive-open collision regression also verifies that a pre-existing handoff
is preserved. Filesystem cleanup itself can fail and report an error; neither the
tests nor the implementation promise unconditional removal on a broken filesystem.
