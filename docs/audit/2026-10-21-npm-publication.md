# ADAM MCP 0.2.0 release review

Date: 21 October 2026. Source: 09ebda4896ba612afc1e9a7f1a65e55871dff0d4.
Reviewed tarball SHA-256: 2f082b237c412cb6a827bb4bd94fabb470769ff481eac7a189dc9e8ff1153d8d.

## Automated and artifact evidence

- [Main CI](https://github.com/Arudchayan/adam-mcp/actions/runs/39551998302): Windows/macOS/Linux, Node 22/24, all six jobs passed.
- [Candidate and artifact](https://github.com/Arudchayan/adam-mcp/actions/runs/39552000024): all six jobs and artifact passed on the same source.
- Local release check passed: 540 workspace tests, typechecking/build, legacy/modern distribution and PDF-worker checks, production audit, fresh consumer installation/audit and release-guard regression test. Full dependency audit: zero vulnerabilities.
- Downloaded clean CI artifact: version0.2.0, ten allowlisted files, expected source/version/hash verified. SOURCE.md identifies the exact public archive and build directions. Archive downloaded publicly and checked for source, lockfile, build script and legal notices.
- Separate external consumer installation of these exact CI bytes passed both stdio/PDF-worker smoke modes and a zero-vulnerability production audit.

## Independent review

The maintainer explicitly approved independent offline agent review as an alternative when the Codex Security helper could not start. No scanner job ran. These are agent reviews, not human certification, a formal scanner result or legal advice.

- security_release_review: core/browser and session boundaries; P2 forum-link navigation finding fixed and independently cleared, no other validated blocker in its scope.
- protocol_qa_release_review: approval/resources/error contracts; registered-handler approval integration design independently cleared and SDK2.3.1 API assumptions checked. Upgraded-dependency tests passed.
- distribution_license_review: package/license/source/workflow boundaries; exact-source directions implementation independently cleared. Upstream transitional Apache/MIT/documentation licensing is reflected in NOTICE; external dependency license files remain installed.

## Installed-client walkthrough

Windows, official installed Codex CLI0.163.0-alpha.11, ChatGPT authentication, ephemeral MCP configuration, read-only client sandbox. Server entry came from the isolated installation of the exact reviewed CI tarball. Live text was shared only for the one page explicitly selected and approved by the maintainer. No course text, account identifiers, cookies, profile files or private screenshots appear in this record.

| Check | Outcome |
| --- | --- |
| Setup/install | Clean external consumer install, generated setup preview, passive doctor and both protocol smoke modes passed. No permanent client configuration overwritten. |
| Inactive session | Real client returned login-required and the login recovery action. Saved profile alone was not treated as authenticated. |
| Recovery/sign-in | Maintainer completed SWITCH sign-in using the installed package. Dashboard verification succeeded and the background session connected. |
| Real listing | Connected status and live course listing succeeded through Codex. |
| Approved selected read | Explicit confirm:true returned 7,399 characters with provenance and untrusted-content notice. No text is reproduced here. |
| Refusal | confirm:false was rejected by input validation and returned no page body. No automatic retry was permitted. |
| Host timeout | A deliberately shortened 50ms tool timeout produced the host's tools/call timeout error. No returned body was displayed in the final verification response. |
| Restart after timeout | New client/server process connected and listed courses successfully. |
| Logout | Installed CLI stopped the holder, disabled automatic reconnect, and reported loggedIn:false, signed-out, holderPid:null, recoveryAction:login. Profile was retained; SWITCH credentials were not revoked. |
| Approval UI/progress limits | This noninteractive host walkthrough used explicit confirmation. It does not verify a graphical elicitation dialog, user-click cancellation or progress rendering. Those are not claimed as verified Codex UI features. Capability-gated decline/cancel/timeout suppression and progress/cancellation behavior have separate registered-handler/wire tests. |
| Expiry limits | Inactive/login-required recovery was exercised. Natural SWITCH expiry was not forced or claimed; unauthorized/expired-page transitions retain automated browser coverage. |

The supported installed-client path verified here is local stdio with explicit confirmation and CLI sign-in. Other client UIs and host-specific elicitation/progress remain unverified, as documented in the compatibility matrix. The walkthrough gate is assessed for this supported path with these explicit limits; it is not a claim of universal client compatibility.

## Media, privacy and publication

Both narrated demos were rebuilt and decoded/sampled for framing, captions and synthetic-data disclosures in the merged media work. The overview is code-rendered with realistic synthetic examples; Inspector footage is synthetic with revised narration/captions. No live course text or credentials are included in npm; media is excluded from the package. The project is explicitly unofficial and discloses model-provider sharing.

The maintainer authorized publication after retained review and walkthrough gates. First publication uses the authenticated, 2FA-protected npm account and the exact reviewed tarball. This interactive bootstrap does not establish GitHub OIDC provenance. Trusted publishing will use owner Arudchayan/repository adam-mcp/workflow publish-npm.yml/environment npm-release after the package exists. No long-lived publish token is added.

## Observed publication result

`adam-mcp@0.2.0` was accepted by npm following maintainer 2FA and became publicly
available after processing. Registry name, version, mcpName and integrity matched
the reviewed artifact. A new external consumer installed that exact npm version;
legacy/modern stdio and PDF-worker checks passed and its production audit reported
zero vulnerabilities. The registry tarball has ten files and the reviewed integrity
`sha512-vSSi2q8pc+UJ1doX4KBwQvj+K3Gft3Sns1LSVN73Nv2cPlh36SnIMF4HSoVCtKHrrpW9cvCJUoLFaEmEEk2DIA==`.

The protected npm trusted publisher was created for
`Arudchayan/adam-mcp`, `publish-npm.yml`, environment `npm-release`, after separate
maintainer 2FA. `NPM_PUBLISH_ENABLED=true`. No token secret was added. A successful
OIDC publication is not claimed; the first new-version publish must validate the
connection within npm's two-day window or the trust must be recreated. Existing
0.2.0 cannot be republished. Environment approval and release gates still apply.

MCP Registry submission is pending GitHub device authorization at this point.

Final protocol/QA follow-up reviewed this sanitized record and cleared the supported
explicit-confirmation/CLI-login path with no remaining blocker in scope. The
reviewer retained the UI/expiry limitations above and requested synchronization
of the public compatibility summary after publication.
