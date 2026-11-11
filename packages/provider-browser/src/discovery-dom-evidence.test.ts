import assert from "node:assert/strict";
import { it } from "node:test";
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserProvider } from "./browser-provider.ts";
import { createPlaywrightSession } from "./playwright-session.ts";
import { extractCatalog, mergeFrameLinks } from "./extract.ts";
import { snapshotFromHtml } from "./memory-session.ts";

it("a chrome duplicate cannot mask a same-origin frame's content link", () => {
  const link = { href: "https://adam.unibas.ch/go/file/710002", text: "Sheet", inChrome: true, inBreadcrumb: false };
  assert.deepEqual(mergeFrameLinks([link], [{ ...link, inChrome: false }]), [{ ...link, inChrome: false }]);
  assert.deepEqual(mergeFrameLinks([{ ...link, inBreadcrumb: true }], [{ ...link, inChrome: false }]),
    [{ ...link, inBreadcrumb: true }, { ...link, inChrome: false }]);
});

async function temporaryProfile(): Promise<string> {
  const root = join(tmpdir(), "opencode");
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, "adam-discovery-test-"));
}

it("intercepted Chrome retains parsed identities from scrubbed captured dashboard and course layouts", { skip: process.env.ADAM_TEST_CHROME !== "1" }, async (t) => {
  const profileDir = await temporaryProfile();
  t.after(() => rm(profileDir, { recursive: true, force: true }));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    let html = "";
    await context.route("**/*", async (route) => {
      if (route.request().url() !== "https://adam.unibas.ch/go/crs/710001") return route.abort();
      await route.fulfill({ contentType: "text/html", body: html });
    });
    const page = await context.newPage();
    const session = createPlaywrightSession({ profileDir });
    Reflect.set(session, "ensurePage", async () => page);
    try {
      for (const name of ["dashboard", "course-multimedia"]) {
        const fixture = JSON.parse(readFileSync(new URL(`../fixtures/live/${name}.json`, import.meta.url), "utf8"));
        html = fixture.html;
        const original = extractCatalog(snapshotFromHtml(fixture.url, fixture.title, html, fixture.text), "");
        const expected = original.objects.filter((item) => name === "dashboard" ? item.type === "crs" : item.type !== "tst").map((item) => item.refId).sort();
        assert.notDeepEqual(expected, [], `${name} fixture must contain identities`);
        const snapshot = await session.open("https://adam.unibas.ch/go/crs/710001");
        const actual = extractCatalog(snapshot, "").objects.filter((item) => name === "dashboard" ? item.type === "crs" : item.type !== "tst").map((item) => item.refId).sort();
        assert.deepEqual(actual, expected, name);
      }
    } finally { await session.close(); }
  } finally { await browser.close(); }
});

it("intercepted DOM correlates listing rows and identities within content regions", { skip: process.env.ADAM_TEST_CHROME !== "1" }, async (t) => {
  const profileDir = await temporaryProfile();
  t.after(() => rm(profileDir, { recursive: true, force: true }));
  const origin = "https://adam.unibas.ch";
  const course = `${origin}/go/crs/710001`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    let content = "";
    let frameContent = '<main><div id="il_center_col"><div class="ilContainerListItemOuter"><a href="/go/file/710002">Frame.pdf</a></div></div></main>';
    const requests: string[] = [];
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      requests.push(url);
      if (url !== course && url !== `${origin}/frame`) return route.abort();
      return route.fulfill({ contentType: "text/html", body: url.endsWith("/frame")
        ? frameContent
        : content });
    });
    const page = await context.newPage();
    const cases = [
      { html: '<main><div id="il_center_col"><div class="ilContainerListItemOuter">Unparsed row</div></div><aside><a href="/go/file/710099">Sidebar</a></aside></main>', state: "unknown", refs: [] },
      { html: '<main><div id="il_center_col"><div class="ilContainerListItemOuter">Unparsed row</div><nav><a href="/go/file/710099">Navigation</a></nav><a href="/go/crs/710098">Unrelated</a></div></main>', state: "unknown", refs: [] },
      { html: '<main><div id="il_center_col"><div class="ilContainerListItemOuter"><a href="/go/file/710002">Sheet.pdf</a></div><nav aria-label="Breadcrumb"><a href="/go/file/710099">Crumb</a></nav></div></main>', state: "ok", refs: ["710002"] },
      { html: '<main><div id="il_center_col"><a href="/go/file/710002">Standalone.pdf</a></div></main>', state: "ok", refs: ["710002"] },
      { html: '<main><div id="il_center_col">This folder is empty.</div></main><aside><a href="/go/file/710099">Sidebar</a></aside>', state: "empty", refs: [] },
      { html: '<main><div id="il_center_col"><iframe src="/frame"></iframe></div></main>', state: "ok", refs: ["710002"] },
    ];
    for (const entry of cases) {
      content = `<title>Course</title>${entry.html}`;
      const session = createPlaywrightSession({ profileDir });
      Reflect.set(session, "ensurePage", async () => page);
      const provider = createBrowserProvider({ session });
      try {
        const result = await provider.listChildren("710001", { type: "crs" });
        assert.equal(result.listingState, entry.state, entry.html);
        assert.deepEqual(result.items.map((item) => item.refId), entry.refs, entry.html);
      } finally { await provider.close(); }
    }
    frameContent = '<main><div id="il_center_col"><div class="ilContainerListItemOuter">Unparsed frame row</div></div></main>';
    content = '<title>Course</title><main><a href="/go/crs/710099">Unrelated shell link</a><iframe src="/frame"></iframe></main>';
    const session = createPlaywrightSession({ profileDir });
    Reflect.set(session, "ensurePage", async () => page);
    const provider = createBrowserProvider({ session });
    try {
      const result = await provider.listChildren("710001", { type: "crs" });
      assert.equal(result.listingState, "unknown");
      assert.deepEqual(result.items, []);
    } finally { await provider.close(); }
    assert.deepEqual(requests, [course, course, course, course, course, course, `${origin}/frame`, course, `${origin}/frame`]);
  } finally { await browser.close(); }
});
