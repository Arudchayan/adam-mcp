# Later coalesced login caller ignores its already-aborted cancellation signal

Severity: low correctness. Tested source `ef9776e`; independently reproduced.

```sh
node --import tsx --test --test-name-pattern="S4 " scripts/qa-public-session/repro.mjs
```

Gate a mocked session.status() while a first loginInteractively call waits. Make a second call with an already-aborted signal, then release status with a valid signed-in result. Both callers succeed. Expected: the second rejects cancelled; the first remains successful.

`playwright-session.ts` returns the existing login promise before inspecting the later caller's signal/options.

## Acceptance

Handle each coalesced caller's cancellation without cancelling other owners. Test already-aborted and later-aborted subscribers and cleanup. Do not infer reverse cancellation coupling without a separate repro.

No authentication bypass or private-data exposure. Mocked status and disposable profile only; no actual Chrome/login or process signals.
