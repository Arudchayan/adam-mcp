// Seeds the local ILIAS 10.12 lab through its UI as a lab course admin (ROLE=system|tutor to override).
// Idempotent: existing terms, definitions, wiki, and pages are kept. Usage (repo root):
//   node tools/ilias-lab/seed/seed-wiki-glo.mjs
//
// Lab-only. Synthetic text, labelled "Lab". Never run against ADAM.
//
// - Glossary "Lab glo" (ref 96): six terms, one definition each.
// - Wiki "Lab wiki pages" in Lab Course (ref 86): created with its start page, online, then
//   three more pages made by following the red (missing) wiki link from the page before.
//   The ref is found by title in the course listing, so a rerun reuses it.
// - Wiki "Lab wiki" (ref 95) is the broken wiki from the lab setup. Not touched here.
import { labPage, LAB } from "./lab-page.mjs";

const GLO_REF = 96;
const COURSE_REF = 86;
const WIKI_TITLE = "Lab wiki pages";
const WIKI_START = "Lab Start";
const ROLE = process.env.ROLE ?? "admin";

const TERMS = [
  ["Lab Term Alpha", "Lab: a synthetic definition of the alpha term, used for reader tests."],
  ["Lab Term Beta", "Lab: a synthetic definition of the beta term, used for reader tests."],
  ["Lab Term Gamma", "Lab: a synthetic definition of the gamma term, used for reader tests."],
  ["Lab Term Delta", "Lab: a synthetic definition of the delta term, used for reader tests."],
  ["Lab Term Epsilon", "Lab: a synthetic definition of the epsilon term, used for reader tests."],
  ["Lab Term Zeta", "Lab: a synthetic definition of the zeta term, used for reader tests."],
];

// Wiki content blocks: h2 (heading), p (paragraph), ul (bullet list). [[Title]] is an internal wiki link.
const START_BLOCKS = [
  { h2: "Lab Start Heading" },
  { p: "Lab start text, see [[Lab Page One]]." },
  { p: "Second paragraph (Lab)." },
];
const PAGES = [
  { title: "Lab Page One", blocks: [
    { h2: "Lab Page One" },
    { p: "Lab page one text, see [[Lab Page Two]] and back to [[Lab Start]]." },
    { ul: ["Lab item A", "Lab item B"] },
  ] },
  { title: "Lab Page Two", blocks: [
    { h2: "Lab Page Two" },
    { p: "Lab page two text, see [[Lab Page Three]] and back to [[Lab Page One]]." },
    { ul: ["Lab item C"] },
  ] },
  { title: "Lab Page Three", blocks: [
    { h2: "Lab Page Three" },
    { p: "Lab page three text, see [[Lab Start]] and back to [[Lab Page Two]]." },
    { ul: ["Lab item D", "Lab item E"] },
  ] },
];

const { browser, page } = await labPage(ROLE);
const slug = (title) => title.replace(/ /g, "_");

/** Glossary term rows of "Lab glo": name, id, definition. */
async function glossaryRows() {
  await page.goto(`${LAB}/ilias.php?baseClass=ilrepositorygui&cmdNode=wq:mx&cmdClass=ilObjGlossaryGUI&cmd=listTerms&ref_id=${GLO_REF}`);
  await page.waitForLoadState("domcontentloaded");
  return page.locator("tbody tr").evaluateAll((rows) =>
    rows.map((row) => {
      const cells = [...row.querySelectorAll("td")];
      const label = (name) => cells.find((c) => c.querySelector(".c-table-data__cell__col-title")?.textContent.trim() === name);
      return {
        name: label("Term:")?.textContent.replace(/^\s*Term:\s*/, "").trim() ?? "",
        id: row.querySelector("input.c-table-data__row-selector")?.value,
        definition: label("Definition:")?.textContent.replace(/^\s*Definition:\s*/, "").trim() ?? "",
      };
    }).filter((r) => r.name),
  );
}

async function seedGlossary() {
  for (const [name, definition] of TERMS) {
    let row = (await glossaryRows()).find((r) => r.name === name);
    if (!row) {
      await page.fill('input[name="new_term"]', name);
      await page.selectOption('select[name="term_language"]', "en");
      await page.locator('input[name="cmd[addTerm]"]').click();
      await page.waitForLoadState("domcontentloaded");
      for (let attempt = 0; attempt < 3 && !row; attempt++) {
        await page.waitForTimeout(1000);
        row = (await glossaryRows()).find((r) => r.name === name);
      }
    }
    if (!row?.id) throw new Error(`term not found after create: ${name}`);
    if (row.definition) { console.log(`glossary exists: ${name}`); continue; }
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
    console.log(`glossary defined: ${name}`);
  }
}

/** Wiki ref for WIKI_TITLE from the course listing, or undefined. */
async function findWiki() {
  await page.goto(`${LAB}/ilias.php?baseClass=ilrepositorygui&ref_id=${COURSE_REF}`);
  await page.waitForLoadState("domcontentloaded");
  const hits = await page.locator("a").evaluateAll((as) => as.map((a) => ({ text: a.textContent.trim().replace(/\s+/g, " "), href: a.getAttribute("href") ?? "" })));
  const hit = hits.find((h) => h.text === WIKI_TITLE && /ref_id=\d+/.test(h.href) && /wikihandlergui/i.test(h.href));
  return hit ? Number(hit.href.match(/ref_id=(\d+)/)[1]) : undefined;
}

