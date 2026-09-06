# ADR 0002 — Local file extract and read-only exercises

## Context

Students want PDF text and exercise instructions. Sending file bytes to a model, automating `tst`, or submitting `exc` are out of scope.

## Decision

- Extract in-process: PDF string literals or `text/plain`, size-capped, sha256 of bytes kept locally, page text in the tool result. No `blob` / base64.
- Browser fetch uses `goto_adam_file_{refId}_download.html` first, skips HTML login/object pages, then the canonical file URL.
- MCP: `adam_extract_file_text` (`confirm: true`) and `adam_get_exercise` (units, deadline, instruction text, own status). No submit, no other students’ files.
- SOAP and HTML stay fail closed for these methods.

## Consequences

Scanned PDFs fail with `unsupported_type` (no OCR). `confirm: true` is an interim schema gate — not a host elicitation modal, not an OS permission, and not equated to tool annotations alone. Real confirms / future writes → elicitation when the host supports MRTR. Extracted text is wrapped as untrusted data.
