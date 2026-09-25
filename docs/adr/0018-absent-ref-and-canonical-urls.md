# ADR 0018 - Absent refs and canonical citations

## Context

A live read of enrolled courses showed three contract misses:

1. `adam_get_course` on a ref that never resolved returned `unsupported_type`. Agents treat that code as “wrong type” and `not_found` as “absent”.
2. Opening a course ref with a `file` hint could land on a different category. That path already throws `stale_id`. It must stay distinct from absence.
3. News items and some embedded children were cited as `ilias.php?ref_id=…` even when the href or the open page parsed to a typed ADAM ref. `listingState=unknown` on pages whose list did not load was already the honest signal; the scrubbed fixtures do not show a parser that calls a real listing empty.

## Decision

1. **Absence vs wrong type vs identity mismatch.** After a page opens, `getCourse` returns the course when the landed object is `crs` for that ref. A resolved object of another known type is `unsupported_type`. No resolved object (including a landing with type `unknown`) is `not_found`. A landed typed ref that is not the requested ref stays `stale_id` (ADR 0016). `listingState=unknown` is not reclassified as `empty`.
2. **Canonical citation when a ref parses.** News and catalog links use `https://adam.unibas.ch/go/{type}/{id}` when `parseAdamRef` yields a known type from the href, or, for news with no typed href, from the open page URL. HTML `&amp;` in hrefs is decoded before parse. A ref whose type cannot be known stays `unknown` with `ilias.php?ref_id={id}`. Do not invent `/go/unknown/…` or a ref that was not in the href or page URL.
3. **No remote transport.** stdio remains the only MCP transport. ChatGPT cannot attach it. A hosted HTTP or SSE server is not part of this change.

## Consequences

- Agents retry or refresh using the existing recovery line: absent → `not_found`, wrong type → `unsupported_type`, different object → `stale_id`.
- Citations that parse are stable `/go/` links. Untyped `ref_id` links stay visible; the folder is not reported empty because of them.
- A successful open is reused until `login()` / `close()` only when the landing is a typed object for the requested ref (ADR 0015). Unknown landings are not stored, so they do not confirm a type probe. Cancelled, unauthorized, forbidden, and stale opens are not stored. The serial queue and the 48-page walk cap are unchanged.

## Tests

- `course-identity.test.ts`: absent → `not_found`; same-ref fold → `unsupported_type`; file open landing on another category → `stale_id`.
- `canonical-urls.test.ts`: news href and page URL; untyped news does not invent `/go/unknown/`; typed `ilias.php` child vs unknown sibling.
- `page-reuse.test.ts`: one open for get/list/list-files; cancel does not open; `login()` opens again.
