# ADR 0060: Read-only staff views (course members, exercise grades)

## Status

Accepted, **lab-verified, ADAM-unverified**. Built from a local ILIAS 10.12 lab (`tools/ilias-lab`, [docs/ilias-lab.md](../ilias-lab.md)), the same version ADAM runs. The maintainer's ADAM account is a student account, and these views are not offered to students. A student on ADAM gets `forbidden`, which the student path verifies. The tutor/admin path has not yet been seen on ADAM.

## Context

Issue #128 asks for read-only tutor/course-admin views. ADAM evidence is impossible without a staff account. The plan (see the issue) is:

1. stand up the same ILIAS version locally;
2. check that the student views match ADAM's (labels, panels, KS components);
3. derive the staff parsers from the lab.

Lab evidence, as the seeded tutor (`lab.tutor`, Course Tutor in "Lab Course"):

- **Course Members.** The course page's tab bar carries `Members` with `cmdClass=ilCourseMembershipGUI`. It lands on the **Edit Participants** table, a legacy `ilTable2` with `tr.tblrow1/2` rows. Its headers are `Name, Login, Roles, Passed, Tutorial Support, Access Refused, Notification, Actions`, after an unlabelled row-selection column. Roles is text ("Course Tutor", "Course Member"). ILIAS leaves it empty on admin rows. Passed, Tutorial Support and Notification are checkboxes. Notification exists only on admin rows. The table sits in a POST form (`cmd=...` updates, deletes and mail), and none of that is used.
- **Exercise grades.** The exercise tab `Submissions and Grades` is `cmdClass=ilexercisemanagementgui&cmd=members`. It has the sub-tabs *Assignment View*, *Participant View* and *Grades View*. Grades View is `cmd=showGradesOverview`, a `table#exc_grades_{n}`. Its column headers are the assignment numbers, linking with `ass_id`, then *Total Exercise*. Each row label is `Lastname, Firstname [login]`. Status is an icon whose `alt` is `Passed` / `Failed` / `Not Graded`. The save, mark and mail controls sit in POST forms.
- The student account sees neither tab.

## Decision

Two tools, both confirm-gated (`confirm: true`, or accepted elicitation per ADR 0019), with `READ_ONLY_ANNOTATIONS`:

- `adam_list_course_members {refId}` returns `members: [{name, login?, roles[], passed?, tutorialSupport?, notification?}]`.
- `adam_get_exercise_grades {refId}` returns `participants: [{name, login?, grades: [{assignment, assignmentId?, status}], total?}]`, where status is `passed | failed | not_graded | unknown`.

Both return `evidence: "lab-verified"`, are wrapped as untrusted, and run names and logins through `redactText`, so email-shaped values are redacted.

Navigation follows only **advertised** routes (the ADR 0030 / 0052 pattern). A link qualifies only when the page renders it and it passes all of these checks:

- pinned origin, path `/ilias.php`;
- the expected `cmdClass`, and `cmd` when one is required, otherwise `show*` / `members` / `participants`;
- the same `ref_id`;
- only the keys `baseClass, cmdNode, cmdClass, cmd, ref_id, vw, member_id, part_id, ass_id`, with no duplicates (so no `rtoken`);
- the numeric keys contain digits only.

When the tab is not advertised, the result is `forbidden` ("your role does not offer this view"), not `not_found`. When the landed page is not recognised, the result is `provider_unavailable` with no partial data. Forms are never submitted.

## Out of scope

- Writing grades, statuses or feedback.
- Adding, removing or mailing members.
- Exporting (Excel/CSV) and downloading submissions.
- Learning Progress cohort views: LP is not enabled in the lab, and ADAM does not offer it to students (ADR 0056). They wait for evidence.
- Preconditions and objectives. These are not seeded yet.

## Consequences

- Staff users get a roster and a grade matrix without new write surface.
- The parsers can drift from ADAM's real markup. They fail closed, and the first staff user who reports a `provider_unavailable` supplies the evidence for a fix. `evidence: "lab-verified"` stays until then.
- Fixture parity: the fixture account is a student, so both tools return `forbidden` (`unsupported_type` for the wrong type).
