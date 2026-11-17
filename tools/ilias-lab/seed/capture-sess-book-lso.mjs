// Captures the student-view pages the sess / book / lso readers are tested against (ADR 0062, #165).
// Output: packages/provider-browser/fixtures/lab/{sess-info-student,book-objects-student,lso-learner-student}.json
// Run after seed-sess-book-lso.mjs. Lab-only (http://localhost:8080).
// Usage (from the repo root): node tools/ilias-lab/seed/capture-sess-book-lso.mjs
import { labPage, saveLabFixture, LAB } from "./lab-page.mjs";

const CAPTURES = [
  ["sess-info-student", "goto.php?target=sess_88"],
  ["book-objects-student", "goto.php?target=book_91"],
  ["lso-learner-student", "goto.php?target=lso_90"],
];

const { browser, page } = await labPage("student");
try {
  for (const [name, path] of CAPTURES) {
    await page.goto(`${LAB}/${path}`);
    await page.waitForLoadState("domcontentloaded");
    console.log(name, await saveLabFixture(name, page));
  }
} finally {
  await browser.close();
}
