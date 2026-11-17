// Seed three synthetic Private Notes as lab.student (ILIAS 10.12 lab, http://localhost:8080) through the
// object's Notes action on its info screen, which opens the notes modal (ilnotegui getNotesHTML) and posts
// the "Add Note" form. Idempotent: a note whose text is already listed on the object is not added again.
// Lab-only. Never touches objects (no edit, delete or export) and never runs against ADAM.
// Usage (from the repo root): node tools/ilias-lab/seed/seed-notes.mjs
import { labPage, LAB } from "./lab-page.mjs";

const NOTES = [
  { ref: 86, text: "Lab note 1: synthetic reminder for the Lab Course (not real content)." },
  { ref: 86, text: "Lab note 2: synthetic second note on the same course." },
  { ref: 97, text: "Lab note 3: synthetic note on the Lab bibliography object." },
];

const { browser, page } = await labPage("student");
try {
  for (const { ref, text } of NOTES) {
    await page.goto(`${LAB}/ilias.php?baseClass=ilrepositorygui&cmd=infoScreen&ref_id=${ref}`);
    // The Notes entry is in the Actions dropdown, which is hidden; a DOM click fires the same handler.
    const opened = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Notes");
      if (!b) return false;
      b.click();
      return true;
    });
    if (!opened) {
      console.log(`skipped ref ${ref}: no Notes action on the info screen`);
      continue;
    }
    await page.waitForSelector("#il_notes_modal .modal-body, dialog .modal-body #ilNotes", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const listed = await page.$eval("dialog", (d) => d.innerText).catch(() => "");
    if (listed.includes(text)) {
      console.log(`exists: ref ${ref} "${text.slice(0, 20)}..."`);
      await page.keyboard.press("Escape");
      continue;
    }
    // Reveal the hidden "Add Note" form (the button's own handler only shows the form area).
    await page.evaluate(() => document.querySelector("dialog [data-note-el='edit-form-area'] button")?.click());
    await page.locator("dialog textarea").first().fill(text);
    await page.locator("dialog [data-note-el='edit-form'] form button", { hasText: /^Save$/ }).click();
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(2500);
    const after = await page.$eval("dialog", (d) => d.innerText).catch(() => "");
    console.log(`${after.includes(text) ? "added" : "NOT CONFIRMED"}: ref ${ref} "${text.slice(0, 20)}..."`);
  }
  await page.goto(`${LAB}/ilias.php?baseClass=ildashboardgui&cmdNode=a4:uo&cmdClass=ilPDNotesGUI&cmd=showPrivateNotes&note_type=1`);
  console.log("overview:", (await page.$eval("#il_center_col", (e) => e.innerText)).replace(/\s+/g, " ").slice(0, 400));
} finally {
  await browser.close();
}
