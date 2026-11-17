import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import { advertisedRoute, advertisedRoutes } from "../advertised-route.ts";
import { createBrowserProvider } from "../browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../memory-session.ts";
import { textOf } from "../ui-items.ts";
import { OBJECT_READERS, type ReaderContext, type ReaderPage } from "./index.ts";
import { parseWikiPages, readWiki, wikiPageTitle, wikiPermalink } from "./wiki.ts";

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
/** The lab's lab-only logins (lab-users.json); none may reach the reader's output. */
const LAB_LOGINS = ["lab.student", "lab.student2", "lab.tutor", "lab.admin", "lab.sysadmin"];

const startHtml = fixtureHtml("wiki-start-student");
const allPagesHtml = fixtureHtml("wiki-all-pages-student");
const objectUrl = `${ORIGIN}/go/wiki/${REF}`;
const permalinkOf = (id: string, ref = REF) => `${ORIGIN}/goto.php/wiki/wpage_${id}_${ref}`;
/** Page id -> the fixture the permalink serves (the lab ids: 1 Start, 2 One, 3 Two, 4 Three). */
const PAGE_FIXTURES: Record<string, string> = { "1": "wiki-start-student", "2": "wiki-page-student", "3": "wiki-page-two-student", "4": "wiki-page-three-student" };

/** Memory session for the wiki: the object page, the All Pages view and each page's permalink. */
const wikiSession = (opened?: string[]) => {
  const pages: Record<string, ReturnType<typeof snapshotFromHtml>> = {
    [objectUrl]: snapshotFromHtml(objectUrl, "Lab Start", startHtml, textOf(startHtml)),
    [`${ORIGIN}/ilias.php?baseClass=ilwikihandlergui&cmdNode=14g:r6&cmdClass=ilobjwikigui&cmd=allPages&ref_id=${REF}&page=Lab_Start`]:
      snapshotFromHtml(objectUrl, "All Pages", allPagesHtml, textOf(allPagesHtml)),
  };
  for (const [id, name] of Object.entries(PAGE_FIXTURES)) {
    const html = fixtureHtml(name);
    pages[permalinkOf(id)] = snapshotFromHtml(permalinkOf(id), "Page", html, textOf(html));
  }
  return { pages, opened };
};
const allPagesUrl = `${ORIGIN}/ilias.php?baseClass=ilwikihandlergui&cmdNode=14g:r6&cmdClass=ilobjwikigui&cmd=allPages&ref_id=${REF}&page=Lab_Start`;

/** A reader context over the lab wiki; `opened` records every page the reader opens. */
const context = (overrides: Partial<ReaderContext> = {}, opened: string[] = []): ReaderContext => {
  const session = wikiSession();
  return {
    refId: REF,
    type: "wiki",
    page: { url: objectUrl, html: startHtml, text: textOf(startHtml) },
    open: async (url: string): Promise<ReaderPage> => {
      opened.push(url);
      const snapshot = session.pages[url];
      if (!snapshot) throw new Error(`unexpected open ${url}`);
      return { url, html: snapshot.html ?? "", text: snapshot.text ?? "" };
    },
    route: (html, rule) => advertisedRoute(html, REF, rule),
    routes: (html, rule) => advertisedRoutes(html, REF, rule),
    ...overrides,
  };
};

