# ADR 0056: Full Derived Tasks page in the calendar; Private Notes deferred

## Status

Accepted (live verification pending)

## Context

Issue #132, platform-services slice. ADR 0051 reads the Dashboard `block_pdtasks` block, which shows only the block's first page. ILIAS 10.12 on ADAM advertises these routes in the main bar to a student account (structure-only probe):

| Entry | Route | Notes |
| --- | --- | --- |
| Tasks | `ilias.php?baseClass=ilderivedtasksgui` | One `panel.il-panel-listing-std-container` of KS UI items. Properties `Exercise` and `End`. Item links `/go/exc/{ref}/{assignment}`. This is the full list behind `block_pdtasks`. |
| Private Notes | `ilias.php?baseClass=ildashboardgui&cmdClass=ilPDNotesGUI&cmd=showPrivateNotes&cmdNode=ai:vo` | Lands on `cmdClass=ilNoteGUI&cmd=getNotesHTML`. Labels `Text`, `Origin`. The probed account had 0 notes. Offers `cmd=exportNotesHTML` (an export) and `cmd=setSortation` (a preference write). |
| Comments | `…cmd=showPublicComments` | Same note GUI, public comments. |

No Learning Progress or Personal Workspace entry is advertised to this account. Guessed LP or workspace routes render blank or an error.

The Calendar's `jumpToCalendar` lands on `ilcalendarmonthgui`, which carries many `ilcalendarappointmentgui&cmd=add` and `ilcalendarcategorygui&cmd=add/switchCalendarMode` routes. Those are writes.

## Decision

### Tasks page → `adam_list_calendar`

- An **unscoped** `adam_list_calendar` also opens the Tasks route (`DERIVED_TASKS_PATH`) once, after the enrolled walk. Each item whose `End` (or `Ende`) property parses as an ADAM timestamp becomes a `source: "calendar"`, `confidence: "explicit"` event. The `/go/exc/{ref}/…` link becomes `objectRefId` and the canonical `/go/exc/{ref}` URL, so the existing dedup merges it with that exercise's `exc` deadline and with the Dashboard block item (`seenIn` keeps both sources). Items without a parseable `End` are skipped; nothing is inferred.
- **Always, not only when the Dashboard block looks truncated.** The block renders no reliable "more items" signal we have evidence for, and guessing would silently drop tasks. The cost is one extra page per unscoped calendar walk. It is memoized for 60 s with the walk generation (cleared by login, logout and `refresh`), so continuation pages and repeat calls within the walk memo do not reopen it.
- **Course-scoped calendars do not open it.** This matches ADR 0051: a scoped walk does not read the Dashboard. The `exc` pages in that course already supply its deadlines.
- **Honest failure.** The page counts as read only when it lands on `ilderivedtasksgui` and shows either the listing panel or an info message box with no listing (the explicit empty state). Anything else, or a non-auth open error, leaves the events out and marks the calendar `partial` with `unreadable_page`. Cancellation, `unauthorized`, `forbidden` and `stale_id` still surface (ADR 0015 / 0016).
- Search and news are unchanged. The Tasks page is not part of the shared walk.

### Private Notes: deferred

`adam_list_notes` is **not** added. The only live evidence is labels on an empty page (0 notes), so the item markup that would carry note text and origin is unverified. Notes are personal free text, and a parser written blind could leak or misattribute them. Revisit when an account with at least one private note can be probed structure-only. That design would be confirm-gated like `adam_read_page`, return text and an origin `/go/{type}/{ref}` only, and never request `exportNotesHTML` or `setSortation`.

### Out of scope

- **Calendar views** (`ilCalendarPresentationGUI`, `ilcalendarmonthgui`, …): pages dense with write routes (`appointment add`, `category add`, `switchCalendarMode`). The Dashboard Calendar block (ADR 0051) and the Tasks page already give upcoming events and deadlines without opening them.
- **iCal / feed subscription URLs**: they embed a personal access token. They are never requested, returned or logged.
- **Learning Progress and Personal Workspace**: ADAM offers neither to students. Unavailable, not missing.
- **Public comments**: other people's text on objects; not needed for deadlines.

## Consequences

- An unscoped `adam_list_calendar` reports every task deadline ADAM lists, not just the Dashboard block's first page. It costs one more page per cold walk.
- A Tasks page that cannot be read makes the calendar `partial` rather than silently shorter.
- Fixture parity: the fixture calendar carries one Tasks item for `100021`, which merges into the `exc` deadline.
- **Needs live verification:** the item layout and `End` format on a real Tasks page with ≥ 2 tasks; the empty-state markup (an info message box is assumed); that the route stays `ilderivedtasksgui` after redirects; that only the Tasks route is opened (no export, sortation or calendar routes).
