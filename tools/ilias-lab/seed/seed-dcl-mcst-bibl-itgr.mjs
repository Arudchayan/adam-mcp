// Seeds the four lab objects that ADR 0062's readers need, through the local ILIAS 10.12
// UI as the lab system admin (lab-page.mjs). Idempotent: each step checks the current state
// first. Only these objects are touched: dcl (ref 111), mcst (98), bibl (new, see below) and
// itgr (89). Synthetic text is labelled "Lab". Localhost only, never ADAM.
//
// Usage (repo root): node tools/ilias-lab/seed/seed-dcl-mcst-bibl-itgr.mjs [dcl|mcst|bibl|itgr ...]
import { labPage, LAB, saveLabFixture } from "./lab-page.mjs";

const COURSE = 86;
const DCL = 111;
const MCST = 98;
const ITGR = 89;
const BIBL_TITLE = "Lab bibl upload";

const ONLY = new Set(process.argv.slice(2));
const want = (step) => ONLY.size === 0 || ONLY.has(step);
const log = (...parts) => console.log(...parts);

const DCL_FIELDS = [
  { title: "Lab title", datatype: "2" },        // Text Entry
  { title: "Lab quantity", datatype: "1" },     // Integer
  { title: "Lab due date", datatype: "5" },     // Date Entry
];
const DCL_RECORDS = [
  { "Lab title": "Lab record one", "Lab quantity": "3", "Lab due date": "2026-12-01" },
  { "Lab title": "Lab record two", "Lab quantity": "12", "Lab due date": "2026-12-15" },
  { "Lab title": "Lab record three", "Lab quantity": "7", "Lab due date": "2027-01-10" },
];

const MCST_ITEMS = [
  { title: "Lab episode 1", description: "Lab synthetic mediacast item 1.", url: "https://example.test/lab/episode-1.mp4" },
  { title: "Lab episode 2", description: "Lab synthetic mediacast item 2.", url: "https://example.test/lab/episode-2.webm" },
];

// Synthetic BibTeX file (Lab entries only).
const BIBTEX = `@article{lab2026one,
  author = {Lab Author One},
  title = {Lab entry one: a synthetic article},
  journal = {Lab Journal},
  year = {2026},
}

@book{lab2025two,
  author = {Lab Author Two},
  title = {Lab entry two: a synthetic book},
  publisher = {Lab Press},
  year = {2025},
}

@inproceedings{lab2024three,
  author = {Lab Author Three and Lab Author Four},
  title = {Lab entry three: a synthetic conference paper},
  booktitle = {Lab Proceedings},
  year = {2024},
}
`;

const { browser, page } = await labPage("system");
const ilias = (query) => `${LAB}/ilias.php?baseClass=ilrepositorygui&${query}`;

/** Clicks the first submit control in the page whose value or text matches `label`. */
async function submit(label) {
  const control = page.locator('input[type="submit"], button').filter({ hasText: label }).first();
  const byValue = page.locator(`input[type="submit"][value="${label}"]`).first();
  if (await byValue.count()) await byValue.click();
  else await control.click();
  await page.waitForLoadState("domcontentloaded");
}

try {
  if (want("dcl")) await seedDcl();
  if (want("mcst")) await seedMcst();
  if (want("bibl")) await seedBibl();
  if (want("itgr")) await seedItgr();
  if (ONLY.has("capture")) await captureFixtures();
} finally {
  await browser.close();
}

