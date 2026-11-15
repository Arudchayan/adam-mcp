# ADR 0052: Exercise assignment views (Ongoing / Upcoming / Past / All)

## Status

Accepted

## Context

Issues #120 and #129: `adam_get_exercise` read only the overview's default **Ongoing** view, so past (closed or submitted) assignments were unreachable. A structure-only live probe of the ILIAS 10.12 exercise overview shows the mode buttons as `<button data-action="…">` routes:

`ilias.php?baseClass=ilexercisehandlergui&cmdNode=…&cmdClass=ilObjExerciseGUI&cmd=showOverview&ref_id={same}&mode=ongoing|future|past|all&from_overview=1`

Past assignment cards label their deadline `Ended On` instead of `Edit Until`.

## Decision

- `adam_get_exercise` takes an optional `view`: `ongoing` (default, unchanged), `upcoming`, `past` or `all`. The result echoes `view` when one was requested.
- A non-default view follows **only** a route the overview itself advertises, as with the ADR 0030 Content tab. The route must use the pinned origin, `/ilias.php`, `baseClass=ilexercisehandlergui`, `cmdClass=ilObjExerciseGUI`, `cmd=showOverview`, the **same** `ref_id`, and the requested mode. Query keys are allowlisted and duplicate keys are rejected. No guessed URLs, submission or management commands are ever followed.
- If the requested view isn't advertised, or its page has no recognizable assignment structure, the call returns `unsupported_type` and names the view.
- `Ended On` (plus German equivalents) is a deadline label.

## Consequences

Same confirm gate as before: the view page is a body read of the same approved exercise. Live: two exercises went from 1 and 0 visible assignments to 8 and 3 under `all`, all with deadlines. The calendar walk still reads only the default view, so past deadlines stay out of `adam_list_calendar`.
