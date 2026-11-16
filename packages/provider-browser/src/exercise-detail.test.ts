import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBrowserProvider } from "./browser-provider.ts";
import { EXERCISE_DETAIL_CAP, exerciseAssignmentDetailUrl, parseExerciseDetail } from "./exercise-detail.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

const origin = "https://adam.unibas.ch";
const detailRoute = (ass: string, ref = "100021", extra = "") =>
  `/ilias.php?baseClass=ilexercisehandlergui&amp;cmdNode=cs:n1:ab&amp;cmdClass=ilAssignmentPresentationGUI&amp;cmd=showAssignment&amp;ref_id=${ref}&amp;ass_id=${ass}${extra}`;
const submitRoute = (ass: string) =>
  `/ilias.php?baseClass=ilexercisehandlergui&amp;cmdNode=cs:n1:ac&amp;cmdClass=ilExSubmissionFileGUI&amp;cmd=submissionScreen&amp;ref_id=100021&amp;ass_id=${ass}`;

/** Skeleton of the live ILIAS 10.12 assignment detail page (structure-only probe). */
function detailPage(options: { instructions?: string; schedule: string; remaining: string; files: string; last: string; extra?: string }): string {
  return `<html><body><header class="il-maincontrols">Menu Dashboard Help</header><main>
<div class="panel panel-primary panel-flex"><div class="panel-heading ilBlockHeader"><h2>Sheet</h2></div><div class="panel-body">
<div class="panel panel-sub panel-flex"><div class="panel-heading ilBlockHeader"><h3>Work Instructions</h3></div><div class="panel-body">
<div class="row"><div class="col-sm-8">${options.instructions ?? ""}</div><div class="col-sm-4">
<div class="il-card thumbnail"><div class="caption card-title">Schedule</div><div class="caption">${options.schedule}</div><div class="caption"><strong>${options.remaining}</strong></div></div>
</div></div></div></div>
<div class="panel panel-sub panel-flex"><div class="panel-heading ilBlockHeader"><h3>Submission</h3></div><div class="panel-body">
<div class="row"><div class="control-label col-sm-3"><p>Submitted Files</p></div><div class="col-sm-9"><p>${options.files}</p></div></div>
<div class="row"><div class="control-label col-sm-3"><p>Last Submission</p></div><div class="col-sm-9"><p>${options.last}</p></div></div>
<div class="row"><div class="control-label col-sm-3"><p></p></div><div class="col-sm-9"><button class="btn btn-primary" data-action="${submitRoute("1")}">Hand In</button></div></div>
</div></div>${options.extra ?? ""}</div></div></main><footer>Imprint</footer></body></html>`;
}

const assignment = (title: string, href: string, status = "Not Attempted") =>
  `<div class="il-item"><h4 class="il-item-title"><a href="${href}">${title}</a></h4><div class="il-item-properties"><span class="il-item-property-name">Edit Until</span><span class="il-item-property-value">20. Nov 2026, 12:00</span><span class="il-item-property-name">Status</span><span class="il-item-property-value">${status}</span></div><a href="${submitRoute("9")}">Hand In</a></div>`;

const absolute = (route: string) => new URL(route.replace(/&amp;/g, "&"), origin).href;

