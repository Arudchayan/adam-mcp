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
4. Default provider is `fixture`. SOAP and HTML stay fail closed.
5. Chrome debugging is not a well-known localhost port.
6. HTTPS + pinned `https://adam.unibas.ch`; allowlist on start and final URL.
7. Rate limit, concurrency 1, size caps — tested.
8. `adam_read_page` requires `confirm: true`.
9. Object type `tst` is denied. No write tools.
10. No PDF bytes to the model. Download cancel is tested.
11. Stdout is protocol-only. Redaction tests cover emails, cookies, and session query keys.
12. README states the project is unofficial and that tool output follows the user’s model host.
13. Browser-session architecture has a review recorded in `docs/adr/`.
14. No real student data, cookies, or private screenshots in the repo.
