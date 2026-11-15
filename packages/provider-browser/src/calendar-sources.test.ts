import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBrowserProvider, dateContext } from "./browser-provider.ts";
import { withoutFileRowDates } from "./extract.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

const origin = "https://adam.unibas.ch";

describe("#119 calendar sources", () => {
  it("drops dates that are only file rows' change times, keeps the same date in other prose", () => {
    const dates = [{ raw: "12. Oct 2026", iso: "2026-10-12T00:00:00.000Z", confidence: "explicit" as const }];
    const rows = [{ raw: "12. Oct 2026, 17:17" }];
    assert.deepEqual(withoutFileRowDates(dates, "Sheet.pdf pdf 184.8 KB 12. Oct 2026, 17:17", rows), []);
    assert.equal(withoutFileRowDates(dates, "Sheet.pdf 12. Oct 2026, 17:17\nTutorial on 12. Oct 2026 is cancelled", rows).length, 1);
    assert.equal(withoutFileRowDates(dates, "Exam on 12. Oct 2026", []).length, 1);
  });

  it("titles a page date with its own clause, never a neighbouring sentence or line", () => {
    const text = "Welcome. Written Exam: Friday, 8 January 2027, 2:00–4:00 p.m. at Kollegienhaus. Bring ID.\nNext line 9 January 2027";
    assert.equal(dateContext(text, "8 January 2027"), "Written Exam: Friday, 8 January 2027, 2:00–4:00 p.m");
    assert.equal(dateContext("Office hours\n9 January 2027\nOther", "9 January 2027"), "9 January 2027");
    assert.equal(dateContext("x", "missing"), "missing");
  });

  it("emits one exc deadline per parsed assignment", async () => {
    const assignment = (title: string, due: string) => `<div class="il-item il-std-item"><h4 class="il-item-title"><a href="/go/exc/100021/1">${title}</a></h4>
      <div class="il-item-properties"><span class="il-item-property-name">Edit Until</span><span class="il-item-property-value">${due}</span>
      <span class="il-item-property-name">Last Submission</span><span class="il-item-property-value">No submission yet.</span></div></div>`;
    const session = createMemorySession({
      [`${origin}/`]: snapshotFromHtml(`${origin}/`, "Dashboard", `<main><a href="/go/crs/100001">Course</a><a href="/logout.php">Abmelden</a></main>`, "Dashboard Course Abmelden"),
      [`${origin}/go/crs/100001`]: snapshotFromHtml(`${origin}/go/crs/100001`, "Course", `<main><h1>Course</h1><a href="/go/exc/100021">Exercises</a><a href="/logout.php">Abmelden</a></main>`, "Course Exercises Abmelden"),
      [`${origin}/go/exc/100021`]: snapshotFromHtml(`${origin}/go/exc/100021`, "Exercises",
        `<main><h1>Exercises</h1>${assignment("Sheet 3", "20. Nov 2026, 12:00")}${assignment("Sheet 4", "27. Nov 2026, 12:00")}<a href="/logout.php">Abmelden</a></main>`,
        "Exercises Sheet 3 Edit Until 20. Nov 2026, 12:00 Sheet 4 Edit Until 27. Nov 2026, 12:00 Abmelden"),
    });
    const calendar = await createBrowserProvider({ session, origin }).listCalendar();
    const exc = calendar.items.filter((item) => item.source === "exc");
    assert.deepEqual(exc.map((item) => [item.title, item.startsAt]), [
      ["Sheet 3 (Deadline)", "2026-11-20T11:00:00.000Z"],
      ["Sheet 4 (Deadline)", "2026-11-27T11:00:00.000Z"],
    ]);
    assert.equal(calendar.items.filter((item) => item.startsAt?.startsWith("2026-11-20")).length, 1, "page copy of the deadline loses to exc");
  });
});
