# ADR 0004 — Typed object open, failure pages, no navigation quota

## Context

Power-user flow: list a course, open a folder, get a PDF, read an exercise. Live testing showed `list_children` / `read_page` opening bare `ilias.php?ref_id=` (type ignored), ADAM “Failure Message” returned as page text, and a self-imposed 20 navigations/minute **throw**. Serial Playwright already prevents parallel tab storms.

## Decision

- Open `/go/{type}/{refId}` when type is known; otherwise probe `crs → fold → file → exc → cat`. Never probe `tst`.
- MCP tools that take a `refId` accept optional `type` and pass it through.
- ADAM failure copy (`Failure Message`, requested page could not be found, German equivalents) is `not_found`, not content.
- Remove the per-minute navigation **quota throw** and the 1s gap. Keep the serial queue.
- `get_course` includes a bounded children summary from the same `/go/crs` snapshot.

## Consequences

Walks can keep up with a fast student. A buggy loop can still hit ADAM harder; that is accepted for a local single-user tool. Probe without `type` costs extra navigations; callers should pass `type` from listings.
