# Security

## Reporting

Open a GitHub Security Advisory, or an issue with the `security` label. Do not attach cookies, Chrome profiles, SWITCH passwords, or live course PDFs.

## Scope

In scope: local stdio MCP, the dedicated Chrome profile, host allowlist, tool results, fixture data, release artifacts.

Out of scope: University of Basel ADAM, SWITCH edu-ID, third-party model providers, hosted MCP (not shipped).

## Publish checklist

Do not tag GitHub/npm until all of these hold:

1. GPL-3.0 text in `LICENSE` plus `NOTICE` for Apache-2.0 dependencies.
2. This file, `CODE_OF_CONDUCT.md`, `docs/threat-model.md`, `docs/scope.md`.
3. CI on Windows, macOS, and Linux: `npm test`, `npm run typecheck`, `npm run build`, `npm run audit`.
4. Default provider is `browser` (live ADAM); `--browser` is a no-op alias. `ADAM_PROVIDER=fixture` fail-closes at runtime (`provider_unavailable`, `retryable=false`); in-process tests call `createFixtureProvider()` / `createConfiguredProvider("fixture")` directly, while `ADAM_MCP_TEST_FIXTURE=1` selects fixture only for the spawned stdio test harness. SOAP and HTML stay fail-closed; enabling either requires an ADR.
5. Chrome CDP uses an ephemeral loopback port with a detached headless session holder (no password, no persistent seed); dashboard is verified on start/resume; `adam_session_status` never launches a browser.
6. HTTPS + pinned `https://adam.unibas.ch`; allowlist on start and final URL.
7. Concurrency 1 (SerialQueue), size caps — tested.
8. `adam_read_page`, `adam_extract_file_text`, `adam_get_forum` (when `threadId` / post bodies), and `adam_get_exercise` require `confirm: true`. `confirm` is an interim schema gate after the student asked to read — not an OS permission, not elicitation, not equated to tool annotations alone. Real confirms / future writes → MCP elicitation when the host supports MRTR.
9. Object type `tst` is denied. No write tools.
10. No PDF bytes to the model. Download cancel is tested.
11. Stdout is protocol-only. Redaction tests cover emails, cookies, and session query keys.
12. README states the project is unofficial and that tool output follows the user’s model host.
13. Browser-session architecture has a review recorded in `docs/adr/`.
14. No real student data, cookies, or private screenshots in the repo.
