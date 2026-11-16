// Create the object types ILIAS 10.12 SOAP cannot (htlm never lands in the tree;
// dcl fails in SOAP) through the course's "Add New Item" menu, as the lab system
// admin. Usage (from the repo root): node tools/ilias-lab/seed/seed-objects-ui.mjs <course ref_id>
import { chromium } from "playwright-core";
import config from "./lab-users.json" with { type: "json" };

const LAB = "http://localhost:8080";
const courseRef = Number(process.argv[2]);
if (!Number.isInteger(courseRef)) throw new Error("usage: seed-objects-ui.mjs <course ref_id>");
const TYPES = ["htlm", "dcl"];

const admin = config.users.find((u) => u.role === "system");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
try {
  await page.goto(`${LAB}/login.php?cmd=force_login&lang=en`);
  await page.fill('input[name="login_form/input_3/input_4"]', admin.login);
  await page.fill('input[name="login_form/input_3/input_5"]', admin.password);
  await page.press('input[name="login_form/input_3/input_5"]', "Enter");
  await page.waitForLoadState("domcontentloaded");
  for (const type of TYPES) {
    const title = `Lab ${type}`;
    await page.goto(`${LAB}/goto.php?target=crs_${courseRef}`);
    if ((await page.content()).includes(`>${title}<`)) { console.log(`exists: ${title}`); continue; }
    // The same create route the course's "Add New Item" menu advertises.
    await page.goto(`${LAB}/ilias.php?baseClass=ilrepositorygui&ref_id=${courseRef}&cmd=create&new_type=${type}`);
    await page.waitForLoadState("domcontentloaded");
    await page.fill('input[name="form/input_0/input_1"]', title);
    await page.fill('textarea[name="form/input_0/input_2"]', "Lab seed");
    await page.locator("button", { hasText: /^\s*(Add|Create) / }).first().click();
    await page.waitForLoadState("domcontentloaded");
    console.log(`created: ${title} -> ${(await page.title()).slice(0, 50)}`);
  }
} finally {
  await browser.close();
}
