# Critical project review — 13 October 2026

## Verdict

ADAM MCP is a credible local read-only study assistant with substantial automated coverage and carefully defined safety boundaries. It is suitable for a supervised pilot with technically comfortable users. I would not yet call the reviewed working tree ready for a broadly distributed, dependable student product.

The main gaps are content identity, truthful change detection, request lifecycle behavior, and proof of live compatibility. More tools would add less value than making the existing promises reliable.

This review covers the current **working tree**, including pre-existing modified and untracked files. It is not an assessment of a particular released tag. No application source was changed. Checks rebuilt ignored distribution output. No live ADAM session, credentials, course files, or private captures were accessed.

## Verification

Environment: Windows, Node 24.19.0, npm 11.17.0.

| Check | Observed result |
| --- | --- |
| First full test run, through `npm run check` | 409 tests: 408 passed, one failed. Browser test `R1 concurrent starts serialize via queue to one live PID` timed out starting its mocked holder. The chained command therefore did not reach the later gates. |
| Isolated rerun of that test | Passed. |
| Second full `npm test` | All 409 tests passed; no skipped tests or TODOs. |
| `npm run typecheck`, run separately | Passed for all six workspaces. |
| `npm run build` | Passed. |
| `npm run test:dist` | Passed, including fixture PDF extraction and JSON-RPC stdout verification from a different working directory. |
| `npm run audit` | Reported zero vulnerabilities in the audited production dependencies at review time. This is not a vulnerability-free guarantee. |
| `npm pack -w adam-mcp --dry-run --json` | Eight intended files, about 74 KB packed / 288 KB unpacked, including the PDF worker, LICENSE and NOTICE. |
| Targeted synthetic experiments | Reproduced cancellation gaps, wrong-thread post attribution, non-PDF matches for `pdf`, and undated old files surviving a future news cutoff. |

Desloppify was unavailable in this environment. No scan ran, so no mechanical or subjective scanner scores are claimed. This is a manual review supported by the project checks and independent synthetic experiments.

Not verified: fresh installation of the packed artifact without repository dependencies, current live ADAM markup/authentication, actual host compatibility across the clients named in README, CI results on other operating systems, and behavior under Node 20/22 on this machine.

## Findings, in priority order

### 1. P1 — Forum posts are not bound to the requested thread identity

**Evidence:** `packages/provider-browser/src/browser-provider.ts:494–541`, especially the initial `parsed.posts` reuse and the final `selectedThread.threadId` assignment. `openAuthorizedOnce` checks object ref identity, but not forum thread identity.

When the initial forum open contains posts, `getForum` uses those posts without verifying that they belong to the requested `threadId`. The secondary thread fetch also does not validate its landed thread ID.

**Reproduction:** A synthetic open for forum `100040` landed on a typed forum URL with `thr_pk=200001` and posts from thread A. Calling `getForum("100040", {type:"frm", threadId:"200002"})` returned `selectedThread.threadId="200002"`, title `Thread A`, and `Body from thread A`.

**Impact:** The student can receive a confident answer with incorrect attribution. This also defeats the intended boundary of reading the particular thread the student selected. The experiment demonstrates a provider defect; it does not establish that live ADAM currently performs this redirect.

**Improvement:** Resolve and validate forum ref plus thread ID against the landed page before accepting posts. Refuse mismatches and uncertain thread identity. Add regressions for initial-page posts belonging to another thread and a requested thread URL redirecting to a different thread.

### 2. P1 — “What changed since…” can report old files as news

**Evidence:** `packages/provider-browser/src/extract.ts:218–232` and `packages/provider-browser/src/browser-provider.ts:644–650`. The parser falls back to file/blog rows whenever page text contains a generic news-related word. `listNews` includes items with an unparseable or absent timestamp even when `since` is provided.

**Reproduction:** A synthetic course with an empty `News` label and a link to `Old notes.txt` returned that file from `listNews({since:"2099-01-01T00:00:00Z"})`, with neither `createdAt` nor `updatedAt`.

**Impact:** Existing material can be presented as recent activity. README's “What changed in my courses this week?” and the `what_changed` prompt exceed what the implementation can reliably establish. There is no persistent before/after inventory comparison in that prompt's path.

**Improvement:** Require actual news-item evidence. For a cutoff query, distinguish undated items from verified changes, with an explicit uncertainty field or exclusion policy. Validate timestamps at the tool boundary. Until actual file-change evidence exists, describe the feature as visible news, rather than newly added files.

### 3. P1 — Cancellation is incomplete and shared work inherits one caller's lifecycle

