import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { objectUrl } from "adam-core";
import { createBrowserProvider } from "../browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../memory-session.ts";
import { OBJECT_READERS } from "./index.ts";
import { parseDataCollectionTables, readDataCollection } from "./dcl.ts";

// ADR 0062 (#165): lab capture (tools/ilias-lab, seed-dcl-mcst-bibl-itgr.mjs). Lab data only;
// the lab serves http://localhost:8080, the fixture is rebased onto the pinned origin.
const ORIGIN = "https://adam.unibas.ch";
const REF = "111";
const lab = (name: string) => (JSON.parse(readFileSync(new URL(`../../fixtures/lab/${name}.json`, import.meta.url), "utf8")) as { html: string })
  .html.replaceAll("http://localhost:8080", ORIGIN);
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("ADR 0062: data collection reader (lab-verified)", () => {
  it("reads the seeded table: columns, record values and footer count", () => {
    const tables = parseDataCollectionTables(lab("dcl-table-student"));
    assert.ok(tables);
    assert.equal(tables.length, 1);
    const [table] = tables;
    assert.equal(table.title, "Standard");
    assert.deepEqual(table.columns, ["Lab title", "Lab quantity", "Lab due date"]);
    assert.equal(table.rowCount, 3);
    assert.equal(table.truncated, undefined);
    assert.deepEqual(table.rows.map((row) => row.cells), [
      { "Lab title": "Lab record one", "Lab quantity": "3", "Lab due date": "01.12.2026" },
      { "Lab title": "Lab record two", "Lab quantity": "12", "Lab due date": "15.12.2026" },
      { "Lab title": "Lab record three", "Lab quantity": "7", "Lab due date": "10.01.2027" },
    ]);
  });

  it("returns undefined on unrelated pages", () => {
    assert.equal(parseDataCollectionTables(lab("course-itgr-student")), undefined);
    assert.equal(parseDataCollectionTables(lab("bibl-view-student")), undefined);
    assert.equal(parseDataCollectionTables("<main><p>No table here</p></main>"), undefined);
  });

  it("fails closed when a record does not align with the header", () => {
    const html = lab("dcl-table-student").replace('<td class="">3</td>', "");
    assert.equal(parseDataCollectionTables(html), undefined);
  });

  it("strips responsive column-title labels from cells and caps the rows", () => {
    const records = Array.from({ length: 105 }, (_, i) => `<tr class="tblrow1"><td><span class="c-table-data__cell__col-title">Lab title: </span>Row ${i}</td></tr>`).join("");
    const html = `<h2 class="ilHeader ilTableHeaderTitle">Lab view</h2><form><table class="table dcl_record_list" id="dcl_rl_1_1"><thead><tr><th><a class="tblheader" href="#">Lab title Ascending</a></th></tr></thead><tbody>${records}</tbody></table></form>`;
    const [table] = parseDataCollectionTables(html) ?? [];
    assert.ok(table);
    assert.equal(table.title, "Lab view");
    assert.deepEqual(table.columns, ["Lab title"]);
    assert.equal(table.rows.length, 100);
    assert.equal(table.rows[0]?.cells["Lab title"], "Row 0");
    assert.equal(table.rowCount, 105);
    assert.equal(table.truncated, true);
  });

  it("reads a page through readPage and attaches the typed detail", async () => {
    const url = objectUrl("dcl", REF, ORIGIN);
    const provider = createBrowserProvider({
      session: createMemorySession({ [url]: snapshotFromHtml(url, "Lab dcl", lab("dcl-table-student"), textOf(lab("dcl-table-student"))) }),
      clock: () => Date.parse("2026-11-17T10:00:00Z"),
    });
    const page = await provider.readPage(REF, { type: "dcl" });
    assert.equal(page.detailStatus, "read");
    assert.equal(page.detail?.kind, "data-collection");
    assert.equal(page.detail?.evidence, "lab-verified");
    const tables = page.detail?.tables as Array<{ rowCount: number; rows: Array<{ cells: Record<string, string> }> }>;
    assert.equal(tables[0]?.rowCount, 3);
    assert.equal(tables[0]?.rows[1]?.cells["Lab quantity"], "12");
  });

  it("is registered for dcl and returns undefined for other markup", async () => {
    assert.equal(OBJECT_READERS.dcl, readDataCollection);
    const ctx = { refId: "1", type: "dcl" as const, page: { url: ORIGIN, html: "<p>x</p>", text: "x" }, open: async () => { throw new Error("no open"); }, route: () => undefined, routes: () => [] };
    assert.equal(await readDataCollection(ctx), undefined);
  });
});
