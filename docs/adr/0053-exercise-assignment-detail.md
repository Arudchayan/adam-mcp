# ADR 0053: Exercise assignment detail pages

## Status

Accepted (slice 1 of #129, live-verified; slice 2 amendment below, lab evidence)

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

## Consequences

- Same confirm gate as `adam_get_exercise`. Detail pages are body reads of the same approved exercise. `adam://exc/{refId}` never passes `detail`.
- Errors on a detail page (session expiry, cancellation, stale id) fail the whole call, as with any other read. Partial results are only produced for structural reasons (`no_link`, `unrecognized`, `not_read`).
- The fixture provider mirrors the shape: with `detail:true` it derives `schedule` and `submission` from the synthetic unit and marks it `read`.
- Live verification (slice 1): the default view and `view:"all"` read detail pages on ADAM after `mode` was allowlisted.

## Amendment: Files, Sample Solution, Team, Evaluation by Tutor (slice 2)

### Evidence

The local ILIAS 10.12 lab (`tools/ilias-lab/`, #161) uses the same student-view labels and panels as ADAM. The assignment detail page can carry four more `panel-sub` panels with the Submission panel's structure: a `.panel-heading.ilBlockHeader > h3` heading, then `.panel-body > div.row`s holding a `div.control-label > p` label and a sibling `div.col-* > p` value.

1. **Files** (instruction files): one row per file. The label is the file name; the value is a `Download` link (`cmdClass=ilexsubmissiongui&cmd=downloadFile&file=…`).
2. **Sample Solution**: the same shape, with `cmd=downloadGlobalFeedbackFile`. It appears only when available (in the lab, after the deadline).
3. **Team** (team assignments): the value is status text such as "You are not assigned to a team yet!", plus `div.ilFormInfo` and a **Create Team** button, which is a write.
4. **Evaluation by Tutor**: an `Evaluation Statement` row holding the tutor's text, and a `Status` row (`Passed`, `Failed`, …).

Official ILIAS v10.12 lang strings (en | de):

| Key | en | de |
| --- | --- | --- |
| exc_instruction | Work Instructions | Arbeitsanweisung |
| files | Files | Dateien |
| exc_global_feedback_file | Sample Solution | Musterlösung |
| exc_team | Team | Team |
| exc_feedback | Evaluation by Tutor | Rückmeldungen |
| exc_tbl_comment | Evaluation Statement | Text-Feedback |
| already_delivered_files | Submitted Files | Bereits abgegebene Dateien |
| exc_last_submission | Last Submission | Datum der letzten Abgabe |

### Decision

- With `detail: true`, each unit may also carry:
  - `instructionFiles: [{ name }]` and `sampleSolution: { name }`: the row labels (file names) only.
  - `team: { status }`: the team panel's text with buttons removed, passed through `redactText`. Member names appear only if ADAM shows them in that text.
  - `evaluation: { statement?, status? }`: the statement is passed through `redactText`.
- A panel ADAM does not show stays absent.
- **Metadata only.** Download links (`downloadFile`, `downloadGlobalFeedbackFile`), the Create Team button and every other team, submit or download route are never kept, returned or followed. Reading the text of exercise files would need its own ADR.
- `ownStatus`: a tutor `Status` of Passed or Failed (via the same `ownStatus()` patterns) wins over the overview, unless the overview already said passed or failed. Otherwise the slice 1 logic is unchanged.
- German labels now use the official strings above, in both the detail parser and the overview's Last Submission label. The slice 1 guesses ("abgegebene Dateien", "Letzte Abgabe") never matched. The slice 1 Work Instructions pattern also failed to match the singular "Arbeitsanweisung"; that is fixed too.

### Consequences

- Same confirm gate and the same single page per assignment: no extra navigation.
- The fixture provider adds a synthetic `instructionFiles` name with `detail: true`.
- Live and lab verification still needed: the four panels on ADAM itself, a graded assignment's Evaluation panel, and a team assignment.