describe("ADR 0062: wiki permalink validator", () => {
  it("accepts the permalink of a page in this wiki, in both advertised forms", () => {
    assert.equal(wikiPermalink(`http://localhost:8080/goto.php/wiki/wpage_3_117`, REF, "3"), undefined, "the lab origin is foreign to the pinned origin");
    assert.equal(wikiPermalink(permalinkOf("3"), REF, "3"), permalinkOf("3"));
    assert.equal(wikiPermalink(`${ORIGIN}/go/wiki/wpage_3_117`, REF, "3"), `${ORIGIN}/go/wiki/wpage_3_117`);
    assert.equal(wikiPermalink(`${ORIGIN}/goto.php/wiki/wpage_3_117`, REF), `${ORIGIN}/goto.php/wiki/wpage_3_117`);
  });

  it("rejects another ref (another wiki), including when the id matches", () => {
    assert.equal(wikiPermalink(permalinkOf("3", "95"), REF, "3"), undefined);
    assert.equal(wikiPermalink(permalinkOf("3", "95"), REF), undefined);
  });

  it("rejects an id that is not the requested one", () => {
    assert.equal(wikiPermalink(permalinkOf("3"), REF, "2"), undefined);
  });

  it("rejects a query string, a fragment and credentials", () => {
    assert.equal(wikiPermalink(`${permalinkOf("3")}?rtoken=abc`, REF, "3"), undefined);
    assert.equal(wikiPermalink(`${permalinkOf("3")}?`, REF, "3"), undefined);
    assert.equal(wikiPermalink(`${permalinkOf("3")}#x`, REF, "3"), undefined);
    assert.equal(wikiPermalink(`https://user:pw@adam.unibas.ch/goto.php/wiki/wpage_3_117`, REF, "3"), undefined);
  });

  it("rejects a foreign origin, even with the same path", () => {
    assert.equal(wikiPermalink("https://evil.example/goto.php/wiki/wpage_3_117", REF, "3"), undefined);
    assert.equal(wikiPermalink("http://adam.unibas.ch/goto.php/wiki/wpage_3_117", REF, "3"), undefined, "http is not the pinned origin");
  });

  it("rejects non-digit and oversized ids and any other path", () => {
    assert.equal(wikiPermalink(`${ORIGIN}/goto.php/wiki/wpage_x_117`, REF), undefined);
    assert.equal(wikiPermalink(`${ORIGIN}/goto.php/wiki/wpage_-1_117`, REF), undefined);
    assert.equal(wikiPermalink(`${ORIGIN}/goto.php/wiki/wpage_1234567890_117`, REF), undefined);
    assert.equal(wikiPermalink(`${ORIGIN}/goto.php/wiki/wpage_3_117/extra`, REF), undefined);
    assert.equal(wikiPermalink(`${ORIGIN}/ilias.php?baseClass=ilwikihandlergui&ref_id=117&wpg_id=3`, REF, "3"), undefined);
    assert.equal(wikiPermalink(`${ORIGIN}/goto.php/wiki/wpage_3_117`, REF, "3x"), undefined);
  });
});

describe("ADR 0062: wiki All Pages inventory", () => {
  it("parses the lab's four pages with their numeric ids and the table footer count", () => {
    const parsed = parseWikiPages(allPagesHtml, REF);
    assert.ok(parsed);
    assert.deepEqual(parsed.pages, [
      { title: "Lab Page One", subPage: "2" },
      { title: "Lab Page Three", subPage: "4" },
      { title: "Lab Page Two", subPage: "3" },
      { title: "Lab Start", subPage: "1" },
    ]);
    assert.equal(parsed.pageCount, 4);
    assert.equal(parsed.truncated, false);
  });

  it("ignores a listing whose rows belong to another wiki", () => {
    const other = allPagesHtml.replaceAll("wpage_", "wpage_").replaceAll("_117", "_95");
    assert.equal(parseWikiPages(other, REF), undefined);
  });

  it("recognises an empty wiki only from ILIAS's own sentence, and nothing else", () => {
    assert.deepEqual(parseWikiPages("<main><p>This object is empty and contains no items.</p></main>", REF), { pages: [], pageCount: 0, truncated: false });
    assert.equal(parseWikiPages("<main><p>Something else</p></main>", REF), undefined);
  });

  it("marks a listing whose footer shows more pages than rendered as truncated", () => {
    const parsed = parseWikiPages(allPagesHtml.replace("(1 - 4 of 4)", "(1 - 4 of 9)"), REF);
    assert.ok(parsed);
    assert.equal(parsed.pageCount, 9);
    assert.equal(parsed.truncated, true);
  });

  it("reads the start page title", () => {
    assert.equal(wikiPageTitle(startHtml), "Lab Start");
  });
});