**Evidence:** `packages/provider-browser/src/session-types.ts:73–80`, `browser-provider.ts:279–299`, `browser-provider.ts:653–681`, and `playwright-session.ts:280–318`.

Browser page opens accept no signal. Many provider reads check cancellation only before asynchronous work. Shared enrolled walks return the first caller's promise directly to later callers, retaining the first caller's signal and progress callback.

**Reproductions:**

- Start `readPage`, pause the injected session open, abort the caller, release the open: the provider returns success and the page title.
- Start one search, attach a second search with its own signal, abort the second while the shared walk is pending: the second still returns success.

**Impact:** Cancelled work continues occupying the single browser queue. A later caller lacks independent cancellation/progress, while cancelling the initiating caller can fail other callers sharing its walk. These are provider-level observations; they do not prove that the SDK sends a response after wire-level cancellation.

**Improvement:** Carry signals into queued and active browser operations, recheck before returning content, and make each waiter independently cancellable. Shared work needs explicit ownership separate from any one subscriber. Test cancellation while queued, during navigation, after navigation, and when two callers share a walk.

The current [MCP stdio specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio) requires no further messages for cancelled requests and recommends stopping work as soon as practical. Verify both provider behavior and transport behavior.

### 4. P2 — Browser work is page-bounded, but not bounded by overall elapsed time

**Evidence:** `browser-provider.ts:55`, `browser-provider.ts:734`, `playwright-session.ts:290–310`, and `serial-queue.ts:8–21`.

The walk stops after 48 retained pages, but has no overall deadline. Individual opens allow 45 seconds for navigation and another 12 seconds for listing readiness, plus other work. The queue has neither a pending-work limit nor independently cancellable waiting entries.

**Impact:** A page count limit does not ensure an acceptable response time. Slow pages and queued calls can leave a study request waiting for minutes. This is a structural latency risk, not a measured live latency claim.

**Improvement:** Set a tool-level elapsed-time budget, cap admission to the queue, and return explicit partial-completion reasons. Preserve single-browser serialization. Make progress operation-neutral: the shared walker currently says `news: page ...` for calendar and search too. Record synthetic slow-session latency and queue behavior before choosing a budget.

### 5. P2 — PDF search intentionally overmatches all files

**Evidence:** `packages/core/src/search.ts:36–44`. The helper returns true for a `pdf` or `.pdf` query for every `type=file` object after title and MIME checks fail.

**Reproduction:** `{type:"file", title:"notes.txt", mimeType:"text/plain"}` matches `pdf`.

**Impact:** Students asking for PDFs can receive known non-PDF files marked as title matches. The implementation documents this as a coverage fallback; it is a semantic tradeoff, not an accidental missing branch.

**Improvement:** Separate confirmed PDF matches from candidates with unknown format. Known contradictory MIME/extension evidence should exclude a PDF match. Preserve discoverability for extensionless material without claiming its format is confirmed. Reject whitespace-only search strings after trimming.

### 6. P2 — The test suite has a timing-sensitive holder test and expensive synchronous process probes

**Evidence:** First full-run failure, successful isolated and full reruns; `session-holder-races.test.ts:134–186`; `session-holder.ts:191–203`.

The mocked startup test uses five-second waits while real Windows process identity checks synchronously launch PowerShell with a three-second timeout. Other process checks also use synchronous child processes.

**Impact:** The observed failure is consistent with timing/load sensitivity, although this review does not prove its exact cause. Synchronous probes also block the server event loop during session operations.

**Improvement:** Inject process identity/liveness and clock behavior into race tests, keeping OS process integration tests separate. Consider asynchronous or batched runtime probes while preserving PID-reuse checks. Do not solve this by removing identity validation or blindly increasing every timeout. Measure Windows session-status overhead.

### 7. P2 — Release verification stops short of a clean installed-package smoke test

**Evidence:** `scripts/verify-dist.mjs:8–12`, `packages/mcp/package.json:45–49`, and `packages/mcp/README.md`.

The distribution test changes the process working directory, but launches the artifact inside the repository. External dependencies can still resolve from repository `node_modules`. The publish lifecycle builds only; it does not enforce the documented release gates. The package README's relative links point to root documents that are not included in the eight-file package.

**Impact:** Good build results do not establish that a fresh consumer installation works or that package users have usable setup instructions. No broken clean installation was demonstrated.

**Improvement:** Pack to a temporary directory, install the tarball into a new project with production dependencies, and exercise help, legacy and modern discovery, fixture extraction, and stdout purity there. Add a documented release command enforcing gates. Use permanent repository documentation URLs or ship concise complete package setup instructions. No publish is needed to verify this.

