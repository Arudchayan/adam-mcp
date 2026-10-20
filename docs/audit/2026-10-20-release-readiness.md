# Release readiness review

Reviewed 20 October 2026. **Hold publication until the remaining release gates are closed.** No npm package, Git tag, or MCP Registry entry was published.

## Media and publication follow-up

The overview has now been completely rebuilt as an approximately 107.5-second narrated illustration with eight designed scenes, realistic synthetic course examples, scripted replies, visible captions and explicit model-sharing/coverage limits. It contains no live browser capture or student information. The 54.6-second Inspector export retains synthetic footage with a new title, replacement narration and captions. The README preview GIF was regenerated. Rendering sources and both caption files are committed; audio/frames stay ignored. Both exports decoded successfully with H.264/AAC streams; sampled frames passed text-fit/disclosure checks, and the overview speech peak measured -3.4 dBFS without clipping. The earlier media rows below describe the initial review and are superseded by this follow-up.

The npm CLI is authenticated as `arudchayan`; no authentication material was copied into source or evidence. The account currently has no packages, so package-level trusted publishing cannot be configured until the first approved package exists. A manual `publish-npm.yml` workflow now reuses the six-platform candidate checks, verifies source/version/artifact hashes, and checks published integrity. It runs only on `main`, requires checklist attestation, the repository enable switch, and `npm-release` environment review. A local adversarial guard test passes for the approved artifact and rejects changed bytes, wrong versions/commits/branches and dirty trees.

The GitHub `npm-release` environment was created with required review by `Arudchayan` and deployment restricted to `main`. The npm trusted publisher and `NPM_PUBLISH_ENABLED` variable remain unconfigured. CI must verify the final committed workflow before it can be used. The user selected realistic samples for the demo; this does not provide the required real-client body-read walkthrough or independent review. Those release gates remain open.

## Source and scope

`git fetch --prune origin` and `git pull --ff-only` succeeded. The current branch, `feature/production-onboarding`, is up to date with its remote at `59cbe8b0a491eebc62e04866e74482cd9e790dbb`. The default branch is `99148fcda1f4cfcea085dadf4973db83378637e3`. Both have the identical source tree `3e2f0995ba041c1e6ffa6ad7aabf839c2cc4a892`. Existing local changes were preserved. This review includes uncommitted release-preparation changes and cannot certify an exact release commit.

Reviewed all six package roles, entry points and manifests; core policy/URL/redaction/extraction boundaries; MCP registrations, schemas, approval gates and result handling; browser/session/discovery boundaries; fixture and disabled providers; build/package verification; CI; and public documentation/demo sources. This is a source and release-readiness review, not an independent security assessment or proof of every live ADAM workflow.

## Findings and changes

| Area | Finding and disposition |
| --- | --- |
| Public wording | Demo assets use neutral overview/Inspector names. Production notes and narration now describe the workflow without pitch language or claims to retrieve every deadline. Synthetic replies remain disclosed. Existing video audio/frames have not been regenerated or certified. |
| Product claims | README search coverage now includes titles and available page text, matching the browser implementation. Partial coverage, news timestamp limits, local authentication, approval requirements, and model-provider sharing remain explicit. |
| Runtime and distribution | Node minimum is 22; candidate CI covers Node 22/24 on three operating systems. Root remains private; only `packages/mcp` is the intended npm publication. CLI workspace code bundles into ESM; runtime dependencies install through npm. |
| Package safeguards | Release checks require matching npm/Registry identifiers and versions, required license/readme/CLI/worker files, an allowlisted tarball, isolated installation and consumer audit, and both protocol smoke modes. |
| Release evidence | `release:prepare` produces a tarball, SHA-256 checksum and JSON evidence. A manual Release candidate workflow runs all six matrix checks before uploading evidence. It cannot publish and has read-only repository permissions. |
| Publication guidance | The release guide covers account/name ownership, exact-commit checks, artifact review, trusted publishing, provenance, installed-client validation, Registry submission and recovery. Actual publishing remains unconfigured. |

## Component assessment

| Component | Evidence and remaining limits |
| --- | --- |
| Core | Origin/ref parsing and exam denial are explicit. PDF/text bytes are bounded; PDF parsing runs in a worker with time/memory limits. Redaction is pattern-based and cannot guarantee removal of all personal information. |
| MCP | Body reads retain confirmation or capability-gated elicitation. Forum/exercise resources expose summaries/metadata. Untrusted-content notices, structured failures, cancellation and stdout discipline have fixture/wire coverage. Host annotations alone do not authorize reads. |
| Browser | Typed enrolled-object identity, same-origin extraction, redirect checks and byte caps guard reads. Cache snapshots expose timestamps and incomplete/unknown listings. Future ADAM markup changes remain a compatibility risk. |
| Session/setup | Dedicated Chrome profile, loopback CDP, PID-bound session holder, login/logout/resume and backup-based config changes have automated coverage. Passive status does not claim authentication based only on a profile directory. A real installed-client walkthrough is still required. |
| Providers | Browser is the runtime default. Fixture is used in-process and by the explicit test harness. HTML/SOAP remain fail-closed. Test catalog results do not establish live file/exercise coverage. |
| Licensing | GPL license and third-party notices are present. The bundled smol-toml parser includes its BSD license. Review exact artifact notices and corresponding source availability before distribution. |
| Media | Renaming exports does not clear their frames/audio for privacy, rights, accuracy or accessibility. Current script revisions require re-export/review before promotional use. Media is excluded from npm. |

