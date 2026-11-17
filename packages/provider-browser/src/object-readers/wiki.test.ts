import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import { advertisedRoute, advertisedRoutes } from "../advertised-route.ts";
import { createBrowserProvider } from "../browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../memory-session.ts";
import { textOf } from "../ui-items.ts";
import { OBJECT_READERS, type ReaderContext } from "./index.ts";
import { parseWikiPages, readWiki, wikiPageSlug, wikiPageTitle } from "./wiki.ts";

/**
 * ADR 0062 / #165: wiki reader against the ILIAS 10.12 lab (tools/ilias-lab, wiki "Lab wiki pages",
 * ref 117; seeded by seed-wiki-glo.mjs, captured by capture-wiki-fixtures.mjs). The lab serves
 * http://localhost:8080; the markup is rebased onto ADAM's pinned origin.
 */
const ORIGIN = "https://adam.unibas.ch";
const REF = "117";
const fixtureHtml = (name: string) => {
  const fixture = JSON.parse(readFileSync(new URL(`../../fixtures/lab/${name}.json`, import.meta.url), "utf8")) as { html: string };
  return fixture.html.replaceAll("http://localhost:8080", ORIGIN);
};
/** The absolute URL an advertised href resolves to, as the reader would open it. */
const absolute = (href: string) => {
  const url = new URL(href.replace(/&amp;/gi, "&"), ORIGIN);
  url.hash = "";
  return url.href;
};
const hrefTo = (html: string, pageParam: string, cmd: string) => {
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
  const found = hrefs.find((h) => h.includes(`cmd=${cmd}`) && new URL(h.replace(/&amp;/g, "&"), ORIGIN).searchParams.get("page") === pageParam);
  assert.ok(found, `no ${cmd} link to ${pageParam}`);
  return absolute(found);
};

const startHtml = fixtureHtml("wiki-start-student");
const allPagesHtml = fixtureHtml("wiki-all-pages-student");
const allPagesUrl = absolute(startHtml.match(/href="([^"]*cmd=allPages[^"]*)"/)![1]!);
const objectUrl = `${ORIGIN}/go/wiki/${REF}`;

/** Memory session for the wiki: the object page, its All Pages view and every page the crawl can open. */
const wikiPages = () => {
  const pageFixtures: Array<[string, string]> = [
    ["Lab_Page_One", "wiki-page-student"],
    ["Lab_Page_Two", "wiki-page-two-student"],
    ["Lab_Page_Three", "wiki-page-three-student"],
  ];
  const pages: Record<string, ReturnType<typeof snapshotFromHtml>> = {
    [objectUrl]: snapshotFromHtml(objectUrl, "Lab Start", startHtml, textOf(startHtml)),
    [allPagesUrl]: snapshotFromHtml(allPagesUrl, "All Pages", allPagesHtml, textOf(allPagesHtml)),
  };
  for (const [title, name] of pageFixtures) {
    const html = fixtureHtml(name);
    // The URL the reader follows: the gotoPage link another page renders to this page.
    const from = title === "Lab_Page_One" ? startHtml : title === "Lab_Page_Two" ? fixtureHtml("wiki-page-student") : fixtureHtml("wiki-page-two-student");
    const url = hrefTo(from, title, "gotoPage");
    pages[url] = snapshotFromHtml(url, title, html, textOf(html));
  }
  return pages;
};

describe("ADR 0062: wiki All Pages inventory", () => {
  it("parses the lab's four pages with slugs and the table footer count", () => {
    const parsed = parseWikiPages(allPagesHtml);
    assert.ok(parsed);
    assert.deepEqual(parsed.pages.map((p) => p.title), ["Lab Page One", "Lab Page Three", "Lab Page Two", "Lab Start"]);
    assert.deepEqual(parsed.pages.map((p) => p.subPage), ["Lab_Page_One", "Lab_Page_Three", "Lab_Page_Two", "Lab_Start"]);
    assert.equal(parsed.pageCount, 4);
    assert.equal(parsed.truncated, false);
  });

  it("recognises an empty wiki only from ILIAS's own sentence, and nothing else", () => {
    assert.deepEqual(parseWikiPages("<main><p>This object is empty and contains no items.</p></main>"), { pages: [], pageCount: 0, truncated: false });
    assert.equal(parseWikiPages("<main><p>Something else</p></main>"), undefined);
  });

  it("marks a listing whose footer shows more pages than rendered as truncated", () => {
    const parsed = parseWikiPages(allPagesHtml.replace("(1 - 4 of 4)", "(1 - 4 of 9)"));
    assert.ok(parsed);
    assert.equal(parsed.pageCount, 9);
    assert.equal(parsed.truncated, true);
  });

  it("reads the start page title and rejects unsafe page ids", () => {
    assert.equal(wikiPageTitle(startHtml), "Lab Start");
    assert.equal(wikiPageSlug("Lab Page One"), "Lab_Page_One");
    assert.equal(wikiPageSlug("Ä ö/../x"), undefined);
  });
});

