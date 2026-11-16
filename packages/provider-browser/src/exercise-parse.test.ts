import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBrowserProvider } from "./browser-provider.ts";
import { parseExerciseUnits } from "./exercise-parse.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

const assignment = (title: string, props: Array<[string, string]>, description = "") => `
  <div class="il-item il-std-item">
    <h4 class="il-item-title"><a href="/go/exc/100021/5001">${title}</a></h4>
    ${description ? `<div class="il-item-description">${description}</div>` : ""}
    <div class="il-item-properties">
      ${props.map(([name, value]) => `<span class="il-item-property-name">${name}</span><span class="il-item-property-value">${value}</span>`).join("")}
    </div>
  </div>`;

const page = (body: string) => `
<header><a href="/go/crs/100001">ADAM</a> Notification Center</header>
<nav aria-label="Breadcrumbs"><a href="/go/crs/100001">Course</a></nav>
<main><h1>Exercises</h1>
  <ul id="ilTab"><li>Assignments</li><li>Info</li><li>Learning Progress</li></ul>
  <div class="il-viewcontrol-mode">Ongoing Upcoming Past All</div>
  <div class="il-panel-listing-std-container"><div class="il-item-group">${body}</div></div>
  <a href="/logout.php">Abmelden</a>
</main>
<footer>Rendered by its-ilias-web-prod-02 - 10.12 - 8.2.35</footer>`;

const now = new Date("2026-11-14T10:00:00Z");

describe("#120 exercise assignments", () => {
  it("returns one unit per assignment with deadline, requirement, type and own status", () => {
    const units = parseExerciseUnits(page(
      assignment("Sheet 3", [["Edit Until", "20. Nov 2026, 12:00"], ["Requirement", "Optional"], ["Last Submission", "No submission yet."], ["Type", "Upload"], ["Status", "Not Graded"]], "5 Days, 18 Hours to Submit") +
      assignment("Sheet 2", [["Bearbeitung bis", "6. Nov 2026, 12:00"], ["Anforderung", "Pflicht"], ["Datum der letzten Abgabe", "5. Nov 2026, 21:14"], ["Status", "Nicht bewertet"]]) +
      assignment("Sheet 1", [["Edit Until", "23. Oct 2026, 12:00"], ["Last Submission", "22. Oct 2026, 09:00"], ["Status", "Passed"]]),
    ), "", now);
    assert.equal(units?.length, 3);
    assert.deepEqual(units?.[0], {
      title: "Sheet 3",
      deadline: "2026-11-20T11:00:00.000Z",
      requirement: "Optional",
      submissionType: "Upload",
      instructionText: "5 Days, 18 Hours to Submit\nEdit Until: 20. Nov 2026, 12:00\nRequirement: Optional\nLast Submission: No submission yet.\nType: Upload\nStatus: Not Graded",
      ownStatus: "none",
    });
    assert.equal(units?.[1]?.ownStatus, "submitted");
    assert.equal(units?.[1]?.requirement, "Pflicht");
    assert.equal(units?.[2]?.ownStatus, "passed");
  });

  it("never includes page chrome in instruction text", () => {
    const units = parseExerciseUnits(page(assignment("Sheet 3", [["Edit Until", "20. Nov 2026, 12:00"]])), "", now);
    assert.doesNotMatch(units?.[0]?.instructionText ?? "", /Notification Center|Rendered by|Learning Progress|Abmelden/);
  });

  it("maps failed before passed and keeps unknown when nothing is shown", () => {
    const units = parseExerciseUnits(page(
      assignment("A", [["Status", "Nicht bestanden"]]) + assignment("B", [["Requirement", "Optional"]]),
    ), "", now);
    assert.deepEqual(units?.map((unit) => unit.ownStatus), ["failed", "unknown"]);
    assert.equal(units?.[1]?.deadline, undefined);
  });

  it("returns no units when ADAM says no assignments are available", () => {
    assert.deepEqual(parseExerciseUnits(page(""), "Exercises Information Message: No assignments available.", now), []);
  });

  it("leaves unrecognised layouts to the existing page-text fallback", () => {
    assert.equal(parseExerciseUnits(page(""), "Exercises Deadline: 22 September 2026", now), undefined);
    assert.equal(parseExerciseUnits(page(`<div class="il-item"><h4 class="il-item-title">News</h4></div>`), "", now), undefined, "items without assignment properties are not assignments");
  });

  it("getExercise returns parsed units through the browser provider", async () => {
    const url = "https://adam.unibas.ch/go/exc/100021";
    const html = page(assignment("Sheet 3", [["Edit Until", "20. Nov 2026, 12:00"], ["Last Submission", "No submission yet."]]));
    const provider = createBrowserProvider({ session: createMemorySession({ [url]: snapshotFromHtml(url, "Exercises", html, "Exercises Sheet 3 Abmelden") }), origin: "https://adam.unibas.ch" });
    const exercise = await provider.getExercise("100021", { type: "exc" });
    assert.deepEqual(exercise.units.map((unit) => [unit.title, unit.deadline, unit.ownStatus]), [["Sheet 3", "2026-11-20T11:00:00.000Z", "none"]]);
  });
});
