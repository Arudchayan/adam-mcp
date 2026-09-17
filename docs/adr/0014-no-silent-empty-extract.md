# ADR 0014 - No silent empty extract after confirm

## Context

Live confirm of `adam_extract_file_text` (2026-09-14, tip 5099529) could succeed after ConfirmGate with blank page text — a broken student-coverage result. Scanned PDFs already failed closed; empty/whitespace payloads and cap-window empties could still look like success.

## Decision

1. **No silent empty body after `confirm:true`.** Bounded extract pages must contain non-whitespace text, or the call fails closed. Do not wrap an untrusted envelope that pretends the read worked.
2. **Honest failure.** Empty/whitespace files and scans use `unsupported_type` (`retryable: false`) with a reason. When the 8-page / 40k-character window contains no text, use `provider_unavailable` (`retryable: false`) and mention the cap — same class as the 8MiB byte limit.
3. **Truncate honesty when text remains.** Char/page caps still set `truncated: true` and keep the bounded text. File bytes still never go to the model.
4. **ConfirmGate unchanged.** Omit / `false` / `"true"` still fail; only literal `true` proceeds. MCP handler also calls `assertExtractHasText` so a leaky provider cannot return a blank success.

## Consequences

Hosts see an error with a reason instead of a successful extract with empty `pages`. ADR 0002 local extract (PDF literals / plain text, no blob) is unchanged except this empty-body gate.
