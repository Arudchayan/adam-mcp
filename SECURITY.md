# Security

This server runs with the student’s ADAM session. Treat it as credential-equivalent software.

## Reporting

Open a GitHub Security Advisory on this repository, or an issue with the `security` label. Do not attach cookies, Chrome profiles, SWITCH passwords, or live course PDFs.

## Scope

In scope: local stdio MCP, the dedicated Chrome profile, host allowlist, tool results, fixture data, release artifacts.

Out of scope: University of Basel ADAM itself, SWITCH edu-ID, third-party model providers, hosted MCP (not shipped).

## Publish checklist

A public release is blocked until all of the following are true:

1. Full GPL-3.0 text in `LICENSE` plus `NOTICE` for Apache-2.0 dependencies.
2. This file, `CODE_OF_CONDUCT.md`, `docs/threat-model.md`, `docs/product-spec.md`.
3. CI on Windows, macOS, and Linux: `npm test`, `npm run typecheck`, `npm run build`, `npm run audit`.
4. Default provider is `fixture`. SOAP and HTML providers fail closed.
5. Chrome debugging is not on a well-known localhost port.
6. HTTPS + pinned `https://adam.unibas.ch`; allowlist on start and final URL.
7. Rate limit + concurrency 1 + size caps, tested.
8. `adam_read_page` requires `confirm: true`.
9. Object type `tst` is denied. No write tools.
10. No PDF bytes to the model. Download cancel is tested.
11. Stdout is protocol-only. Redaction tests cover emails, cookies, and session query keys.
12. README states: unofficial, never paste SWITCH passwords, tool output may leave Switzerland, copyright applies.
13. Browser-session architecture has an independent review recorded in git history / ADR.
14. No real student data, cookies, or private screenshots in the repo.
