// Captures the student-view pages the sess / book / lso readers are tested against (ADR 0062, #165).
// Output: packages/provider-browser/fixtures/lab/{sess-info-student,sess-info-undated-student,
//   book-objects-student,lso-learner-student}.json
// Run after seed-sess-book-lso.mjs. Lab-only (http://localhost:8080).
// The dated session is looked up by its title in Lab Course, so the capture follows the seed.
// Usage (from the repo root): node tools/ilias-lab/seed/capture-sess-book-lso.mjs
import { labPage, saveLabFixture, LAB } from "./lab-page.mjs";

const DATED_TITLE = "Lab sess dated";
const LAB_COURSE = 86;

const { browser, page } = await labPage("student");
try {
  await page.goto(`${LAB}/goto.php?target=crs_${LAB_COURSE}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const href = await page.locator("a", { hasText: DATED_TITLE }).first().getAttribute("href");
  const datedRef = href?.match(/ref_id=(\d+)/)?.[1];
  if (!datedRef) throw new Error(`session "${DATED_TITLE}" not found in Lab Course; run seed-sess-book-lso.mjs first`);
  const CAPTURES = [
    ["sess-info-student", `goto.php?target=sess_${datedRef}`],
    ["sess-info-undated-student", "goto.php?target=sess_88"],
    ["book-objects-student", "goto.php?target=book_91"],
    ["lso-learner-student", "goto.php?target=lso_90"],
  ];
  for (const [name, path] of CAPTURES) {
    await page.goto(`${LAB}/${path}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    console.log(name, await saveLabFixture(name, page));
  }
} finally {
  await browser.close();
}
