# ADR 0010 - Protocol correctness: cursor, resources, structured output, instructions

## Context

SOTA review (MCP SDK `@modelcontextprotocol/server` 2.0.0, protocol family 2025-03-26/2026-07-28) found four correctness gaps that are cheap and low-risk:

1. Invalid cursors silently reset to offset 0 (`decodeCursor` returns 0), causing duplicate pages and walk loops.
2. Resource misses throw generic `AdamError(not_found)` → `-32603` instead of `ResourceNotFoundError`.
3. Tool `structuredContent` is built without validating against the advertised `outputSchema`.
4. Server advertises no `instructions`, forcing every prompt to re-explain confirm/listing honesty.

## Decision

1. **Strict cursor at the MCP boundary.** `cursorSchema` is `z.string().regex(/^\d+$/).optional()`. Garbage is rejected at the MCP boundary before any provider call (surfaced as a tool `isError` result, not a wire `-32602`). Providers keep lenient `decodeCursor` internally (direct calls default to 0).
2. **Resource miss → `ResourceNotFoundError`.** `adam-course/folder/file/exercise` handlers catch `AdamError(not_found)` and throw `new ResourceNotFoundError(uri.href)`. `unauthorized` stays distinct (no oracle merge); other errors propagate.
3. **Structured-output validation.** `ok(data, schema)` / `runProvider(op, tool, schema)` / `runReadTool(op, tool, schema)` optionally `safeParse` the redacted `structuredContent`. Mismatch throws `AdamError(provider_unavailable, ..., retryable=false)` (shape bug, not retryable). All 13 tools pass their `outputSchema`.
4. **Server instructions.** `new McpServer(serverInfo, { instructions })` carries the read-only workspace contract: `adam://` vs `/go/...`, `confirm:true`, `empty` vs `unknown`, `tst` deny, no bytes/passwords.

## Consequences

- Clients that relied on garbage-cursor reset break (intended; they were looping).
- Resource hosts get correct caching/UX for misses.
- Provider drift is caught before it leaves the process.
- No new tools, no writes, no HTTP/Sampling/Roots/Logging/OAuth. `confirm:true` stays interim (MRTR deferred to Phase C writes).

## Tests

- `sota.test.ts`: cursor accept/reject, `ResourceNotFoundError` code, `ok` schema enforcement, `_instructions` presence.
- Existing `stdio.test.ts` B4/B6/B10/B11/B12 unchanged.
