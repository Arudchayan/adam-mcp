import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { preferCalendarEvents } from "adam-core";
import { createBrowserProvider } from "./browser-provider.ts";
import { DERIVED_TASKS_PATH, derivedTasksEvents } from "./extract.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

// Mirrors the live ILIAS 10.12 Tasks page (ilDerivedTasksGUI, structure-only probe, #132, ADR 0056).
const origin = "https://adam.unibas.ch";
const tasksUrl = `${origin}${DERIVED_TASKS_PATH}`;
const task = (title: string, href: string, exercise: string, end: string) => `
  <li class="il-std-item-container"><div class="il-item il-std-item">
    <h4 class="il-item-title"><a href="${href}">${title}</a></h4>
    <hr class="il-item-divider"><div class="row">
      <div class="col-md-6"><span class="il-item-property-name">Exercise</span><span class="il-item-property-value">${exercise}</span></div>
      <div class="col-md-6"><span class="il-item-property-name">End</span><span class="il-item-property-value">${end}</span></div>
    </div>
  </div></li>`;
const tasksPage = (items: string) => `<main><div class="panel il-panel-listing-std-container clearfix">
  <h2>Tasks</h2><div class="il-item-group"><div class="il-item-group-items"><ul>${items}</ul></div></div></div></main>`;
const items =
  task('Submission of Assignment "Sheet 3"', "https://adam.unibas.ch/go/exc/100021/5001", "Exercises", "20. Nov 2026, 12:00") +
  task('Submission of Assignment "Sheet 9"', "https://adam.unibas.ch/go/exc/100121/5009", "Lab", "15. Jan 2027, 23:59") +
  task("Undated task", "https://adam.unibas.ch/go/exc/100121/5010", "Lab", "");
const provenance = { sourceUrl: tasksUrl, fetchedAt: "2026-11-15T10:00:00.000Z", provider: "browser" as const };
const home = `<main><a href="/go/crs/100001">Course</a><a href="/logout.php">Abmelden</a></main>`;
const pages = (tasksHtml?: string) => ({
  [`${origin}/`]: snapshotFromHtml(`${origin}/`, "Dashboard", home, "Dashboard Course Abmelden"),
  [`${origin}/go/crs/100001`]: snapshotFromHtml(`${origin}/go/crs/100001`, "Course", `<main><h1>Course</h1><a href="/go/file/100011">Notes.pdf</a><a href="/logout.php">Abmelden</a></main>`, "Course Notes.pdf Abmelden"),
  ...(tasksHtml ? { [tasksUrl]: snapshotFromHtml(tasksUrl, "Tasks", tasksHtml, "Tasks Abmelden") } : {}),
});

