// Seeds the glossary "Lab glo" (ref 96) of the local ILIAS 10.12 lab through its UI, as a lab
// course admin (or ROLE=system|tutor). Idempotent: existing terms and definitions are kept.
// Usage (from the repo root): node tools/ilias-lab/seed/seed-wiki-glo.mjs
//
// Lab-only. Synthetic text, marked "Lab". Never run against ADAM.
//
// Wiki (ref 95): not seeded here. ILIAS 10.12 only accepts a Start Page on the wiki
// creation form (cmd=create), so an existing empty wiki cannot get a start page through
// the UI. The wiki pages are reported as not seeded (see the PR notes).
import { labPage, LAB } from "./lab-page.mjs";

const GLO_REF = 96;
const ROLE = process.env.ROLE ?? "admin";
const TERMS = [
  ["Lab Term Alpha", "Lab: a synthetic definition of the alpha term, used for reader tests."],
  ["Lab Term Beta", "Lab: a synthetic definition of the beta term, used for reader tests."],
  ["Lab Term Gamma", "Lab: a synthetic definition of the gamma term, used for reader tests."],
  ["Lab Term Delta", "Lab: a synthetic definition of the delta term, used for reader tests."],
  ["Lab Term Epsilon", "Lab: a synthetic definition of the epsilon term, used for reader tests."],
  ["Lab Term Zeta", "Lab: a synthetic definition of the zeta term, used for reader tests."],
];

const LIST = `${LAB}/ilias.php?baseClass=ilrepositorygui&cmdNode=wq:mx&cmdClass=ilObjGlossaryGUI&cmd=listTerms&ref_id=${GLO_REF}`;
const { browser, page } = await labPage(ROLE);

/** Term rows of the glossary content list: name, id, definition text. */
async function listRows() {
  await page.goto(LIST);
  await page.waitForLoadState("domcontentloaded");
  return page.locator("tr.c-table-data__row, tbody tr").evaluateAll((rows) =>
    rows.map((row) => {
      const cells = [...row.querySelectorAll("td")];
      const term = cells.find((c) => c.querySelector(".c-table-data__cell__col-title")?.textContent.trim() === "Term:");
      const def = cells.find((c) => c.querySelector(".c-table-data__cell__col-title")?.textContent.trim() === "Definition:");
      const id = row.querySelector("input.c-table-data__row-selector")?.value;
      return {
        name: term?.textContent.replace(/^\s*Term:\s*/, "").trim() ?? "",
        id: id ? Number(id) : undefined,
        definition: def?.textContent.replace(/^\s*Definition:\s*/, "").trim() ?? "",
      };
    }).filter((r) => r.name),
  );
}

try {
  for (const [name, definition] of TERMS) {
    let row = (await listRows()).find((r) => r.name === name);
    if (!row) {
      await page.fill('input[name="new_term"]', name);
      await page.selectOption('select[name="term_language"]', "en");
      await page.locator('input[name="cmd[addTerm]"]').click();
      await page.waitForLoadState("domcontentloaded");
      // ILIAS lands on the definition editor, which can fail on a brand-new term; the list is authoritative.
      for (let attempt = 0; attempt < 3 && !row; attempt++) {
        await page.waitForTimeout(1000);
        row = (await listRows()).find((r) => r.name === name);
      }
    }
    if (!row?.id) throw new Error(`term not found after create: ${name}`);
    if (row.definition) { console.log(`exists: ${name}`); continue; }
    // The same route the row's "Edit Definition" action advertises.
    await page.goto(`${LAB}/ilias.php?baseClass=ilrepositorygui&cmdNode=wq%3Amx%3Adt%3A11r%3Adm&cmdClass=ilglossarydefpagegui&cmd=edit&ref_id=${GLO_REF}&term_id=0&glo_term_list_table_action=editDefinition&glo_term_list_table_term_ids%5B%5D=${row.id}`);
    await page.waitForLoadState("domcontentloaded");
    await page.locator('button[aria-label="Add Content"]').first().click();
    await page.locator("text=Insert Text").first().click();
    await page.waitForTimeout(1500);
    const editor = page.frames().find((f) => f.url() === "about:srcdoc");
    if (!editor) throw new Error(`no text editor frame for ${name}`);
    await editor.locator("body").click();
    await page.keyboard.type(definition);
    await page.locator("button", { hasText: "Finish Text Editing" }).first().click();
    await page.waitForLoadState("domcontentloaded");
    await page.locator("button", { hasText: "Finish Editing" }).first().click().catch(() => {});
    await page.waitForLoadState("domcontentloaded");
    console.log(`defined: ${name}`);
  }
  console.log("rows:", (await listRows()).map((r) => `${r.name}${r.definition ? "" : " (no definition)"}`).join(" | "));
} finally {
  await browser.close();
}
