import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBrowserProvider } from "./browser-provider.ts";
import { extractCatalog } from "./extract.ts";
import { parseFileRows } from "./file-rows.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

// Synthetic rows: structure follows the scrubbed ILIAS 10.12 course capture
// (fixtures/live/course-multimedia.json, ilObjListRow / il_ContainerListItem),
// property values follow the #122 report ("pdf 184.8 KB 12. Oct 2026, 17:17", "49 pages").
const row = (refId: string, type: string, title: string, properties: string[], description = "") => `
<li id="item_row__other-${refId}" class="ilCLI ilObjListRow"><div class="ilContainerListItemOuter"><div class="ilContainerListItemContent ">
<div class="il_ContainerListItem"><div class="il_ContainerItemTitle form-inline"><h3 class="il_ContainerItemTitle"><a href="/go/${type}/${refId}" class="il_ContainerItemTitle">${title}</a></h3></div>
<div class="ilFloatRight"><div class="dropdown"><ul class="dropdown-menu"><li><button class="btn btn-link">Info</button></li></ul></div></div>
<div class="ilListItemSection il_Description">${description}</div>
${properties.length ? `<div class="ilListItemSection il_ItemProperties">${properties.map((value) => `<span class="il_ItemProperty"> ${value}&nbsp;&nbsp;</span>`).join("")}</div>` : ""}
</div></div></div></li>`;

const listing = (rows: string[]) => `
<nav aria-label="Brotkrumen"><a href="/go/root/1">ADAM</a><a href="/go/crs/100001">Synthetic Course</a></nav>
<main><h1>Synthetic Folder</h1><ul class="ilContainerItemsContainer">${rows.join("")}</ul></main>`;

const NOW = new Date("2026-11-14T10:00:00.000Z");

describe("#122 file listing row metadata", () => {
  const html = listing([
    row("100011", "file", "Lecture 01", ["pdf", "184.8 KB", "12. Oct 2026, 17:17", "49 pages"]),
    row("100030", "fold", "Sub folder", []),
    row("100012", "file", "Notebook", ["ipynb", "50.33 KB", "Today, 09:05"], "Covers the 3 pages of 1 Sep 2026 notes, 6.23 MB"),
    row("100013", "file", "Slides", ["pptx", "16.52 MB"]),
  ]);

  it("parses format, size, change time and pages from each file's own row", () => {
    const rows = parseFileRows(html, NOW);
    assert.deepEqual(rows.get("100011"), {
      extension: "pdf",
      mimeType: "application/pdf",
      sizeBytes: Math.round(184.8 * 1024),
      pageCount: 49,
      updatedAt: "2026-10-12T15:17:00.000Z",
      updatedAtRaw: "12. Oct 2026, 17:17",
    });
    // Description text is not a property: no pages, size or date borrowed from it.
    assert.deepEqual(rows.get("100012"), {
      extension: "ipynb",
      mimeType: "application/x-ipynb+json",
      sizeBytes: Math.round(50.33 * 1024),
      updatedAt: "2026-11-14T08:05:00.000Z",
      updatedAtRaw: "Today, 09:05",
    });
    // Neighbouring rows never leak: the slides row has no date or page count.
    const slides = rows.get("100013");
    assert.equal(slides?.extension, "pptx");
    assert.equal(slides?.sizeBytes, Math.round(16.52 * 1024 * 1024));
    assert.equal(slides?.pageCount, undefined);
    assert.equal(slides?.updatedAt, undefined);
    assert.equal(rows.has("100030"), false);
  });

  it("surfaces row metadata on list_children objects and list_files, and attributes row dates", () => {
    const snapshot = snapshotFromHtml("https://adam.unibas.ch/go/fold/100010", "Synthetic Folder", html, "Synthetic Folder");
    const catalog = extractCatalog(snapshot, NOW.toISOString());
    const child = catalog.objects.find((item) => item.refId === "100011") as Record<string, unknown> | undefined;
    assert.equal(child?.type, "file");
    assert.equal(child?.extension, "pdf");
    assert.equal(child?.pageCount, 49);
    assert.equal(child?.updatedAt, "2026-10-12T15:17:00.000Z");
    assert.equal(catalog.files.find((file) => file.refId === "100013")?.mimeType, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    assert.deepEqual(catalog.fileRowDates, [
      { refId: "100011", raw: "12. Oct 2026, 17:17", iso: "2026-10-12T15:17:00.000Z" },
      { refId: "100012", raw: "Today, 09:05", iso: "2026-11-14T08:05:00.000Z" },
    ]);
  });

  it("omits ambiguous values instead of choosing one", () => {
    const rows = parseFileRows(listing([row("100014", "file", "Odd", ["pdf", "zip", "1 KB", "2 KB", "1 Sep 2026", "2 Sep 2026"])]), NOW);
    assert.equal(rows.has("100014"), false);
  });

  it("drops a field when two rows for the same file disagree", () => {
    const rows = parseFileRows(listing([
      row("100015", "file", "Twice", ["pdf", "1 KB"]),
      row("100015", "file", "Twice", ["pdf", "2 KB"]),
    ]), NOW);
    assert.deepEqual(rows.get("100015"), { extension: "pdf", mimeType: "application/pdf" });
  });

  it("reads Kitchen Sink item properties for file items", () => {
    const ks = `<div class="il-item il-std-item"><h4 class="il-item-title"><a href="/go/file/100016">Data</a></h4>
<div class="il-item-description">Updated 1 Sep 2026</div>
<span class="il-item-property-name">Format</span><span class="il-item-property-value">csv</span>
<span class="il-item-property-name">Size</span><span class="il-item-property-value">2,5 MB</span>
<span class="il-item-property-name">Last update</span><span class="il-item-property-value">3. Nov 2026, 08:00</span></div>`;
    assert.deepEqual(parseFileRows(ks, NOW).get("100016"), {
      extension: "csv",
      mimeType: "text/csv",
      sizeBytes: Math.round(2.5 * 1024 * 1024),
      updatedAt: "2026-11-03T07:00:00.000Z",
      updatedAtRaw: "3. Nov 2026, 08:00",
    });
  });

  it("returns row metadata through the provider's listFiles", async () => {
    const provider = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession({
        "https://adam.unibas.ch/go/fold/100010": snapshotFromHtml("https://adam.unibas.ch/go/fold/100010", "Synthetic Folder", html, "Synthetic Folder Abmelden"),
      }),
    });
    const listed = await provider.listFiles("100010", { type: "fold" });
    const lecture = listed.items.find((item) => item.refId === "100011");
    assert.equal(lecture?.pageCount, 49);
    assert.equal(lecture?.extension, "pdf");
  });
});
