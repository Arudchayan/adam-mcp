# ADR 0012 — Read-only forum thread read

## Context

Domain live pass 2026-09-14 (tip 5099529) sighted `frm` via enrolled `list_children` (frm×1 alongside file×37). Students need lecturer Q&A thread text. Forum *writes* (post/reply/subscribe), generic URL fetch, and `sess`/`webr`/`exc` expansion stay out of scope.

## Decision

1. **Resource primary.** Register `adam://frm/{refId}` (JSON). Cite live `https://adam.unibas.ch/go/frm/{refId}` the same way other resources cite `/go/{type}/{refId}`. Resource read returns forum meta + thread **summaries only** (no post bodies).
2. **One tool.** `adam_get_forum` with `readOnlyHint: true`.
   - Args: `refId` (forum), optional `threadId`, optional `confirm`.
   - Omit `threadId` → forum meta + thread summaries only (no post bodies); `confirm` not required.
   - Set `threadId` → that thread’s posts; `confirm: true` **required** via existing `ConfirmGate.requireTrue` (same class as `adam_read_page` / `adam_extract_file_text`).
3. **Fail-closed.** Provider paths require `type === "frm"` (or equivalent live type string). Wrong type → typed `unsupported_type` error; no silent coerce. Mirror AT5 / `adam_get_exercise`.
4. **Trust envelope.** All returned forum content goes through the ADR 0008 untrusted envelope (`UntrustedContent` / `runReadTool`); `deepRedact` applies; no file bytes; no writes.
5. **Fixture.** Labeled synthetic `frm` only for CI (AT5 style). Never invent unlabeled live-looking threads.
6. **Listing.** `list_children` may surface `type: "frm"` when a child is a forum. Do not expand `sess` / `webr` / `exc`.
7. **SOAP/HTML.** Stay fail-closed for `getForum`.
8. **Browser live HTML.** Parse thread summaries from the forum page markup students see (`thr_pk`, `thread_ids[]`, `viewThread` / `goto.php?target=frm_{refId}_{threadId}`). Parse post bodies from `ilFrmPostContent` when `threadId` is set. Missing or unparseable HTML → honest empty `threads`, or fail-closed posts (`not_found`, never invent bodies). Do not follow `showUser` links.

## Consequences

- First-party surface stays small: one resource template + one read tool.
- Post bodies stay behind the same interim `confirm: true` schema gate as page/extract (not OS permission, not elicitation).
- Live `adam_get_forum` / `adam://frm` thread lists can match the UI when the listing HTML contains thread rows; fixture still proves the full posts shape.
- `sess` / `webr` remain wait-for-inventory; `exc` unchanged beyond existing AT5 path.
