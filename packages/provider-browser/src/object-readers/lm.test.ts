import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import { advertisedRoute, advertisedRoutes } from "../advertised-route.ts";
import { createBrowserProvider } from "../browser-provider.ts";
import { textOf } from "../ui-items.ts";
import { createMemorySession, snapshotFromHtml } from "../memory-session.ts";
import { parseLmPageText, parseLmTree, readLearningModule } from "./lm.ts";
import type { ReaderContext, ReaderPage } from "./index.ts";

// ADR 0062 / ADR 0057 lab evidence: ILIAS 10.12 lab (tools/ilias-lab), lab seed data only.
// Fixtures are rebased from http://localhost:8080 to the pinned ADAM origin before use.
const ORIGIN = "https://adam.unibas.ch";
const fixture = (name: string) => {
  const parsed = JSON.parse(readFileSync(new URL(`../../fixtures/lab/${name}.json`, import.meta.url), "utf8")) as { url: string; html: string };
  return { url: parsed.url.replaceAll("http://localhost:8080", ORIGIN), html: parsed.html.replaceAll("http://localhost:8080", ORIGIN) };
};
const start = () => fixture("lm-start-student");
const layout = (objId: number) => `${ORIGIN}/ilias.php?baseClass=illmpresentationgui&cmd=layout&ref_id=93&obj_id=${objId}`;

/** Minimal reader context over a fixture page: `open` is not expected to be called by these tests. */
const contextFor = (page: ReaderPage, subPage?: string, open?: ReaderContext["open"]): ReaderContext => ({
  refId: "93",
  type: "lm",
  page,
  ...(subPage !== undefined ? { subPage } : {}),
  open: open ?? (async () => { throw new Error("unexpected open"); }),
  route: (html, rule) => advertisedRoute(html, "93", rule),
  routes: (html, rule) => advertisedRoutes(html, "93", rule),
});
const readerPage = (url: string, html: string): ReaderPage => ({ url, html, text: textOf(html) });

describe("ADR 0062: learning module (lm) reader, lab-verified", () => {
  it("parses the presentation table of contents into chapters and pages", () => {
    const tree = parseLmTree(start().html);
    assert.ok(tree);
    assert.deepEqual(tree.chapters.map((chapter) => chapter.title), ["Lab Chapter 1", "Lab Chapter 2"]);
    assert.deepEqual(tree.chapters[0]!.pages, [
      { title: "Lab Page 1.1", subPage: "5" },
      { title: "Lab Page 1.2", subPage: "6" },
    ]);
    assert.deepEqual(tree.chapters[1]!.pages, [
      { title: "Lab Page 2.1", subPage: "4" },
      { title: "Lab Page 2.2", subPage: "7" },
    ]);
    // The module root ("Lab lm", obj_id 1) is not a chapter or a page of its own.
    assert.deepEqual(tree.pages, []);
  });

  it("returns chapters, pages and pageCount from the start page without opening anything", async () => {
    const page = start();
    const result = await readLearningModule(contextFor(readerPage(page.url, page.html)));
    assert.deepEqual(result, {
      detail: {
        kind: "learning-module",
        evidence: "lab-verified",
        chapters: [
          { title: "Lab Chapter 1", pages: [{ title: "Lab Page 1.1", subPage: "5" }, { title: "Lab Page 1.2", subPage: "6" }] },
          { title: "Lab Chapter 2", pages: [{ title: "Lab Page 2.1", subPage: "4" }, { title: "Lab Page 2.2", subPage: "7" }] },
        ],
        pageCount: 4,
      },
    });
  });

  it("extracts a sub-page's title and paragraphs from its content frame", () => {
    const text = parseLmPageText(fixture("lm-page-student").html);
    assert.equal(text, "Lab Page 2.2\n\nLab page 2.2: synthetic lab text in the second chapter.");
  });

  it("returns undefined for an unrelated page, an unknown sub-page and a malformed sub-page id", async () => {
    const copa = fixture("copa-view-student");
    assert.equal(await readLearningModule(contextFor(readerPage(copa.url, copa.html))), undefined);
    const page = start();
    const ctx = (subPage: string) => contextFor(readerPage(page.url, page.html), subPage);
    assert.equal(await readLearningModule(ctx("999")), undefined);
    assert.equal(await readLearningModule(ctx("5/../../x")), undefined);
    assert.equal(await readLearningModule(ctx("pg-5")), undefined);
  });

  it("reads one sub-page only through the advertised layout route", async () => {
    const page = start();
    const opened: string[] = [];
    const open: ReaderContext["open"] = async (url) => {
      opened.push(url);
      const target = fixture("lm-page-student");
      return readerPage(target.url, target.html);
    };
    const result = await readLearningModule(contextFor(readerPage(page.url, page.html), "7", open));
    assert.deepEqual(opened, [layout(7)]);
    assert.equal(result?.text, "Lab Page 2.2\n\nLab page 2.2: synthetic lab text in the second chapter.");
  });
});

describe("ADR 0062: learning module (lm) end-to-end readPage", () => {
  const pages = {
    [`${ORIGIN}/go/lm/93`]: (() => { const p = start(); return snapshotFromHtml(p.url, "Lab lm", p.html, textOf(p.html)); })(),
    [layout(7)]: (() => { const p = fixture("lm-page-student"); return snapshotFromHtml(p.url, "Lab Page 2.2", p.html, textOf(p.html)); })(),
  };
  const provider = () => createBrowserProvider({ session: createMemorySession(pages), clock: () => Date.parse("2026-11-17T10:00:00Z") });

  it("attaches the learning-module detail to readPage", async () => {
    const page = await provider().readPage("93", { type: "lm" });
    assert.equal(page.detailStatus, "read");
    assert.equal(page.detail?.kind, "learning-module");
    assert.equal(page.detail?.evidence, "lab-verified");
    assert.equal(page.detail?.pageCount, 4);
    assert.equal(page.subPage, undefined);
  });

  it("reads a chapter page through subPage and returns its text", async () => {
    const page = await provider().readPage("93", { type: "lm", subPage: "7" });
    assert.equal(page.detailStatus, "read");
    assert.equal(page.subPage, "7");
    assert.match(page.text, /Lab page 2\.2: synthetic lab text/);
  });

  it("reports an unknown subPage as stale_id", async () => {
    await assert.rejects(provider().readPage("93", { type: "lm", subPage: "999" }), (error: unknown) => error instanceof AdamError && error.code === "stale_id");
  });
});
