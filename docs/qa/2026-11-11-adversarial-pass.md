# Adversarial QA — 11 November 2026

## Verdict

**Not a clean QA pass.** The ordinary suite can pass while deterministic break
tests expose correctness and boundary-hardening defects. No production fixes,
release tags or package publication were performed in this pass.

Tested production source: `ef9776e80dbb4b7d60d33b9547b6a0ce5e0daacd`.
Environment: Windows, Node 24.19.0, npm 11.17.0. QA-only artifacts are on
`qa/adversarial-2026-11-11`. Independent agents first tested contracts and then
inspected causes; separate reviewers reproduced and narrowed candidate claims.
Subsequent public-evidence preparation and final artifact review used Terra medium
at the user's request. Earlier agents used the default model.

## Recorded runs

- Initial `npm run release:check` failed in the folder-sharing test. The relevant
  operations retained correct error taxonomy but made four rather than three
  navigations. Thirty isolated repetitions passed; a deterministic alternate
  schedule reproduces the assertion failure. Filed #90; no retry masked it.
- A later `npm test` passed 595 tests with one opt-in skip. This does not erase
  the initial failure or establish that #90 is fixed.
- Final `npm run release:check` on the public QA branch passed all gates, with
  600 workspace tests passing and one opt-in skip after five lifecycle guardrails
  were added. The explicit unfixed-defect repros remain intentionally failing.
- Typecheck, build, both distribution protocol checks, fresh packed-consumer
  installation/audit and five release-tooling tests passed separately.
- Full dependency audit, including development dependencies: zero reported
  vulnerabilities at the time checked. This is not proof of vulnerability absence.
- Opt-in disposable-Chrome folder DOM test passed separately, with intercepted
  synthetic requests and no personal profile.
- Public download guardrails: 16 passed. Lifecycle guardrails: five passed,
  including 960 seeded queue entries. Discovery guardrails: seven passed,
  including isolated Chrome frames, mutations, cursor expiry and cyclic traversal.
- Original blind protocol checks covered malformed wire/arguments, confirmation
  coercion/reuse, denied real test bodies, stdout hygiene and resource/tool parity;
  existing elicitation integration passed 68 tests. Private reproduction artifacts
  were not copied onto the public QA branch.
- Intentional expected-safe repro failures are separate files outside normal
  workspace test discovery. They are evidence of unfixed defects, not passing
  regressions or a reason to alter normal runner selection to hide failures.

## Public issue inventory

- #90 — scheduling-dependent folder-sharing test failure.
- #91 — unsolicited partial download saved as a complete original.
- #92 — HTML refusal encoding/prefix limits and overbroad documentation.
- #93 — resource/tool malformed metadata validation asymmetry.
- #94 — fixture denied-type-hint fidelity; not a production exam bypass.
- #95 — resource cancellation does not reach provider work.
- #96 — transfer callback deadline/cooperation limitations; low hardening.
- #97 — unknown exercise deadline borrows a later lecture date.
- #98 — failed startup removes a different pending generation's seed.
- #99 — stalled progress callback holds shared work; low optional robustness.
- #100 — later coalesced login ignores its cancellation signal.
- #101 — search resurrects identities suppressed by empty/unknown listings.
- #102 — sidebar link corroborates unrelated unparsed content rows.

Issue bodies under `scripts/qa/issues/` record expected/actual behavior, scope,
source locations and acceptance criteria. Do not inflate conditional callback or
provider-injection findings into demonstrated remote exploits.

Four additional security-sensitive candidates were submitted as **private draft
advisories**, following SECURITY.md. No public advisory, CVE request or real
credential-disclosure claim was made. Their reproduction details remain private.

## Live normal-user checks

The user completed normal Chrome login; session status was rechecked before reads.
Two bounded metadata-only passes each covered eight enrolled course roots and four
selected folders. The second prioritized exercise-named folders. The first observed
87 child objects and 53 file-metadata entries, with 58 cursor continuations; the
second observed 88 objects and 45 file-metadata entries, with 57 continuations.
Children/files inventories agreed within each sampled container. Neither pass
reported unknown inventory or provider errors. These are overlapping samples,
not unique totals or a complete recursive inventory.

The user approved normal-user inspection of one selected Web Link page. Its
listing still classified the object as unknown, and its page read resolved webr
without exposing a destination. A structural inspection emitted no titles,
page text, real IDs, external destination values, cookies, storage or file bytes.
  No external link was followed. Existing #84 was updated rather than duplicated.

Existing #86 was updated with passing samples, but remains open: the sampled
folders are not established to be the original four affected objects.

## Reproduction entrypoints

```sh
# Ordinary gate; the known flaky test may fail.
npm run release:check

# Passing synthetic guardrails.
node --import tsx --test scripts/qa/adversarial-downloads/held.test.ts
node --import tsx --test packages/provider-browser/src/adversarial-holder-public.test.ts packages/provider-browser/src/adversarial-lifecycle.test.ts
node --import tsx --test packages/provider-browser/qa/adversarial-discovery/held.test.ts

# Explicit unfixed-defect checks: expected to exit nonzero on the tested source.
node --import tsx scripts/qa/repro-folder-sharing-schedule.mjs
node --import tsx --test scripts/qa/adversarial-downloads/boundary-repros.ts
node --import tsx --test scripts/qa/mcp-boundaries.repro.mjs
node --import tsx --test scripts/qa-public-session/repro.mjs
node --import tsx --test packages/provider-browser/qa/adversarial-discovery/findings.repro.ts
```

Live scripts require explicit flags and an authenticated session. Do not run the
selected-page inspector without approval for that specific page. No broad live
fuzzing, authentication attacks, submissions, tests/exams, course-file downloads,
recursive mirroring, logout/purge or forced process termination was performed.

## Limits

This does not certify macOS/Linux execution of the new QA artifacts, POSIX
permissions, Windows file-symlink privilege/ACL behavior, every PDF malformed-input
resource limit, every client UI, live extraction/download content, or exhaustive
interleavings. Synthetic expected/actual failures establish implementation
behavior, not prevalence on ADAM. Passing safety controls do not establish
downstream model resistance to prompt injection.
