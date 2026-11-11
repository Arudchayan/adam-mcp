import assert from "node:assert/strict";
import { createBrowserProvider } from "../../packages/provider-browser/src/browser-provider.ts";
import { createPlaywrightSession } from "../../packages/provider-browser/src/playwright-session.ts";

if (!process.argv.includes("--live")) throw new Error("Explicit --live is required; metadata only, no bodies or bytes.");
const session = createPlaywrightSession();
const provider = createBrowserProvider({ session });
const summary = { metadataOnly: true, courses: 0, containers: 0, objects: 0, fileMetadata: 0, folders: 0, paginationChecks: 0, identityChecks: 0, incompleteInventories: 0, listingStates: {}, providerErrors: {}, elapsedMs: 0 };
const started = Date.now();
async function inventory(read) {
  let cursor;
  const seen = new Set();
  const items = [];
  let snapshotAt;
  for (let page = 0; page < 25; page++) {
    const result = await read(cursor);
    if (snapshotAt) assert.equal(result.snapshotAt, snapshotAt, "Cursor pages must preserve snapshot identity");
    snapshotAt ??= result.snapshotAt;
    summary.listingStates[result.listingState ?? "unspecified"] = (summary.listingStates[result.listingState ?? "unspecified"] ?? 0) + 1;
    if (result.listingState === "unknown") {
      summary.incompleteInventories++;
      assert.equal(result.totalHint, undefined);
    }
    if (result.listingState === "empty") assert.equal(result.items.length, 0);
    for (const item of result.items) {
      assert.notEqual(item.type, "tst", "Denied objects must not be listed");
      assert.ok(!seen.has(item.refId), "Pagination must not repeat an object");
      seen.add(item.refId);
      const url = new URL(item.url);
      assert.equal(url.origin, "https://adam.unibas.ch");
      assert.equal(item.provenance.provider, "browser");
      assert.ok(Number.isFinite(Date.parse(item.provenance.fetchedAt)));
      items.push(item);
      summary.identityChecks++;
    }
    if (!result.nextCursor) return { items, complete: result.listingState !== "unknown" };
    assert.notEqual(result.nextCursor, cursor, "A cursor must advance");
    cursor = result.nextCursor;
    summary.paginationChecks++;
  }
  summary.incompleteInventories++;
  return { items, complete: false };
}
async function inspect(container) {
  summary.containers++;
  try {
    const children = await inventory((cursor) => provider.listChildren(container.refId, { type: container.type, cursor, limit: 2 }));
    summary.objects += children.items.length;
    const files = await inventory((cursor) => provider.listFiles(container.refId, { type: container.type, cursor, limit: 2 }));
    summary.fileMetadata += files.items.length;
    if (children.complete) {
      const expected = children.items.filter((item) => item.type === "file").map((item) => item.refId).sort();
      const actual = files.items.map((item) => item.refId).sort();
      assert.ok(actual.length === expected.length && actual.every((id, index) => id === expected[index]), "Children and files must agree on the same cached container inventory");
    }
    return children.items.filter((item) => item.type === "fold");
  } catch (error) {
    if (["unauthorized", "cancelled"].includes(error.code) || !error.code) throw error;
    const key = `${error.code}:${error.retryable}`;
    summary.providerErrors[key] = (summary.providerErrors[key] ?? 0) + 1;
    summary.incompleteInventories++;
    return [];
  }
}
try {
  const status = await session.status();
  assert.equal(status.loggedIn, true, "Login and recheck status before live metadata QA");
  const courses = await inventory((cursor) => provider.listCourses({ cursor, limit: 2 }));
  assert.ok(courses.complete, "Enrollment listing must load before traversal");
  summary.courses = courses.items.length;
  const folders = [];
  for (const course of courses.items.slice(0, 8)) folders.push(...await inspect(course));
  for (const folder of folders.slice(0, 4)) {
    summary.folders++;
    await inspect(folder);
  }
} finally {
  await provider.close();
  summary.elapsedMs = Date.now() - started;
  // Never emit account identifiers, course titles, refIds, raw HTML or content.
  console.log(JSON.stringify(summary, null, 2));
}
