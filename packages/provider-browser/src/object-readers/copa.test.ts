import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import { advertisedRoute, advertisedRoutes } from "../advertised-route.ts";
import { createBrowserProvider } from "../browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../memory-session.ts";
import { textOf } from "../ui-items.ts";
import type { ReaderContext, ReaderPage } from "./index.ts";
import { parseCopaHeadings, readContentPage } from "./copa.ts";

// ADR 0062 / ADR 0057 lab evidence: ILIAS 10.12 lab (tools/ilias-lab), lab seed data only.
const ORIGIN = "https://adam.unibas.ch";
const fixture = (name: string) => {
  const parsed = JSON.parse(readFileSync(new URL(`../../fixtures/lab/${name}.json`, import.meta.url), "utf8")) as { url: string; html: string };
  return { url: parsed.url.replaceAll("http://localhost:8080", ORIGIN), html: parsed.html.replaceAll("http://localhost:8080", ORIGIN) };
};
const readerPage = (url: string, html: string): ReaderPage => ({ url, html, text: textOf(html) });
const contextFor = (page: ReaderPage, subPage?: string): ReaderContext => ({
  refId: "92",
  type: "copa",
  page,
  ...(subPage !== undefined ? { subPage } : {}),
  open: async () => { throw new Error("content pages open nothing"); },
  route: (html, rule) => advertisedRoute(html, "92", rule),
  routes: (html, rule) => advertisedRoutes(html, "92", rule),
});

describe("ADR 0062: content page (copa) reader, lab-verified", () => {
  it("reads the headings of the content page in order, with their levels", () => {
    const copa = fixture("copa-view-student");
    assert.deepEqual(parseCopaHeadings(copa.html), [
      { level: 2, text: "Lab Copa Heading One" },
      { level: 1, text: "Lab Copa Heading Two" },
    ]);
  });

  it("returns the content-page detail with headings and sectionCount", async () => {
    const copa = fixture("copa-view-student");
    const result = await readContentPage(contextFor(readerPage(copa.url, copa.html)));
    assert.deepEqual(result, {
      detail: {
        kind: "content-page",
        evidence: "lab-verified",
        headings: [
          { level: 2, text: "Lab Copa Heading One" },
          { level: 1, text: "Lab Copa Heading Two" },
        ],
        sectionCount: 2,
      },
    });
  });

  it("returns undefined for an unrelated page, and for any sub-page", async () => {
    const course = fixture("course-student");
    assert.equal(await readContentPage(contextFor(readerPage(course.url, course.html))), undefined);
    const copa = fixture("copa-view-student");
    assert.equal(await readContentPage(contextFor(readerPage(copa.url, copa.html), "1")), undefined);
  });
});

describe("ADR 0062: content page (copa) end-to-end readPage", () => {
  const copa = fixture("copa-view-student");
  const pages = { [`${ORIGIN}/go/copa/92`]: snapshotFromHtml(copa.url, "Lab copa", copa.html, textOf(copa.html)) };
  const provider = () => createBrowserProvider({ session: createMemorySession(pages), clock: () => Date.parse("2026-11-17T10:00:00Z") });

  it("attaches the content-page detail to readPage", async () => {
    const page = await provider().readPage("92", { type: "copa" });
    assert.equal(page.detailStatus, "read");
    assert.equal(page.detail?.kind, "content-page");
    assert.equal(page.detail?.sectionCount, 2);
    assert.match(page.text, /Lab content page intro/);
  });

  it("rejects a subPage, because content pages have none", async () => {
    await assert.rejects(provider().readPage("92", { type: "copa", subPage: "1" }), (error: unknown) => error instanceof AdamError && error.code === "stale_id");
  });
});
