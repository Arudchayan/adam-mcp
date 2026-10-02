# ADR 0019 — Elicitation spike (additive, capability-gated)

## Context

`confirm: true` is an interim schema gate after the student asked to read
(not OS permission, not elicitation, not equated to tool annotations alone).
Real confirms and future writes go to MCP elicitation when the host supports
MRTR (multi-round-trip requests). The SDK is `@modelcontextprotocol/server`
2.x, which spans two eras:

- **2025 legacy push**: `ctx.mcpReq.elicitInput({ mode: "form", message, requestedSchema })`
  (server→client request).
- **2026-07-28 modern return**: `inputRequired({ inputRequests: { confirm:
  inputRequired.elicit(...) } })` + re-entry via `acceptedContent(inputResponses)`.
  The legacy shim (default on) fulfils `input_required` via
  `elicitation/create` on 2025 connections, so one write-once return shape
  serves both eras. `requestedSchema` is flat primitives only (converted from
  Zod via `normalizeElicitInputParams`). Capability miss is `-32021`,
  bad `requestState` is `-32602`. Per-leg timeouts default to 60s protocol-wide;
  elicitation legs are human-paced, so 10 minutes is the spike value.

Body tools in scope: `adam_read_page`, `adam_extract_file_text`,
`adam_get_exercise`, and `adam_get_forum` iff `threadId` (post bodies).
Summaries without `threadId` need no confirm and no elicitation.

## Decision

1. **Write-once handlers** (`packages/mcp/src/server.ts`, helpers in
   `packages/mcp/src/elicitation.ts`): check `acceptedContent` first; if
   missing, return `inputRequired(elicit confirm:boolean "Yes, open it")`;
   the shim covers 2025 hosts. Elicited content is untrusted — only a boolean
   gate is read, never echoed into provider payloads, logs, or citations.
2. **Additive behind a capability check** (`clientSupportsElicitation`):
   modern per-request envelope `clientCapabilities.elicitation`, else legacy
   initialize-declared `getClientCapabilities()?.elicitation`. Fail-closed to
   `false` when unknown, so hosts without elicitation see zero behavior change.
3. **`confirm: true` stays as the fallback**: `ConfirmGate.requireTrue` and
   Zod `z.literal(true)` are kept (fields become `.optional()` so omit can
   reach the handler for elicitation). If the host lacks elicitation
   (`-32021` / `CapabilityNotSupported`) or on decline/cancel/timeout, fall
   back to the existing `confirmation_required` error text
   (`requires confirm:true after the student asked to read`). Decline/cancel
   re-entries use distinct safe text with the same code
   (`confirmation was declined/cancelled via elicitation…`); timeouts surface
   via the shim leg failure without re-entry (no data leak).
4. **Unchanged invariants**: `READ_ONLY_ANNOTATIONS` untouched,
   `UntrustedContent` envelope + `deepRedact` untouched, no file bytes, no
   writes, `tst` still denied. Elicitation never carries passwords or cookies.
5. **Timeouts**: `McpServer` is constructed with
   `inputRequired: { roundTimeoutMs: 600_000 }` (10 minutes, human-paced).
   The SDK legacy shim already defaults to 600s; passing it explicitly
   documents intent and avoids the 60s protocol default on any path.

## Consequences

- Capable hosts get a real elicitation prompt (`Yes, open it`) instead of only
  an auto-fillable boolean; incapable hosts get the exact existing
  `confirmation_required` text (no break, no hang, no `-32021` leak to the
  model as data).
- `tools/list` now advertises `confirm` as optional (still `const: true` when
  present) so omit can reach the handler; RPC-level `omit/false → isError with
  /confirm/` still holds on no-capability hosts via the fallback.
- No new tools, no resources/prompts changes, no HTTP/OAuth/Sampling/Roots/
  Logging wiring.

## Acceptance

- Both eras green in-memory (`packages/mcp/src/elicitation.test.ts`):
  modern envelope + legacy initialize paths build the same `input_required`
  shape; `isInputRequiredResult` true; flat-primitive schema verified.
- No-capability host passes existing confirm tests (`npm test` B4/forum/extract
  RPC suites on 2025-era `capabilities: {}` still `isError` with `/confirm/`
  and `confirm:true` still succeeds).
- Annotations unchanged (`readOnlyHint: true` on all four body tools).
- Decline/cancel/timeout produce distinct safe text (decline/cancel via
  `declineFallbackError`; timeout via shim leg failure; capability miss via
  `confirmation_required` fallback, modern `-32021` never reaches the model
  as content).
