# Production readiness — local read-only workflows

Updated 13 October 2026. Scope: local STDIO, dedicated Chrome authentication,
existing enrolled ADAM surfaces and approved text reads. No hosted server, ADAM
writes, new object types, registry publication or tags are part of this change.

## Requirements and evidence

| Requirement | Implementation and verification |
| --- | --- |
| Installation reaches a useful student outcome | Packaged `setup --client … --write --login`; prerequisite checks, backed-up config merge and first course verification. The built CLI completed this flow against live ADAM using a temporary configuration, without changing an actual client's settings. |
| Host configuration is portable and preserves unrelated settings | Absolute Node executable and entry arguments, JSON/TOML parsing, original-file backup and atomic replacement. `onboarding.test.ts` covers all generated client formats, spaces/non-ASCII paths, tool-policy preservation and malformed configuration refusal. |
| Tool timeout covers authentication | Codex emits 2,100 seconds: maximum 30-minute login plus five-minute startup/queue/cleanup margin. Other clients use CLI login unless their timeout behavior is verified. |
| Diagnostics are passive | `doctor`, with optional JSON output; checks Node, Chrome, artifact, profile accessibility, config and existing session. Synthetic tests and built/installed CLI checks use isolated profiles; no browser launch is needed. |
| Session recovery is understandable | Additive connection states and recovery actions; saved profile is unverified, explicit logout differs from failed login, unfinished sign-in windows are not attached to. Session-state and login-flow regressions pass. |
| Login is cancellable and gives feedback | Safe progress stages, queued signal propagation, cancellation-aware notifications and verification before announcing connection. Window closure, cancellation, timeout, notification failure and session reuse are tested. Root npm helpers now forward options correctly; a live two-minute login command confirmed forwarding and successful handoff. |
| Errors support reliable recovery | Redacted provider/confirmation error envelopes with code, retryability, recovery action and optional run ID. Advertised output schemas include error branches. An independent JSON Schema validator accepts errors and rejects malformed successes; legacy/modern wire checks preserve body gates and exam denial. SDK-generated input-validation failures retain SDK text. |
| Discovery can be narrowed safely | Search/calendar/news accept enrolled `courseRefId`. Dashboard evidence authorizes scope before navigation; synthetic tests show other courses are not visited and unknown scope is refused. A live scoped search completed with honest partial coverage. |
| Freshness and completeness are visible | Explicit `refresh` starts a new discovery snapshot and rejects cursor combination. Existing cursors keep their snapshots; `snapshotAt` and per-item fetch provenance distinguish times. Partial reasons identify caps, unreadable pages and unknown listings. Regression coverage passes. |
| Policy and student guidance agree | ADR 0025, shorter README, setup/recovery guide, tool-contract reference and dated client matrix. No approval gate, pinned origin, read-only boundary or inactive provider was relaxed. |
| Package works outside the repository | `release:check` packs and installs into a clean consumer with production dependencies, then exercises setup/doctor, legacy and modern STDIO, scoped reads, extraction worker and stdout hygiene. |

## Observed checks

- Full suite: **444 passed**, zero failures, skips or TODOs. The last additional
  regression covers all JSON client formats; the complete suite was rerun.
- Strict workspace type checking passed.
- Build and distribution smoke checks passed for legacy and modern modes.
- Production dependency audit reported zero vulnerabilities at check time.
- Clean tarball installation and its built CLI checks passed.
- `git diff --check` passed.
- Environment for local checks: Windows, Node 24.19.0. Repository CI separately
  targets Windows/macOS/Linux and Node 20/22; record actual PR outcomes below.

Live metadata observation: **2026-10-13T17:16:57Z**. Status was connected, enrolled
course listing was `ok` with at least one course, and scoped discovery returned
a timestamp and `partial:true`. This verifies a usable session and truthful
incomplete coverage, not exhaustive course coverage. A prior holder had expired
after several hours; the provider refused reads with `unauthorized` and a fresh
interactive sign-in restored access. No course names, bodies or credentials are
stored in this record. Guided setup subsequently verified login reuse and the
course listing.

## Release gates and limits

1. Record the change's actual six-job CI matrix result; local Node 24 checks do
   not prove Node 20/22 or other operating systems.
2. Record installed-client version/OS walkthroughs in `client-compatibility.md`,
   including progress, timeout and confirmation behavior. Generated config and
   protocol tests are not actual desktop-client walkthroughs.
3. A current live body/extraction check requires the student to select and approve
   that particular object. It was not performed under blanket production-readiness
   authorization. Forum/deadline tests depend on permitted inventory; do not hunt
   or expand types to fill a checklist.
4. Before publishing/tagging, satisfy the complete `SECURITY.md` checklist, review
   the proposed release and use `npm run release:check`. No publication or tag was
   made for this work.

Remaining product limits include scanned PDF OCR, exact formula/layout fidelity,
news as a substitute for inventory-change tracking, unobserved object types,
pattern-based redaction and the maintenance burden of live browser markup.
They remain explicit limitations rather than hidden claims of full ADAM coverage.

PR/CI evidence: pending creation and matrix verification at initial record.
