import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { preferCalendarEvents } from "adam-core";
import { createBrowserProvider } from "./browser-provider.ts";
import { dashboardCalendarEvents } from "./extract.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

// Mirrors the live ILIAS 10.12 Dashboard Tasks and Calendar blocks (structure-only probe, #132).
const item = (title: string, description: string, href = "", props = "") => `
  <li class="il-std-item-container"><div class="il-item il-std-item">
    <h4 class="il-item-title">${href ? `<a href="${href}">${title}</a>` : `<button class="btn btn-link">${title}</button>`}</h4>
    <div class="il-item-description">${description}</div>${props}
  </div></li>`;
const block = (kind: string, id: string, heading: string, items: string) => `
  <div id="block_${kind}_${id}"><div class="panel panel-secondary panel-flex">
    <div class="panel-heading ilHeader"><div class="panel-title"><h2>${heading}</h2></div></div>
    <div class="panel-body"><div class="il-item-group"><div class="il-item-group-items"><ul>${items}</ul></div></div></div>
  </div></div>`;
const dashboard = block("pdtasks", "11", "Tasks",
  item('Submission of Assignment "Sheet 3"', "20. Nov 2026, 12:00", "https://adam.unibas.ch/go/exc/100021/5001",
    `<hr class="il-item-divider"><div class="row"><span class="il-item-property-name">Exercise</span><span class="il-item-property-value">Exercises</span></div>`)) +
  block("pdcal", "12", "Calendar",
    item("Sheet 3 (Deadline)", "20. Nov 2026, 12:00") +
    item("Lecture: Data Structures", "20. Nov 2026, 14:15") +
    item("Semester end", "30. Apr 2027, 16:15") +
    item("No time shown", "soon"));
const provenance = { sourceUrl: "https://adam.unibas.ch/ilias.php?baseClass=ilDashboardGUI", fetchedAt: "2026-11-15T10:00:00.000Z", provider: "browser" as const };

describe("#132 Dashboard Tasks and Calendar", () => {
  it("reads tasks with their exercise and calendar items with their start time", () => {
    const events = dashboardCalendarEvents(`<main>${dashboard}</main>`, provenance);
    assert.deepEqual(events.map((event) => [event.title, event.startsAt, event.objectRefId, event.source]), [
      ['Submission of Assignment "Sheet 3"', "2026-11-20T11:00:00.000Z", "100021", "calendar"],
      ["Sheet 3 (Deadline)", "2026-11-20T11:00:00.000Z", undefined, "calendar"],
      ["Lecture: Data Structures", "2026-11-20T13:15:00.000Z", undefined, "calendar"],
      ["Semester end", "2027-04-30T14:15:00.000Z", undefined, "calendar"],
    ]);
    assert.equal(events[0]!.url, "https://adam.unibas.ch/go/exc/100021");
  });

  it("keeps distinct same-day Dashboard events instead of merging them by day", () => {
    const events = preferCalendarEvents(dashboardCalendarEvents(`<main>${dashboard}</main>`, provenance));
    assert.equal(events.filter((event) => event.startsAt?.startsWith("2026-11-20")).length, 3);
  });

  it("surfaces Dashboard events through listCalendar", async () => {
    const origin = "https://adam.unibas.ch";
    const session = createMemorySession({
      [`${origin}/`]: snapshotFromHtml(`${origin}/`, "Dashboard", `<main><a href="/go/crs/100001">Course</a>${dashboard}<a href="/logout.php">Abmelden</a></main>`, "Dashboard Course Abmelden"),
      [`${origin}/go/crs/100001`]: snapshotFromHtml(`${origin}/go/crs/100001`, "Course", `<main><h1>Course</h1><a href="/go/file/100011">Notes.pdf</a><a href="/logout.php">Abmelden</a></main>`, "Course Notes.pdf Abmelden"),
    });
    const calendar = await createBrowserProvider({ session, origin }).listCalendar();
    assert.equal(calendar.items.filter((event) => event.source === "calendar").length, 4);
  });
});

it("#132: merges a Dashboard deadline into the same-titled exercise deadline", () => {
  const exc = { title: "Sheet 3 (Deadline)", startsAt: "2026-11-20T11:00:00.000Z", source: "exc" as const, confidence: "explicit" as const, objectRefId: "100021", provenance };
  const merged = preferCalendarEvents([exc, ...dashboardCalendarEvents(`<main>${dashboard}</main>`, provenance)]);
  const sameDay = merged.filter((event) => event.startsAt?.startsWith("2026-11-20"));
  assert.deepEqual(sameDay.map((event) => [event.title, event.source]).sort(), [["Lecture: Data Structures", "calendar"], ["Sheet 3 (Deadline)", "exc"]]);
  assert.deepEqual(sameDay.find((event) => event.source === "exc")?.seenIn?.sort(), ["calendar", "exc"]);
});
