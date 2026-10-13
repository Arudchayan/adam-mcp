# Integration, usability and login review — 13 October 2026

## Assessment

ADAM MCP has a strong foundation for a local, read-only study assistant. Its weakest product layer is the journey from installation to a successful student question. Setup and recovery require users to understand several implementation details that should be handled by the product.

Prioritize a dependable connection experience before adding more ADAM object types. The next milestone should be: a new student connects a supported client, signs in, finds one course document, and recovers from an expired session without understanding MCP, Chrome holders, or configuration schemas.

This assessment covers repository code, documentation, synthetic checks and official host documentation. It is not a live authentication or usability study. No ADAM credentials, course content, browser profiles or private screenshots were accessed. Application source was not changed.

## Verification and earlier findings

In this review, `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:dist` passed. The distribution smoke check exercised legacy and modern protocol flows. The clean consumer installation script exists, but `npm run test:package` was not run in this review. Actual client walkthroughs and current SWITCH/ADAM behavior remain unverified.

The earlier critical-project review is historical evidence, not a current defect list. Current code contains fixes for forum thread identity, undated news cutoff handling, request cancellation/shared walks, queue admission/wait limits, overall walk duration, whitespace queries, and contrary PDF format evidence. Modern protocol smoke tests and clean tarball installation verification have also been added. Do not reopen those findings without a new failing case.

## Findings

### 1. High priority: host timeouts and server budgets disagree

`adam_login` advertises a default ten-minute wait in `packages/mcp/src/server.ts`. Cross-course walks have a two-minute budget in `packages/provider-browser/src/browser-provider.ts`. `scripts/print-mcp-config.mjs` prints a Codex configuration without a tool timeout.

Official [MCP configuration documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) documents a default 60-second tool timeout. That creates a configuration-level mismatch: a legitimate login or slow walk can outlive its host request. This is established by the code and documentation, not reproduced in an actual client here.

Short term: emit an explicit, documented timeout for each host that supports it, accounting for queue waiting and cleanup as well as the operation budget. Keep CLI login as the dependable fallback. Longer term: investigate a nonblocking login flow that reports progress through status rather than holding one request open while the student completes MFA. That changes session behavior and needs an ADR.

Acceptance: a synthetic slow walk survives the configured host budget; delayed human login can complete or cancel cleanly; timeout errors explain the next action.

### 2. High priority: installation is a developer workflow

The documented path requires Git, Node, npm installation, a build, manual host configuration, a separate login command, a restart and two verification calls. Setup prints every configuration format at once; it does not validate the selected client's connection. The registry path is explicitly pending in repository documentation.

Introduce a guided local setup command: choose client, check prerequisites, generate only its configuration, optionally install it with a backup, sign in, and verify the first course listing. Configuration changes must preserve unrelated servers and offer a dry run. Keep manual setup available.

A stable installed launcher is preferable to a checkout-dependent path for student distribution. Complete the existing release and SECURITY gates before publishing; registry availability was not independently checked in this review.

Acceptance: on a clean supported machine, the user reaches a course listing without manually editing JSON/TOML. Paths containing spaces and non-ASCII characters work.

### 3. High priority: session state is technically accurate but insufficiently explanatory

`status()` deliberately never launches Chrome. With no holder or local CDP endpoint, it reports `login-required`. A subsequent read may still successfully resume a saved profile. This difference is documented, but a student can reasonably interpret the status as proof they must sign in again.

Keep status passive. Distinguish verified sign-in, inactive session with unverified saved profile, sign-in in progress, explicit local logout, and unknown/error states. Profile existence must never be presented as proof of valid authentication. Provide a clear action such as “Try reconnecting” or “Sign in” based on verified evidence.

Use an explicit reconnect action to validate saved state when requested. Do not quietly turn status into browser startup. Changes require a session ADR.

Acceptance: after a simulated dead holder, passive status makes no false authentication claim, reconnect restores a valid session, and explicit logout prevents automatic reconnection.

### 4. Medium priority: login progress is mostly invisible to the student

The flow already reuses verified sessions, opens Chrome for SWITCH/MFA, cancels on window closure, hands off to a background session, and supports explicit logout. These are strengths. However, much of the feedback is stderr text, and `waitForAdamLogin` mainly polls for return to authenticated ADAM.

Expose safe stages: opening browser, waiting for sign-in, verifying ADAM, starting background session, connected, cancelled or failed. Use concise recovery messages. An observed return to ADAM is evidence; do not invent a precise MFA stage from a generic wait. Keep credentials entirely in the browser.

Acceptance: stalled login, closed window, expired form and holder startup failure each produce a useful outcome without a misleading “connected” state.

### 5. Medium priority: integration claims need dated client evidence

README names many clients; fixture and wire tests establish server behavior, not complete host support. Official [host documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) confirms local STDIO configuration and shared desktop/CLI/IDE configuration, while also distinguishing hosted web usage from local configuration. Avoid treating all surfaces as interchangeable.

