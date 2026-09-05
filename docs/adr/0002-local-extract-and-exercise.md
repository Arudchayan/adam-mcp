# ADR 0002 — Local file extract and read-only exercises

## Context

The product bar (M6/M10) requires explaining course PDFs and reading exercise instructions. The trust bar forbids sending file bytes to the model and forbids exam/`tst` automation or submissions.

Independent spec review (`4991bc42-2e92-49e0-a938-7414950ef8a2`) already locked the conflict resolution: local extract after `confirm: true`; `exc` is read-only; `tst` stays denied.

## Decision

- Add `AdamProvider.extractFileText` and `getExercise` in `adam-core`.
- Extract in-process: PDF string literals or `text/plain`, size-capped, sha256 of the **bytes kept in the local process**, page text only in the tool result. No `blob`, no base64.
- Browser fetches `goto_adam_file_{refId}_download.html` first, skips HTML login/object pages, then falls back to the canonical file URL.
- MCP tools: `adam_extract_file_text` (`confirm: true`) and `adam_get_exercise` (units, deadline, instruction text, own status). No submit, no other students' files.
- SOAP and HTML providers stay fail-closed, including the new methods.
- Resources `adam://fold/{refId}`, `adam://file/{refId}`, `adam://exc/{refId}` are citation handles; live ADAM URLs remain `https://adam.unibas.ch/go/...`.

## Consequences

Scanned PDFs fail with `unsupported_type` instead of OCR. Browser search/calendar/news remain shallow. `confirm: true` is still a schema gate, not a host modal. Extracted page text is wrapped as untrusted data.

## Independent review (2026-09-05)

Reviewer: isolated explore agent who did not author this patch.

**Verdict: PASS** for the extract + exercise surface (eight trust invariants hold). Follow-up tests cover HTML-skip and SOAP/HTML fail-closed on the new methods. Residual P1: browser `ownStatus` stays `unknown` and instruction text is the full page.