async function seedDcl() {
  // Online (Settings > General). The lab's SOAP creation leaves the object offline.
  await page.goto(ilias(`cmdNode=wq:m2&cmdClass=ilObjDataCollectionGUI&cmd=edit&ref_id=${DCL}`));
  const online = page.locator('input[name="form/input_4/input_5"]');
  if (!(await online.isChecked())) {
    await online.check();
    await submit("Save");
    log("dcl: set online");
  } else log("dcl: already online");

  // Fields on the "Standard" table (table_id 1).
  const fieldsUrl = ilias(`cmdNode=wq:m2:as:ak&cmdClass=ilDclFieldListGUI&cmd=listFields&ref_id=${DCL}&table_id=1`);
  await page.goto(fieldsUrl);
  const existingFields = await page.content();
  for (const field of DCL_FIELDS) {
    if (existingFields.includes(field.title)) { log(`dcl field exists: ${field.title}`); continue; }
    await page.goto(ilias(`cmdNode=wq:m2:as:ak&cmdClass=ilDclFieldEditGUI&cmd=create&ref_id=${DCL}&table_id=1`));
    await page.fill('input[name="title"]', field.title);
    await page.check(`input[name="datatype"][value="${field.datatype}"]`);
    await submit("Create Field");
    const errors = await page.locator(".alert-danger, .il-input-error, .help-block").allTextContents();
    log(errors.length ? `dcl field FAILED ${field.title}: ${errors.join(" | ").replace(/\s+/g, " ").slice(0, 160)}` : `dcl field created: ${field.title}`);
  }

  // Records. The add form lists the table's fields by title.
  await page.goto(ilias(`cmdNode=wq:m2:ap&cmdClass=ilDclRecordListGUI&cmd=listRecords&ref_id=${DCL}&mode=manage`));
  const listed = await page.content();
  if (listed.includes(DCL_RECORDS[0]["Lab title"]) && listed.includes(DCL_RECORDS[2]["Lab title"])) {
    log("dcl records: already present");
    return;
  }
  for (const record of DCL_RECORDS) {
    await page.goto(ilias(`cmdNode=wq:m2:ao&cmdClass=ilDclRecordEditGUI&cmd=create&ref_id=${DCL}&table_id=1&tableview_id=1`));
    for (const field of DCL_FIELDS) {
      // Each field's input is the control its label points at (ILIAS form labels carry `for`).
      const forId = await page.locator("label", { hasText: field.title }).first().getAttribute("for");
      await page.locator(`[id="${forId}"]`).fill(record[field.title]);
    }
    await submit("Save");
    const errors = await page.locator(".alert-danger, .il-input-error, .help-block").allTextContents();
    log(errors.length ? `dcl record FAILED: ${errors.join(" | ").replace(/\s+/g, " ").slice(0, 160)}` : `dcl record saved: ${record["Lab title"]}`);
  }
}

async function seedMcst() {
  const mediacast = (query) => `${LAB}/ilias.php?baseClass=ilmediacasthandlergui&${query}`;
  await page.goto(mediacast(`cmdNode=j9:o6&cmdClass=ilObjMediaCastGUI&cmd=listItems&ref_id=${MCST}`));
  for (const item of MCST_ITEMS) {
    if ((await page.content()).includes(item.title)) { log(`mcst item exists: ${item.title}`); continue; }
    await page.goto(mediacast(`cmdNode=j9:o6:jd&cmdClass=ilMediaCreationGUI&ref_id=${MCST}`));
    // Option 2 (External URL) is a collapsed panel on the add page.
    await page.getByText("Option 2: External URL").click();
    await page.fill('input[name="url"]', item.url);
    await page.locator('input[name="cmd[saveUrl]"]').click();
    await page.waitForLoadState("domcontentloaded");
    // The item editor follows: title, description and the play time (entered by hand).
    await page.fill('input[name="title"]', item.title);
    await page.fill("textarea[name=description]", item.description);
    await page.locator('input[name="cmd[updateCastItem]"]').first().click();
    await page.waitForLoadState("domcontentloaded");
    await page.goto(mediacast(`cmdNode=j9:o6&cmdClass=ilObjMediaCastGUI&cmd=listItems&ref_id=${MCST}`));
    log((await page.content()).includes(item.title) ? `mcst item created: ${item.title}` : `mcst FAILED: ${item.title} not listed`);
  }
}

/**
 * The bibliography at ref 97 was created by SOAP without a file, so ILIAS shows it as
 * "not migrated" and offers no upload. A new bibliography is created through the course's
 * "Add New Item" form, which takes the BibTeX file. Ref 97 is left as it is.
 */
async function seedBibl() {
  await page.goto(ilias(`cmd=render&ref_id=${COURSE}`));
  if (!(await refOf(BIBL_TITLE))) {
    await page.goto(ilias(`ref_id=${COURSE}&cmd=create&new_type=bibl`));
    await page.fill('input[name="title"]', BIBL_TITLE);
    await page.fill('textarea[name="desc"]', "Lab synthetic bibliography (three Lab entries).");
    await page.setInputFiles('input[name="bibliographic_file"]', { name: "lab-bibliography.bib", mimeType: "text/plain", buffer: Buffer.from(BIBTEX) });
    await submit("Add Bibliography");
  }
  const ref = await refOf(BIBL_TITLE);
  if (!ref) {
    const errors = await page.locator(".alert-danger, .il-input-error").allTextContents();
    throw new Error(`bibl FAILED: ${errors.join(" | ").replace(/\s+/g, " ").slice(0, 200)}`);
  }
  log(`bibl ${BIBL_TITLE} ref ${ref}`);
  // New objects start offline; the reader's student view needs it online (Settings > General).
  await page.goto(ilias(`cmdNode=wq:kz&cmdClass=ilObjBibliographicGUI&cmd=editObject&ref_id=${ref}`));
  const online = page.locator('input[name="form/input_4/input_5"]');
  if (!(await online.isChecked())) {
    await online.check();
    await submit("Save");
    log(`bibl ${ref}: set online`);
  }
}

