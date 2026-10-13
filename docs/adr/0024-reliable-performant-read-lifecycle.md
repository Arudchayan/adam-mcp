# ADR 0024 — Reliable and performant read lifecycle

Date: 2026-10-13. Status: accepted for the reliability baseline.

## Context

The critical review reproduced forum posts attributed to the wrong thread,
undated files reported as recent news, and cancelled callers completing reads.
Concurrent walks inherited one caller's cancellation/progress. Repeated reads
reused navigation but repeated catalog extraction, and a page cap did not bound
elapsed time or queued demand. Performance is a core product requirement.

## Decision

1. Body reads bind to both forum ref and landed thread ID. Overview posts may
   only be reused for that exact thread. A requested thread landing without the
   correct identity is `stale_id`; missing post HTML remains `not_found`.
2. News requires parsed article/headline evidence. Generic News labels do not
   promote file/blog listings into activity. Cutoff queries omit undated items;
   unfiltered queries keep evidenced undated news. Distinct headlines on one URL
   remain distinct. The change prompt describes timestamped news, not an
   inventory diff. MCP accepts valid ISO date/date-time boundaries and rejects
   whitespace-only searches before provider work.
3. Per-URL opens and enrolled walks use shared operations with an independent
   signal/progress subscription for each caller. Cancellation rejects that
   waiter immediately; when the last waiter leaves, the underlying work is
   aborted. Login, logout invalidation and close cancel stale operations.
   Aborted work cannot seed page/catalog/walk caches. Catalogs are weakly cached
   per snapshot, with provenance regenerated after a fresh open. Complete walks
   and page TTLs remain one minute; pagination snapshots remain ten minutes.
4. An enrolled walk has a 120-second elapsed-time budget, including queue waits
   and progress delivery. If usable pages have been collected, return those
   with `partial:true`, `partialReason:"time_budget"` and the existing notice.
   If the dashboard cannot be obtained, return a retryable error. Partial walks
   are never memoized. The limit is cooperative with the JS event loop and is
   not a hard limit on synchronous CPU execution.
5. Browser concurrency remains one. The FIFO admits 32 waiting operations, with
   a 30-second waiting timeout. Cancelled/timed-out waiting entries are removed
   immediately. The active operation retains the serialization slot until its
   cleanup completes, so cancellation never causes two tabs to run concurrently.
   A cancelled navigation closes only its current tab, retaining the context and
   authenticated holder; the next read recreates/reuses a tab. File HEAD probes
   use the same pinned-origin, cancellable native-fetch redirect checks as GET,
   without downloading bytes or applying the extraction size cap to metadata.
6. Cache only the current process's OS-confirmed identity, and still check its
   liveness on every use. That PID cannot be reused while this JS process is
   running. Foreign process identity is always re-read, preserving PID-reuse
   protection. This avoids repeated PowerShell launches in mocked-holder tests
   and holder self-checks; foreign Windows probes remain synchronous.
7. Release verification installs the real tarball in a fresh temporary consumer
   outside the repository, with production dependencies and no `NODE_PATH`.
   Both legacy initialization and modern discovery/metadata flows verify body
   confirmation, PDF-worker resolution, input rejection and protocol-only stdout.
   Modern cancellation must not receive a response and subsequent extraction
   must still work. CI includes this check. No publishing or tagging is performed.

## Consequences and limits

The trust envelope, explicit/elicited body approval from ADR 0019, exam denial,
origin pin, no-write scope and bounded extraction remain intact. No object type
is unlocked and no new MCP tool is introduced. A cancelled tab does not sign the
user out. A subscriber that still needs a shared operation keeps it alive.

The synthetic benchmark isolates navigation/catalog reuse; it makes no live
network-performance claim. Current live ADAM navigation cancellation, SWITCH
handoff and actual client behavior still require the bounded user-side live
check. Parsing/redaction quality and file-version change detection are separate
concerns. Clean package verification accesses the registry but no ADAM account.

See [reliability and performance acceptance](../qa/reliability-baseline.md) for
measured evidence and regression coverage.
