import assert from "node:assert/strict";
import { it } from "node:test";
import { AdamError } from "adam-core";
import { createBrowserProvider } from "./browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

const origin = "https://adam.unibas.ch";
function environment() {
  const course = (id: string, file: string) => snapshotFromHtml(`${origin}/go/crs/${id}`, `Course ${id}`, `<main><h1>Course ${id}</h1><a href="/go/file/${file}">Sheet ${file}</a><a href="/go/file/100099">Sheet final</a><a href="/logout.php">Abmelden</a></main>`, `Course ${id} Sheet ${file} Sheet final Abmelden`);
  const pages = {
    [origin]: snapshotFromHtml(`${origin}/ilias.php?baseClass=ilDashboardGUI`, "Dashboard", '<main><a href="/go/crs/100001">Course A</a><a href="/go/crs/100002">Course B</a></main>', "Dashboard Course A Course B Abmelden"),
    [`${origin}/go/crs/100001`]: course("100001", "100011"),
    [`${origin}/go/crs/100002`]: course("100002", "100022"),
  };
  const opened: string[] = [];
  let clock = 0;
  const provider = createBrowserProvider({ clock: () => clock, session: createMemorySession(pages, { onOpen: (url) => opened.push(url) }) });
  return { provider, pages, opened, course, advance: () => { clock += 1000; } };
}

it("course-scoped discovery checks enrollment and never navigates the other course", async () => {
  const { provider, opened } = environment();
  const results = await provider.search("Sheet", { courseRefId: "100001" });
  assert.ok(results.items.some((item) => item.refId === "100011"));
  assert.ok(!results.items.some((item) => item.refId === "100022"));
  assert.ok(!opened.includes(`${origin}/go/crs/100002`));
  assert.ok(results.snapshotAt);
  await provider.listCalendar({ courseRefId: "100001" });
  await provider.listNews({ courseRefId: "100001" });
  await assert.rejects(() => provider.search("Sheet", { courseRefId: "999999" }), (error: unknown) => error instanceof AdamError && error.code === "forbidden");
  assert.ok(!opened.some((url) => url.includes("999999")));
});

it("refresh sees new material while old cursors retain their timestamp and bind to scope", async () => {
  const { provider, pages, course, advance } = environment();
  const first = await provider.search("Sheet", { courseRefId: "100001", limit: 1 });
  assert.ok(first.nextCursor);
  pages[`${origin}/go/crs/100001`] = course("100001", "100012");
  advance();
  const fresh = await provider.search("Sheet", { courseRefId: "100001", refresh: true });
  assert.ok(fresh.items.some((item) => item.refId === "100012"));
  assert.notEqual(fresh.snapshotAt, first.snapshotAt);
  const old = await provider.search("Sheet", { courseRefId: "100001", cursor: first.nextCursor });
  assert.equal(old.snapshotAt, first.snapshotAt);
  await assert.rejects(() => provider.search("Sheet", { courseRefId: "100002", cursor: first.nextCursor }), /another query/);
  await assert.rejects(() => provider.search("Sheet", { courseRefId: "100001", cursor: first.nextCursor, refresh: true }), /Omit cursor/);
});