describe("ADR 0062: wiki reader", () => {
  const context = (overrides: Partial<ReaderContext> = {}): ReaderContext => ({
    refId: REF,
    type: "wiki",
    page: { url: objectUrl, html: startHtml, text: textOf(startHtml) },
    open: async (url: string) => {
      const pages = wikiPages();
      const snapshot = pages[url];
      if (!snapshot) throw new Error(`unexpected open ${url}`);
      return { url, html: snapshot.html ?? "", text: snapshot.text ?? "" };
    },
    route: (html, rule) => advertisedRoute(html, REF, rule),
    routes: (html, rule) => advertisedRoutes(html, REF, rule),
    ...overrides,
  });

  it("reads the wiki detail from the All Pages view", async () => {
    const result = await readWiki(context());
    assert.ok(result);
    const detail = result.detail as unknown as { kind: string; evidence: string; startPage: string; pageCount: number; pages: Array<{ title: string; subPage: string }> };
    assert.equal(detail.kind, "wiki");
    assert.equal(detail.evidence, "lab-verified");
    assert.equal(detail.startPage, "Lab Start");
    assert.equal(detail.pageCount, 4);
    assert.equal(detail.pages.length, 4);
    assert.equal(result.text, undefined);
  });

  it("returns undefined when the object page has no All Pages sub-tab", async () => {
    assert.equal(await readWiki(context({ route: () => undefined })), undefined);
  });

  it("returns undefined for pages that are not a wiki object page", async () => {
    const course = fixtureHtml("course-student");
    assert.equal(await readWiki(context({ page: { url: objectUrl, html: course, text: textOf(course) }, route: () => undefined })), undefined);
  });

  it("reads one page's content by subPage through an advertised page link", async () => {
    const result = await readWiki(context({ subPage: "Lab_Page_One" }));
    assert.ok(result);
    assert.match(result.text ?? "", /Lab page one text, see Lab Page Two and back to Lab Start/);
    assert.match(result.text ?? "", /Lab item A/);
    assert.doesNotMatch(result.text ?? "", /Sort by this column|Wiki Functions/);
  });

  it("crawls to a page two links away and reads it", async () => {
    const result = await readWiki(context({ subPage: "Lab_Page_Three" }));
    assert.ok(result);
    assert.match(result.text ?? "", /Lab page three text/);
  });

  it("reads the start page text for its own subPage id", async () => {
    const result = await readWiki(context({ subPage: "Lab_Start" }));
    assert.ok(result);
    assert.match(result.text ?? "", /Lab start text, see Lab Page One/);
  });

  it("returns undefined for a subPage the crawl does not reach", async () => {
    assert.equal(await readWiki(context({ subPage: "Lab_Missing" })), undefined);
  });
});

describe("ADR 0062: wiki readPage end to end", () => {
  const provider = () => createBrowserProvider({
    session: createMemorySession(wikiPages()),
    clock: () => Date.parse("2026-11-17T10:00:00Z"),
  });

  it("attaches the wiki detail to readPage and reads a sub-page by subPage", async () => {
    assert.equal(typeof OBJECT_READERS.wiki, "function");
    const page = await provider().readPage(REF, { type: "wiki" });
    assert.equal(page.detailStatus, "read");
    assert.equal((page.detail as unknown as { pageCount: number }).pageCount, 4);
    assert.match(page.text, /Lab Start/);

    const sub = await provider().readPage(REF, { type: "wiki", subPage: "Lab_Page_One" });
    assert.equal(sub.subPage, "Lab_Page_One");
    assert.equal(sub.detailStatus, "read");
    assert.match(sub.text, /Lab page one text/);
  });

  it("rejects an unknown subPage as stale_id", async () => {
    await assert.rejects(
      provider().readPage(REF, { type: "wiki", subPage: "Lab_Missing" }),
      (error: unknown) => error instanceof AdamError && error.code === "stale_id",
    );
  });
});
