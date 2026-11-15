import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBrowserProvider, MEMBERSHIP_OVERVIEW_PATH } from "./browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";
import { newsPageRoute } from "./news-paging.ts";
import type { PageSnapshot } from "./session-types.ts";

// Synthetic, structure-only mirror of ILIAS 10.12 News block pagination (#132, ADR 0055 amendment).
const origin = "https://adam.unibas.ch";
const dashboardUrl = `${origin}/ilias.php?baseClass=ilDashboardGUI&cmd=jumpToSelectedItems`;
const courseUrl = `${origin}/go/crs/100001`;
const fetchedAt = "2026-11-14T10:00:00.000Z";

const courseRoute = (page: number, blockId = "4242", refId = "100001") =>
  new URL(`/ilias.php?baseClass=ilrepositorygui&cmdNode=xs:mm:8d&cmdClass=ilcolumngui&ref_id=${refId}&col_side=right&block_type=news&news_${blockId}_blnavpage=${page}`, origin).href;
const dashboardRoute = (page: number, blockId = "77") =>
  new URL(`/ilias.php?baseClass=ildashboardgui&cmdNode=ai:8d&cmdClass=ilcolumngui&view=0&show=5f3a9c&col_side=right&block_type=pdnews&pdnews_${blockId}_blnavpage=${page}`, origin).href;

const item = (blockType: "news" | "pdnews", id: string, date: string) => `
  <li class="il-std-item-container"><div class="il-item il-std-item">
    <h4 class="il-item-title"><a href="ilias.php?cmdClass=${blockType === "news" ? "ilNewsForContextBlockGUI" : "ilPDNewsBlockGUI"}&amp;cmd=showNews&amp;block_type=${blockType}&amp;news_id=${id}">News ${id}<br></a></h4>
    <div class="il-item-description">Body ${id}</div>
    <div class="row"><div class="col-md-6"><span class="il-item-property-name">Date</span><span class="il-item-property-value">${date}</span></div></div>
  </div></li>`;

const esc = (url: string) => url.replace(/&/g, "&amp;");

/** Pagination like ILIAS: page buttons around the current one, plus a next chevron. */
const pagination = (route: (page: number) => string, current: number, total: number) => {
  const buttons = [0, current - 1, current, current + 1, total - 1]
    .filter((page, at, all) => page >= 0 && page < total && all.indexOf(page) === at)
    .map((page) => `<button class="btn btn-link${page === current ? " engaged" : ""}" data-action="${esc(route(page))}">${page + 1}</button>`);
  const next = current + 1 < total ? `<button class="btn btn-default glyph" aria-label="next" data-action="${esc(route(current + 1))}"></button>` : "";
  return `<div class="il-viewcontrol-pagination l-bar__element">${buttons.join("")}${next}</div>`;
};

const block = (blockType: "news" | "pdnews", blockId: string, items: string, paging: string, controls = "") => `
<div id="block_${blockType}_${blockId}"><div class="panel panel-secondary panel-flex">
  <div class="panel-heading ilHeader"><div class="panel-title"><h2>News</h2></div>
    <div class="panel-viewcontrols l-bar__space-keeper">${paging}</div>
    <div class="panel-controls">${controls}</div></div>
  <div class="panel-body"><div class="il-item-group"><div class="il-item-group-items"><ul>${items}</ul></div></div></div>
</div></div>`;

const feedAndSettings = `
  <div class="dropdown"><ul class="dropdown-menu">
    <li><button class="btn btn-link" data-action="/ilias.php?baseClass=ildashboardgui&amp;cmdClass=ilpdnewsblockgui&amp;cmd=showFeedUrl&amp;block_type=pdnews">Get Feed URL</button></li>
    <li><button class="btn btn-link" data-action="/ilias.php?baseClass=ildashboardgui&amp;cmdClass=ilpdnewsblockgui&amp;cmd=editSettings&amp;block_type=pdnews">Settings</button></li>
  </ul></div>`;

const coursePage = (url: string, blockHtml: string) => snapshotFromHtml(url, "Course", `
<nav aria-label="Breadcrumbs"><a href="/go/root/1">ADAM</a><a href="/go/crs/100001">Course</a></nav>
<main><div id="il_center_col"><div class="ilContainerListItemOuter"><a href="/go/file/100011">Sheet.pdf</a></div></div>
<div id="il_right_col">${blockHtml}</div><a href="/logout.php">Abmelden</a></main>`, "Course Sheet.pdf Abmelden");

