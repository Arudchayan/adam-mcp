import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdamError, type Paginated } from "adam-core";
import { chromium } from "playwright-core";
import { createBrowserProvider } from "../../src/browser-provider.ts";
import { classifyListing, extractCatalog } from "../../src/extract.ts";
import { folderContentTab } from "../../src/folder-listing.ts";
import { createMemorySession, snapshotFromHtml, type MemorySessionPages } from "../../src/memory-session.ts";
import { SnapshotPagination } from "../../src/snapshot-pagination.ts";
import { createPlaywrightSession } from "../../src/playwright-session.ts";

const origin = "https://adam.unibas.ch";
const url = `${origin}/go/fold/710020`;
const tab = `${origin}/ilias.php?baseClass=ilRepositoryGUI&cmdClass=ilObjFolderGUI&cmd=render&ref_id=710020`;
const errorCode = (code: string) => (error: unknown) => error instanceof AdamError && error.code === code;

it("bounded folder-tab mutation corpus rejects alternate origins, identity/actions and parameter ambiguity", () => {
  const attacks = [
    tab.replace(origin, "http://adam.unibas.ch"), tab.replace(origin, "https://adam.unibas.ch.evil.invalid"),
    tab.replace(origin, "https://adam.unibas.ch:444"), tab.replace(origin, "https://user@adam.unibas.ch"),
    tab.replace("710020", "710021"), tab.replace("render", "delete"), `${tab}#fragment`,
    tab.replace("/ilias.php", "/other.php"),
  ];
  for (const key of ["cmd", "CMD", "%63md", "ref_id", "REF_ID", "cmdClass", "baseClass", "redirect", "item_ref_id", "csrf", "return"])
    for (const value of ["delete", "710021", "", "render", "https://evil.invalid/"])
      attacks.push(`${tab}&${key}=${encodeURIComponent(value)}`);
  for (const value of ["delete", "", "render", "https://evil.invalid/", "1;delete", "1/2"])
    attacks.push(`${tab}&cmdNode=${encodeURIComponent(value)}`);
  for (const candidate of attacks) assert.equal(folderContentTab([candidate], url, "710020"), undefined, candidate);
  assert.equal(folderContentTab([tab], url, "710020"), tab);
});

it("bounded classification truth table preserves rows over contradictory empty/blank signals", () => {
  const base = snapshotFromHtml(url, "Folder", "<main></main>", "");
  for (const rows of [0, 1, 2, 99]) for (const kept of [0, 1, 3])
    for (const emptyCopy of [false, true]) for (const contentBlank of [false, true]) {
      const result = classifyListing({ ...base, dom: { itemRows: rows, emptyCopy, contentBlank } }, kept);
      const expected = rows > 0 ? kept > 0 ? "ok" : "unknown" : emptyCopy ? "empty" : "unknown";
      assert.equal(result.state, expected, JSON.stringify({ rows, kept, emptyCopy, contentBlank }));
    }
});

it("snapshot cursors survive replay and changing limits but bind every nonblank query key and expire exactly", () => {
  let clock = 1000;
  const pagination = new SnapshotPagination(() => clock);
  const values = Array.from({ length: 37 }, (_, i) => i);
  const first = pagination.first("search:a:course=710001", values, { limit: 1 }, { partial: true });
  assert.ok(first.nextCursor);
  for (const limit of [1, 2, 7, 20, 100]) {
    const page: Paginated<number> = pagination.continue<number>("search:a:course=710001", { cursor: first.nextCursor, limit })!;
    assert.deepEqual(page.items, values.slice(1, 1 + Math.min(100, limit)));
    assert.equal(page.snapshotAt, first.snapshotAt);
    assert.equal(Reflect.get(page, "partial"), true);
  }
  for (const key of ["search:b:course=710001", "search:a:course=710002", "news:", "courses", ""])
    assert.throws(() => pagination.continue(key, { cursor: first.nextCursor }), errorCode("stale_id"));
  clock += 599_999;
  assert.ok(pagination.continue("search:a:course=710001", { cursor: first.nextCursor }));
  clock++;
  assert.throws(() => pagination.continue("search:a:course=710001", { cursor: first.nextCursor }), errorCode("stale_id"));
});

it("typed getter cross-product never converts denied tests or mismatched same-ref objects", async () => {
  for (const landedType of ["crs", "fold", "file", "exc", "frm", "tst"] as const) {
    const landedUrl = `${origin}/go/${landedType}/710030`;
    const snapshot = { ...snapshotFromHtml(landedUrl, "Synthetic", "<main><h1>Synthetic</h1></main>", "Synthetic"),
      dom: { itemRows: 0, emptyCopy: true } };
    for (const getter of ["getCourse", "getExercise", "getForum", "getFile"] as const) {
      const requestedType = { getCourse: "crs", getExercise: "exc", getForum: "frm", getFile: "file" }[getter];
      if (requestedType === landedType) continue;
      const provider = createBrowserProvider({ session: createMemorySession({ [`${origin}/go/${requestedType}/710030`]: snapshot }) });
      try { await assert.rejects(provider[getter]("710030"), errorCode("unsupported_type"), `${getter} landing ${landedType}`); }
      finally { await provider.close(); }
    }
  }
});

