# ADR 0053: Exercise assignment detail pages

## Status

Accepted (slice 1 of #129; live verification pending)

## Context

Issue #129: `adam_get_exercise` returns units parsed from the exercise overview (#120, ADR 0052). The overview card carries the deadline and status, but not the assignment's work instructions, remaining time or the student's own submission state. A structure-only live probe of ILIAS 10.12 on ADAM (text masked) showed:

- Each overview assignment title links to `/ilias.php?baseClass=ilexercisehandlergui&cmdClass=ilAssignmentPresentationGUI&…&ref_id={same}&ass_id={n}`.
- The overview also links `cmdClass=ilExSubmissionFileGUI&cmd=submissionScreen`. That is the **submit** screen.
- The detail page has one `panel-primary` (the assignment) and two `panel-sub` panels:
  1. **Work Instructions**: a text column plus an `il-card` "Schedule" card with `Edit Until: …` / `Ended On: …` and a `<strong>` remaining time (`5 Days, 12 Minutes, …` / `Time is up.`).
  2. **Submission**: `control-label` / value rows (`Submitted Files`, `Last Submission`) and a submit button.
- None of the 6 sampled assignments had instruction text, instruction files, a sample solution or tutor feedback.

## Decision

- `adam_get_exercise` takes an optional `detail: true` rather than a new `assignmentId` input:
  - The overview read already lists every assignment, so a client never needs to know, pass or guess an `ass_id`. Assignment ids stay out of the tool surface and out of model-invented input.
  - Each followed URL is a link the overview itself advertised, as in ADR 0030 and ADR 0052. A caller-supplied id would mean building URLs from input.
  - It composes with `view` (for example `view:"all", detail:true`).
  The cost is one page per assignment. The call is opt-in, sequential, and capped at **20** detail pages. Units past the cap are marked `detailStatus:"not_read"`.
- A detail link is followed only when it uses the pinned origin, `/ilias.php`, `baseClass=ilexercisehandlergui`, `cmdClass=ilAssignmentPresentationGUI`, the **same** `ref_id` and a numeric `ass_id`. Query keys must come from the allowlist (`baseClass, cmdNode, cmdClass, cmd, ref_id, ass_id, from_overview, mode`) with no duplicates. `mode`, when present, must be an overview mode (`ongoing|future|past|all`): live title links carry it under a non-default `view`. `cmd`, when present, must be `show…` (live links have none). The landed URL must pass the same check. The submit screen, file delivery and every other command are never followed. Buttons and form controls on the detail page are ignored.
- Each unit gets these fields:
  - `instructionText`: the Work Instructions text column only, with the Schedule card and page chrome excluded. It replaces the overview-derived text only when non-empty.
  - `schedule`: `{ deadline (parseAdamTimestamp), deadlineText, timeRemaining (raw) }`. `deadline` also fills `unit.deadline` when the overview had none.
  - `submission`: `{ submittedFiles, lastSubmission }`, ADAM's own text for this user. `ownStatus` keeps the overview logic: when the overview left it `unknown`, it is recomputed with the same function from the detail `Last Submission`.
  - `detailStatus`: `read | no_link | unrecognized | not_read`.
- Headings match English and German labels. A page without a recognisable Work Instructions or Submission panel is `unrecognized`, and no text is guessed.
- **Not parsed:** instruction files, sample solutions, peer or tutor feedback. There is no live evidence of their markup yet, so no selectors are invented. They are left to the ILIAS lab workstream.

## Consequences

- Same confirm gate as `adam_get_exercise`. Detail pages are body reads of the same approved exercise. `adam://exc/{refId}` never passes `detail`.
- Errors on a detail page (session expiry, cancellation, stale id) fail the whole call, as with any other read. Partial results are only produced for structural reasons (`no_link`, `unrecognized`, `not_read`).
- The fixture provider mirrors the shape: with `detail:true` it derives `schedule` and `submission` from the synthetic unit and marks it `read`.
- Live verification still needed: the exact title-link keys and `cmd` value (the allowlist may need widening), whether the landed URL stays on the presentation route, German labels, and a sample with real instruction text.
