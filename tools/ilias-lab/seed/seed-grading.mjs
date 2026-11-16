// Seed student submissions and tutor evaluations in the local lab, through the web
// UI (SOAP has no submission or grading calls). Run after seed-ui.mjs.
// Usage (from the repo root): node tools/ilias-lab/seed/seed-grading.mjs <exercise ref_id>
import { chromium } from "playwright-core";
import config from "./lab-users.json" with { type: "json" };

const LAB = "http://localhost:8080";
const excRef = Number(process.argv[2]);
if (!Number.isInteger(excRef)) throw new Error("usage: seed-grading.mjs <exercise ref_id>");
const SHEET = "Lab sheet 2 (current)";
// Evaluation per student login: status value and statement text (lab-only content).
const EVALUATIONS = {
  "lab.student": { status: "passed", statement: "Lab tutor feedback: good work, all tasks solved." },
  "lab.student2": { status: "failed", statement: "Lab tutor feedback: task 2 is missing." },
};

// `lab.student` must not also match `lab.student2`.
const exactLogin = (loginName) => new RegExp(loginName.replace(/\./g, "\\.") + "(?![\\w.])");

const browser = await chromium.launch({ channel: "chrome", headless: true });
const login = async (role, which = 0) => {
  const user = config.users.filter((u) => u.role === role)[which];
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${LAB}/login.php?cmd=force_login&lang=en`);
  await page.fill('input[name="login_form/input_3/input_4"]', user.login);
  await page.fill('input[name="login_form/input_3/input_5"]', user.password);
  await page.press('input[name="login_form/input_3/input_5"]', "Enter");
  await page.waitForLoadState("domcontentloaded");
  return { page, context, user };
};

try {
  // --- students submit ------------------------------------------------------
  for (const which of [0, 1]) {
    const { page, context, user } = await login("student", which);
    await page.goto(`${LAB}/goto.php?target=exc_${excRef}`);
    const item = page.locator("main .il-item", { hasText: SHEET }).first();
    const route = await item.locator("[data-action*='submissionScreen']").first().getAttribute("data-action");
    await page.goto(new URL(route, LAB).href);
    if ((await page.content()).includes(`${user.login}-submission.txt`)) { console.log(`exists: submission by ${user.login}`); await context.close(); continue; }
    await page.locator("main button", { hasText: "Upload File" }).first().click();
    await page.waitForLoadState("domcontentloaded");
    await page.locator("input[type=file]").first().setInputFiles({ name: `${user.login}-submission.txt`, mimeType: "text/plain", buffer: Buffer.from(`Lab submission by ${user.login}.`) });
    await page.waitForTimeout(2500);
    await page.locator("main button", { hasText: "Save" }).first().click();
    await page.waitForLoadState("domcontentloaded");
    const ok = (await page.locator(".alert-success, .c-alert--success, [role=alert]").allTextContents()).join(" ");
    console.log(`${/uploaded/i.test(ok) ? "submitted" : "submission FAILED"}: ${user.login}`);
    await context.close();
  }

  // --- tutor evaluates --------------------------------------------------------
  const { page, context } = await login("tutor");
  const openSheet = async () => {
    await page.goto(`${LAB}/goto.php?target=exc_${excRef}`);
    await page.locator("#ilTab a", { hasText: "Submissions and Grades" }).first().click();
    await page.waitForLoadState("domcontentloaded");
    const option = await page.locator("select[name=ass_id] option", { hasText: SHEET }).first().getAttribute("value");
    await page.selectOption("select[name=ass_id]", option);
    await page.locator("[name='cmd[selectAssignment]']").first().click();
    await page.waitForLoadState("domcontentloaded");
  };
  await openSheet();
  const ids = Object.fromEntries(await Promise.all(Object.keys(EVALUATIONS).map(async (loginName) => {
    const row = page.locator("table tbody tr", { hasText: exactLogin(loginName) }).first();
    const name = await row.locator("select[name^='status[']").getAttribute("name").catch(() => null);
    return [loginName, name?.match(/\[(\d+)\]/)?.[1]];
  })));
  for (const [loginName, { status }] of Object.entries(EVALUATIONS)) {
    if (!ids[loginName]) { console.log(`not listed for grading: ${loginName}`); continue; }
    await page.selectOption(`select[name='status[${ids[loginName]}]']`, status);
  }
  await page.locator("[name='cmd[saveStatusAll]']").first().click();
  await page.waitForLoadState("domcontentloaded");
  console.log(`status saved: ${JSON.stringify(Object.fromEntries(Object.entries(EVALUATIONS).map(([k, v]) => [k, v.status])))}`);

  for (const [loginName, { statement }] of Object.entries(EVALUATIONS)) {
    if (!ids[loginName]) continue;
    await openSheet();
    const row = page.locator("table tbody tr", { hasText: exactLogin(loginName) }).first();
    // The statement action sits in the row's actions dropdown.
    await row.locator("button.dropdown-toggle, .dropdown > button").first().click();
    await row.locator("button", { hasText: "Write Evaluation Statement" }).first().click();
    const textarea = page.locator(".modal.show textarea, .modal.in textarea, dialog[open] textarea, .il-modal-roundtrip textarea").first();
    await textarea.waitFor({ state: "visible", timeout: 10_000 });
    await textarea.fill(statement);
    await page.locator(".modal.show button, .modal.in button, dialog[open] button, .il-modal-roundtrip button").filter({ hasText: /^Save$|Save/ }).first().click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);
    console.log(`statement written: ${loginName}`);
  }
  await context.close();
} finally {
  await browser.close();
}
