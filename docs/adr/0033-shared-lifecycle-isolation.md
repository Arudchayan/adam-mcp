# ADR 0033: Shared lifecycle isolation

## Status

Accepted.

## Decision

Shared operations deliver progress on a best-effort basis, with at most one
outstanding callback per subscriber and at most 32 per operation. Updates arriving while it is busy or the operation is at capacity are
dropped, not queued; callback failures do not affect the operation. Delivery
does not delay completion. A permanently pending callback can remain pending,
but cannot accumulate further deliveries for that subscriber.

Concurrent interactive login requests share one operation. Each caller owns its
own cancellation and progress subscription; the first caller's timeout and force
options define the shared attempt. When its last owner leaves, the operation is
cancelled. A replacement attempt waits for the old attempt's cleanup before
opening another window. Aborting a caller does not cancel other owners.

## Context and consequences

An in-process synthetic callback can otherwise hold shared work indefinitely;
this is not evidence of cross-host interference or a remote attack. Progress
is advisory and may be dropped, including the final update. Cancellation can
return to an owner before cleanup finishes; the shared attempt retains cleanup
ownership and prevents a replacement from overlapping it. An uncooperative
underlying browser or status operation can still delay that cleanup.
