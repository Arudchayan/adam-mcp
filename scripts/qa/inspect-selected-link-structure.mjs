import { createPlaywrightSession } from "../../packages/provider-browser/src/playwright-session.ts";
import { structuralHref } from "./structural-href.mjs";

const refId = process.argv[2];
if (!/^\d+$/.test(refId ?? "") || !process.argv.includes("--confirm")) {
  throw new Error("Pass one selected Web Link refId and --confirm only after approval to read that page.");
}
const session = createPlaywrightSession();
try {
  const status = await session.status();
  if (!status.loggedIn) throw new Error("Login and recheck status before selected-page QA.");
  const snapshot = await session.open(`https://adam.unibas.ch/go/webr/${refId}`);
  const page = Reflect.get(session, "page");
  const structure = await page.evaluate(() => {
    const root = document.querySelector("#il_center_col") ?? document.querySelector("#ilContentContainer") ?? document.querySelector("main");
    return {
      rootFound: Boolean(root),
      anchors: [...(root?.querySelectorAll("a") ?? [])].slice(0, 100).map((a) => ({ href: a.getAttribute("href") ?? "", hasClickHandler: a.hasAttribute("onclick") })),
      tables: [...(root?.querySelectorAll("table") ?? [])].map((table) => ({ rows: table.rows.length, links: table.querySelectorAll("a").length })),
      webLinksTabAnchors: [...document.querySelectorAll("#ilTab a, [role='tab']")].filter((a) => /^Weblinks$/i.test((a.textContent ?? "").trim())).length,
    };
  });
  const anchors = structure.anchors.map(({ href, hasClickHandler }) => ({ ...structuralHref(href, snapshot.url), hasClickHandler }));
  console.log(JSON.stringify({ selectedPageApproved: true, capturedAt: new Date().toISOString(), landingStructure: structuralHref(snapshot.url, "https://adam.unibas.ch"), rootFound: structure.rootFound, anchors, tables: structure.tables, webLinksTabAnchors: structure.webLinksTabAnchors, externalNavigation: false, note: "Structural counts and allowlisted labels only. No titles, classes, arbitrary paths, page text, destination values, live IDs, cookies, storage state or bytes emitted." }, null, 2));
} finally {
  await session.close();
}
