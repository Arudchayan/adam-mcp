import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { chromium } from "playwright-core";
import { classifyListing } from "./extract.ts";
import { LISTING_PROBE_SCRIPT, createPlaywrightSession } from "./playwright-session.ts";

// Opt-in disposable Chrome only. Every request is intercepted; no ADAM/profile access.
it("synthetic real DOM: wrapper blanks, scoped empty evidence, selectors and delayed same-origin frames", { skip: process.env.ADAM_TEST_CHROME !== "1" }, async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const requests: string[] = [];
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== "https://adam.unibas.ch") return route.abort();
      requests.push(url.pathname);
      const body = url.pathname === "/go/fold/100020"
        ? '<main><ul id="ilTab"><li><a href="/ilias.php?baseClass=ilRepositoryGUI&amp;cmdClass=ilObjFolderGUI&amp;cmd=render&amp;ref_id=100020">Inhalt</a></li></ul><div id="il_center_col"><div></div></div></main>'
        : url.pathname === "/ilias.php"
          ? '<main><div id="il_center_col"><div class="ilContainerListItemOuter"><a href="/go/file/100021">Recovered.pdf</a></div></div></main>'
        : url.pathname === "/go/fold/100010"
        ? '<main><div id="il_center_col"><iframe src="/synthetic-frame"></iframe></div></main>'
        : url.pathname === "/synthetic-frame"
          ? `<main><div id="il_center_col"></div></main><script>setTimeout(() => { document.querySelector("#il_center_col").innerHTML = '<div class="ilContainerListItemOuter"><a href="/go/file/100011">Synthetic sheet.pdf</a></div>'; }, 100)</script>`
          : "<main>Unexpected synthetic path</main>";
      return route.fulfill({ contentType: "text/html", body });
    });
    const page = await context.newPage();
    for (const [html, expected] of [
      ['<main><div id="il_center_col"><div><div></div></div></div></main>', { itemRows: 0, emptyCopy: false, contentBlank: true }],
      ['<main><div id="il_center_col">This folder is empty.</div></main>', { itemRows: 0, emptyCopy: true, contentBlank: false }],
      ['<main><div id="il_center_col"><p>The words this folder is empty are an example, not a listing.</p></div></main>', { itemRows: 0, emptyCopy: false, contentBlank: false }],
      ['<header>This folder is empty</header><main><div id="il_center_col"><div></div></div></main>', { itemRows: 0, emptyCopy: false, contentBlank: true }],
      ['<main><div id="il_center_col"><div class="ilContainerListItemOuter"><a href="/go/file/100011">Sheet</a></div></div></main>', { itemRows: 1, emptyCopy: false, contentBlank: false }],
    ] as const) {
      await page.setContent(html);
      assert.deepEqual(await page.evaluate(LISTING_PROBE_SCRIPT), expected);
    }
    for (const name of ["folder-blank-exercises", "folder-blank-notes"]) {
      const fixture = JSON.parse(readFileSync(new URL(`../fixtures/live/${name}.json`, import.meta.url), "utf8"));
      await page.setContent(fixture.html);
      const probe = await page.evaluate(LISTING_PROBE_SCRIPT) as { itemRows: number; emptyCopy: boolean; contentBlank: boolean };
      assert.equal(probe.itemRows, 0, `${name}: actual DOM has no listing rows`);
      assert.equal(probe.contentBlank, true, `${name}: execute probe, do not trust prerecorded dom`);
    }
    const session = createPlaywrightSession();
    Reflect.set(session, "ensurePage", async () => page);
    const snapshot = await session.open("https://adam.unibas.ch/go/fold/100010");
    assert.equal(snapshot.dom?.itemRows, 1, "readiness must wait for a delayed same-origin content frame");
    assert.ok(snapshot.links.some((link) => link.text === "Synthetic sheet.pdf"));
    assert.equal(classifyListing(snapshot, 1).state, "ok");
    const recovered = await session.open("https://adam.unibas.ch/go/fold/100020");
    assert.ok(recovered.links.some((link) => link.text === "Recovered.pdf"));
    assert.equal(recovered.dom?.itemRows, 1);
    assert.equal(requests.filter((path) => path === "/ilias.php").length, 1, "real DOM tab selection navigates once");
  } finally {
    await browser.close();
  }
});
