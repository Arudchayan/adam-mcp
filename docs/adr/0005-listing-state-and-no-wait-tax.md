# ADR 0005 — Honest listing state, no wait tax

## Context

`list_children` / `list_files` returning `ok` + `items: []` is ambiguous: true-empty
folder (fixture `100020`) vs ILIAS item list that never hydrated. `open()` stacked
`networkidle` 15s + `delay(1_500)` + `waitForFunction` 12s on every navigation,
slow and flaky on ILIAS 10, and timeouts were swallowed into `[]`. Separately,
`parseAdamRef` typed a child id from the parent `cmdClass`
(`ilobjfoldergui&ref_id=PARENT&item_ref_id=CHILD` → `fold/CHILD`), poisoning
`typeByRefId` and `adam://` handles.

## Decision

- Add optional `listingState: "ok" | "empty" | "unknown"` (+ optional
  `listingSignals`, `notice`) on `Paginated<T>`. Page-backed lists must set it;
  walks (`search` / `calendar` / `news`) stay best-effort `Paginated`.
  - `ok`: source listing hydrated (usually `items.length >= 1`; a later cursor
    page may be `items: []` with `totalHint > 0` and no `nextCursor`).
  - `empty`: list finished, zero children (ADAM empty copy or finished item
    list with zero rows). `items` must be `[]`, `totalHint: 0`. Only valid on
    the first page (no cursor).
  - `unknown`: page opened, list not trustworthy. May carry partial items.
    Never claim "folder is empty". Omit `totalHint`.
  - `not_found` stays an error, never a `listingState`.
- Classify from DOM signals in extract, not from waits: item selectors hit →
  `ok`; EN/DE empty-folder copy → `empty`; else → `unknown`.
- Remove `networkidle` + unconditional `delay(1_500)` from `open()`. Keep
  `domcontentloaded` + one bounded `waitForFunction(fn, undefined, { timeout })`
  scoped to the content container. No retry storms on `unknown`.
- `parseAdamRef`: when `item_ref_id` names a distinct child, return
  `{ type: "unknown", refId: child }`. `cmdClass` describes the parent `ref_id`,
  not the child. `unknown` is the needs-resolve marker; `rememberTypes` already
  skips it.

## Consequences

Callers switch on `listingState` instead of `items.length`. Models must not say
"nothing there" unless `empty`, must not say "no deadlines" from an empty fold
(`100020` vs `100021` still holds). `unknown` may cause one retry with `type`
from the parent listing, then cite the ADAM URL. `paginate()` stays a slicer;
callers attach state after slicing.
