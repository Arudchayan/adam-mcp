import assert from "node:assert/strict";
import { it } from "node:test";
import { createBrowserProvider } from "./browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

const origin = "https://adam.unibas.ch";
const course = `${origin}/go/crs/710001`;
const home = () => snapshotFromHtml(`${origin}/ilias.php?baseClass=ilDashboardGUI`, "Dashboard",
  '<main><a href="/go/crs/710001">Synthetic course</a></main>', "Dashboard Abmelden");

it("search does not resurrect children of an empty dashboard", async () => {
  const opened: string[] = [];
  const snapshot = { ...home(), dom: { itemRows: 0, emptyCopy: true } };
  const provider = createBrowserProvider({ session: createMemorySession({ [origin]: snapshot }, { onOpen: (url) => opened.push(url) }) });
  try {
    assert.deepEqual((await provider.listCourses()).items, []);
    const result = await provider.search("Synthetic course");
    assert.deepEqual(result.items, []);
    assert.equal(result.partial, undefined);
    assert.deepEqual(opened, [origin, origin]);
  } finally { await provider.close(); }
});

it("unknown listings suppress child titles but retain current-page body matches and partial metadata", async () => {
  const blank = { ...snapshotFromHtml(course, "Course", '<main><h1>Course</h1><a href="/go/file/710099">Phantom sheet</a></main>', "Course body phrase"),
    dom: { itemRows: 0, emptyCopy: false, contentBlank: true } };
  const provider = createBrowserProvider({ session: createMemorySession({ [origin]: home(), [course]: blank }) });
  try {
    assert.deepEqual((await provider.listChildren("710001", { type: "crs" })).items, []);
    const suppressed = await provider.search("Phantom sheet", { courseRefId: "710001" });
    assert.deepEqual(suppressed.items, []);
    assert.equal(suppressed.partial, true);
    assert.equal(suppressed.skipped, 1);
    assert.deepEqual(Reflect.get(suppressed, "partialReasons"), ["unknown_listing"]);
    const body = await provider.search("body phrase", { courseRefId: "710001" });
    assert.deepEqual(body.items.map((item) => item.refId), ["710001"]);
    assert.equal(body.partial, true);
  } finally { await provider.close(); }
});
