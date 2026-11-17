import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AdamError, objectUrl } from "adam-core";
import { createBrowserProvider } from "../browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../memory-session.ts";
import { OBJECT_READERS } from "./index.ts";
import { parseBibliographyEntries, readBibliography } from "./bibl.ts";

// ADR 0062 (#165): lab capture (tools/ilias-lab). The lab bibliography holds three synthetic
// Lab entries from a BibTeX upload. Rebased onto the pinned origin.
const ORIGIN = "https://adam.unibas.ch";
const REF = "115";
const lab = (name: string) => (JSON.parse(readFileSync(new URL(`../../fixtures/lab/${name}.json`, import.meta.url), "utf8")) as { html: string })
  .html.replaceAll("http://localhost:8080", ORIGIN);
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const entryUrl = `${ORIGIN}/ilias.php?baseClass=ilrepositorygui&cmdNode=wq:kz&cmdClass=ilObjBibliographicGUI&cmd=showDetails&ref_id=${REF}&entry_id=1`;

describe("ADR 0062: bibliography reader (lab-verified)", () => {
  it("lists the entries in ADAM's order with authors, year, cite key and subPage ids", () => {
    const entries = parseBibliographyEntries(lab("bibl-view-student"));
    assert.ok(entries);
    assert.deepEqual(entries.map((entry) => entry.title), [
      "Lab entry one: a synthetic article",
      "Lab entry three: a synthetic conference paper",
      "Lab entry two: a synthetic book",
    ]);
    assert.deepEqual(entries[0], {
      title: "Lab entry one: a synthetic article",
      authors: "Lab Author One",
      year: 2026,
      citeKey: "lab2026one",
      subPage: "1",
    });
    assert.deepEqual(entries.map((entry) => entry.subPage), ["1", "3", "2"]);
    assert.equal(entries[1]?.authors, "Lab Author Three and Lab Author Four");
    assert.equal(entries[2]?.year, 2025);
  });

  it("never returns the original file route", () => {
    assert.doesNotMatch(JSON.stringify(parseBibliographyEntries(lab("bibl-view-student"))), /sendFile|Download/);
  });

  it("returns undefined on unrelated pages", () => {
    assert.equal(parseBibliographyEntries(lab("dcl-table-student")), undefined);
    assert.equal(parseBibliographyEntries("<main><p>Nothing</p></main>"), undefined);
  });

  it("reads one entry through readPage subPage and returns its label/value rows", async () => {
    const mainUrl = objectUrl("bibl", REF, ORIGIN);
    const view = lab("bibl-view-student");
    const provider = createBrowserProvider({
      session: createMemorySession({
        [mainUrl]: snapshotFromHtml(mainUrl, "Lab bibl upload", view, textOf(view)),
        [entryUrl]: snapshotFromHtml(entryUrl, "Lab bibl upload", lab("bibl-entry-student"), textOf(lab("bibl-entry-student"))),
      }),
      clock: () => Date.parse("2026-11-17T10:00:00Z"),
    });
    const page = await provider.readPage(REF, { type: "bibl" });
    assert.equal(page.detailStatus, "read");
    assert.equal(page.detail?.kind, "bibliography");
    assert.equal(page.detail?.evidence, "lab-verified");
    assert.equal(page.detail?.entryCount, 3);
    assert.equal(page.detail?.entry, undefined);

    const entry = await provider.readPage(REF, { type: "bibl", subPage: "1" });
    assert.equal(entry.subPage, "1");
    assert.equal(entry.detailStatus, "read");
    const selected = entry.detail?.entry as { title: string; fields: Array<{ label: string; value: string }> };
    assert.equal(selected.title, "Lab entry one: a synthetic article");
    assert.deepEqual(selected.fields.map((field) => field.label), ["Bib Cite", "Author", "Title", "Journal", "Year"]);
    assert.match(entry.text, /Lab entry one/);
  });

  it("returns stale_id for a subPage that ADAM does not advertise", async () => {
    const mainUrl = objectUrl("bibl", REF, ORIGIN);
    const view = lab("bibl-view-student");
    const provider = createBrowserProvider({
      session: createMemorySession({ [mainUrl]: snapshotFromHtml(mainUrl, "Lab bibl upload", view, textOf(view)) }),
      clock: () => Date.parse("2026-11-17T10:00:00Z"),
    });
    await assert.rejects(provider.readPage(REF, { type: "bibl", subPage: "99" }), (error: unknown) => error instanceof AdamError && error.code === "stale_id");
  });

  it("is registered for bibl and returns undefined without a bibliography list", async () => {
    assert.equal(OBJECT_READERS.bibl, readBibliography);
    const ctx = { refId: REF, type: "bibl" as const, page: { url: ORIGIN, html: "<p>x</p>", text: "x" }, open: async () => { throw new Error("no open"); }, route: () => undefined, routes: () => [] };
    assert.equal(await readBibliography(ctx), undefined);
  });
});
