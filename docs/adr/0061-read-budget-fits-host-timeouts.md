# ADR 0061: Cross-course reads fit MCP host timeouts

## Status

Accepted. This ADR lowers the elapsed walk budget that ADR 0024 bounded and ADR 0025 kept at two minutes.

## Context

The 0.4.0 release-candidate walkthrough ran in an independent client chat. In that client, unscoped `adam_list_calendar` and `adam_list_news` timed out every time (4 of 4 calls) at the host's request limit, while course-scoped calls worked. Many MCP hosts cancel a request after 60 s. The server's walk budget was 120 s, so it never reported a partial result before the host gave up.

A live timing of the student account's full enrolled walk (8 courses, 34 pages) took 118 s. About 0.7 s per page was the actual page load. The rest was two waits:

- **Content tab.** Every course page tried to click a `Content`/`Inhalt` tab with a 3 s timeout. ADAM courses already land on Content, so each course spent the full 3 s. That added up to 8 × 3 s.
- **Listing readiness.** The readiness wait (ADR 0005, ADR 0007) returns only when it sees listing rows or empty-folder copy. Pages that legitimately have neither (the Dashboard, an exercise, a structurally empty folder) waited out the full 12 s. That happened five times per walk.

## Decision

- The Content tab is clicked only when it is **visible at that moment** (`isVisible()`, which does not wait). The 3 s click timeout applies only to a tab that exists.
- The listing-ready probe also returns true once the document has reached `readyState === "complete"`, every same-origin frame is complete, and 750 ms (`LISTING_SETTLE_GRACE_MS`) has passed since the load event. A same-origin frame that is still loading, or still on `about:blank` while naming a `src`, keeps the wait going, so delayed frames (ADR 0007) are still awaited. The 12 s timeout remains the upper bound.
- `MAX_WALK_MS` drops from 120 s to **25 s** (first set to 45 s; see the amendment below). A walk that reaches the budget returns what it has read, with `partial: true` and `time_budget`, as before. The read-budget error now names the configured budget and suggests `courseRefId`.

## Results (live, student account, counts only)

- The full walk went from 118 s to 37.5 s with the same 34 pages and 35 navigations. A repeat within a minute takes 2.2 s, because cached pages are reused.
- Unscoped `adam_list_calendar` completes in 38.7–39.6 s and is not partial, with the same 17 events as the earlier 107 s run.
- `adam_list_news` then shares the walk, takes 0.0 s, and returns 22 items.

## Consequences

- Hosts with a 60 s request limit get complete cross-course answers on accounts of this size. Larger accounts get an honest partial result, not a host timeout.
- Codex's generated `tool_timeout_sec` (ADR 0025) is unchanged; it exists for interactive login.
- Pages that render rows late, after load, could be read earlier than before. The same-origin frame checks and the unchanged folder recovery (ADR 0030, ADR 0050) keep classifying a still-blank listing as `unknown`, never as empty.

## Amendment (second walkthrough, 17 November 2026)

The second release-candidate walkthrough used the fixed build. Its client again timed out on the first unscoped calendar and news calls, fired in parallel from a fresh client start, and both succeeded on retry. A fresh server process answered both in about 35 s in a local stdio run. The retry succeeded because the server finished the shared walk after the client had given up. That points to a client request limit nearer 30 s than 60 s.

Calls are serial by design (SECURITY.md: SerialQueue), so the walk cannot be parallelised. The budget is therefore **25 s**:

- A cold fresh-process call, calendar and news in parallel, answers in about 25.6 s. It is `partial` with `time_budget` and has 16 of 17 events, because the Dashboard Tasks and Calendar blocks are read first.
- A repeat within a minute continues from the per-page cache and completes in about 14 s with 17 of 17 events. Later calls are served from the shared walk at once.

## Amendment: background completion (0.5.0 walkthrough, 17 November 2026)

In the installed-client walkthrough of 0.5.0, unscoped calendar and news stayed `partial` even on a retry. The client retried more than a minute later, after the per-page cache had expired, so each call started the same 25 s walk again.

**Decision:**
- **Background completion.** When a walk stops on `time_budget`, the same walk continues in the background. It is capped at `MAX_BACKGROUND_WALK_MS` (90 s), reuses cached pages, and caches the complete result for the usual minute.
- **Lifetime.** It is a `SharedOperation` with `keepAlive`, so a waiter that gives up does not cancel it. `close()` and session invalidation cancel it. It never starts another background walk.
- **Joining.** A call arriving while it runs joins it, but waits at most one read budget. If the walk hasn't finished by then, the call gets the partial walk that started the background run, still marked `partial` with `time_budget`, so no host timeout is introduced.
- **Queue.** Calls stay serial (SerialQueue). Other reads queue behind the background walk within the existing 30 s queue wait.

**Live (student account, counts only):**
- Calendar and news in parallel: 25.1 s and 33.3 s, both `partial`.
- The background walk finished about 43 s after the start.
- Calendar and news 45 s later: 0.0 s and complete (26 events, 35 news items).
- A call 40 s after that: 0.6 s, complete.
