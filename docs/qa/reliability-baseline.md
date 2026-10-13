# Reliability and performance baseline

Goal: make existing read-only student workflows trustworthy and responsive on
the latest default branch, before expanding capability. Started 2026-10-13 from
`origin/main` at `da409b7`, on `feature/reliability-baseline`.

## Acceptance criteria

| Requirement | Evidence |
| --- | --- |
| Forum bodies belong to the requested forum and thread; mismatches fail closed | `read-integrity.test.ts`: wrong initial thread, wrong redirected thread, unidentified thread, exact-match reuse |
| Empty News labels invent no activity; cutoff queries contain only dated evidence | `read-integrity.test.ts`: old file, undated announcement, future cutoff, distinct same-URL headlines, invalid cutoff with zero navigation |
| Concurrent/repeated reads perform one navigation and one catalog extraction per current snapshot | `request-performance.test.ts`: four concurrent/repeated reads, one open, no subsequent HTML access |
| Either shared caller can cancel without failing the other; last cancellation stops underlying work | `request-performance.test.ts`: initiating/later caller, progress isolation, last subscriber, cancelled-page cache recovery |
| Queue admission/waiting are bounded and cancellation frees pending entries | `request-performance.test.ts`: queued cancellation before active release, full queue, waiting timeout, recovery without concurrent execution |
| The elapsed walk budget returns honest partial data and does not cache it as complete | `request-performance.test.ts`: blocked course, `time_budget`, successful retry |
| Active navigation cancellation closes its tab and leaves the next read usable | `navigation-cancellation.test.ts`: mocked Playwright tab lifecycle and queue recovery; current live ADAM remains unverified |
| Production installation works outside repository dependency resolution | `npm run test:package`: tarball install in a temporary consumer; modern and legacy stdio, page-aware PDF worker, confirmation, input validation and modern cancellation |
| Required checks pass | `npm run release:check`: all tests, typecheck, build, both protocol modes, production audit and clean installed package |

## Performance evidence

Measured on Windows, Node 24.19.0. A synthetic course has 100 file links and
about 50,000 text characters. Each batch calls get-course, list-children,
list-files and read-page. After ten warmup batches, measure fifty batches
(200 calls). No live session is used.

For this comparison the prior `browser-provider.ts` from `origin/main` was
loaded alongside the new provider using the same current parser and memory
session. This isolates the provider cache path; it is not a full historical
application benchmark. The optional baseline source stays in ignored `scratch/`.

| Metric | Prior provider | New provider |
| --- | ---: | ---: |
| Cold four-call batch | 59.871 ms | 14.005 ms |
| Warm batch p50 | 41.318 ms | 0.475 ms |
| Warm batch p95 | 54.551 ms | 0.845 ms |
| Additional warm navigations | 0 | 0 |
| Additional warm HTML accesses | 600 | 0 |
| Total navigation opens | 1 | 1 |

The observed median improvement is about 87× for this local cached-read
workload. It is not a claim of 87× faster end-to-end ADAM requests. Absolute
timings vary with hardware/load, so regression tests gate avoided work and
correct lifecycle behavior rather than a fragile millisecond threshold.
Reproduce the current workload with `npm run benchmark:reads`.

## Local gate result — 2026-10-13

`npm run release:check` passed on Windows / Node 24.19.0: **432 tests** passed
with no skipped/TODO tests, strict typechecking passed, build passed, legacy and
modern distribution checks passed, the production audit reported zero known
vulnerabilities, and the clean installed tarball passed both protocol modes.
The holder-race suite also passed after removing repeated self-identity OS probes.
The remote default branch was re-fetched after implementation and remained at
`da409b7`. The local reliability/performance milestone is complete; this is not
a claim that the remaining live checks have passed.

PR review added regressions for cancelling a stalled progress subscriber and
waiting for tab close before advancing the queue. The clean-install CI gate
also exposed macOS symlinked temporary paths; CLI entry detection now compares
real paths, with a directory-symlink regression.

## Remaining verification limits

No current live ADAM or SWITCH session was accessed. Check login/handoff,
navigation cancellation and recovery, one selected forum thread, dated news,
and one permitted extraction with the user's session under
[live-reverify.md](../live-reverify.md). Keep private captures and course material
out of Git. Local Windows checks do not establish CI results on macOS/Linux or
real compatibility with every client named in README. Foreign Windows process
identity probes remain synchronous and are a future performance target.
