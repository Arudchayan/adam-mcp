import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBrowserProvider } from "./browser-provider.ts";
import { extractCatalog } from "./extract.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

// Synthetic URL-contract tests only: no new live fixture, icon rule, or
// destination schema. The inventory/capture gate for #84 remains unmet.
const folderUrl = "https://adam.unibas.ch/go/fold/100010";
const webUrl = "https://adam.unibas.ch/go/webr/100050";
const fetchedAt = "2026-11-11T00:00:00.000Z";
const typedHrefs = [
  "/go/webr/100050",
  "/goto_adam_webr_100050.html",
  "/goto.php?target=webr_100050",
  "/ilias.php?ref_id=100050&amp;cmdClass=ilobjlinkresourcegui",
  "/ilias.php?ref_id=100050&amp;cmdClass=ilobjweblinkgui",
];

describe("Web Link existing URL contract (#84)", () => {
  for (const href of typedHrefs) {
    it(`lists an explicitly typed href with an ADAM citation: ${href}`, async () => {
      const snapshot = snapshotFromHtml(
        folderUrl,
        "Synthetic folder",
        `<main><h1>Synthetic folder</h1><a href="${href}">Synthetic resource</a></main>`,
        "Synthetic folder Synthetic resource Abmelden",
      );
      const opened: string[] = [];
      const session = createMemorySession({ [folderUrl]: snapshot }, { onOpen: (url) => opened.push(url) });
      const provider = createBrowserProvider({ session });
      try {
        const listed = await provider.listChildren("100010", { type: "fold" });
        assert.equal(listed.listingState, "ok");
        assert.equal(listed.items.length, 1);
        const item = listed.items[0]!;
        assert.equal(item.type, "webr");
        assert.equal(item.refId, "100050");
        assert.equal(item.url, webUrl);
        assert.equal(item.provenance.provider, "browser");
        assert.equal(item.provenance.sourceUrl, href.replaceAll("&amp;", "&"));
        assert.deepEqual(opened, [folderUrl]);
      } finally {
        await provider.close();
      }
    });
  }

  it("keeps the typed duplicate in either order, with the typed source provenance", () => {
    const unknown = '<a href="/ilias.php?ref_id=100050">Synthetic resource</a>';
    const typed = '<a href="/go/webr/100050">Synthetic resource</a>';
    for (const anchors of [unknown + typed, typed + unknown]) {
      const catalog = extractCatalog(
        snapshotFromHtml(folderUrl, "Synthetic folder", `<main>${anchors}</main>`, ""),
        fetchedAt,
      );
      assert.equal(catalog.objects.length, 1);
      assert.equal(catalog.objects[0]?.type, "webr");
      assert.equal(catalog.objects[0]?.url, webUrl);
      assert.equal(catalog.objects[0]?.provenance.sourceUrl, "/go/webr/100050");
      assert.equal(catalog.objects[0]?.provenance.fetchedAt, fetchedAt);
    }
  });

  it("does not infer Web Link type from a title or a nearby external link", () => {
    const catalog = extractCatalog(
      snapshotFromHtml(
        folderUrl,
        "Synthetic folder",
        `<main>
          <a href="/ilias.php?ref_id=100050">Web Link: Synthetic resource</a>
          <a href="https://materials.example/go/webr/100050">Linked PDF</a>
        </main>`,
        "Web Link: Synthetic resource Linked PDF",
      ),
      fetchedAt,
    );
    assert.equal(catalog.objects.length, 1);
    assert.equal(catalog.objects[0]?.type, "unknown");
    assert.equal(catalog.objects[0]?.url, "https://adam.unibas.ch/ilias.php?ref_id=100050");
  });

  it("reads an unknown ref resolved by an ADAM page URL without fetching external links", async () => {
    // Unknown hints use the existing probe order; the ADAM landing URL, not
    // the probed type, establishes identity. No new webr probe is added.
    const probeUrl = "https://adam.unibas.ch/go/crs/100050";
    const snapshot = snapshotFromHtml(
      webUrl,
      "Synthetic resource",
      '<main><h1>Synthetic resource</h1><a href="https://materials.example/resource.pdf">Synthetic target</a></main>',
      "Synthetic resource Synthetic target Abmelden",
    );
    const opened: string[] = [];
    const session = createMemorySession({ [probeUrl]: snapshot }, { onOpen: (url) => opened.push(url) });
    // Fail if a page read attempts a file/probe path, not just a navigation.
    session.fetchAuthorized = async () => { throw new Error("Unexpected byte fetch"); };
    session.probeAuthorized = async () => { throw new Error("Unexpected metadata probe"); };
    const provider = createBrowserProvider({ session });
    try {
      const page = await provider.readPage("100050", { type: "unknown" });
      assert.equal(page.type, "webr");
      assert.equal(page.url, webUrl);
      assert.equal(page.text, snapshot.text);
      assert.equal(page.provenance.sourceUrl, webUrl);
      assert.equal(page.provenance.provider, "browser");
      assert.deepEqual(opened, [probeUrl]);
    } finally {
      await provider.close();
    }
  });
});