it("href mutation corpus never extracts non-ADAM origins as typed enrollment identities", () => {
  const hrefs = ["https://evil.invalid/go/crs/710001", "https://adam.unibas.ch.evil.invalid/go/crs/710001",
    "http://adam.unibas.ch/go/crs/710001", "javascript:alert('/go/crs/710001')", "data:text/plain,/go/crs/710001"];
  for (const href of hrefs) {
    const snapshot = snapshotFromHtml(origin, "Dashboard", `<main><a href="${href}">Bogus course</a></main>`, "Dashboard");
    assert.deepEqual(extractCatalog(snapshot, "2026-11-11T00:00:00Z").objects, [], href);
  }
});

it("intercepted disposable browser admits same-origin content frames but excludes foreign frame inventory", async () => {
  const tempRoot = join(tmpdir(), "opencode");
  await mkdir(tempRoot, { recursive: true });
  const profileDir = await mkdtemp(join(tempRoot, "adam-qa-discovery-"));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const bodies = new Map([
      [`${origin}/go/crs/710001`, '<title>Course</title><main><div id="il_center_col"><div class="ilContainerListItemOuter"><a href="/go/file/710011">Main sheet</a></div><iframe src="/qa-frame"></iframe><iframe src="https://foreign.invalid/qa-frame"></iframe></div></main>'],
      [`${origin}/qa-frame`, '<main><div class="ilContainerListItemOuter"><a href="/go/file/710012">Same-origin sheet</a></div></main>'],
      ["https://foreign.invalid/qa-frame", '<main><div class="ilContainerListItemOuter"><a href="https://adam.unibas.ch/go/file/710013">Foreign sheet</a></div></main>'],
    ]);
    const requests: string[] = [];
    await context.route("**/*", async (route) => {
      const target = route.request().url(); requests.push(target);
      const body = bodies.get(target);
      return body === undefined ? route.abort() : route.fulfill({ contentType: "text/html", body });
    });
    const page = await context.newPage();
    const session = createPlaywrightSession({ profileDir });
    Reflect.set(session, "ensurePage", async () => page);
    const provider = createBrowserProvider({ session });
    const result = await provider.listChildren("710001", { type: "crs" });
    assert.deepEqual(result.items.map((item) => item.refId).sort(), ["710011", "710012"]);
    assert.equal(result.listingState, "ok");
    assert.deepEqual(new Set(requests), new Set(bodies.keys()));
  } finally {
    await browser.close();
    await rm(profileDir, { recursive: true, force: true });
  }
});

it("seeded cyclic enrolled graph stays bounded, respects course scope, prunes unknown branches and reports partial reason", async () => {
  let seed = 0x710001;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const courseUrl = `${origin}/go/crs/710001`;
  const folderIds = Array.from({ length: 14 }, (_, index) => String(711000 + index));
  const pages: MemorySessionPages = {
    [origin]: snapshotFromHtml(`${origin}/ilias.php?baseClass=ilDashboardGUI`, "Dashboard",
      '<main><a href="/go/crs/710001">Enrolled A</a><a href="/go/crs/710002">Enrolled B</a></main>', "Dashboard"),
    [courseUrl]: snapshotFromHtml(courseUrl, "Course A", `<main>${folderIds.map((id) => `<a href="/go/fold/${id}">Folder ${id}</a>`).join("")}<a href="/go/crs/710002">Sibling B</a><a href="/go/tst/719999">Denied test</a></main>`, "Course A"),
  };
  for (const [index, id] of folderIds.entries()) {
    const target = `${origin}/go/fold/${id}`;
    const peers = Array.from({ length: 4 }, () => folderIds[random() % folderIds.length]!);
    pages[target] = snapshotFromHtml(target, `Folder ${id}`, `<main><h1>Folder ${id}</h1>${peers.map((peer) => `<a href="/go/fold/${peer}">Peer ${peer}</a>`).join("")}<a href="/go/file/${712000 + index}">Sheet ${index}</a><a href="/go/tst/719999">Denied test</a></main>`, `Folder ${id}`);
  }
  const unknownUrl = `${origin}/go/fold/${folderIds[3]}`;
  pages[unknownUrl] = { ...snapshotFromHtml(unknownUrl, "Unknown folder", '<main><a href="/go/fold/718888">Hidden branch</a></main>', "Unknown folder"),
    dom: { itemRows: 0, emptyCopy: false, contentBlank: true } };
  const opens: string[] = [];
  const provider = createBrowserProvider({ session: createMemorySession(pages, { onOpen: (target) => opens.push(target) }) });
  try {
    const result = await provider.search("Sheet", { courseRefId: "710001" });
    assert.equal(result.partial, true);
    assert.equal(result.skipped, 1);
    assert.deepEqual(Reflect.get(result, "partialReasons"), ["unknown_listing"]);
    assert.equal(opens.length, 16, "home + enrolled course + fourteen unique folders despite cycles");
    assert.equal(new Set(opens).size, opens.length);
    assert.ok(opens.every((target) => !/710002|719999|718888|\/go\/file\//.test(target)));
    assert.equal(result.items.length, 13, "only hydrated folders contribute their Sheet file title");
  } finally { await provider.close(); }
});