### 8. P2 — Confirmation policy and compatibility evidence need consolidation

**Evidence:** `AGENTS.md:34`, `SECURITY.md:24`, `docs/architecture.md:33–51`, README's confirmation table, and `packages/mcp/src/stdio.test.ts`.

Contributor/security documents say bodies require `confirm:true`, while runtime/README support explicit confirmation or accepted elicitation. Architecture simultaneously calls confirmation a required argument and describes omitted confirmation entering the elicitation handler. Repeated copies of the contract appear throughout tool descriptions, schemas, prompts, and documentation.

The inspected stdio tests and distribution check use the legacy `2025-03-26` initialization flow. This is useful evidence, but does not itself demonstrate a modern `server/discover` / per-request metadata exchange or actual host support.

**Impact:** Contributors and hosts can receive conflicting instructions. Detailed protocol language dominates the user guide while the practical support matrix remains unclear.

**Improvement:** Establish one authoritative confirmation policy covering explicit confirmation, elicitation, decline, cancel, and unsupported hosts. Shorten tool descriptions around the task and recovery action. Add a modern wire-level smoke test and a dated client compatibility matrix. Treat named clients as supported only at the confidence level actually verified.

## What is working well

- Package boundaries separate policy/types, MCP presentation, fixtures, and browser access. Disabled providers fail closed.
- Read-only scope, exam denial, canonical citations, untrusted content envelopes, and redaction are exercised by tests.
- `ok`, `empty`, and `unknown` listing states prevent many false “nothing exists” answers. Partial walks have explicit signals.
- Recent working-tree changes add one-minute freshness, stable snapshot pagination, explicit logout blocking, bounded streaming downloads, and page-aware PDF extraction in a worker.
- Extraction has concrete byte, character, page, execution-time, and worker heap limits, and returns text rather than bytes.
- CI is configured for three operating systems and Node 20/22. Tests cover protocol, facade, parser, session, and distribution concerns.
- ADRs and the live-inventory gate discourage speculative support for unobserved object types.

These are real strengths. They should be preserved while addressing the findings.

## Maintainability and usability improvements

The largest production modules are `browser-provider.ts` (1,081 lines), `playwright-session.ts` (811), `server.ts` (805), and `extract.ts` (635). Size alone is not a defect, but these files combine several responsibilities involved in the confirmed failures.

Refactor around testable responsibilities: request cancellation/shared walks; cache and snapshot lifetime; object/thread identity; news/deadline extraction; session lifecycle; and MCP registration. Avoid creating generic frameworks just to reduce line counts. Centralize policy strings and output metadata where duplication already causes drift.

For users, prioritize:

1. A short verified clone/login/client setup path, with the registry path clearly secondary until independently verified.
2. A local diagnostic command for Node/Chrome availability, artifact presence, profile permission, session state and recovery guidance. It should expose no credentials or private material.
3. Typed recovery details in error results: code, retryable, safe recovery action and run ID, with concise accompanying text. Current `fail()` results primarily encode these in a string.
4. Clear freshness and completeness in answers: checked time, partial reasons, and whether dates/changes are known or inferred. An empty result should never sound like verified absence when coverage is incomplete.
5. Scope controls for expensive requests using already observed course/folder identities. Any new tool or changed session/extraction contract needs the repository's ADR process.

Track task success on realistic student questions, rather than only tool-call success: find a named sheet, identify a real deadline, explain an empty folder, recover from expired login, and stop a slow request. Use public or synthetic material for automated evaluation.

## Recommended delivery order and readiness gates

| Stage | Work | Acceptance evidence |
| --- | --- | --- |
| First | Fix forum identity, news truthfulness, and caller-independent cancellation | Targeted regressions for all reproduced cases; full suite green. |
| Second | Bound total request duration; make holder tests deterministic; measure Windows session overhead | Slow/queued synthetic calls meet the chosen budget, cancel promptly, and retain honest partial results. |
| Third | Verify installation and protocol modes; consolidate policy and package docs | Fresh tarball installation works without repository resolution; modern and legacy wire tests pass; policy documents agree. |
| Fourth | Conduct a bounded user-side live check and a real client walkthrough | Dated evidence for current authentication, listing, one permissible extraction, deadlines where present, and one forum thread where present. No private artifacts committed. |
| Then | Ship a reviewed version | Repository SECURITY checklist green; complete CI evidence; clearly stated supported environments and limitations. |

Avoid expanding writes, hosted access, mass extraction, or unobserved object types to compensate for these reliability gaps. The best next milestone is trustworthy completion of the existing read-only student workflows.
