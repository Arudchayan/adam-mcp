import assert from "node:assert/strict";
import { createBrowserProvider } from "../../packages/provider-browser/src/browser-provider.ts";
import { createPlaywrightSession } from "../../packages/provider-browser/src/playwright-session.ts";
import { snapshotFromHtml } from "../../packages/provider-browser/src/memory-session.ts";

const folder = "https://adam.unibas.ch/go/fold/100010";
const tab = "https://adam.unibas.ch/ilias.php?baseClass=ilRepositoryGUI&cmdClass=ilObjFolderGUI&cmd=render&ref_id=100010&cmdNode=1:2";
const blank = { ...snapshotFromHtml(folder, "Synthetic folder", '<main><div id="il_center_col"></div></main>', "ILIAS Abmelden"), dom: { itemRows: 0, emptyCopy: false, contentBlank: true } };
const session = createPlaywrightSession();
const opens = [];
const page = {
  async goto(url) { opens.push(url); return null; },
  async waitForFunction() {},
  async evaluate() { return [tab]; },
  locator: () => ({ filter: () => ({ first: () => ({ async click() {} }) }) }),
};
Reflect.set(session, "ensurePage", async () => page);
Reflect.set(session, "rejectIfBlocked", async () => {});
Reflect.set(session, "probeListing", async () => undefined);
Reflect.set(session, "readSnapshot", async () => blank);
let releaseGetter;
const slowerLogoutCheck = new Promise((resolve) => { releaseGetter = resolve; });
let checks = 0;
// Deterministic equivalent of different completion times for the two local
// session-disabled file checks. No real filesystem/profile/browser is touched.
session.explicitlyLoggedOut = async () => {
  if (++checks === 1) await slowerLogoutCheck;
  return false;
};
const provider = createBrowserProvider({ session });
try {
  const getter = provider.getCourse("100010");
  const listing = provider.listChildren("100010").finally(releaseGetter);
  const results = await Promise.allSettled([getter, listing]);
  const codes = results.map((result) => result.status === "rejected" ? result.reason.code : "success");
  assert.deepEqual(codes, ["unsupported_type", "provider_unavailable"]);
  console.log(JSON.stringify({ synthetic: true, codes, navigations: opens.length, opens, diagnosis: "Correct error taxonomy; the existing three-navigation assertion depends on uncoordinated scheduling." }, null, 2));
  // Deliberately reproduce the existing test's failing assertion, outside normal discovery.
  assert.deepEqual(opens, [folder.replace("/fold/", "/crs/"), folder, tab]);
} finally {
  await provider.close();
}