async function createWiki() {
  await page.goto(`${LAB}/ilias.php?baseClass=ilrepositorygui&ref_id=${COURSE_REF}&cmd=create&new_type=wiki`);
  await page.waitForLoadState("domcontentloaded");
  await page.fill('input[name="form/input_0/input_1"]', WIKI_TITLE);
  await page.fill('textarea[name="form/input_0/input_2"]', "Lab seed");
  await page.fill('input[name="form/input_3"]', WIKI_START);
  await page.locator("button, input[type=submit]", { hasText: /^\s*Add Wiki\s*$/ }).last().click();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);
  const ref = Number(page.url().match(/ref_id=(\d+)/)?.[1]);
  if (!ref) throw new Error("wiki create did not return a ref_id");
  console.log(`wiki created: ${WIKI_TITLE} ref ${ref}`);
  return ref;
}

async function ensureOnline(ref) {
  await page.goto(`${LAB}/ilias.php?baseClass=ilwikihandlergui&cmdClass=ilobjwikigui&cmd=editSettings&ref_id=${ref}`);
  await page.waitForLoadState("domcontentloaded");
  const online = page.locator('input[name="form/input_5/input_6"]');
  if (await online.isChecked()) return;
  await online.check();
  await page.locator("button, input[type=submit]", { hasText: /^\s*Save\s*$/ }).first().click().catch(async () => page.locator('input[value="Save"]').first().click());
  await page.waitForLoadState("domcontentloaded");
  console.log(`wiki ${ref} set online`);
}

/** Visible toolbar/menu control by its exact text. */
const visible = (text) => page.locator("button:visible", { hasText: new RegExp(`^\\s*${text}\\s*$`) }).first();

/** Types one COPage text block: headings, paragraphs and bullet lists, in order. */
async function writeBlocks(blocks) {
  await page.locator('button[aria-label="Add Content"]').first().click();
  await page.locator("text=Insert Text").first().click();
  await page.waitForTimeout(1800);
  const editor = page.frames().find((f) => f.url() === "about:srcdoc");
  if (!editor) throw new Error("no text editor frame");
  // Toolbar clicks take focus from the editor, so each step re-focuses it at the end.
  const focusEnd = async () => { await editor.locator("body").click(); await page.keyboard.press("Control+End"); };
  for (const block of blocks) {
    if (block.h2 !== undefined) {
      await focusEnd();
      await visible("Standard").click();
      await visible("Headline 2").click();
      await focusEnd();
      await page.keyboard.type(block.h2);
      await page.keyboard.press("Enter");
    } else if (block.p !== undefined) {
      await focusEnd();
      await page.keyboard.type(block.p);
      await page.keyboard.press("Enter");
    } else if (block.ul !== undefined) {
      await focusEnd();
      await page.locator('button[aria-label="Bullet List"]:visible').first().click();
      await focusEnd();
      for (const item of block.ul) {
        await page.keyboard.type(item);
        await page.keyboard.press("Enter");
      }
      await page.keyboard.press("Enter"); // an empty item leaves the list
    }
  }
  await page.locator("button", { hasText: "Finish Text Editing" }).first().click();
  await page.waitForTimeout(1500);
  await page.locator("button", { hasText: "Finish Editing" }).first().click().catch(() => {});
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(800);
}

/** The wiki page's preview text (the student and admin view share the same text). */
async function previewText(ref, title) {
  await page.goto(`${LAB}/goto.php?target=wiki_${ref}_${slug(title)}`).catch(() => {});
  await page.waitForLoadState("domcontentloaded");
  return page.locator("main").first().innerText().catch(() => "");
}

async function seedWiki() {
  let ref = await findWiki();
  if (ref) console.log(`wiki exists: ${WIKI_TITLE} ref ${ref}`);
  else ref = await createWiki();
  await ensureOnline(ref);

  // Start page: the wiki was created with the start page title; fill its content once.
  if (!(await previewText(ref, WIKI_START)).includes("Lab start text")) {
    await page.goto(`${LAB}/ilias.php?baseClass=ilwikihandlergui&cmdClass=ilWikiPageGUI&cmd=edit&ref_id=${ref}&page=${slug(WIKI_START)}`);
    await page.waitForLoadState("domcontentloaded");
    await writeBlocks(START_BLOCKS);
    console.log("wiki start page written");
  } else {
    console.log("wiki start page exists");
  }

  // Each page is made by following the red link on the page before it, then writing its content.
  let source = WIKI_START;
  for (const pageSpec of PAGES) {
    // A written page shows its paragraph; an empty or missing page does not.
    // The rendered text has no [[ ]] brackets; compare with the link text only.
    const marker = pageSpec.blocks.find((b) => b.p).p.replace(/\[\[|\]\]/g, "").slice(0, 30);
    if ((await previewText(ref, pageSpec.title)).includes(marker)) {
      console.log(`wiki page exists: ${pageSpec.title}`);
    } else {
      // A missing page is a red link on the page before it; an empty page is edited via "Edit Page".
      await page.goto(`${LAB}/goto.php?target=wiki_${ref}_${slug(source)}`);
      await page.waitForLoadState("domcontentloaded");
      const red = page.locator("a.ilWikiPageMissing", { hasText: pageSpec.title });
      if (await red.count()) {
        await red.first().click();
      } else {
        await page.goto(`${LAB}/goto.php?target=wiki_${ref}_${slug(pageSpec.title)}`);
        await page.waitForLoadState("domcontentloaded");
        await page.locator("button:visible, a:visible", { hasText: /^\s*Edit Page\s*$/ }).first().click();
      }
      await page.waitForLoadState("domcontentloaded");
      await writeBlocks(pageSpec.blocks);
      console.log(`wiki page written: ${pageSpec.title}`);
    }
    source = pageSpec.title;
  }
  return ref;
}

try {
  await seedGlossary();
  const wiki = await seedWiki();
  console.log(`done: glossary ${GLO_REF}, wiki ${wiki}`);
} finally {
  await browser.close();
}