describe("ADR 0053: exercise assignment detail", () => {
  it("accepts only the same-exercise ilAssignmentPresentationGUI route", () => {
    assert.match(exerciseAssignmentDetailUrl(detailRoute("7"), "100021") ?? "", /ass_id=7/);
    // Live title-link shape: no cmd, two-part cmdNode, mode=all under a non-default view.
    const live = "/ilias.php?baseClass=ilexercisehandlergui&amp;cmdNode=cs:n12:34&amp;cmdClass=ilAssignmentPresentationGUI&amp;ref_id=100021&amp;from_overview=1&amp;ass_id=7";
    assert.match(exerciseAssignmentDetailUrl(live, "100021") ?? "", /ass_id=7/);
    assert.match(exerciseAssignmentDetailUrl(`${live}&amp;mode=all`, "100021") ?? "", /mode=all/);
    assert.equal(exerciseAssignmentDetailUrl(`${live}&amp;mode=evil`, "100021"), undefined, "unknown mode");
    assert.equal(exerciseAssignmentDetailUrl(`${live}&amp;mode=all&amp;mode=past`, "100021"), undefined, "duplicate mode");
    for (const href of [
      undefined,
      submitRoute("7"),
      detailRoute("7", "100099"),
      detailRoute("7").replace("cmd=showAssignment", "cmd=submit"),
      detailRoute("7").replace("ass_id=7", "ass_id=x"),
      detailRoute("7").replace("&amp;ass_id=7", ""),
      detailRoute("7", "100021", "&amp;ass_id=8"),
      detailRoute("7", "100021", "&amp;file=1"),
      "https://evil.example" + detailRoute("7"),
      "/go/exc/100021/1",
    ]) assert.equal(exerciseAssignmentDetailUrl(href, "100021"), undefined, String(href));
  });

  it("parses work instructions, schedule and submission, without chrome or buttons", () => {
    const now = new Date("2026-11-15T10:00:00Z");
    const open = parseExerciseDetail(detailPage({ instructions: "<p>Read chapter 3.</p>", schedule: "Edit Until: 20. Nov 2026, 12:00", remaining: "5 Days, 12 Minutes", files: "You have not submitted any files.", last: "No submission yet." }), now);
    assert.deepEqual(open, {
      instructionText: "Read chapter 3.",
      schedule: { deadlineText: "20. Nov 2026, 12:00", deadline: "2026-11-20T11:00:00.000Z", timeRemaining: "5 Days, 12 Minutes" },
      submission: { submittedFiles: "You have not submitted any files.", lastSubmission: "No submission yet." },
    });
    const ended = parseExerciseDetail(detailPage({ schedule: "Ended On: 9. Oct 2026, 12:00", remaining: "Time is up.", files: "x.pdf", last: "8. Oct 2026, 09:00" }), now);
    assert.equal(ended?.instructionText, undefined, "empty instruction column stays absent");
    assert.equal(ended?.schedule?.deadline, "2026-10-09T10:00:00.000Z");
    assert.equal(ended?.schedule?.timeRemaining, "Time is up.");
    assert.equal(parseExerciseDetail("<main><p>Something else</p></main>", now), undefined);
  });

  it("follows each advertised detail link through the provider, never the submit screen", async () => {
    const overviewUrl = `${origin}/go/exc/100021`;
    const detailUrl = absolute(detailRoute("1"));
    const opened: string[] = [];
    const session = createMemorySession({
      [overviewUrl]: snapshotFromHtml(overviewUrl, "Exercises", `<main><h1>Exercises</h1>${assignment("Sheet 1", detailRoute("1"))}${assignment("Sheet 2", "/go/exc/100021/2")}</main>`, "Exercises Sheet 1 Sheet 2"),
      [detailUrl]: snapshotFromHtml(detailUrl, "Sheet 1", detailPage({ instructions: "Solve 1-3.", schedule: "Edit Until: 20. Nov 2026, 12:00", remaining: "5 Days", files: "You have not submitted any files.", last: "No submission yet." }), "Sheet 1"),
    }, { onOpen: (url) => opened.push(url) });
    const provider = createBrowserProvider({ session, origin });
    const result = await provider.getExercise("100021", { type: "exc", detail: true });
    assert.deepEqual(result.units.map((unit) => [unit.title, unit.detailStatus, unit.ownStatus]), [["Sheet 1", "read", "none"], ["Sheet 2", "no_link", "unknown"]]);
    assert.equal(result.units[0]?.instructionText, "Solve 1-3.");
    assert.equal(result.units[0]?.schedule?.timeRemaining, "5 Days");
    assert.equal(result.units[0]?.submission?.lastSubmission, "No submission yet.");
    assert.equal(opened.some((url) => /ilExSubmissionFileGUI/i.test(url)), false, "submit screen never opened");
    const plain = await provider.getExercise("100021", { type: "exc" });
    assert.equal(plain.units.some((unit) => unit.detailStatus || unit.submission), false, "default read unchanged");
  });

  it(`caps detail reads at ${EXERCISE_DETAIL_CAP}`, async () => {
    const overviewUrl = `${origin}/go/exc/100021`;
    const count = EXERCISE_DETAIL_CAP + 2;
    const items = Array.from({ length: count }, (_, at) => assignment(`Sheet ${at}`, detailRoute(String(at + 1)))).join("");
    const pages: Parameters<typeof createMemorySession>[0] = {
      [overviewUrl]: snapshotFromHtml(overviewUrl, "Exercises", `<main><h1>Exercises</h1>${items}</main>`, "Exercises"),
    };
    for (let at = 1; at <= count; at += 1) {
      const url = absolute(detailRoute(String(at)));
      pages[url] = snapshotFromHtml(url, "Sheet", detailPage({ schedule: "Edit Until: 20. Nov 2026, 12:00", remaining: "5 Days", files: "-", last: "No submission yet." }), "Sheet");
    }
    const provider = createBrowserProvider({ session: createMemorySession(pages), origin });
    const result = await provider.getExercise("100021", { type: "exc", detail: true });
    assert.equal(result.units.filter((unit) => unit.detailStatus === "read").length, EXERCISE_DETAIL_CAP);
    assert.equal(result.units.filter((unit) => unit.detailStatus === "not_read").length, 2);
  });
});