const dashboardPage = (url: string, blockHtml: string) => snapshotFromHtml(url, "Dashboard", `
<main><div id="il_center_col"><div class="ilContainerListItemOuter"><a href="/go/crs/100001">Synthetic course</a></div></div>
<div id="il_right_col">${blockHtml}</div><a href="/logout.php">Abmelden</a></main>`, "Dashboard Synthetic course Abmelden");

/** Page p of a 10-page course block, two items per page, one day older per page. */
const courseNews = (page: number) => item("news", `${1000 + page * 2}`, `${String(13 - page).padStart(2, "0")}. Nov 2026, 10:00`) +
  item("news", `${1001 + page * 2}`, `${String(13 - page).padStart(2, "0")}. Nov 2026, 09:00`);

/** Page p of the Dashboard block, one item per page, one day older per page. */
const dashboardBlock = (page: number, total: number) => block("pdnews", "77",
  item("pdnews", `${5000 + page}`, `${String(13 - page).padStart(2, "0")}. Nov 2026, 08:00`), pagination(dashboardRoute, page, total), feedAndSettings);

const setup = (options: { coursePages?: number; dashboard?: string; dashboardPages?: number; courseBlock?: (page: number) => string; walkTimeoutMs?: number; slowPagingMs?: number } = {}) => {
  const opened: string[] = [];
  const total = options.coursePages ?? 10;
  const pages: Record<string, PageSnapshot> = {
    [origin]: dashboardPage(dashboardUrl, options.dashboardPages ? dashboardBlock(0, options.dashboardPages) : options.dashboard ?? ""),
    [courseUrl]: coursePage(courseUrl, options.courseBlock?.(0) ?? block("news", "4242", courseNews(0), pagination(courseRoute, 0, total))),
  };
  for (let page = 1; page < (options.dashboardPages ?? 0); page += 1) {
    pages[dashboardRoute(page)] = dashboardPage(dashboardRoute(page), dashboardBlock(page, options.dashboardPages!));
  }
  for (let page = 1; page < total; page += 1) {
    pages[courseRoute(page)] = coursePage(courseRoute(page), options.courseBlock?.(page) ?? block("news", "4242", courseNews(page), pagination(courseRoute, page, total)));
  }
  const session = createMemorySession(pages, {
    onOpen: (url) => {
      opened.push(url);
      // Test seam: a slow later page spends the shared read budget.
      if (options.slowPagingMs && url.includes("ilcolumngui")) {
        const until = Date.now() + options.slowPagingMs;
        while (Date.now() < until) { /* busy wait */ }
      }
    },
  });
  const provider = createBrowserProvider({ origin, clock: () => Date.parse(fetchedAt), session, ...(options.walkTimeoutMs ? { walkTimeoutMs: options.walkTimeoutMs } : {}) });
  return { provider, opened, pages };
};

const pagingOpens = (opened: string[]) => opened.filter((url) => url.includes("ilcolumngui"));

describe("ADR 0055 amendment: News block route allowlist", () => {
  const course = { blockType: "news" as const, blockId: "4242", courseRefId: "100001" };
  const dashboard = { blockType: "pdnews" as const, blockId: "77" };

  it("accepts the advertised course and Dashboard routes and reads the 0-based index", () => {
    assert.deepEqual(newsPageRoute(courseRoute(3), course), { url: courseRoute(3), index: 3 });
    assert.deepEqual(newsPageRoute(dashboardRoute(1), dashboard), { url: dashboardRoute(1), index: 1 });
    assert.equal(newsPageRoute(esc(courseRoute(2)).replace(origin, ""), course)?.index, 2);
  });

  it("rejects anything outside the exact shape", () => {
    const rejected: Array<[string, typeof course | typeof dashboard]> = [
      [courseRoute(1).replace(origin, "https://adam.unibas.ch.evil.example"), course],
      [courseRoute(1).replace("/ilias.php", "/goto.php"), course],
      [courseRoute(1, "9999"), course],
      [courseRoute(1, "4242", "100002"), course],
      [`${courseRoute(1)}&cmd=showFeedUrl`, course],
      [`${courseRoute(1)}&cmd=editSettings`, course],
      [`${courseRoute(1)}&ref_id=100001`, course],
      [`${courseRoute(1)}&news_4242_blnavpage=2`, course],
      [courseRoute(1).replace("ilcolumngui", "ilnewsforcontextblockgui"), course],
      [courseRoute(1).replace("block_type=news", "block_type=pdnews"), course],
      [courseRoute(1).replace("ilrepositorygui", "ildashboardgui"), course],
      [courseRoute(1).replace("xs:mm:8d", "xs%2Fmm"), course],
      [courseRoute(1).replace("col_side=right", "col_side=top"), course],
      [courseRoute(1).replace("blnavpage=1", "blnavpage=-1"), course],
      [courseRoute(1).replace("blnavpage=1", "blnavpage=999"), course],
      [`${courseRoute(1)}#x`, course],
      [courseRoute(1), dashboard],
      [dashboardRoute(1).replace("show=5f3a9c", "show=xyz"), dashboard],
      [dashboardRoute(1).replace("view=0", "view=a"), dashboard],
      [`${dashboardRoute(1)}&ref_id=100001`, dashboard],
      [`${dashboardRoute(1)}&rtoken=abc`, dashboard],
      [dashboardRoute(1, "78"), dashboard],
    ];
    for (const [raw, target] of rejected) assert.equal(newsPageRoute(raw, target), undefined, raw);
  });
});

