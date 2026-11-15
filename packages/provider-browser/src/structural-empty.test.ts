import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chromium } from "playwright-core";
import { classifyListing } from "./extract.ts";
import { snapshotFromHtml } from "./memory-session.ts";
import { LISTING_PROBE_SCRIPT, mergeListingProbes } from "./playwright-session.ts";

const blank = { itemRows: 0, emptyCopy: false, contentBlank: true };

describe("ADR 0050: structurally empty folders (#86)", () => {
  it("is structurally empty only for a single main document with no content children and object tabs", () => {
    assert.equal(mergeListingProbes([{ ...blank, contentNoElements: true, objectTabs: 3 }])?.structurallyEmpty, true);
    assert.equal(mergeListingProbes([{ ...blank, contentNoElements: false, objectTabs: 3 }])?.structurallyEmpty, undefined, "wrapper-only blank");
    assert.equal(mergeListingProbes([{ ...blank, contentNoElements: true, objectTabs: 0 }])?.structurallyEmpty, undefined, "no object tabs");
    assert.equal(mergeListingProbes([{ ...blank, contentNoElements: true, objectTabs: 3 }, blank])?.structurallyEmpty, undefined, "a content frame exists");
    assert.equal(mergeListingProbes([{ ...blank, itemRows: 2, contentNoElements: false, objectTabs: 3 }])?.structurallyEmpty, undefined);
  });

  const page = (url: string) => snapshotFromHtml(url, "Folder", `<main><div id="il_center_col"></div></main>`, "Folder");

  it("classifies a structurally empty folder as empty with its own notice", () => {
    const listing = classifyListing({ ...page("https://adam.unibas.ch/go/fold/100020"), dom: { itemRows: 0, emptyCopy: false, contentBlank: true, structurallyEmpty: true } }, 0);
    assert.equal(listing.state, "empty");
    assert.equal(listing.signals.structurallyEmpty, true);
    assert.match(listing.notice ?? "", /no child objects are visible to this account/);
  });

  it("keeps courses, wrapper-only blanks and failure pages unknown", () => {
    const signal = { itemRows: 0, emptyCopy: false, contentBlank: true, structurallyEmpty: true };
    assert.equal(classifyListing({ ...page("https://adam.unibas.ch/go/crs/100001"), dom: signal }, 0).state, "unknown");
    assert.equal(classifyListing({ ...page("https://adam.unibas.ch/go/fold/100020"), dom: { ...signal, structurallyEmpty: undefined } }, 0).state, "unknown");
    const failure = snapshotFromHtml("https://adam.unibas.ch/go/fold/100020", "Failure Message", "<main><div id=\"il_center_col\"></div></main>", "The requested page could not be found.");
    assert.equal(classifyListing({ ...failure, dom: signal }, 0).state, "unknown");
  });
});

// Opt-in disposable Chrome only: synthetic HTML via setContent, no ADAM access.
it("real Chrome probe: childless content root under tabs vs wrapper-only blank", { skip: process.env.ADAM_TEST_CHROME !== "1" }, async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    const tabs = `<ul id="ilTab"><li>Content</li><li>Info</li><li>Permissions</li></ul>`;
    await page.setContent(`<main>${tabs}<div id="il_center_col" class="col-sm-12"></div></main>`);
    assert.deepEqual(mergeListingProbes([await page.evaluate(LISTING_PROBE_SCRIPT) as never])?.structurallyEmpty, true);
    await page.setContent(`<main>${tabs}<div id="il_center_col"><div><div></div></div></div></main>`);
    assert.equal(mergeListingProbes([await page.evaluate(LISTING_PROBE_SCRIPT) as never])?.structurallyEmpty, undefined);
    await page.setContent(`<main><div id="il_center_col"></div></main>`);
    assert.equal(mergeListingProbes([await page.evaluate(LISTING_PROBE_SCRIPT) as never])?.structurallyEmpty, undefined, "no tabs");
  } finally {
    await browser.close();
  }
});
