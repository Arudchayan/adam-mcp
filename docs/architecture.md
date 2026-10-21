# Architecture

The 0.3.0 source candidate adds a CLI-only local download sink (ADR 0027),
scope-keyed discovery sharing and bounded PDF waiting demand (ADR 0028).
No MCP tool or resource gains local filesystem write access.

```
AI client (Cursor, Claude Desktop, VS Code, Windsurf, Claude Code)
        │  stdio, JSON-RPC
        ▼
   packages/mcp          tools / resources / prompts
        │
        ▼
   packages/core         ref_id, /go/{type}/{id} URLs, errors
        │
        ├── fixture      in-process test catalog (not a runtime provider)
        └── browser      dedicated Chrome profile → https://adam.unibas.ch (default)
```

ADAM MCP uses a local Chrome session for ADAM authentication. The MCP process talks to that browser; it is not a hosted ADAM proxy.

SOAP and HTML packages exist in the tree and fail closed. ADAM’s `/soap/server.php` returned 403 when checked (see [docs/providers.md](providers.md)).

Canonical citations are `https://adam.unibas.ch/go/{type}/{ref_id}`. MCP resource URIs (`adam://crs/{refId}`, …) are handles for the host, not URLs the browser should fetch.

Stdout is MCP only. Logs go to stderr.

## SDK / protocol pin (A4)

- **SDK:** `@modelcontextprotocol/server` **2.x** — `packages/mcp` depends on `^2.3.1` (resolved 2.3.1 in lockfile).
- **Protocol era:** MCP specification **2025-03-26** / **2026-07-28** family (stdio JSON-RPC; tools, resources, prompts). Do not adopt deprecated Sampling, Roots, or protocol Logging; do not put MCP OAuth on stdio.

Bump the pin in this file when changing the server dependency major or the negotiated protocol era.

## Confirm vs elicitation (A3)

`confirm: true` on `adam_read_page`, `adam_extract_file_text`, `adam_get_exercise`, and `adam_get_forum` (when `threadId` is set) is an **interim schema gate** used **after the student asked to read** that object. It is the explicit fallback argument for hosts without elicitation support. The argument is optional in the schema so omission can enter the capability-gated elicitation handler. No body is returned before either explicit confirmation or accepted boolean elicitation. The flag is **not**:

- an OS permission dialog,
- MCP **elicitation**, or
- equated to tool annotations alone (`readOnlyHint`, etc.).

The runtime supports MCP **elicitation** when the host supports MRTR (ADR 0019). Omission on other hosts, decline, or cancel returns `confirmation_required` and no bodies. Future writes need a separate review. Do not document `confirm` or annotations as elicitation.

Spike behavior (both eras, shim default-on, `confirm: true` fallback intact): [ADR 0019](adr/0019-elicitation-spike.md).


## Trust envelope (ADR 0008)

Every read tool result and every ADAM `resources/read` payload is wrapped as `UntrustedContent` (`untrusted: true` + notice) and passed through `deepRedact`. Page/extract keep the page notice; listings, exercise, forum, and other structured reads use the data notice. `ConfirmGate.requireTrue` gates instruction/page bodies on `adam_read_page`, `adam_extract_file_text`, `adam_get_exercise`, and forum posts (`threadId`). Resource `adam://exc/{refId}` returns exercise metadata only (no `instructionText`); instruction bodies require the confirm-gated tool.

## SOTA hardening (ADR 0010 / 0011)

- **Instructions:** `McpServer(serverInfo, { instructions })` carries the read-only contract (handles vs live URLs, `confirm:true`, `empty` vs `unknown`, `tst` deny).
- **Tool arguments:** Zod rejects (`confirm:false`, a non-digit cursor, a non-ADAM URL) are tool results with `isError: true` and an input-validation message. Omitted confirmation reaches the elicitation handler (ADR 0019). The SDK does not emit JSON-RPC `-32602` for those rejects (ADR 0010). Fixture offsets use `decodeCursor`; browser cursors bind to snapshots (ADR 0021). Resource misses use `ResourceNotFoundError`, reported as `-32602`.
- **Resources:** `not_found` maps to `ResourceNotFoundError`; `unauthorized` stays distinct.
- **Structured output:** `ok(data, outputSchema)` validates redacted `structuredContent`; mismatch is `provider_unavailable` non-retryable (shape bug).
- **Bounds:** `MAX_PAGE_CHARS=50_000` (`adam-core`); `PageContent.truncated` + `untrustedPageOutputSchema.truncated?`; truncate after `inferDates`. Extract caps stay 8MiB / 40k chars / ≤20 pages; after `confirm:true`, empty extract text fails closed (ADR 0014) instead of a blank success.
- **Cancellation:** `ObjectOpenOptions.signal` + `throwIfCancelled(signal)` (`cancelled`, non-retryable). MCP extracts via `signalFromContext(ctx)` and threads to every provider; browser walks check per iteration and never memoize cancelled walks.
- **Retryability:** unknown bugs and `cancelled` are `retryable=false`; only `provider_unavailable` defaults true.
- **Redaction:** `password/api_key/secret`/matriculation in text; `password/api_key/secret` query keys in URLs; `deepRedact` uses `redactUrl` for `*url` fields.

