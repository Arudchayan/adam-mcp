// Seeds the three ILIAS 10.12 lab objects this reader set needs, through the lab UI as
// the lab system admin (never ADAM). Idempotent: each step checks the current page first.
//   learning module (ref 93): 2 chapters x 2 pages, one paragraph each, online, TOC shows pages
//   HTML module (ref 94):     synthetic zip (index.html + lab-second.html), unzipped, start file index.html
//   content page (ref 92):    two headings (Headline 2 / Headline 1 styles) and paragraphs
// Usage (from the repo root): node tools/ilias-lab/seed/seed-lm-htlm-copa.mjs
import { labPage, LAB } from "./lab-page.mjs";
import { zipStored } from "./zip-stored.mjs";

const LM = 93;
const HTLM = 94;
const COPA = 92;

const CHAPTERS = [
  { title: "Lab Chapter 1", pages: [
    { title: "Lab Page 1.1", text: "Lab page 1.1: synthetic lab text for the learning module reader." },
    { title: "Lab Page 1.2", text: "Lab page 1.2: second synthetic lab text, same chapter." },
  ] },
  { title: "Lab Chapter 2", pages: [
    { title: "Lab Page 2.1", text: "Lab page 2.1 paragraph one. Synthetic lab text for the reader." },
    { title: "Lab Page 2.2", text: "Lab page 2.2: synthetic lab text in the second chapter." },
  ] },
];

const COPA_INTRO = "Lab content page intro. Synthetic lab text for the content page reader.";
const COPA_BLOCKS = [
  { style: "Headline 2", text: "Lab Copa Heading One" },
  { style: "Standard", text: "Lab copa paragraph under heading one." },
  { style: "Headline 1", text: "Lab Copa Heading Two" },
  { style: "Standard", text: "Lab copa paragraph under heading two." },
];

const HTML_START = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Lab HTML start</title></head><body><h1>Lab HTML start</h1><p>Synthetic lab text for the HTML module start page.</p><p><a href=\"lab-second.html\">Second lab page</a></p></body></html>\n";
const HTML_SECOND = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Lab HTML second</title></head><body><h1>Lab HTML second</h1><p>Synthetic lab text for the second HTML page.</p></body></html>\n";

const CONTENT = `${LAB}/ilias.php?baseClass=illmeditorgui&cmdNode=fa:nj:k&cmdClass=ILIAS%5CLearningModule%5CEditing%5CEditSubObjectsGUI&ref_id=${LM}&obj_id=0&sub_type=st`;
const listUrl = (obj) => `${LAB}/ilias.php?baseClass=illmeditorgui&cmdNode=fa:nj:za:k&cmdClass=ILIAS%5CLearningModule%5CEditing%5CEditSubObjectsGUI&cmd=list&ref_id=${LM}&obj_id=${obj}&sub_type=pg`;
const pageEditUrl = (obj) => `${LAB}/ilias.php?baseClass=illmeditorgui&cmdNode=fa:nj:fj:fi&cmdClass=ilLMPageGUI&cmd=edit&ref_id=${LM}&obj_id=${obj}`;
const copaEditUrl = `${LAB}/ilias.php?baseClass=ilrepositorygui&cmdNode=wq:lr:91&cmdClass=ilContentPagePageGUI&cmd=edit&ref_id=${COPA}`;
const htlmListUrl = `${LAB}/ilias.php?baseClass=ilrepositorygui&cmdNode=wq:mi:8s&cmdClass=ilContainerResourceGUI&ref_id=${HTLM}`;

const { browser, page } = await labPage("system");
const settle = () => page.waitForLoadState("domcontentloaded");
const bodyText = async () => (await page.locator("#il_center_col, main").first().innerText()).replace(/\s+/g, " ");

/** Obj id of the first link with exactly this text (chapter or page rows). */
const objIdOf = (title) => page.evaluate((t) => {
  const a = [...document.querySelectorAll("a[href]")].find((x) => x.textContent.trim() === t && /obj_id=\d+/.test(x.getAttribute("href")));
  return a ? Number(a.getAttribute("href").match(/obj_id=(\d+)/)[1]) : undefined;
}, title);

