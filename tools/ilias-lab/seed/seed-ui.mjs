// UI seeding for what ILIAS 10.12 SOAP cannot create: exercise assignments with
// instruction files, deadlines and a sample solution. Drives the local lab only,
// as the lab system admin (lab-users.json). Run after seed.mjs + lab-sql.sh prepare.
// Usage (from the repo root): node tools/ilias-lab/seed/seed-ui.mjs <exercise ref_id>
import { chromium } from "playwright-core";
import config from "./lab-users.json" with { type: "json" };

const LAB = "http://localhost:8080";
const excRef = Number(process.argv[2]);
if (!Number.isInteger(excRef)) throw new Error("usage: seed-ui.mjs <exercise ref_id>");

const DAY = 86_400_000;
// datetime-local value in the lab's wall clock
const at = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 16);
const textFile = (name, text) => ({ name, mimeType: "text/plain", buffer: Buffer.from(text) });

// type: 1 Upload, 4 Team Upload (values from the assignment type selector)
const ASSIGNMENTS = [
  { title: "Lab sheet 1 (past)", type: "1", deadlineDays: -7, instruction: "Past sheet. Read the attached instructions.",
    file: textFile("sheet-1-instructions.txt", "Lab instruction file for sheet 1."), sample: textFile("sheet-1-solution.txt", "Lab sample solution for sheet 1.") },
  { title: "Lab sheet 2 (current)", type: "1", deadlineDays: 7, instruction: "Current sheet with an instruction file.",
    file: textFile("sheet-2-instructions.txt", "Lab instruction file for sheet 2.") },
  { title: "Lab sheet 3 (team)", type: "4", deadlineDays: 14, instruction: "Team upload sheet." },
  { title: "Lab sheet 4 (future)", type: "1", deadlineDays: 21, instruction: "Future sheet without files." },
];

const admin = config.users.find((u) => u.role === "system");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
try {
  await page.goto(`${LAB}/login.php?cmd=force_login&lang=en`);
  await page.fill('input[name="login_form/input_3/input_4"]', admin.login);
  await page.fill('input[name="login_form/input_3/input_5"]', admin.password);
  await page.press('input[name="login_form/input_3/input_5"]', "Enter");
  await page.waitForLoadState("domcontentloaded");

  const listUrl = `${LAB}/ilias.php?baseClass=ilexercisehandlergui&cmdClass=ilExAssignmentEditorGUI&cmd=listAssignments&ref_id=${excRef}`;
  for (const a of ASSIGNMENTS) {
    await page.goto(listUrl);
    if ((await page.content()).includes(a.title)) { console.log(`exists: ${a.title}`); continue; }
    await page.selectOption("select[name=type]", a.type);
    await page.locator("form:has(select[name=type]) input[type=submit], form:has(select[name=type]) button").first().click();
    await page.waitForLoadState("domcontentloaded");
    await page.fill("input[name=title]", a.title);
    await page.fill("textarea[name=instruction]", a.instruction);
    if (a.file) await page.setInputFiles("input[name='files[0]']", a.file);
    await page.check("input[name=deadline_mode][value='0']");
    await page.fill("input[name=deadline]", at(a.deadlineDays));
    if (a.sample) {
      await page.check("input[name=fb]");
      await page.setInputFiles("input[name=fb_file]", a.sample);
      await page.check("input[name=fb_date][value='1']");
    }
    await page.locator("input[name='cmd[saveAssignment]']").first().click();
    await page.waitForLoadState("domcontentloaded");
    const errors = await page.locator(".alert-danger, .c-alert--error, .help-block.alert, .il-input-error").allTextContents();
    console.log(errors.length ? `FAILED: ${a.title}: ${errors.join(" | ").replace(/\s+/g, " ").slice(0, 200)}` : `created: ${a.title}`);
  }
  await page.goto(listUrl);
  const content = await page.content();
  console.log(`assignments present: ${ASSIGNMENTS.filter((a) => content.includes(a.title)).length}/${ASSIGNMENTS.length}`);
} finally {
  await browser.close();
}
