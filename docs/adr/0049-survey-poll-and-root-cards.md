# ADR 0049: Read-only Survey and Poll types, repository-root cards, guessed-type redirects

## Status

Accepted

## Context

Issue #124 (items 1–3) cross-mapped live ADAM (ILIAS 10.12) against `adam-mcp@0.4.0`:

1. **Surveys (`svy`)** listed as `type: "unknown"` with `ilias.php?ref_id=` URLs. Reading one without a type probed `/go/crs/{refId}`, ADAM redirected to the parent course, and the call failed with `stale_id`, which tells the student to refresh a listing that was never stale. `type: "svy"` was rejected by the schema.
2. **Repository root (`root:1`)** listings returned `listingState: "unknown"` with `chromeOnly: true`. ILIAS 10.12 renders top-level categories as UI cards (`.il-card` in an `.il-deck`), with an image link named `Open …` and a title link to `/go/cat/{refId}`. The DOM probe only counted list rows, so card links were marked as chrome.
3. **Inline course polls (`poll`)** are rendered as a vote form, often without a title link, so listings omitted them.

Item 4 (explicit type mismatch) was fixed separately in #137.

## Decision

- **Types.** `svy` and `poll` join `ADAM_OBJECT_TYPES`, so they are valid `type` arguments and cite as `/go/svy/{refId}` and `/go/poll/{refId}`. Both are leaf objects: they are never walked, and they have no resource template.
- **URL parsing.** `cmdClass=ilObjSurveyGUI` / `ilObjPollGUI` map to `svy` / `poll`. `baseClass` is consulted only as a fallback after `cmdClass`, and only for those two GUIs, because a survey info screen lands on `ilias.php?baseClass=ilObjSurveyGUI&ref_id=…` without a `cmdClass`. Generic base classes such as `ilRepositoryGUI` still mean `unknown`.
- **Read-only.** `adam_read_page` (with the existing confirmation) returns the visible text of a survey's info screen or a poll's page. No tool submits a survey, votes, or follows a form action. Poll forms are read for their `action` ref only, and only inside `<main>`.
- **Poll titles.** A poll title comes from the nearest preceding heading or ILIAS item title. If none is found, it is the neutral `Poll {refId}`. Button labels such as `Vote` or `Ergebnisse` are never used as titles.
- **Root cards.** `.il-card` counts as a listing row in the DOM probe and as a row container for link classification. Image-only links take their name from `aria-label`. When an `Open <title>` link and a plain `<title>` link point at the same ref, the plain title wins.
- **Guessed-type redirects.** When `openObject` probes a type nobody supplied (no caller type, hint or cached identity) and ADAM lands on a different ref, the call fails with `unsupported_type`, `retryable: false`, saying the object's type could not be identified. A redirect after an explicit or cached type is still `stale_id` (ADR 0016).
- **Parity.** The fixture catalog gains labeled synthetic `svy` `100130` and `poll` `100131` under course `100101`. The root (`1`) already lists `cat/900001`.
- `tst` stays denied. No write tool is added.

## Consequences

- Hosts see surveys and polls with stable citations and can read them once typed, instead of getting a `stale_id` loop.
- `adam_list_children({ refId: "1", type: "root" })` can report `ok` with categories when cards render.
- A cold read of an unrecognized type now says the type is unknown instead of blaming a stale listing.
- All of this markup is synthetic and modelled on ILIAS 10.12. Live re-verification is still pending: the survey landing URL, the root card DOM and the poll block markup. If the live poll block has no form `action` carrying its ref, polls will still be missing from listings until a capture shows the right hook.
- Other ILIAS types named in #124 (`sess`, `grp`, `mcst`/`xoct`, `wiki`, `lm`, `glo`) remain out of scope here (epic #127).
