# Non-settling progress callback holds shared completion for other subscribers

Severity: low optional robustness. Tested source `ef9776e`; independently reproduced. Not a demonstrated cross-host denial of service.

```sh
node --import tsx --test --test-name-pattern="S3 " scripts/qa-public-session/repro.mjs
```

A SharedOperation awaits report() before returning 42. One subscriber's synthetic progress callback never settles; a second subscriber without a callback cannot complete until the first callback is released or cancelled. Rejected callbacks are already isolated correctly.

`request-lifecycle.ts` report fan-out awaits Promise.allSettled over callbacks. Consider an explicitly bounded/best-effort delivery policy that cannot hold otherwise completed shared work indefinitely, preserving cancellation and safe shutdown.

The shipped stdio subscribers share the same output transport; blocked stdout already affects healthy response delivery. Provider discovery deadlines still bound enclosing walks. This direct callback mechanism does not prove a real host callback hangs, cross-host interference, remote exploitation or a bypass of the two-minute discovery budget. Keep separate from transfer callback issue #96.