Bounded live re-verify (no code): [live-reverify.md](live-reverify.md).

## Read reliability (ADRs 0021–0023)

Labelled deadline parsing validates real calendar days and preserves supported
clock times. Unzoned clocks use Europe/Zurich; ambiguous or nonexistent DST
times are omitted. Date-only values retain UTC-midnight representation without
claiming a known deadline clock. Unknown child containers propagate `partial`.

Page and complete-walk caches expire after 60 seconds. Partial walks and unknown
container pages are not memoized. Opaque decimal browser cursors reference fixed
query-bound snapshots for ten minutes (maximum 256 tokens); page snapshots are
capped at 128. Search/calendar/news accept `refresh:true` without a cursor to
start fresh discovery while preserving existing cursors. Other reads refresh
after a minute or server restart. Login, close and a
logged-out status clear cached identity and pagination state.

Complete walk caches and shared operations are keyed by enrolled course scope
or the global scope, with at most 32 cached and 32 in-flight scopes. Scoped
search/calendar/news share traversal; each new walk verifies enrollment. PDF
parsing retains one worker, with up to eight waiting jobs, at most 32 MiB of
waiting input and a 30-second queue deadline. Overload is a retryable error.

CLI downloads stream directly to a private temporary file in an explicit existing
directory outside Git. They have separate 256 MiB/120-second transfer limits,
safe filenames, a digest and exclusive final-name creation via hard link. Ordinary
failure/cancellation cleans the temporary name. They never send file bytes through
MCP, write to ADAM or relax selected-object text approval. See [downloads](downloads.md).

Discovery accepts an enrolled `courseRefId`, checked against dashboard evidence
before scoped navigation. Snapshot results carry `snapshotAt`; item provenance
retains fetch times. `partialReasons` identifies time/page caps, unreadable pages
and unknown listings. See [ADR 0025](adr/0025-production-onboarding-and-read-controls.md).

Provider/confirmation failures return a redacted error envelope with code,
retryability, recovery action and optional run ID alongside the legacy error line.
Advertised output schemas accept successes or errors; success payload validation
remains strict. SDK-generated schema validation rejects retain the SDK's text
format. Setup and doctor are local CLI commands, not new MCP tools.

PDF.js extracts actual pages in a local worker with a 20-second timeout, a
128 MiB JavaScript heap limit and captured diagnostics. Eval/XFA/rendering are
disabled. Limits apply to actual pages and text; page count comes from the PDF.
File transfers stream through a pinned-origin fetch, checking every redirect
before credentials are sent and cancelling at the byte cap. HEAD responses
are disposed. See [ADR 0022](adr/0022-bounded-page-aware-extraction.md).

Redaction covers session/OTP/recovery identifiers, auth headers, query/fragment/
matrix carriers, URL-shaped fields and explicit sensitive scalar fields. The
former adversarial TODO tests now block CI. This is pattern-based hygiene, not
general detection of personal information or arbitrary prose secrets: ambiguous
human titles and unlabeled secrets remain outside the guarantee.

Login reuses a verified session, otherwise releases headless Chrome before opening
a visible sign-in window. Cancellation/closed windows stop waiting and failures
close owned windows. Explicit logout prevents automatic resume until login.
The host signal reaches interactive login and holder startup; holder failure
cleanup keeps ownership evidence when Chrome/CDP remains live.

## Session recovery (runbook)

Full runbook: [session-recovery.md](session-recovery.md). `npm run login`
(headed first sign-in) → holder owns headless Chrome → `adam_session_status`
(never launches) → `npm run logout` (stops holder). A dead holder resumes once
per read (headless verify → cookie handoff) or fails closed
`unauthorized` / `login-required`.

```
tool ──► holder check ──► holder live? ──yes──► attach CDP ──► read
                │                              ▲
                no                 dashboard verifies
                ▼                              │
         resume? (headless Chrome              │
         on existing profile) ──signed-in──► handoff to new holder
                │
                └──login page──► close Chrome ──► unauthorized (tool AdamError; status with no holder → reason: login-required)
```

