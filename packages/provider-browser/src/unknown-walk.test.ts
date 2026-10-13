import assert from "node:assert/strict";
import { it } from "node:test";
import { createBrowserProvider } from "./browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

it("unknown child listings mark search, calendar and news as incomplete", async () => {
  const origin = "https://adam.unibas.ch";
  const course = `${origin}/go/crs/100001`;
  const home = snapshotFromHtml(`${origin}/ilias.php?baseClass=ilDashboardGUI`, "Dashboard",
    '<main><a href="/go/crs/100001">Synthetic course</a><a href="/logout.php">Abmelden</a></main>', "Dashboard Synthetic course Abmelden");
  const blank = { ...snapshotFromHtml(course, "Synthetic course", '<main><h1>Synthetic course</h1><div id="il_center_col"></div></main>', "Synthetic course"),
    dom: { itemRows: 0, emptyCopy: false, contentBlank: true } };
  const provider = createBrowserProvider({ origin, session: createMemorySession({ [origin]: home, [course]: blank }) });
  for (const result of [await provider.search("missing"), await provider.listCalendar(), await provider.listNews()]) {
    assert.equal(result.partial, true);
    assert.equal(result.skipped, 1);
    assert.match(result.notice ?? "", /incomplete/i);
  }
});

it("an unknown nested folder marks aggregation incomplete and is retried rather than memoized", async () => {
  const origin = "https://adam.unibas.ch", course = `${origin}/go/crs/100001`, folder = `${origin}/go/fold/100010`;
  let folderOpens = 0;
  const pages = {
    [origin]: snapshotFromHtml(`${origin}/ilias.php?baseClass=ilDashboardGUI`, "Dashboard", '<main><a href="/go/crs/100001">Synthetic course</a></main>', "Dashboard Synthetic course Abmelden"),
    [course]: snapshotFromHtml(course, "Synthetic course", '<main><h1>Synthetic course</h1><a href="/go/fold/100010">Notes</a></main>', "Synthetic course Notes"),
    [folder]: { ...snapshotFromHtml(folder, "Notes", '<main><h1>Notes</h1></main>', "Notes"), dom: { itemRows: 0, emptyCopy: false, contentBlank: true } },
  };
  const provider = createBrowserProvider({ origin, session: createMemorySession(pages, { onOpen: (url) => { if (url === folder) folderOpens++; } }) });
  assert.equal((await provider.listCalendar()).partial, true);
  assert.equal((await provider.listNews()).partial, true);
  assert.equal((await provider.search("missing")).partial, true);
  assert.ok(folderOpens >= 3);
});