/** Clicks a visible button by its exact trimmed text (ILIAS adds icon/caret whitespace). */
const clickButton = (text) => page.evaluate((t) => {
  const b = [...document.querySelectorAll("button")].find((x) => x.offsetParent && x.textContent.trim() === t);
  if (!b) throw new Error(`no button ${t}`);
  b.click();
}, text);

async function ensureChapter(title) {
  await page.goto(CONTENT); await settle();
  if (!(await objIdOf(title))) {
    await clickButton("Insert chapter");
    await page.waitForTimeout(800);
    await page.locator('input[name="form/input_0"]').first().fill(title);
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await settle();
    await page.goto(CONTENT); await settle();
  }
  return objIdOf(title);
}

async function ensurePage(chapterObj, title) {
  await page.goto(listUrl(chapterObj)); await settle();
  if (!(await objIdOf(title))) {
    await clickButton("Insert page");
    await page.waitForTimeout(800);
    await page.locator('input[name="form/input_0"]').first().fill(title);
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await settle();
    await page.goto(listUrl(chapterObj)); await settle();
  }
  return objIdOf(title);
}

async function ensurePageText(pageObj, text) {
  await page.goto(pageEditUrl(pageObj)); await settle();
  await page.waitForTimeout(500);
  if ((await bodyText()).includes(text)) return "exists";
  await page.getByText("Click here to add content.").first().click();
  await page.waitForTimeout(800);
  await page.getByText("Insert Text", { exact: true }).first().click();
  await page.waitForTimeout(2000);
  await page.frameLocator("iframe[id$='tinytarget_ifr'], iframe.tox-edit-area__iframe").first().locator("body").click();
  await page.keyboard.type(text);
  await page.getByRole("button", { name: "Finish Text Editing" }).first().click();
  await settle();
  await page.waitForTimeout(800);
  await page.goto(pageEditUrl(pageObj)); await settle();
  return (await bodyText()).includes(text) ? "added" : "FAILED";
}

async function ensureLearningModule() {
  for (const chapter of CHAPTERS) {
    const chapterObj = await ensureChapter(chapter.title);
    for (const p of chapter.pages) {
      const pageObj = await ensurePage(chapterObj, p.title);
      console.log(`lm ${chapter.title} / ${p.title}: obj ${pageObj}, text ${await ensurePageText(pageObj, p.text)}`);
    }
  }
  // Show pages in the student's table of contents, not only chapters.
  await page.goto(`${LAB}/ilias.php?baseClass=illmeditorgui&cmdNode=fa:nj&cmdClass=ilObjLearningModuleGUI&cmd=properties&ref_id=${LM}&sub_type=st`); await settle();
  const tocSelect = page.locator("select[name=toc_mode]");
  if ((await tocSelect.inputValue()) !== "pages") {
    await tocSelect.selectOption({ label: "Chapters and Pages" });
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await settle();
    console.log("lm toc_mode set to Chapters and Pages");
  }
}