describe("ADR 0056 Derived Tasks page", () => {
  it("reads every task with its End deadline and binds the exercise ref", () => {
    const events = derivedTasksEvents({ url: tasksUrl, html: tasksPage(items) }, provenance);
    assert.deepEqual(events?.map((event) => [event.title, event.startsAt, event.objectRefId, event.source, event.url]), [
      ['Submission of Assignment "Sheet 3"', "2026-11-20T11:00:00.000Z", "100021", "calendar", "https://adam.unibas.ch/go/exc/100021"],
      ['Submission of Assignment "Sheet 9"', "2027-01-15T22:59:00.000Z", "100121", "calendar", "https://adam.unibas.ch/go/exc/100121"],
    ]);
  });

  it("binds the exercise from a button title's data-action (live ILIAS 10.12 markup) and merges with exc", () => {
    const button = (action: string) => `<main><div class="panel il-panel-listing-std-container"><ul>
      <li class="il-std-item-container"><div class="il-item il-std-item">
        <h4 class="il-item-title"><button class="btn btn-link" data-action="${action}" id="il_ui_fw_1">Submission of Assignment &quot;Sheet 3&quot;</button></h4>
        <div class="row"><span class="il-item-property-name">End</span><span class="il-item-property-value">20. Nov 2026, 12:00</span></div>
      </div></li></ul></div></main>`;
    const events = derivedTasksEvents({ url: tasksUrl, html: button("/go/exc/100021/5001") }, provenance);
    assert.equal(events?.[0]?.objectRefId, "100021");
    assert.equal(events?.[0]?.url, "https://adam.unibas.ch/go/exc/100021");
    const exc = { title: "Sheet 3 (Deadline)", startsAt: "2026-11-20T11:00:00.000Z", source: "exc" as const, confidence: "explicit" as const, objectRefId: "100021", provenance };
    const merged = preferCalendarEvents([exc, ...(events ?? [])]);
    assert.equal(merged.length, 1);
    assert.deepEqual(merged[0]?.seenIn?.sort(), ["calendar", "exc"]);
    // Off-origin or protocol-relative actions are never taken as a route.
    for (const foreign of ["https://evil.example/go/exc/100021/5001", "//evil.example/go/exc/100021/5001", "javascript:alert(1)"]) {
      assert.equal(derivedTasksEvents({ url: tasksUrl, html: button(foreign) }, provenance)?.[0]?.objectRefId, undefined);
    }
  });

  it("treats an info message with no listing as a verified empty list", () => {
    assert.deepEqual(derivedTasksEvents({ url: tasksUrl, html: `<main><div class="alert alert-info" role="status">No tasks.</div></main>` }, provenance), []);
  });

  it("does not read an unrecognised page or a redirect elsewhere as 'no tasks'", () => {
    assert.equal(derivedTasksEvents({ url: tasksUrl, html: "<main><h1>Tasks</h1></main>" }, provenance), undefined);
    assert.equal(derivedTasksEvents({ url: `${origin}/ilias.php?baseClass=ilDashboardGUI`, html: tasksPage(items) }, provenance), undefined);
  });

  it("adds Tasks page deadlines to an unscoped calendar, opening only the Tasks route once", async () => {
    const opened: string[] = [];
    const session = createMemorySession(pages(tasksPage(items)), { onOpen: (url) => opened.push(url) });
    const provider = createBrowserProvider({ session, origin });
    const calendar = await provider.listCalendar();
    assert.deepEqual(calendar.items.filter((event) => event.source === "calendar").map((event) => event.objectRefId).sort(), ["100021", "100121"]);
    assert.equal(calendar.partial, undefined);
    await provider.listCalendar({ from: "2026-01-01T00:00:00.000Z" });
    assert.equal(opened.filter((url) => url === tasksUrl).length, 1);
    // Never the export / sortation / calendar write routes.
    assert.equal(opened.some((url) => /cmd=(exportNotesHTML|setSortation|add)\b|ilcalendar/i.test(url)), false);
  });

  it("merges a Tasks page item into the Dashboard block item for the same exercise", async () => {
    const dashboard = `<div id="block_pdtasks_11"><div class="panel"><ul>
      <li class="il-std-item-container"><div class="il-item il-std-item"><h4 class="il-item-title"><a href="https://adam.unibas.ch/go/exc/100021/5001">Submission of Assignment "Sheet 3"</a></h4>
      <div class="il-item-description">20. Nov 2026, 12:00</div></div></li></ul></div></div>`;
    const withBlock = { ...pages(tasksPage(items)), [`${origin}/`]: snapshotFromHtml(`${origin}/`, "Dashboard", `<main><a href="/go/crs/100001">Course</a>${dashboard}<a href="/logout.php">Abmelden</a></main>`, "Dashboard Course Abmelden") };
    const calendar = await createBrowserProvider({ session: createMemorySession(withBlock), origin }).listCalendar();
    assert.equal(calendar.items.filter((event) => event.objectRefId === "100021").length, 1);
  });

  it("marks the calendar partial when the Tasks page cannot be read", async () => {
    const calendar = await createBrowserProvider({ session: createMemorySession(pages()), origin }).listCalendar();
    assert.equal(calendar.partial, true);
    assert.deepEqual(Reflect.get(calendar, "partialReasons"), ["unreadable_page"]);
  });

  it("surfaces sign-in loss on the Tasks page instead of hiding it", async () => {
    const login = { ...pages(), [tasksUrl]: snapshotFromHtml(tasksUrl, "Login", `<main><form action="https://login.eduid.ch/idp/profile/SAML2/Redirect/SSO"><input type="password"></form></main>`, "Login mit SWITCH edu-ID") };
    await assert.rejects(
      () => createBrowserProvider({ session: createMemorySession(login), origin }).listCalendar(),
      (error: unknown) => (error as { code?: string }).code === "unauthorized",
    );
  });

  it("course-scoped calendars do not open the Tasks page", async () => {
    const opened: string[] = [];
    const session = createMemorySession(pages(tasksPage(items)), { onOpen: (url) => opened.push(url) });
    await createBrowserProvider({ session, origin }).listCalendar({ courseRefId: "100001" });
    assert.equal(opened.includes(tasksUrl), false);
  });
});
