// Shared helpers for seeding and capturing the local ILIAS 10.12 lab (tools/ilias-lab).
// Lab-only: http://localhost:8080 and the lab users in lab-users.json. Never point this at ADAM.
//
//   import { labPage, saveLabFixture, LAB } from "./lab-page.mjs";
//   const { browser, page } = await labPage("student");
//   await page.goto(`${LAB}/goto.php?target=wiki_95`);
//   await saveLabFixture("wiki-start-student", page);
//   await browser.close();
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import config from "./lab-users.json" with { type: "json" };

export const LAB = "http://localhost:8080";
const FIXTURES = fileURLToPath(new URL("../../../packages/provider-browser/fixtures/lab/", import.meta.url));

/** Signs in as the first lab user with `role` ("student", "tutor", "admin", "system"); `which` picks the nth. */
export async function labPage(role = "student", which = 0, options = {}) {
  const user = config.users.filter((u) => u.role === role)[which];
  if (!user) throw new Error(`no lab user with role ${role} #${which}`);
  const browser = await chromium.launch({ channel: "chrome", headless: options.headless ?? true });
  const page = await browser.newPage();
  await page.goto(`${LAB}/login.php?cmd=force_login&lang=en`);
  await page.fill('input[name="login_form/input_3/input_4"]', user.login);
  await page.fill('input[name="login_form/input_3/input_5"]', user.password);
  await page.press('input[name="login_form/input_3/input_5"]', "Enter");
  await page.waitForLoadState("domcontentloaded");
  return { browser, page, user };
}

/** Strips scripts, styles, inline SVG and CSRF tokens; keeps markup. */
export function cleanLabHtml(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, "")
    .replace(/(rtoken(?:=|%3D))[a-f0-9]{16,}/gi, "$1lab-token")
    .replace(/\s(rtoken|token)="[a-f0-9]{16,}"/gi, ' $1="lab-token"');
}

/**
 * Saves the page as packages/provider-browser/fixtures/lab/<name>.json, shaped
 * { name, source, url, html }. Tests rebase `http://localhost:8080` onto https://adam.unibas.ch.
 */
export async function saveLabFixture(name, page) {
  if (!/^[a-z0-9-]{3,80}$/.test(name)) throw new Error(`fixture name must be kebab-case: ${name}`);
  const html = cleanLabHtml(await page.content());
  const url = page.url().replace(/[?&]rtoken=[^&]+/g, "");
  await writeFile(`${FIXTURES}${name}.json`, JSON.stringify({ name, source: "ILIAS 10.12 lab (tools/ilias-lab), seed data", url, html }, null, 1) + "\n");
  return { name, chars: html.length };
}
