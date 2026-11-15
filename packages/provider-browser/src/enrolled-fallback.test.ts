import assert from "node:assert/strict";
import { it } from "node:test";
import { createBrowserProvider, MEMBERSHIP_OVERVIEW_PATH } from "./browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

const origin = "https://adam.unibas.ch";
// Live ILIAS 10.12: the Dashboard centre can show only side blocks, no course list (ADR 0059).
const dashboard = snapshotFromHtml(`${origin}/`, "Dashboard", `<main><div id="il_center_col"></div><div id="block_pdnews_1"></div><a href="/logout.php">Abmelden</a></main>`, "Dashboard Abmelden");
const overview = snapshotFromHtml(`${origin}${MEMBERSHIP_OVERVIEW_PATH}`, "My Courses and Groups",
  `<main><div id="il_center_col"><div id="block_dash_mem_1"><div class="il-item"><h4 class="il-item-title"><a href="/go/crs/100001">Course A</a></h4></div><div class="il-item"><h4 class="il-item-title"><a href="/go/crs/100002">Course B</a></h4></div></div></div><a href="/logout.php">Abmelden</a></main>`,
  "My Courses and Groups Course A Course B Abmelden");
const course = (id: string) => snapshotFromHtml(`${origin}/go/crs/${id}`, `Course ${id}`, `<main><h1>Course</h1><a href="/go/file/${id}9">Notes.pdf</a><a href="/logout.php">Abmelden</a></main>`, "Course Notes.pdf Abmelden");

it("ADR 0059: lists enrolled courses from the membership overview when the Dashboard shows none", async () => {
  const session = createMemorySession({ [`${origin}/`]: dashboard, [`${origin}${MEMBERSHIP_OVERVIEW_PATH}`]: overview, [`${origin}/go/crs/100001`]: course("100001"), [`${origin}/go/crs/100002`]: course("100002") });
  const provider = createBrowserProvider({ session, origin });
  const courses = await provider.listCourses();
  assert.equal(courses.listingState, "ok");
  assert.deepEqual(courses.items.map((item) => item.refId), ["100001", "100002"]);
  const search = await provider.search("notes");
  assert.equal(search.items.filter((item) => item.type === "file").length, 2, "the walk reaches courses from the overview");
});

it("ADR 0059: keeps the Dashboard's honest unknown state when the overview lists no courses either", async () => {
  const empty = snapshotFromHtml(`${origin}${MEMBERSHIP_OVERVIEW_PATH}`, "My Courses and Groups", `<main><div id="il_center_col"></div></main>`, "My Courses and Groups");
  const provider = createBrowserProvider({ session: createMemorySession({ [`${origin}/`]: dashboard, [`${origin}${MEMBERSHIP_OVERVIEW_PATH}`]: empty }), origin });
  const courses = await provider.listCourses();
  assert.notEqual(courses.listingState, "ok");
  assert.deepEqual(courses.items, []);
});