async function ensureHtmlModule() {
  await page.goto(htlmListUrl); await settle();
  let listing = await bodyText();
  if (!/index\.html/.test(listing)) {
    if (!/lab-htlm\.zip/.test(listing)) {
      const zip = zipStored([{ name: "index.html", text: HTML_START }, { name: "lab-second.html", text: HTML_SECOND }]);
      await page.locator("input[type=file]").first().setInputFiles({ name: "lab-htlm.zip", mimeType: "application/zip", buffer: zip });
      await page.getByRole("button", { name: "Select Files", exact: true }).first().click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(3000);
      await page.getByRole("button", { name: "Save", exact: true }).first().click();
      await settle();
      await page.goto(htlmListUrl); await settle();
    }
    const unzip = await page.evaluate(() => [...document.querySelectorAll("button, a")].map((a) => a.getAttribute("data-action") || a.getAttribute("href") || "").find((h) => /cmd=unzip/.test(h)));
    if (unzip) { await page.goto(unzip); await settle(); }
    await page.goto(htlmListUrl); await settle();
    listing = await bodyText();
  }
  console.log("htlm files listed:", /index\.html/.test(listing) && /lab-second\.html/.test(listing));
  // Start file: the row action sets lm_path to hex(index.html) = 696e6465782e68746d6c.
  const setStart = await page.evaluate(() => [...document.querySelectorAll("button, a")].map((a) => a.getAttribute("data-action") || a.getAttribute("href") || "").find((h) => /cmd=setStartFile/.test(h) && /696e6465782e68746d6c/.test(h)));
  await page.goto(`${LAB}/ilias.php?baseClass=ilrepositorygui&cmdNode=wq:mi:es&cmdClass=ilinfoscreengui&cmd=showSummary&ref_id=${HTLM}`); await settle();
  if (/No Start File/.test(await bodyText()) && setStart) {
    await page.goto(setStart); await settle();
  }
  await page.goto(`${LAB}/ilias.php?baseClass=ilrepositorygui&cmdNode=wq:mi:es&cmdClass=ilinfoscreengui&cmd=showSummary&ref_id=${HTLM}`); await settle();
  console.log("htlm start file:", /No Start File/.test(await bodyText()) ? "MISSING" : "set");
}

/** The class list of the rendered paragraph holding this text (ILIAS text-block styles). */
const styleOf = (text) => page.evaluate((t) => { const el = [...document.querySelectorAll("p, h1, h2, h3, h4")].find((x) => x.textContent.includes(t)); return el ? el.className : ""; }, text);

/** Applies a paragraph style from the editor's style dropdown to the paragraph under the caret. */
async function clickStyle(style) {
  await page.locator("button.dropdown-toggle", { hasText: /^Standard/ }).first().click();
  await page.waitForTimeout(500);
  await page.locator("button:visible", { hasText: new RegExp(`^${style}$`) }).first().click();
  await page.waitForTimeout(500);
}

async function ensureContentPage() {
  await page.goto(copaEditUrl); await settle();
  await page.waitForTimeout(500);
  if (!(await bodyText()).includes(COPA_INTRO)) {
    await page.getByText("Click here to add content.").first().click();
    await page.waitForTimeout(800);
    await page.getByText("Insert Text", { exact: true }).first().click();
    await page.waitForTimeout(2000);
    await page.frameLocator("iframe[id$='tinytarget_ifr'], iframe.tox-edit-area__iframe").first().locator("body").click();
    await page.keyboard.type(COPA_INTRO);
    await page.getByRole("button", { name: "Finish Text Editing" }).first().click();
    await settle();
    await page.goto(copaEditUrl); await settle();
  }
  const editor = page.frameLocator("iframe[id$='tinytarget_ifr'], iframe.tox-edit-area__iframe").first().locator("body");
  for (const block of COPA_BLOCKS) {
    // New blocks are typed after the intro paragraph; Enter starts the paragraph.
    if (!(await bodyText()).includes(block.text)) {
      await page.getByText("Lab content page intro").first().click();
      await page.waitForTimeout(1200);
      await editor.click();
      await page.keyboard.press("Control+End");
      await page.keyboard.press("Enter");
      await page.keyboard.type(block.text);
      await page.getByRole("button", { name: "Finish Text Editing" }).first().click();
      await settle();
      await page.goto(copaEditUrl); await settle();
    }
    if (block.style !== "Standard" && !(await styleOf(block.text)).includes("Headline")) {
      await page.getByText(block.text).first().click();
      await page.locator("iframe[id$='tinytarget_ifr']").first().waitFor({ timeout: 10000 });
      await page.waitForTimeout(1200);
      await editor.click();
      await clickStyle(block.style);
      await page.getByRole("button", { name: "Finish Text Editing" }).first().click();
      await settle();
      await page.goto(copaEditUrl); await settle();
    }
  }
  console.log(`copa: ${COPA_BLOCKS.length} blocks checked`);
}

try {
  await ensureLearningModule();
  await ensureHtmlModule();
  await ensureContentPage();
} finally {
  await browser.close();
}
