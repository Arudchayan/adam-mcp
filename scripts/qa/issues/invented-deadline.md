# Unknown exercise deadline borrows a later lecture date as an explicit due date

Severity: medium correctness (P2). Tested source `ef9776e`; independently verified with synthetic memory pages and intercepted real DOM.

Minimal page text:

```text
Deadline: not announced. Lecture starts 2026-11-12.
```

Expected: no exercise-unit deadline; lecture date may remain separate page-date evidence.

Actual: `getExercise().units[0].deadline` is `2026-11-12T00:00:00.000Z`. Calendar aggregation also promotes that date to `source: exc`, `confidence: explicit`.

## Cause

`exerciseDeadlineFromPage` in `packages/provider-browser/src/deadlines.ts` captures up to 120 same-line characters after a deadline label and takes the first date, crossing sentence boundaries and explicit unknown-status prose. Its own AT5 contract says unrelated session dates must not become deadlines.

## Acceptance criteria

- Explicitly unannounced/unknown deadline text does not borrow a following sentence's date.
- Keep supported EN/DE date formats, valid labeled deadlines and timezone/DST validation.
- Exercise and calendar regression tests verify absence of invented explicit due dates while preserving separate page-date evidence.

No live due date was tested or shown incorrect. All examples are synthetic; this is not evidence of unauthorized access.
