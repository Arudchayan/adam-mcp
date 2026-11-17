// Captures the lab student's read-only booking screen (week grid) of the first bookable
// object in booking pool 91 as fixtures/lab/book-slots-student.json. Never picks or confirms a slot.
// Usage (repo root, lab running): node tools/ilias-lab/seed/capture-book-slots.mjs
import { labPage, LAB, saveLabFixture } from "./lab-page.mjs";

const { browser, page } = await labPage("student");
try {
  await page.goto(`${LAB}/goto.php?target=book_91`);
  const html = await page.content();
  const screen = [...html.matchAll(/(?:href|data-action)="([^"]*cmdClass=ilBookingProcessWithScheduleGUI[^"]*cmd=book[^"]*)"/gi)].map((m) => m[1].replace(/&amp;/g, "&"))[0];
  if (!screen) throw new Error("no booking screen link for the student; is the pool online with a fixed schedule?");
  await page.goto(new URL(screen, LAB).href);
  console.log(JSON.stringify(await saveLabFixture("book-slots-student", page)));
} finally {
  await browser.close();
}
