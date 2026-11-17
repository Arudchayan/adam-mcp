// Capture the lab student's Private Notes overview and one object's notes modal as fixtures for
// packages/provider-browser (notes-parse tests). Run seed-notes.mjs first. Lab-only (http://localhost:8080).
// Usage (from the repo root): node tools/ilias-lab/seed/capture-notes.mjs
import { labPage, saveLabFixture, LAB } from "./lab-page.mjs";

const { browser, page } = await labPage("student");
try {
  await page.goto(`${LAB}/ilias.php?baseClass=ildashboardgui&cmdNode=a4:uo&cmdClass=ilPDNotesGUI&cmd=showPrivateNotes&note_type=1`);
  console.log(await saveLabFixture("notes-overview-student", page));

  await page.goto(`${LAB}/ilias.php?baseClass=ilrepositorygui&cmd=infoScreen&ref_id=86`);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Notes");
    b?.click();
  });
  await page.waitForSelector("dialog #ilNotes", { timeout: 20000 });
  await page.waitForTimeout(1000);
  console.log(await saveLabFixture("notes-object-student", page));
} finally {
  await browser.close();
}