## Verification evidence

Local environment: Windows, Node.js `24.19.0`, npm `11.17.0`.

| Check | Result |
| --- | --- |
| Fresh pull | Passed; current branch already up to date, tracked baseline identical to fetched `main` |
| `npm run release:check` | Passed: 446 tests, 446 passed, zero failures/skips; all six workspace typechecks; build; both distribution smoke modes; production audit; isolated tarball installation, consumer audit and protocol/PDF-worker checks |
| `npm ci` | Passed after the initial check; zero reported vulnerabilities. npm reported esbuild install-script approval warnings; no trust settings were changed. |
| Full `npm audit --json` | Zero vulnerabilities, including development dependencies |
| Final `npm run release:prepare` | Passed after `npm ci`: all 446 tests passed with zero skips; typecheck/build, both wire modes, both production audits and isolated consumer checks passed again. Produced `.release/adam-mcp-0.2.0.tgz`, checksum and JSON evidence. Evidence correctly marks the working tree dirty and publication unapproved. |
| Registry schema | `server.json` validated with Python jsonschema against its official published `$schema`; remote ownership and submission remain unverified |
| Release workflow | YAML parsed locally; six-job matrix and artifact dependency verified. GitHub execution is pending the committed workflow. |
| Syntax and whitespace | Updated recorder/chat/release helper syntax and `git diff --check` passed |
| Public npm metadata | `npm view adam-mcp ... --registry=https://registry.npmjs.org` returned E404; no public package found. This does not prove name availability or account ownership. |
| Upstream CI | [Run 39136814834](https://github.com/Arudchayan/adam-mcp/actions/runs/39136814834) passed all six jobs for `99148fc`: Windows/macOS/Linux, Node 20/22. It does not certify these local changes or the new Node 22/24 matrix. |

Earlier filesystem permission, junction, holder and network failures are not current blockers: the fresh pull, all tests and consumer checks succeeded in this session. They are not reproduced or used to justify skipping checks.

Local review tarball SHA-256: `a99e74183414c65edcd127ede0aae500d0d303365101083d035721433cff9abd`. The artifact is excluded from Git and is a local review candidate, not a release certification. Preserve it alongside `.release/release-evidence.json` only for this working-tree snapshot; regenerate evidence from the reviewed commit before publication.

## Remaining publication gates

1. Commit and independently review the final diff; require green Node 22/24 Windows/macOS/Linux CI for that exact commit. Run the release-candidate workflow and retain its artifact and run URL.
2. Record an installed-client walkthrough with version/OS, setup, sign-in, course listing, one student-selected approved read, refusal/cancellation, restart, expired-session recovery, timeout/progress and logout. Update the compatibility matrix with observed outcomes. This review does not authorize live body reads.
3. Complete every item in [SECURITY.md](../../SECURITY.md#publish-checklist), including independent protocol/QA/security review, exact-artifact notices/corresponding source, and footage/privacy/redistribution review. Re-export revised demo sources before claiming updated audio/captions.
4. Verify authenticated npm package/account ownership, candidate version availability and MCP namespace access. Configure a protected trusted publisher or use an approved interactive first publication; no credentials are needed for preparation.
5. Publish the reviewed tarball only after sign-off, validate the installed registry version and provenance, then validate/publish matching MCP Registry metadata. Update pending-release language only after observing successful publication and installation.

## Distribution research

Recommended distribution is npm for the local stdio CLI, followed by the official MCP Registry for discovery. No hosted endpoint is required. Official references reviewed on 20 October 2026:

- [MCP Registry quickstart](https://modelcontextprotocol.io/registry/quickstart): publish the npm artifact first; the Registry hosts metadata and remains in preview.
- [MCP package ownership](https://modelcontextprotocol.io/registry/package-types): npm `mcpName` must match the Registry name. Local assertions do not establish namespace ownership or remote acceptance.
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/): OIDC avoids long-lived publish tokens, requires npm 11.5.1+/Node 22.14.0+, and generates provenance for supported public CI publication.
- [MCP security guidance](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices): protect local process launch and authorization boundaries. HTTP OAuth guidance is not a requirement to add OAuth to this stdio server.

Follow [the release guide](../releasing.md). Automated checks are green locally; public-release sign-off remains incomplete.
