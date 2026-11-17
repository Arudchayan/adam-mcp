// Captures the student-view fixtures for the lm, htlm and copa readers (ADR 0062) from the lab.
// Run after seed-lm-htlm-copa.mjs. Usage (from the repo root): node tools/ilias-lab/seed/capture-lm-htlm-copa.mjs
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { labPage, saveLabFixture, cleanLabHtml, LAB } from "./lab-page.mjs";

const FIXTURES = fileURLToPath(new URL("../../../packages/provider-browser/fixtures/lab/", import.meta.url));
const { browser, page } = await labPage("student");
try {
  const captures = [
    ["lm-start-student", `${LAB}/goto.php?target=lm_93`],
    ["lm-page-student", `${LAB}/ilias.php?baseClass=illmpresentationgui&cmd=layout&ref_id=93&obj_id=7`],
    ["htlm-info-student", `${LAB}/goto.php?target=htlm_94`],
    ["copa-view-student", `${LAB}/goto.php?target=copa_92`],
  ];
  for (const [name, url] of captures) {
    await page.goto(url);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);
    console.log(name, await saveLabFixture(name, page));
  }
  // The HTML module's start file is delivered on its own page through the presentation route
  // (ilias.php?baseClass=ilHTLMPresentationGUI redirects to deliver.php). The delivery URL carries a
  // per-session token, so the fixture records the ILIAS route instead of the delivered address.
  await page.goto(`${LAB}/ilias.php?baseClass=ilHTLMPresentationGUI&ref_id=94`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(500);
  // The lab's PHP build prints an output-buffer notice ahead of the delivered file; it is not content.
  const html = cleanLabHtml(await page.content()).replace(/<br>\n<b>Notice<\/b>:[^\n]*<br>\n/g, "");
  const route = `${LAB}/ilias.php?baseClass=ilHTLMPresentationGUI&ref_id=94`;
  await writeFile(`${FIXTURES}htlm-start-student.json`, JSON.stringify({ name: "htlm-start-student", source: "ILIAS 10.12 lab (tools/ilias-lab), seed data", url: route, html }, null, 1) + "\n");
  console.log("htlm-start-student", { chars: html.length, delivered: page.url().replace(/\?.*$/, "").replace(/\/deliver\.php\/[^/]+\//, "/deliver.php/<token>/") });
} finally {
  await browser.close();
}