/** Lab skeleton (ILIAS 10.12): `panel-sub` with `control-label > p` label + sibling `col-* > p` value rows. */
const panel = (heading: string, rows: Array<[string, string]>) =>
  `<div class="panel panel-sub panel-flex"><div class="panel-heading ilBlockHeader"><h3>${heading}</h3></div><div class="panel-body">${rows
    .map(([label, value]) => `<div class="row"><div class="control-label col-sm-3"><p>${label}</p></div><div class="col-sm-9">${value}</div></div>`)
    .join("")}</div></div>`;
const download = (cmd: string, file = "") =>
  `<p><a href="ilias.php?baseClass=ilexercisehandlergui&amp;cmdNode=cs:n1:ad&amp;cmdClass=ilexsubmissiongui&amp;cmd=${cmd}&amp;ref_id=100021&amp;ass_id=1${file}">Download</a></p>`;
const extraPanels = (headings: { files: string; sample: string; team: string; evaluation: string; statement: string; status: string }) => [
  panel(headings.files, [["sheet-1.pdf", download("downloadFile", "&amp;file=abc")], ["data.csv", download("downloadFile", "&amp;file=def")]]),
  panel(headings.sample, [["solution-1.pdf", download("downloadGlobalFeedbackFile")]]),
  panel(headings.team, [["Team Members", `<p>You are not assigned to a team yet!</p><div class="ilFormInfo">Ask tutor@example.org.</div><button class="btn btn-default" data-action="ilias.php?cmd=createTeam">Create Team</button>`]]),
  panel(headings.evaluation, [[headings.statement, "<p>Good work, mail grader@example.org.</p>"], [headings.status, "<p>Passed</p>"]]),
].join("");

