// Captures student-view glossary fixtures (ref 96) into packages/provider-browser/fixtures/lab/.
// Run after seed-wiki-glo.mjs. Lab-only; the student is the lab student account.
// Usage (from the repo root): node tools/ilias-lab/seed/capture-glo-fixtures.mjs
import { labPage, saveLabFixture, LAB } from "./lab-page.mjs";

const { browser, page } = await labPage("student");
try {
  // The glossary's student entry point (lands on ilPresentationTableGUI show).
  await page.goto(`${LAB}/goto.php?target=glo_96`);
  await page.waitForLoadState("domcontentloaded");
  console.log(await saveLabFixture("glo-terms-student", page));
  // Only the page the student reaches; the glossary has no per-term route, so no term fixture.
} finally {
  await browser.close();
}