/** Item group membership: the course-level "Materials" tab of the item group. */
async function seedItgr() {
  const members = [MCST, DCL];
  const bibl = await refOf(BIBL_TITLE);
  if (bibl) members.push(bibl);
  await page.goto(ilias(`cmdNode=wq:n8&cmdClass=ilObjItemGroupGUI&cmd=listMaterials&ref_id=${ITGR}`));
  for (const ref of members) {
    const box = page.locator(`input[name="items[]"][value="${ref}"]`);
    if (!(await box.isChecked())) await box.check();
  }
  await page.locator('input[name="cmd[saveItemAssignment]"]').first().click();
  await page.waitForLoadState("domcontentloaded");
  log(`itgr ${ITGR} members: ${members.join(", ")}`);
}

/**
 * Student-view fixtures (tools/ilias-lab/seed/lab-page.mjs saveLabFixture). The lab
 * student sees the same pages ADAM shows a student; the reader tests rebase the origin.
 */
async function captureFixtures() {
  const { browser: studentBrowser, page: student } = await labPage("student");
  try {
    const open = async (url) => { await student.goto(url); await student.waitForLoadState("domcontentloaded"); };
    // First href or data-action (ILIAS KS buttons carry their route in data-action) matching `pattern`.
    const routeTo = async (pattern) => student.$$eval("a[href], [data-action]", (els, source) => {
      const re = new RegExp(source);
      for (const el of els) {
        const route = el.getAttribute("href") || el.getAttribute("data-action") || "";
        if (re.test(route)) return route.replace(/&amp;/g, "&");
      }
      return null;
    }, pattern.source);

    await open(ilias(`cmd=render&ref_id=${DCL}`));
    log("capture", (await saveLabFixture("dcl-table-student", student)).name);

    // The student table renders no per-record detail route (the table view is the only read view),
    // so there is no dcl-record-student fixture; see the PR's uncovered list.
    const recordRoute = await routeTo(/ilDclDetailedViewGUI|showDetailedView|cmd=showRecord|record_id=/);
    if (recordRoute) {
      await open(new URL(recordRoute, LAB).href);
      log("capture", (await saveLabFixture("dcl-record-student", student)).name);
    } else log("dcl: no per-record detail route for students; dcl-record-student not captured");

    await open(`${LAB}/ilias.php?baseClass=ilmediacasthandlergui&cmdNode=j9:o6&cmdClass=ilObjMediaCastGUI&cmd=showContent&ref_id=${MCST}`);
    log("capture", (await saveLabFixture("mcst-content-student", student)).name);

    const bibl = await refOf(BIBL_TITLE);
    await open(ilias(`cmdNode=wq:kz&cmdClass=ilObjBibliographicGUI&cmd=showContent&ref_id=${bibl}`));
    log("capture", (await saveLabFixture("bibl-view-student", student)).name);

    const entryRoute = await routeTo(/cmd=showDetails&ref_id=\d+&entry_id=\d+/);
    if (!entryRoute) throw new Error("bibl: no entry detail route on the student view");
    await open(new URL(entryRoute, LAB).href);
    log("capture", (await saveLabFixture("bibl-entry-student", student)).name);

    await open(ilias(`cmdNode=wq:lu&cmdClass=ilObjCourseGUI&cmd=view&ref_id=${COURSE}`));
    log("capture", (await saveLabFixture("course-itgr-student", student)).name);
  } finally {
    await studentBrowser.close();
  }
}

/** ref_id of the course child titled `title`, read from the course's own listing. */
async function refOf(title) {
  await page.goto(ilias(`cmd=render&ref_id=${COURSE}`));
  const href = await page.locator("a", { hasText: title }).first().getAttribute("href").catch(() => null);
  return href?.match(/ref_id=(\d+)/)?.[1] ? Number(href.match(/ref_id=(\d+)/)[1]) : undefined;
}
