# ADR 0041: Transfer cancellation and sink settlement

## Status

Accepted.

## Decision

Race credential acquisition, fetch, and response reads against the transfer
abort signal. Credentials are obtained only for a pinned origin and no request
starts after abort. Observe late failures and cancel late response bodies without
waiting on potentially uncooperative stream cancellation. Pass the transfer
signal to credential and sink callbacks. Check it before and after each sink
callback and between partial filesystem writes.

Sink callbacks are not raced: the stream promise settles only after an active
callback settles, so the local download cannot close or unlink a temporary file
while a write is still running. Arbitrary JavaScript callbacks and filesystem
operations cannot be forcibly stopped. Setup, sync, final publication and cleanup
are not covered by the transfer timer. A callback that ignores the signal can
delay cancellation indefinitely. Backpressure and byte limits remain unchanged.
