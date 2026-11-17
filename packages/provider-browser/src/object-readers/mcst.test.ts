import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { objectUrl } from "adam-core";
import { createBrowserProvider } from "../browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../memory-session.ts";
import { OBJECT_READERS } from "./index.ts";
import { parseMediacastItems, readMediacast } from "./mcst.ts";

// ADR 0062 (#165): lab capture (tools/ilias-lab). Lab data only; rebased onto the pinned origin.
const ORIGIN = "https://adam.unibas.ch";
const REF = "98";
const lab = (name: string) => (JSON.parse(readFileSync(new URL(`../../fixtures/lab/${name}.json`, import.meta.url), "utf8")) as { html: string })
  .html.replaceAll("http://localhost:8080", ORIGIN);
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("ADR 0062: mediacast reader (lab-verified)", () => {
  it("lists the playlist by title and gives the shown item its description", () => {
    const parsed = parseMediacastItems(lab("mcst-content-student"));
    assert.ok(parsed);
    assert.equal(parsed.itemCount, 4);
    assert.equal(parsed.truncated, false);
    const [first, second] = parsed.items;
    assert.deepEqual(first, { title: "Lab episode 2", description: "Lab synthetic mediacast item 2.", current: true });
    assert.deepEqual(second, { title: "Lab episode 1" });
    // Only the item on screen has a description; the others are listed by title alone.
    assert.equal(parsed.items.filter((item) => item.description !== undefined).length, 1);
  });

  it("never returns media, previews, play times or download routes", () => {
    const text = JSON.stringify(parseMediacastItems(lab("mcst-content-student")));
    assert.doesNotMatch(text, /\.mp4|\.webm|mcst_preview|download|Download|play|Play/);
  });

  it("returns undefined on unrelated pages", () => {
    assert.equal(parseMediacastItems(lab("dcl-table-student")), undefined);
    assert.equal(parseMediacastItems("<main><p>Nothing</p></main>"), undefined);
  });

  it("reads a page through readPage and attaches the typed detail", async () => {
    const url = objectUrl("mcst", REF, ORIGIN);
    const html = lab("mcst-content-student");
    const provider = createBrowserProvider({
      session: createMemorySession({ [url]: snapshotFromHtml(url, "Lab mcst", html, textOf(html)) }),
      clock: () => Date.parse("2026-11-17T10:00:00Z"),
    });
    const page = await provider.readPage(REF, { type: "mcst" });
    assert.equal(page.detailStatus, "read");
    assert.equal(page.detail?.kind, "mediacast");
    assert.equal(page.detail?.evidence, "lab-verified");
    assert.equal((page.detail?.items as Array<{ title: string }>)[1]?.title, "Lab episode 1");
  });

  it("is registered for mcst and returns undefined for other markup", async () => {
    assert.equal(OBJECT_READERS.mcst, readMediacast);
    const ctx = { refId: REF, type: "mcst" as const, page: { url: ORIGIN, html: "<p>x</p>", text: "x" }, open: async () => { throw new Error("no open"); }, route: () => undefined, routes: () => [] };
    assert.equal(await readMediacast(ctx), undefined);
  });
});
