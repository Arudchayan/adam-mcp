# ADR 0001 — Local Chrome session as the live ADAM adapter

## Context

ADAM does not offer a student OAuth API. Public checks on 5 Sep 2026: `/soap/server.php` HTTP 403, WebDAV plugin off, REST 404, ADAM is a SAML SP.

## Decision

Use a dedicated-profile Playwright Chrome session as the only live provider. Keep SOAP/HTML fail closed. Pin origin to `https://adam.unibas.ch`, HTTPS allowlist, ephemeral CDP via `DevToolsActivePort`, deny `tst`, require `confirm` on page reads, rate-limit navigations.

## Consequences

DOM selectors will break. Live search/calendar/news walk enrolled objects, not `ilsearchcontrollergui` or the calendar GUI. ChatGPT cannot spawn this stdio server. npm publish stays behind the [SECURITY.md](../../SECURITY.md) checklist.
