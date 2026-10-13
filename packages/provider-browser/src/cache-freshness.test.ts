import assert from "node:assert/strict";
import { it } from "node:test";
import { AdamError } from "adam-core";
import { createBrowserProvider } from "./browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";
import { SnapshotPagination } from "./snapshot-pagination.ts";

it("refreshes page and walk data after a minute while existing cursors keep their snapshot", async () => {
  const origin = "https://adam.unibas.ch", url = `${origin}/go/crs/100001`;
  let clock = 0, opens = 0;
  const course = (version: number) => snapshotFromHtml(url, "Synthetic course",
    `<main><h1>Synthetic course</h1><a href="/go/file/${100010 + version}">Version ${version}</a><a href="/go/file/100099">Final file</a><a href="/logout.php">Abmelden</a></main>`, `Synthetic course Version ${version} Final file Abmelden`);
  const pages = {
    [origin]: snapshotFromHtml(`${origin}/ilias.php?baseClass=ilDashboardGUI`, "Dashboard", '<main><a href="/go/crs/100001">Synthetic course</a></main>', "Dashboard Synthetic course Abmelden"),
    [url]: course(1),
  };
  const provider = createBrowserProvider({ origin, clock: () => clock, session: createMemorySession(pages, { onOpen: () => { opens++; } }) });
  const first = await provider.listFiles("100001", { type: "crs", limit: 1 });
  assert.equal(first.items[0]?.title, "Version 1");
  assert.ok(first.nextCursor);
  await provider.search("Version");
  pages[url] = course(2);
  const cached = await provider.listFiles("100001", { type: "crs" });
  assert.equal(cached.items[0]?.title, "Version 1");
  assert.equal(cached.items[0]?.provenance.fetchedAt, first.items[0]?.provenance.fetchedAt);
  clock = 60_001;
  assert.equal((await provider.listFiles("100001", { type: "crs" })).items[0]?.title, "Version 2");
  const next = await provider.listFiles("100001", { type: "crs", cursor: first.nextCursor });
  assert.deepEqual(next.items.map((item) => item.title), ["Final file"]);
  assert.equal((await provider.search("Version")).items[0]?.title, "Version 2");
  assert.ok(opens >= 4);
  clock = 600_001;
  await assert.rejects(() => provider.listFiles("100001", { type: "crs", cursor: first.nextCursor }),
    (error: unknown) => error instanceof AdamError && error.code === "stale_id");
});

it("binds cursors to their query and clears them on session invalidation", () => {
  const pages = new SnapshotPagination();
  const first = pages.first("a", [1, 2, 3], { limit: 1 }, { partial: true });
  assert.match(first.nextCursor!, /^\d+$/);
  assert.throws(() => pages.continue("b", { cursor: first.nextCursor }), AdamError);
  assert.equal((pages.continue("a", { cursor: first.nextCursor }) as { partial?: boolean }).partial, true);
  pages.clear();
  assert.throws(() => pages.continue("a", { cursor: first.nextCursor }), AdamError);
});

it("explicit logout immediately blocks cached pages, walks and pagination", async () => {
  const origin = "https://adam.unibas.ch", url = `${origin}/go/crs/100001`;
  let loggedOut = false;
  const session = createMemorySession({
    [origin]: snapshotFromHtml(`${origin}/ilias.php?baseClass=ilDashboardGUI`, "Dashboard", '<main><a href="/go/crs/100001">Synthetic course</a></main>', "Dashboard Synthetic course Abmelden"),
    [url]: snapshotFromHtml(url, "Synthetic course", '<main><h1>Synthetic course</h1><a href="/go/file/100011">One</a><a href="/go/file/100012">Two</a></main>', "Synthetic course One Two"),
  });
  session.explicitlyLoggedOut = async () => loggedOut;
  const provider = createBrowserProvider({ origin, session });
  const first = await provider.listFiles("100001", { type: "crs", limit: 1 });
  await provider.search("One");
  loggedOut = true;
  for (const read of [() => provider.getCourse("100001"), () => provider.search("One"), () => provider.listFiles("100001", { type: "crs", cursor: first.nextCursor })]) {
    await assert.rejects(read, (error: unknown) => error instanceof AdamError && error.code === "unauthorized");
  }
});
