import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { objectUrl } from "adam-core";
import { createBrowserProvider } from "../browser-provider.ts";
import { extractCatalog, itemGroupBlocks } from "../extract.ts";
import { createMemorySession, snapshotFromHtml } from "../memory-session.ts";

// ADR 0062 (#165): an item group (`itgr`) renders as a container block with no title link.
// Its members are linked rows inside the block. Lab capture (tools/ilias-lab), rebased onto
// the pinned origin.
const ORIGIN = "https://adam.unibas.ch";
const COURSE = "86";
const lab = (name: string) => (JSON.parse(readFileSync(new URL(`../../fixtures/lab/${name}.json`, import.meta.url), "utf8")) as { url: string; html: string });
const courseFixture = () => {
  const fixture = lab("course-itgr-student");
  return { url: fixture.url.replaceAll("http://localhost:8080", ORIGIN), html: fixture.html.replaceAll("http://localhost:8080", ORIGIN) };
};
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const FETCHED = "2026-11-17T10:00:00.000Z";

describe("ADR 0062: item groups in the course listing (#165)", () => {
  it("finds the item group block and its header title", () => {
    assert.deepEqual(itemGroupBlocks(courseFixture().html), [{ refId: "89", title: "Lab itgr" }]);
    assert.deepEqual(itemGroupBlocks(lab("course-student").html), []);
  });

  it("lists the item group as itgr and each member as a typed child", () => {
    const { url, html } = courseFixture();
    const catalog = extractCatalog(snapshotFromHtml(url, "Lab Course", html, textOf(html)), FETCHED);
    const group = catalog.objects.find((item) => item.refId === "89");
    assert.ok(group);
    assert.equal(group.type, "itgr");
    assert.equal(group.title, "Lab itgr");
    assert.equal(group.url, `${ORIGIN}/go/itgr/89`);
    const members = new Map(catalog.objects.map((item) => [item.refId, [item.type, item.title]]));
    assert.deepEqual(members.get("115"), ["bibl", "Lab bibl upload"]);
    assert.deepEqual(members.get("111"), ["dcl", "Lab dcl"]);
    assert.deepEqual(members.get("98"), ["mcst", "Lab mcst"]);
    assert.equal(catalog.objects.some((item) => item.type === "unknown"), false);
  });

  it("does not invent an item group on a course without one", () => {
    const html = lab("course-student").html.replaceAll("http://localhost:8080", ORIGIN);
    const catalog = extractCatalog(snapshotFromHtml(`${ORIGIN}/go/crs/86`, "Lab Course", html, textOf(html)), FETCHED);
    assert.equal(catalog.objects.some((item) => item.type === "itgr"), false);
  });

  it("lists the item group and its members through adam_list_children", async () => {
    const { url, html } = courseFixture();
    const courseUrl = objectUrl("crs", COURSE, ORIGIN);
    const provider = createBrowserProvider({
      session: createMemorySession({ [courseUrl]: snapshotFromHtml(courseUrl, "Lab Course", html, textOf(html)), [url]: snapshotFromHtml(url, "Lab Course", html, textOf(html)) }),
      clock: () => Date.parse("2026-11-17T10:00:00Z"),
    });
    const children = await provider.listChildren(COURSE, { type: "crs" });
    const byRef = new Map(children.items.map((item) => [item.refId, item.type]));
    assert.equal(byRef.get("89"), "itgr");
    assert.equal(byRef.get("115"), "bibl");
    assert.equal(byRef.get("111"), "dcl");
    assert.equal(byRef.get("98"), "mcst");
  });
});
