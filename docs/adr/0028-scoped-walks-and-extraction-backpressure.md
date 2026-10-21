# ADR 0028 — Scoped walk sharing and extraction backpressure

Date: 2026-10-21. Status: implemented for the 0.3.0 candidate.

## Context

Global enrolled-tree discovery shares a walk and memoizes complete results.
Course-scoped reads bypass that reuse and repeat enrollment/traversal work.
PDF extraction has one bounded worker, but its waiting closures retain input
without an admission cap or waiting deadline.

## Decision

1. Key walk memos and shared operations by enrolled course scope, with a separate
   key for the global walk. Share search, calendar and news within a scope.
   Validate enrollment within every new scoped walk; never substitute a global or
   another course's result. Bound complete scope memos and in-flight scope entries
   to 32 each. Complete results expire after 60 seconds; partial walks are not cached.
2. Keep per-subscriber cancellation/progress and session generations. Login, close
   and explicit logout clear/cancel owned work. Refresh detaches existing work
   without cancelling its subscribers or invalidating their pagination snapshots;
   old generations cannot repopulate caches. Existing result pagination remains
   scope/query-bound, with a ten-minute TTL. Traversal continuation is not added.
   Track operation ownership separately from reuse keys so subsequent login/close
   also cancels work previously detached by refresh. The 32-operation admission
   bound includes those detached walks until they settle.
3. Keep one active PDF worker. Admit at most eight waiting PDF tasks and 32 MiB of
   aggregate waiting input, with a 30-second waiting deadline. Reject excess demand
   and expired waiting as retryable `provider_unavailable`. Remove cancelled/expired
   tasks and their queued weight immediately. Preserve parser timeout, memory,
   page, character, byte and approval limits. Parser failures still drain the queue.
4. Share the pinned-origin transfer loop between bounded extraction buffering and
   the CLI's bounded streaming sink. Do not enlarge extraction limits. Await each
   sink chunk, bound declared/actual sizes, dispose responses, and preserve timeout,
   cancellation and credential checks. Reject inconsistent unencoded Content-Length;
   encoded response length is not compared to decompressed byte count.

## Verification

Regressions cover scoped cancellation by either caller, scope isolation, TTL,
refresh races, partial retry and enrollment changes after login. Weighted queue
tests cover byte/count saturation, waiting timeout, cancellation and failed-task
recovery. Existing extraction, stdio and session tests remain required.

`npm run benchmark:discovery` measures synthetic cold trees, repeated concurrent
scoped reads, honest partial coverage at the page cap and queue saturation/recovery.
It does not access ADAM or claim live-network performance. The optional baseline
module argument supports comparative measurements, like `benchmark:reads`.
