# Resource-read cancellation is not forwarded to provider work

Severity: low reliability/resource use. Tested source `ef9776e`; independently reproduced, including the actual browser provider with a synthetic blocked session.

```sh
node --import tsx --test --test-name-pattern="R5:" scripts/qa/mcp-boundaries.repro.mjs
```

Start a synthetic blocked getFile through `resources/read`, then send `notifications/cancelled` for that request. The provider received no AbortSignal. Equivalent tool reads receive a signal and abort underlying work when their final subscriber cancels.

Resource handlers in `packages/mcp/src/server.ts` omit request context/signal; tool handlers forward it.

## Expected / acceptance

- Propagate resource request cancellation through all applicable provider operations.
- Preserve other shared subscribers and cancel underlying work only after its final owner leaves.
- Cover queued/active reads and no-reply-after-cancellation semantics.

This concerns unnecessary browser/queue work, not a requirement to return a cancellation response. Actual navigation remains time-bounded; indefinite blocking or remote denial of service was not established. All repro data/session work is synthetic.
