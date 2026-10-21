# Release review — 21 October 2026

Candidate: `adam-mcp@0.2.0`, local stdio, Node 22+. This supplements the
[20 October review](2026-10-20-release-readiness.md). It records observed results;
publication requires the final committed artifact and remaining walkthrough.

## Independent manual reviews

The maintainer approved independent agent review when the Codex Security helper
could not start. No scanner job was created. These are offline agent assessments,
not a completed Codex Security scan, human review or legal certification.

| Reviewer | Scope and disposition |
| --- | --- |
| `security_release_review` | Core/browser boundaries and session controls. Found a P2: forum source hrefs could navigate an authenticated tab to an unintended ADAM route. Independently reviewed the fix and cleared it: numeric requested IDs now construct a pinned route before navigation; source hrefs are discarded. No other validated blocker in its scope. |
| `protocol_qa_release_review` | Tool approval, protocol contracts, resources, errors and configuration. Independently cleared the new registered-handler approval test design and SDK 2.3.1 API compatibility. Test execution on the upgraded dependency remains required; host UI behavior is separate. |
| `distribution_license_review` | Package boundaries, dependencies, notices, release guards and source availability. Requested immutable recipient-facing source directions. Independently cleared the implementation: generated SOURCE.md and release evidence bind the exact source revision/archive; package verification checks the installed copy. Public archive verification remains a release action. |

The forum fix and its limitations are documented in [ADR 0026](../adr/0026-forum-thread-navigation.md).
Approval integration uses in-process legacy SDK transport and modern HTTP-shaped
dispatch with fresh server factories. It checks all four body routes: accepted
boolean approval, false/string/missing decisions, decline/cancel, incapable-host
fallback, and legacy unanswered timeout. It does not establish real-client UI
behavior; modern timeout ownership remains with the host.

## Dependency refresh

The 21 October audit detected advisories added to the audit database since the
previous clean run. The MCP server/core dependency was updated from 2.0.0 to
2.3.1. NOTICE reflects Apache-2.0 package metadata and the upstream LICENSE's
retained MIT contribution terms and separate documentation license.
The upstream advisories describe HTTP transport/validation/authentication paths;
this product exposes local stdio only and adds no HTTP listener or bearer auth.

- [Shared HTTP transport/server advisory](https://github.com/advisories/GHSA-jm63-cq47-j5jp)
- [HTTP validation resource advisory](https://github.com/advisories/GHSA-46jr-4wx8-v453)
- [HTTP bearer audience advisory](https://github.com/advisories/GHSA-rvq5-wwqv-78pq)

## Observed client walkthrough

Windows; official installed Codex CLI `0.163.0-alpha.10.2`, ChatGPT authentication,
ephemeral read-only configuration. Initial runs used the repository's built
distribution entry, not an independently installed tarball. Logs remain private
and ignored; no course body, screenshot, profile or credential is release evidence.

| Check | Observed result |
| --- | --- |
| Chrome sign-in | Maintainer completed SWITCH sign-in; CLI verified the dashboard and continued with a background session. |
| Metadata through real client | Session connected; course listing returned live browser provenance and an honest successful listing state. |
| Selected approved read | Maintainer explicitly approved one selected course page and model sharing. `confirm:false` failed before returning a body; `confirm:true` returned nonempty text with untrusted-content notice and provenance. No body is reproduced here. |
| Client process restart | Metadata and approved-read runs used separate fresh Codex CLI processes with ephemeral server configuration. |
| Later passive status | After the session became inactive, status returned login-required/disconnected, without claiming the saved profile was authenticated. Renewed sign-in is pending. This is not evidence of a naturally expired SWITCH session. |
| Remaining live checks | Final installed tarball, renewed login, logout/reconnect, and host-specific cancellation/progress/timeout outcomes still require completion or an explicit recorded unsupported outcome. Automated tests remain separate evidence. |

## Media and final release evidence

Local `npm run release:check` passed on Windows, Node 24.19.0/npm 11.17.0
after the SDK update: workspace tests, strict typechecking, build, both stdio
smoke modes and PDF worker, locked production audit, isolated tarball install,
consumer audit and protocol checks, and artifact guard regression test.
The separate full dependency audit also reported zero vulnerabilities.
These results cover the working-tree change; exact committed CI is still required.

Both narrated MP4 exports and the overview GIF were rebuilt in the preceding
merged release preparation. The overview uses synthetic, code-rendered scenes
and realistic sample courses; the Inspector recording retains synthetic footage
with revised narration/captions. Media is excluded from npm.

The green matrix and archived artifact for `43a4243` precede these fixes and the
dependency update. They cannot certify the new candidate. Archive final CI URLs,
source archive verification, tarball file list/checksum/integrity and installed
client outcomes after committing the final changes. npm publication and trusted
publisher activation are still pending.
