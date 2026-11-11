// Intentionally failing contract checks. Run explicitly; never normal test discovery.
import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { createBrowserProvider } from "../../src/browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../../src/memory-session.ts";
import { createPlaywrightSession } from "../../src/playwright-session.ts";

const origin = "https://adam.unibas.ch";
const course = `${origin}/go/crs/710001`;
const home = () => snapshotFromHtml(`${origin}/ilias.php?baseClass=ilDashboardGUI`, "Dashboard",
  '<main><a href="/go/crs/710001">Synthetic course</a></main>', "Dashboard Abmelden");

it("D1: an explicitly empty dashboard must not authorize a global title hit", async () => {
  const snapshot = { ...home(), dom: { itemRows: 0, emptyCopy: true } };
  const provider = createBrowserProvider({ session: createMemorySession({ [origin]: snapshot }) });
  try {
    assert.deepEqual((await provider.listCourses()).items, []);
    const result = await provider.search("Synthetic course");
    assert.deepEqual(result.items.map((item) => item.refId), [],
      `empty enrollment listing leaked search identities; partial=${result.partial}`);
  } finally { await provider.close(); }
});

it("D2: unknown course listing must not become a verified child title hit", async () => {
  const blank = { ...snapshotFromHtml(course, "Course", '<main><h1>Course</h1><a href="/go/file/710099">Phantom sheet</a></main>', "Course"),
    dom: { itemRows: 0, emptyCopy: false, contentBlank: true } };
  const provider = createBrowserProvider({ session: createMemorySession({ [origin]: home(), [course]: blank }) });
  try {
    assert.deepEqual((await provider.listChildren("710001", { type: "crs" })).items, []);
    const result = await provider.search("Phantom sheet", { courseRefId: "710001" });
    assert.equal(result.partial, true);
    assert.deepEqual(result.items.map((item) => item.refId), [], "unknown-listing links must not form a fake inventory");
  } finally { await provider.close(); }
});

it("D3: real DOM unparsed row cannot be corroborated by an unrelated outside-content link", async () => {
  const tempRoot = join(tmpdir(), "opencode");
  await mkdir(tempRoot, { recursive: true });
  const profileDir = await mkdtemp(join(tempRoot, "adam-qa-discovery-"));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const requests: string[] = [];
    await context.route("**/*", async (route) => {
      requests.push(route.request().url());
      if (route.request().url() !== course) return route.abort();
      return route.fulfill({ contentType: "text/html", body:
        '<title>Course</title><main><h1>Course</h1><div id="il_center_col"><div class="ilContainerListItemOuter">Visible row without a parseable link</div></div></main><aside><a href="/go/file/710099">Unrelated sidebar file</a></aside>' });
    });
    const page = await context.newPage();
    const session = createPlaywrightSession({ profileDir });
    // Never attach to a holder, personal profile, or live ADAM browser.
    Reflect.set(session, "ensurePage", async () => page);
    const provider = createBrowserProvider({ session });
    const result = await provider.listChildren("710001", { type: "crs" });
    assert.deepEqual(requests, [course]);
    assert.deepEqual({ state: result.listingState, refs: result.items.map((item) => item.refId) },
      { state: "unknown", refs: [] }, "row evidence and parsed links must refer to the same content region");
  } finally {
    await browser.close();
    await rm(profileDir, { recursive: true, force: true });
  }
});

it("D5: an explicitly unknown deadline must not borrow the lecture date later in prose", async () => {
  const url = `${origin}/go/exc/710021`;
  const text = "Exercise\nDeadline: not announced. Lecture starts 2026-11-12.";
  const snapshot = snapshotFromHtml(url, "Exercise", `<main><h1>Exercise</h1><p>${text}</p></main>`, text);
  const provider = createBrowserProvider({ session: createMemorySession({ [url]: snapshot }) });
  try {
    const result = await provider.getExercise("710021", { type: "exc" });
    assert.equal(result.units[0]?.deadline, undefined, "a lecture date is not the exercise deadline");
  } finally { await provider.close(); }
});

it("D5: calendar must not promote a lecture date to an explicit exercise deadline", async () => {
  const url = `${origin}/go/exc/710021`;
  const text = "Exercise\nDeadline: not announced. Lecture starts 2026-11-12.";
  const listing = snapshotFromHtml(course, "Course", '<main><a href="/go/exc/710021">Exercise</a></main>', "Course");
  const exercise = snapshotFromHtml(url, "Exercise", `<main><h1>Exercise</h1><p>${text}</p></main>`, text);
  const provider = createBrowserProvider({ session: createMemorySession({ [origin]: home(), [course]: listing, [url]: exercise }) });
  try {
    const result = await provider.listCalendar({ courseRefId: "710001" });
    assert.deepEqual(result.items.filter((item) => item.source === "exc" && item.objectRefId === "710021"), [],
      "an unrelated lecture date must not become an explicit exercise deadline");
  } finally { await provider.close(); }
});
