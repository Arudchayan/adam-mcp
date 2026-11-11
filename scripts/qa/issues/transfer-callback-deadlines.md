# Clarify transfer deadline and cancellation guarantees for pending callbacks

Severity: low robustness/documentation. Tested source `ef9776e`; independently reproduced. No demonstrated remote availability vulnerability.

```sh
node --import tsx --test --test-name-pattern="callback" scripts/qa/adversarial-downloads/boundary-repros.ts
```

Synthetic observations:

- A 10 ms transfer deadline remains unsettled after 60 ms while injected headers() is pending; it settles after release.
- Caller cancellation remains unsettled while injected onChunk() is pending; it settles after release.

The fetch controller is aborted, but credential/sink callbacks are awaited without an independent deadline race. Production analogues await Chrome cookie RPC and filesystem writes; this test does not establish that either stalls in production. Native-like response-stream timeout tests already pass.

## Requested outcome

Document which phases the timeout/cancellation guarantees cover and consider bounded credential acquisition and cooperative sink cancellation. Add explicit blocked-callback tests. Do not introduce a naive timeout race that closes/unlinks a destination while an outstanding write can still complete after cleanup; preserving file safety may require waiting for an in-progress write.

One callback-cooperation issue, not a credential leak, high-severity DoS, or two independent vulnerabilities. All callbacks and bytes are synthetic.
