# Public session QA probes

These probes use disposable temporary directories, synthetic data, mocked process and network operations, and mocked Playwright entry points. They do not launch or attach Chrome or send real process signals. Each probe intentionally fails on the baseline; they are outside normal test discovery. Run from the repository root:

```sh
node --import tsx --test --test-name-pattern="S2 " scripts/qa-public-session/repro.mjs
node --import tsx --test --test-name-pattern="S3 " scripts/qa-public-session/repro.mjs
node --import tsx --test --test-name-pattern="S4 " scripts/qa-public-session/repro.mjs
```

- **S2, low:** A failed start's cleanup removes a different generation's seed in a controlled pre-CDP interleaving. This models a newer start that has written its seed but not yet consumed it; no other record is published. It does not establish that a healthy newer holder is killed. Responding CDP protects existing files, as covered by the passing holder test.
- **S3, optional robustness:** A deliberately never-settling progress callback holds shared work that awaits reporting, including another subscriber. This is a direct `SharedOperation` test, not evidence that an MCP transport callback actually hangs or that such a hang is common. Rejected callbacks are handled, as the passing lifecycle test demonstrates.
- **S4, low:** A later, already-aborted login subscriber receives the in-flight login's success instead of cancellation. The existing-session fast path is simulated via a gated `status`; this does not establish behavior for every login phase.

Passing companion tests:

```sh
node --import tsx --test packages/provider-browser/src/adversarial-holder-public.test.ts packages/provider-browser/src/adversarial-lifecycle.test.ts
```
