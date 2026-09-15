# ADR 0013 — Browser exercise extract depth (live-ready `exc`)

## Context

AT5 shipped labeled synthetic `exc` (`100021`) and a thin browser `getExercise`: fail-closed `type===exc`, labeled-deadline regex, single unit from full page text, hardcoded `ownStatus: "unknown"`. Domain live passes still report `exc`×0 in enrolled inventory (e.g. tip `5099529`), so live HTML capture is blocked. Students still need honest parsers ready when `/go/exc/{refId}` appears. Changing extract behavior needs an ADR (`AGENTS.md`).

Phase C submit/upload stays out. No invented live sightings.

## Decision

1. **Keep one tool + resource.** `adam_get_exercise` + `adam://exc/{refId}` (ADR 0002 / AT5). No new exercise tool.
2. **Type-hint fail-closed.** If the client passes `options.type` and it is not `exc`, refuse before open (mirror `getForum` / ADR 0012). Landed URL type must still be `exc`.
3. **Labeled deadlines only.** Extend `exerciseDeadlineFromPage`: when a label match includes wall-clock time (`HH:MM`), interpret as **Europe/Zurich** and emit ISO-UTC (Uni Basel). Unlabeled page dates never become unit deadlines (AT5/AT6).
4. **ownStatus from unambiguous EN/DE copy.** Map Not submitted / Nicht abgegeben → `none`; Submitted / Abgegeben → `submitted`; Passed / Bestanden → `passed`; Failed / Nicht bestanden → `failed`. Ambiguous or absent → `unknown`. Never invent grades.
5. **Units.** If the page has multiple clearly labeled assignment / Aufgabe blocks, emit one unit each; otherwise one unit with the object title. Instruction text prefers an Instructions / Arbeitsanweisung block; else capped page text with logout chrome stripped. No submit fields.
6. **Fixtures.** CI uses memory-session ILIAS-*shaped* HTML and fixture catalog goldens. Scrubbed live `exc` captures join `fixtures/live/` only after a real sighting + capture pipeline — do not invent.
7. **SOAP/HTML.** Stay fail-closed for `getExercise`.

## Consequences

- Browser path can surface ownStatus and Zurich-aware deadline times without waiting for inventory.
- Live verification remains a manual checklist until Domain records an `exc` sighting in `docs/capabilities.md`.
- Calendar `source:exc` continues to use the same labeled-deadline helper (AT6).
