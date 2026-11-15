# ADR 0050: Structurally empty folders

## Status

Accepted. Narrows ADR 0030's "blank content is never empty" for folders only.

## Context

Issue #86: some ILIAS 10.12 folders failed closed with `provider_unavailable (blank_content)`. The student checked all three affected folders in interactive Chrome, and all three were genuinely empty: an upload-only dropbox and two exercise-sheet folders not populated yet. ILIAS renders such folders with no rows and no "empty" message, so ADR 0030 deliberately refused to call them empty without evidence.

A structure-only live probe (tags and classes, no text or identities) found a stable difference:

- **Empty folder:** the page header, breadcrumbs and three object tabs render, and `#il_center_col` has **no child elements at all**.
- **Populated folder:** `#il_center_col` always contains an `ilContainerBlock` with `ilContainerItemsContainer` rows.

The 10.11 scrubbed captures `folder-blank-exercises` and `folder-blank-notes` have the same childless-root shape.

## Decision

A folder listing is `empty`, with `listingSignals.structurallyEmpty: true` and its own notice, only when **all** of these hold:

1. The landing is the requested folder (`/go/fold/{refId}`), not a course or other object.
2. It is not a login, failure or permission page.
3. The main document's content root has no rows, no text, no media or controls, and **zero child elements**. Wrapper-only blanks such as `<div><div></div></div>` stay `unknown`.
4. Object tabs (`#ilTab li`) rendered, so the page itself loaded.
5. No same-origin content frame was probed. A frame means content may still be loading.
6. The ADR 0030 bounded readiness wait and the one advertised Content-tab recovery have already run.

Courses with the same shape stay `unknown`. A course that rendered no content is more likely a failed or partial load.

## Consequences

Genuinely empty and upload-only folders list as empty instead of erroring. The notice says no child objects are *visible to this account* and that upload-only folders look the same, so it never claims nothing exists. Every other blank stays fail-closed with the ADR 0030 diagnostic.

Live check: 23 nested folders gave 20 `ok` and 3 `empty`, matching the student's manual check. The old scrubbed captures carry no `structurallyEmpty` probe result, so their replay tests still expect `unknown`.