Add a small support matrix: client version, OS, transport, setup method, tested date, confirmation fallback, progress/cancellation support and timeout configuration. Mark documented-but-unverified integrations plainly. Validate two primary student clients first, then expand.

The generated Claude Code shell line does not quote its absolute path. This checkout has no spaces, so that is a portability risk from inspection rather than a reproduced failure. Prefer structured command arguments or host-appropriate quoting, and test space-containing paths. Explicit Node paths can also reduce dependence on a GUI application's PATH.

### 6. Medium priority: errors require interpreting implementation language

`fail()` in `packages/mcp/src/results.ts` produces a text block containing a code, retryable flag and run ID, without structured error content. Hosts or agents must infer the recovery action from prose.

Return a validated error object alongside short human-readable text: code, retryability, recovery action and run ID. Differentiate browser missing, configuration failure, expired session, permission denial, queue congestion and unsupported format. Keep private material out of diagnostics.

A local `doctor` command should check Node/Chrome availability, built artifact location, configuration validity, profile accessibility and passive session state. It should never read course bodies or launch login merely to diagnose installation.

### 7. Medium priority: students cannot narrow expensive discovery sufficiently

Search exposes query, cursor and limit; calendar exposes dates, cursor and limit. Neither schema exposes a course/folder scope. A small result limit does not necessarily reduce the work of constructing a cross-course result set. With a capped walk, relevant material can be omitted while unrelated courses consume the budget.

Add optional scope using already observed, authorized course/folder identities, with stable pagination and honest coverage metadata. This does not require inventing new ADAM object types. Measure navigation count as well as latency. Tool contract changes should follow the repository's ADR process where applicable.

Acceptance: a question about one course visits only the relevant authorized subtree and clearly reports unreadable containers or exhausted budgets.

### 8. Medium priority: freshness and completeness are hard to explain in answers

One-minute caches and ten-minute immutable pagination snapshots are sensible. However, `freshness: live-browser-session` is an origin label, not an observation timestamp. Partial walks have a broad notice and skipped count, with a dedicated reason only for time-budget exhaustion.

Expose observation time, snapshot time and coverage reasons consistently. Offer an explicit refresh mechanism rather than telling users to restart the server for immediate freshness. Preserve immutable cursor semantics. A deadline answer should communicate “These are the dates I could verify” and identify incomplete coverage when present.

The existing `what_changed` workflow is timestamped news, not file inventory comparison. Keep that limitation visible. A future metadata-only inventory diff needs its own retention and scope design; it should not become a mass content crawl.

### 9. Medium priority: policy text overwhelms user-facing guidance

README and tool descriptions repeatedly mix normal tasks with protocol terminology, confirmation rules, cursors, recovery cards and fixture history. This increases reading effort and makes policy drift more likely.

Use a short student guide for setup, sign-in, supported questions, privacy and recovery. Keep detailed contracts in contributor documentation and concise central server instructions. Confirmation UI should explain the selected document or thread and that its text will go to the connected model, rather than presenting `confirm:true` as the user's task. Preserve explicit per-object approval or accepted elicitation; no blanket permission shortcut.

### 10. Architectural tradeoff: local browser access needs ongoing compatibility work

Browser parsing is the justified access path in this repository, but ADAM/ILIAS markup and SWITCH redirects are external dependencies. Fixture success cannot establish current live compatibility. Process identity probes also still use synchronous OS subprocesses, a potential source of Windows responsiveness problems that needs measurement.

Maintain a bounded, user-approved live smoke checklist and refreshed scrubbed fixtures after observed markup changes. Measure session-status overhead before replacing probes with asynchronous or batched implementations. Preserve process ownership checks. Do not enable dormant providers or unobserved object types to avoid these maintenance obligations.

## Recommended delivery order

| Batch | Deliverable | Evidence of success |
| --- | --- | --- |
| 1 | Host timeout alignment, client support matrix, path-safe selected-client configuration | Slow-request checks and one actual walkthrough per primary client |
| 2 | Guided setup, passive diagnostics, understandable session/reconnect states | Clean machine reaches first course; restart and explicit logout behave correctly |
| 3 | Login stage feedback and structured recovery errors | Expiry, cancellation, missing Chrome and failed background startup have distinct useful recovery |
| 4 | Course-scoped discovery, observation timestamps and explicit refresh | Fewer navigations for scoped tasks; partial answers remain honest |
| 5 | Student guide and small observed user pilot | Students complete representative tasks without developer assistance |

Track setup completion rate, time to first useful answer, login/recovery completion rate, request latency, cancellation latency and incorrect absence claims. Define targets after a baseline; this review does not claim measured user success rates or live latency.

A local graphical companion could eventually present connection status, sign-in/reconnect, client selection and diagnostics. Build it only if the guided command-line pilot still shows material onboarding friction. A hosted dashboard or session tunnel would conflict with the current local-only scope and is not required for these improvements.