describe("ADR 0062: wiki reader", () => {
  it("reads the detail from the All Pages view and keeps the start page title", async () => {
    const result = await readWiki(context());
    assert.ok(result);
    const detail = result.detail as unknown as { kind: string; evidence: string; startPage: string; pageCount: number; pages: Array<{ title: string; subPage: string }> };
    assert.equal(detail.kind, "wiki");
    assert.equal(detail.evidence, "lab-verified");
    assert.equal(detail.startPage, "Lab Start");
    assert.equal(detail.pageCount, 4);
    assert.deepEqual(detail.pages.map((p) => p.subPage), ["2", "4", "3", "1"]);
    assert.equal(result.text, undefined);
  });

  it("keeps no editor login, avatar or editor-date in the detail", async () => {
    const result = await readWiki(context());
    assert.ok(result);
    const serialised = JSON.stringify(result.detail);
    for (const login of LAB_LOGINS) assert.doesNotMatch(serialised, new RegExp(login.replaceAll(".", "\\.")));
    assert.doesNotMatch(serialised, /data:image|ilUser|Last Changed|Today,/i);
  });

  it("returns undefined when the object page has no All Pages sub-tab", async () => {
    assert.equal(await readWiki(context({ route: () => undefined })), undefined);
  });

  it("returns undefined for pages that are not a wiki object page", async () => {
    const course = fixtureHtml("course-student");
    assert.equal(await readWiki(context({ page: { url: objectUrl, html: course, text: textOf(course) }, route: () => undefined })), undefined);
  });

  it("reads one page by its numeric id with exactly one permalink open after the listing", async () => {
    const opened: string[] = [];
    const result = await readWiki(context({ subPage: "3" }, opened));
    assert.ok(result);
    assert.deepEqual(opened, [allPagesUrl, permalinkOf("3")]);
    assert.match(result.text ?? "", /Lab page two text, see Lab Page Three and back to Lab Page One/);
    assert.doesNotMatch(result.text ?? "", /Wiki Functions|Last edited|Sort by this column/);
  });

  it("reads the start page by its id 1 through its own permalink", async () => {
    const opened: string[] = [];
    const result = await readWiki(context({ subPage: "1" }, opened));
    assert.ok(result);
    assert.deepEqual(opened, [allPagesUrl, permalinkOf("1")]);
    assert.match(result.text ?? "", /Lab start text, see Lab Page One/);
  });

  it("returns undefined for an id the listing does not advertise, without opening its permalink", async () => {
    const opened: string[] = [];
    assert.equal(await readWiki(context({ subPage: "9" }, opened)), undefined);
    assert.deepEqual(opened, [allPagesUrl]);
  });

  it("returns undefined for a non-numeric subPage", async () => {
    assert.equal(await readWiki(context({ subPage: "Lab_Page_One" })), undefined);
  });
});

describe("ADR 0062: wiki readPage end to end", () => {
  const provider = () => createBrowserProvider({
    session: createMemorySession(wikiSession().pages),
    clock: () => Date.parse("2026-11-17T10:00:00Z"),
  });

  it("attaches the wiki detail to readPage and reads a page by its numeric id", async () => {
    assert.equal(typeof OBJECT_READERS.wiki, "function");
    const page = await provider().readPage(REF, { type: "wiki" });
    assert.equal(page.detailStatus, "read");
    assert.equal((page.detail as unknown as { pageCount: number }).pageCount, 4);
    assert.match(page.text, /Lab Start/);

    const sub = await provider().readPage(REF, { type: "wiki", subPage: "2" });
    assert.equal(sub.subPage, "2");
    assert.equal(sub.detailStatus, "read");
    assert.match(sub.text, /Lab page one text/);
  });

  it("rejects an unknown or old-style subPage as stale_id", async () => {
    for (const subPage of ["9", "Lab_Page_One"]) {
      await assert.rejects(
        provider().readPage(REF, { type: "wiki", subPage }),
        (error: unknown) => error instanceof AdamError && error.code === "stale_id",
      );
    }
  });
});
