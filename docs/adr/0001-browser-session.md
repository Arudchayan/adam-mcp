# ADR 0001 — Local Chrome session as the live ADAM adapter

## Context

Six independent 2026-09-05 reports (DX, MCP architecture, repo critique, feature inventory, live ADAM, trust) had to decide how a student MCP talks to ADAM without SWITCH passwords in the model.

Public checks: `/soap/server.php` Apache 403, WebDAV plugin off, REST 404, ADAM is a SAML SP, SWITCH OIDC is not a student client for ADAM.

## Decision

Ship a dedicated-profile Playwright session as the only live provider. Keep SOAP/HTML fail-closed. Pin origin to `https://adam.unibas.ch`, HTTPS allowlist, ephemeral CDP via `DevToolsActivePort`, deny `tst`, confirm page reads, rate-limit navigations.

## Consequences

DOM fragility remains. Live search/calendar/news walk enrolled ADAM objects, not `ilsearchcontrollergui` or the calendar GUI. ChatGPT is unsupported. A compiled `packages/mcp/dist/adam-mcp.mjs` exists after `npm run build`; npm registry publish is still blocked until the SECURITY checklist is green.

## Independent review (2026-09-05)

Reviewer: isolated explore agent `4991bc42-2e92-49e0-a938-7414950ef8a2` (did not author the Playwright implementation).

**Verdict: FAIL for public GitHub/npm tag.**

Findings accepted:

- Rate limit / download cancel / size caps needed tests (added).
- `npm audit` missing from CI (added).
- Compiled `bin` missing (esbuild `dist/adam-mcp.mjs` added; registry publish still later).
- Spec mixed “trust publish” with “product complete” (three bars documented in `docs/product-spec.md`).
- `confirm: true` is a schema gate, not host elicitation (documented as residual risk, not claimed as a human modal).

PDF extract and `get_exercise` are implemented as local text extract + read-only `exc` (ADR 0002). They are still **product-complete** work relative to the original trust-publish P0, not a reason to skip the SECURITY checklist.

## Remediation after the FAIL (same day)

The FAIL findings were implemented in-tree before the public GitHub push:

- Rate limit, download cancel, size caps, and redaction have package tests.
- CI runs `npm test`, `typecheck`, `build`, and `audit` on Windows/macOS/Linux × Node 20/22.
- Compiled `packages/mcp/dist/adam-mcp.mjs` is the student CLI after `npm run setup`.
- Trust-publish vs shipped-MCP vs product-complete bars are in `docs/product-spec.md`.
- `confirm: true` remains a schema gate; residual confused-deputy risk is documented.

A public **npm tag** stays blocked until `SECURITY.md` is green, including green CI. This ADR is the recorded independent architecture review; it is not a self-issued PASS for registry publish.
