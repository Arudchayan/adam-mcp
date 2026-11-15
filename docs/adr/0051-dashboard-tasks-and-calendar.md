# ADR 0051: Dashboard Tasks and Calendar blocks as calendar sources

## Status

Accepted

## Context

Issues #119 and #132: ADAM's Dashboard renders its own **Tasks** block (`block_pdtasks_{id}`) and **Calendar / Upcoming Events** block (`block_pdcal_{id}`). Both are UI item lists:

- **Tasks:** title `Submission of Assignment "…"`, a link to `/go/exc/{ref}/{assignment}`, the deadline in the item description, and an `Exercise` property.
- **Calendar:** title, with the start time in the description.

`adam_list_calendar` never returned `source: "calendar"`. The enrolled walk already opens the Dashboard first, so these blocks are available without extra navigation.

## Decision

- Parse both blocks from the Dashboard snapshot the walk already retrieves. No new pages, routes or tools.
- Return items whose description parses as an ADAM timestamp as `source: "calendar"`, `confidence: "explicit"`. Items without a parseable time are skipped.
- A task's `/go/exc/{ref}/…` link becomes `objectRefId`, so it merges with the same exercise's `exc` deadline (existing exc > calendar > page preference, corroboration kept in `seenIn`).
- Dedup no longer merges events that have **no** object only because they share a day. They key on title too. A no-object event with the same day and title as an object event (ADAM's `"<assignment> (Deadline)"` entry) merges into it.

## Consequences

The calendar gains ADAM's own upcoming events and task deadlines. Live: the upcoming exercise deadline is corroborated by Dashboard Tasks and Calendar, and the semester end appears as a calendar event, with no duplicates. Course-scoped calendars don't include Dashboard blocks, because the walk does not retain the Dashboard page for a scoped request.

Only the block's first page is read. The full `ilCalendarPresentationGUI` and `ilDerivedTasksGUI` views remain out of scope.
