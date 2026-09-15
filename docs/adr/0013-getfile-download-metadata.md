# ADR 0013 - getFile download-abort metadata

## Context

Playwright aborts navigation when ADAM starts a file download (`Download is starting` / `net::ERR_ABORTED`). The browser provider previously returned a stub `FileObject` with `title === refId`, so `adam_get_file` looked broken after a warm `list_children` or on a cold open. Pulling full file bytes only to recover a filename would defeat ADR 0002’s “no blob to the model” posture and waste bandwidth.

## Decision

1. **Listing cache.** Remember `FileObject` rows from catalog extracts (`fileByRefId`). Prefer human listing titles / mime / size over page chrome or bare refIds.
2. **Abort path.** On download-navigation errors, build the file from cache and optional metadata — never invent file bytes for the tool result.
3. **HEAD probe.** Optional `AdamBrowserSession.probeAuthorized(url)` issues an origin-pinned HTTPS HEAD to `goto_adam_file_{refId}_download.html` for `Content-Disposition` / `Content-Type` / `Content-Length`. Do not fall back to full `fetchAuthorized` solely for metadata.
4. **Merge order.** When remembering types, seed from listing objects, let `catalog.files` (fileHints) win, and merge with any richer prior cache entry rather than blind overwrite.
5. **Walk.** Enrolled walks open via `openObject(..., { listingFastFail: true })` (same as listChildren / ADR 0004), not bare `/go/{type}` alone.

## Consequences

- Cold `getFile` can recover a real filename without a prior list when ADAM sends `Content-Disposition`.
- Sessions without `probeAuthorized` keep cache/stub behavior (no surprise full download for titles).
- Extract still uses `fetchAuthorized` for bytes (ADR 0002); this ADR only covers metadata recovery on aborted opens.