describe("ADR 0053 amendment: Files, Sample Solution, Team, Evaluation panels", () => {
  const now = new Date("2026-11-15T10:00:00Z");
  const base = { schedule: "Ended On: 9. Oct 2026, 12:00", remaining: "Time is up.", files: "x.pdf", last: "8. Oct 2026, 09:00" };

  it("returns file names, team status and tutor evaluation as metadata only (no links, buttons or emails)", () => {
    const detail = parseExerciseDetail(detailPage({ ...base, extra: extraPanels({ files: "Files", sample: "Sample Solution", team: "Team", evaluation: "Evaluation by Tutor", statement: "Evaluation Statement", status: "Status" }) }), now);
    assert.deepEqual(detail?.instructionFiles, [{ name: "sheet-1.pdf" }, { name: "data.csv" }]);
    assert.deepEqual(detail?.sampleSolution, { name: "solution-1.pdf" });
    assert.equal(detail?.team?.status, "You are not assigned to a team yet! Ask [redacted-email].");
    assert.deepEqual(detail?.evaluation, { statement: "Good work, mail [redacted-email].", status: "Passed" });
    assert.doesNotMatch(JSON.stringify(detail), /download|ilias\.php|Create Team|@example/i);
  });

  it("matches the official German ILIAS 10.12 labels", () => {
    const german = detailPage({ ...base, extra: extraPanels({ files: "Dateien", sample: "Musterlösung", team: "Team", evaluation: "Rückmeldungen", statement: "Text-Feedback", status: "Status" }) })
      .replace("<h3>Work Instructions</h3>", "<h3>Arbeitsanweisung</h3>")
      .replace("<p>Submitted Files</p>", "<p>Bereits abgegebene Dateien</p>")
      .replace("<p>Last Submission</p>", "<p>Datum der letzten Abgabe</p>")
      .replace("<h3>Submission</h3>", "<h3>Abgabe</h3>");
    const detail = parseExerciseDetail(german, now);
    assert.deepEqual(detail?.submission, { submittedFiles: "x.pdf", lastSubmission: "8. Oct 2026, 09:00" });
    assert.equal(detail?.schedule?.timeRemaining, "Time is up.");
    assert.equal(detail?.instructionFiles?.length, 2);
    assert.deepEqual(detail?.sampleSolution, { name: "solution-1.pdf" });
    assert.equal(detail?.evaluation?.status, "Passed");
    assert.match(detail?.evaluation?.statement ?? "", /^Good work/);
  });

  it("omits panels ADAM does not show", () => {
    const detail = parseExerciseDetail(detailPage(base), now);
    for (const key of ["instructionFiles", "sampleSolution", "team", "evaluation"] as const) assert.equal(detail?.[key], undefined, key);
  });

  it("carries the panels through the provider, lets a tutor's Passed set ownStatus, and opens no download/team route", async () => {
    const overviewUrl = `${origin}/go/exc/100021`;
    const detailUrl = absolute(detailRoute("1"));
    const opened: string[] = [];
    const session = createMemorySession({
      [overviewUrl]: snapshotFromHtml(overviewUrl, "Exercises", `<main><h1>Exercises</h1>${assignment("Sheet 1", detailRoute("1"))}</main>`, "Exercises Sheet 1"),
      [detailUrl]: snapshotFromHtml(detailUrl, "Sheet 1", detailPage({ ...base, extra: extraPanels({ files: "Files", sample: "Sample Solution", team: "Team", evaluation: "Evaluation by Tutor", statement: "Evaluation Statement", status: "Status" }) }), "Sheet 1"),
    }, { onOpen: (url) => opened.push(url) });
    const provider = createBrowserProvider({ session, origin });
    const [unit] = (await provider.getExercise("100021", { type: "exc", detail: true })).units;
    assert.equal(unit?.detailStatus, "read");
    assert.equal(unit?.ownStatus, "passed");
    assert.deepEqual(unit?.instructionFiles?.map((file) => file.name), ["sheet-1.pdf", "data.csv"]);
    assert.equal(unit?.sampleSolution?.name, "solution-1.pdf");
    assert.equal(unit?.evaluation?.status, "Passed");
    assert.match(unit?.team?.status ?? "", /not assigned/);
    assert.equal(opened.some((url) => /ilexsubmissiongui|download|createTeam/i.test(url)), false, opened.join(", "));
  });
});
