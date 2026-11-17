// Captures student-view wiki fixtures ("Lab wiki pages", found by title in the Lab Course) into
// packages/provider-browser/fixtures/lab/. Run after seed-wiki-glo.mjs. Lab-only.
// Usage (repo root): node tools/ilias-lab/seed/capture-wiki-fixtures.mjs
import { labPage, saveLabFixture, LAB } from "./lab-page.mjs";

const COURSE_REF = 86;
const WIKI_TITLE = "Lab wiki pages";

const { browser, page } = await labPage("student");
try {
  // Find the wiki ref by title in the course listing, as the seed does.
  await page.goto(`${LAB}/ilias.php?baseClass=ilrepositorygui&ref_id=${COURSE_REF}`);
  await page.waitForLoadState("domcontentloaded");
  const href = await page.locator("a").evaluateAll((as, title) => as.find((a) => a.textContent.trim().replace(/\s+/g, " ") === title && /wikihandlergui/i.test(a.getAttribute("href") ?? ""))?.getAttribute("href") ?? "", WIKI_TITLE);
  const ref = href.match(/ref_id=(\d+)/)?.[1];
  if (!ref) throw new Error(`wiki "${WIKI_TITLE}" not visible to the student in course ${COURSE_REF}`);

  await page.goto(`${LAB}/goto.php?target=wiki_${ref}_Lab_Start`);
  await page.waitForLoadState("domcontentloaded");
  console.log(await saveLabFixture("wiki-start-student", page));

  await page.goto(`${LAB}/goto.php?target=wiki_${ref}_Lab_Page_One`);
  await page.waitForLoadState("domcontentloaded");
  console.log(await saveLabFixture("wiki-page-student", page));

  // Two more hops for the sub-page crawl test (Start -> One -> Two -> Three).
  for (const [name, title] of [["wiki-page-two-student", "Lab_Page_Two"], ["wiki-page-three-student", "Lab_Page_Three"]]) {
    await page.goto(`${LAB}/goto.php?target=wiki_${ref}_${title}`);
    await page.waitForLoadState("domcontentloaded");
    console.log(await saveLabFixture(name, page));
  }

  // The "All Pages" sub-tab: the student's own link on the start page.
  await page.goto(`${LAB}/goto.php?target=wiki_${ref}_Lab_Start`);
  await page.waitForLoadState("domcontentloaded");
  const allPages = await page.locator("a").evaluateAll((as) => as.find((a) => a.textContent.trim() === "All Pages")?.getAttribute("href") ?? "");
  if (!allPages) throw new Error("the student has no All Pages link");
  await page.goto(new URL(allPages, LAB).href);
  await page.waitForLoadState("domcontentloaded");
  console.log(await saveLabFixture("wiki-all-pages-student", page));
  console.log(`wiki ref ${ref}`);
} finally {
  await browser.close();
}