describe("ADR 0055 amendment: listNews follows News block pages", () => {
  it("reads at most 5 extra pages per block, through the next route only, attributed to the course", async () => {
    const { provider, opened } = setup();
    const result = await provider.listNews({ limit: 100 });
    assert.deepEqual(pagingOpens(opened), [1, 2, 3, 4, 5].map((page) => courseRoute(page)));
    assert.equal(result.items.length, 12);
    assert.equal(new Set(result.items.map((news) => news.newsId)).size, 12);
    assert.equal(result.items.every((news) => news.courseRefId === "100001" && news.url === courseUrl), true);
    assert.equal(result.partial, undefined);
  });

  it("stops after the last advertised page", async () => {
    const { provider, opened } = setup({ coursePages: 3 });
    const result = await provider.listNews({ limit: 100 });
    assert.deepEqual(pagingOpens(opened), [courseRoute(1), courseRoute(2)]);
    assert.equal(result.items.length, 6);
  });

  it("stops once a page's items are all older than since", async () => {
    // Page 0 = 13 Nov, page 1 = 12 Nov, page 2 = 11 Nov: page 2 is entirely before the cutoff.
    const { provider, opened } = setup();
    const result = await provider.listNews({ since: "2026-11-11T12:00:00.000Z", limit: 100 });
    assert.deepEqual(pagingOpens(opened), [courseRoute(1), courseRoute(2)]);
    assert.equal(result.items.length, 4);
    const none = setup();
    await none.provider.listNews({ since: "2026-11-14T00:00:00.000Z" });
    assert.deepEqual(pagingOpens(none.opened), []);
  });

  it("does not follow a tampered or missing next route", async () => {
    const tampered = setup({
      courseBlock: (page) => block("news", "4242", courseNews(page), page === 0
        ? `<div class="il-viewcontrol-pagination"><button class="btn btn-link" data-action="${esc(courseRoute(1, "4242", "100002"))}">2</button><button data-action="${esc(`${courseRoute(1)}&cmd=showFeedUrl`)}">next</button></div>`
        : ""),
    });
    const result = await tampered.provider.listNews({ limit: 100 });
    assert.deepEqual(pagingOpens(tampered.opened), []);
    assert.equal(result.items.length, 2);
  });

  it("dedupes repeated news_ids across pages and memoizes pages for the walk", async () => {
    const { provider, opened } = setup({
      coursePages: 3,
      courseBlock: (page) => block("news", "4242", page === 2 ? courseNews(1) : courseNews(page), pagination(courseRoute, page, 3)),
    });
    assert.equal((await provider.listNews({ limit: 100 })).items.length, 4);
    await provider.listNews({ since: "2026-11-01T00:00:00.000Z" });
    assert.equal(pagingOpens(opened).length, 2);
  });

  it("follows Dashboard pages and never the feed or settings controls", async () => {
    const { provider, opened } = setup({ coursePages: 1, dashboardPages: 3 });
    const result = await provider.listNews({ limit: 100 });
    assert.deepEqual(pagingOpens(opened), [dashboardRoute(1), dashboardRoute(2)]);
    assert.equal(opened.some((url) => /showFeedUrl|editSettings/.test(url)), false);
    const dashboardItems = result.items.filter((news) => news.newsId?.startsWith("50"));
    assert.deepEqual(dashboardItems.map((news) => [news.newsId, news.courseRefId, news.url]), [
      ["5000", undefined, dashboardUrl], ["5001", undefined, dashboardUrl], ["5002", undefined, dashboardUrl],
    ]);
  });

  it("pages the Dashboard first and skips course blocks it paged to the end", async () => {
    const { provider, opened } = setup({ dashboardPages: 3 });
    const result = await provider.listNews({ limit: 100 });
    assert.deepEqual(pagingOpens(opened), [dashboardRoute(1), dashboardRoute(2)]);
    assert.equal(result.partial, undefined);
  });

  it("skips course blocks when the Dashboard reached since", async () => {
    // Dashboard page 2 (11 Nov) is entirely before the cutoff.
    const { provider, opened } = setup({ dashboardPages: 12 });
    await provider.listNews({ since: "2026-11-11T12:00:00.000Z" });
    assert.deepEqual(pagingOpens(opened), [dashboardRoute(1), dashboardRoute(2)]);
  });

  it("pages course blocks after a Dashboard block cut at its 5-page cap", async () => {
    const { provider, opened } = setup({ dashboardPages: 12, coursePages: 3 });
    await provider.listNews({ limit: 100 });
    assert.deepEqual(pagingOpens(opened), [
      ...[1, 2, 3, 4, 5].map((page) => dashboardRoute(page)),
      courseRoute(1), courseRoute(2),
    ]);
  });

  it("does not report course blocks cut by the reserve when the Dashboard was read", async () => {
    // Budget 2 s, reserve 200 ms: five 300 ms Dashboard pages, then course paging runs out.
    const { provider, opened } = setup({ dashboardPages: 12, walkTimeoutMs: 2_000, slowPagingMs: 300 });
    const result = await provider.listNews({ limit: 100 });
    assert.equal(pagingOpens(opened).filter((url) => url.includes("pdnews")).length, 5);
    assert.equal(pagingOpens(opened).filter((url) => url.includes("block_type=news")).length < 5, true);
    assert.equal(result.partial, undefined);
  });

  it("reports time_budget when the reserve cuts the Dashboard block itself", async () => {
    // Budget 2 s, reserve 200 ms: 600 ms pages open at ~0, 600 and 1200 ms; the 4th would start past 1800 ms.
    const { provider, opened } = setup({ dashboardPages: 12, walkTimeoutMs: 2_000, slowPagingMs: 600 });
    const result = await provider.listNews({ limit: 100 });
    assert.equal(pagingOpens(opened).length, 3);
    assert.equal(opened.some((url) => url.includes("block_type=news")), false);
    assert.equal(result.partial, true);
    assert.equal(result.partialReason, "time_budget");
  });

  it("ADR 0059: pages the Dashboard block when the course list comes from the membership overview", async () => {
    const { provider, opened, pages } = setup({ dashboardPages: 3 });
    // Live shape: the Dashboard centre shows only side blocks, no course list.
    pages[origin] = snapshotFromHtml(dashboardUrl, "Dashboard",
      `<main><div id="il_center_col"></div><div id="il_right_col">${dashboardBlock(0, 3)}</div><a href="/logout.php">Abmelden</a></main>`, "Dashboard Abmelden");
    pages[`${origin}${MEMBERSHIP_OVERVIEW_PATH}`] = snapshotFromHtml(`${origin}${MEMBERSHIP_OVERVIEW_PATH}`, "My Courses and Groups",
      `<main><div id="il_center_col"><div id="block_dash_mem_1"><div class="il-item"><h4 class="il-item-title"><a href="/go/crs/100001">Course</a></h4></div></div></div><a href="/logout.php">Abmelden</a></main>`,
      "My Courses and Groups Course Abmelden");
    const result = await provider.listNews({ limit: 100 });
    assert.deepEqual(pagingOpens(opened), [dashboardRoute(1), dashboardRoute(2)]);
    assert.equal(opened.includes(courseUrl), true, "the walk reaches the course through the overview");
    assert.deepEqual(result.items.map((news) => news.newsId).sort(), ["1000", "1001", "5000", "5001", "5002"]);
    assert.equal(result.partial, undefined);
  });

  it("course scope pages the course block only", async () => {
    const dashboardBlock = block("pdnews", "77", item("pdnews", "5000", "13. Nov 2026, 08:00"), pagination(dashboardRoute, 0, 3));
    const { provider, opened } = setup({ coursePages: 2, dashboard: dashboardBlock });
    await provider.listNews({ courseRefId: "100001" });
    assert.deepEqual(pagingOpens(opened), [courseRoute(1)]);
  });

  it("stops at the shared read budget and reports time_budget", async () => {
    const { provider, opened } = setup({ walkTimeoutMs: 1_000, slowPagingMs: 600 });
    const result = await provider.listNews({ limit: 100 });
    assert.equal(pagingOpens(opened).length < 5, true);
    assert.equal(result.partial, true);
    assert.equal(result.partialReason, "time_budget");
  });

  it("reports an unreadable later page as partial and keeps what it has", async () => {
    const { provider, pages } = setup({ coursePages: 3 });
    delete pages[courseRoute(2)];
    const result = await provider.listNews({ limit: 100 });
    assert.equal(result.items.length, 4);
    assert.equal(result.partial, true);
  });
});
