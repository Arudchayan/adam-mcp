import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBrowserProvider, uniqueNews } from "./browser-provider.ts";
import { extractCatalog } from "./extract.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

// Synthetic, structure-only mirror of the ILIAS 10.12 Dashboard and course News blocks (#132, ADR 0055).
const origin = "https://adam.unibas.ch";
const dashboardUrl = `${origin}/ilias.php?baseClass=ilDashboardGUI&cmd=jumpToSelectedItems`;
const courseUrl = `${origin}/go/crs/100001`;

const item = (blockType: "news" | "pdnews", id: string, title: string, description: string, date: string) => {
  const gui = blockType === "news" ? "ilNewsForContextBlockGUI" : "ilPDNewsBlockGUI";
  return `
  <li class="il-std-item-container"><div class="il-item il-std-item">
    <h4 class="il-item-title"><a href="ilias.php?baseClass=${blockType === "news" ? "ilrepositorygui" : "ildashboardgui"}&amp;cmdClass=${gui}&amp;cmd=showNews&amp;block_type=${blockType}&amp;news_id=${id}">${title}<br></a></h4>
    <div class="il-item-description">${description}</div>
    <hr class="il-item-divider">
    <div class="row"><div class="col-md-6"><span class="il-item-property-name">Date</span><span class="il-item-property-value">${date}</span></div></div>
  </div></li>`;
};

const pagination = (base: string, blockType: string, pages: number) => `
  <div class="il-viewcontrol-pagination l-bar__element">
    <button class="btn btn-link engaged" data-action="${base}&amp;cmdClass=ilcolumngui&amp;block_type=${blockType}">1</button>
    <button class="btn btn-link" data-action="${base}&amp;cmdClass=ilcolumngui&amp;block_type=${blockType}">${pages}</button>
    <button class="btn btn-default glyph" aria-label="next" data-action="${base}&amp;cmdClass=ilcolumngui&amp;block_type=${blockType}"></button>
  </div>`;

const block = (id: string, blockType: "news" | "pdnews", items: string, extraControls = "") => `
<div id="block_${blockType}_${id}"><div class="panel panel-secondary panel-flex">
  <div class="panel-heading ilHeader"><div class="panel-title"><h2>News</h2></div>
    <div class="panel-viewcontrols l-bar__space-keeper">${pagination(`/ilias.php?baseClass=${blockType === "news" ? "ilrepositorygui" : "ildashboardgui"}`, blockType, 6)}</div>
    <div class="panel-controls">${extraControls}</div></div>
  <div class="panel-body"><div class="il-item-group"><div class="il-item-group-items"><ul>${items}</ul></div></div></div>
</div></div>`;

const dashboardControls = `
  <div class="dropdown"><button class="btn btn-default dropdown-toggle" aria-label="Actions"></button>
    <ul class="dropdown-menu">
      <li><button class="btn btn-link" data-action="/ilias.php?baseClass=ildashboardgui&amp;cmdClass=ilpdnewsblockgui&amp;cmd=showFeedUrl&amp;block_type=pdnews">Get Feed URL</button></li>
      <li><button class="btn btn-link" data-action="/ilias.php?baseClass=ildashboardgui&amp;cmdClass=ilpdnewsblockgui&amp;cmd=editSettings&amp;block_type=pdnews">Settings</button></li>
    </ul></div>`;

const dashboardHtml = (items: string) => `
<main><div id="il_center_col"><div class="ilContainerListItemOuter"><a href="/go/crs/100001">Synthetic course</a></div></div>
<div id="il_right_col">${block("77", "pdnews", items, dashboardControls)}</div><a href="/logout.php">Abmelden</a></main>`;

const courseHtml = (items: string) => `
<nav aria-label="Breadcrumbs"><a href="/go/root/1">ADAM</a><a href="/go/crs/100001">Course</a></nav>
<main><div id="il_center_col"><div class="ilContainerListItemOuter"><a href="/go/file/100011">Sheet.pdf</a></div></div>
<div id="il_right_col">${block("4242", "news", items)}</div><a href="/logout.php">Abmelden</a></main>`;

const fetchedAt = "2026-11-14T10:00:00.000Z";

describe("ADR 0055 Dashboard News block", () => {
  const catalog = extractCatalog(snapshotFromHtml(dashboardUrl, "Dashboard", dashboardHtml(
    item("pdnews", "9001", "File: Sheet 4 uploaded", "A new file is available.", "Today, 08:22") +
    item("pdnews", "9500", "Library closed", "The library is closed on Monday.", "12. Nov 2026, 17:09"),
  ), "Dashboard Abmelden"), fetchedAt);

  it("returns each item with its date, summary and news_id, citing the Dashboard without inventing a course", () => {
    assert.deepEqual(catalog.news.map((news) => [news.title, news.createdAt, news.summary, news.newsId, news.courseRefId, news.url]), [
      ["File: Sheet 4 uploaded", "2026-11-14T07:22:00.000Z", "A new file is available.", "9001", undefined, dashboardUrl],
      ["Library closed", "2026-11-12T16:09:00.000Z", "The library is closed on Monday.", "9500", undefined, dashboardUrl],
    ]);
  });

  it("never turns the label, pagination or feed/settings controls into items", () => {
    assert.equal(catalog.news.some((news) => /^(?:news|get feed url|settings|1|6)$/i.test(news.title)), false);
    assert.equal(catalog.news.length, 2);
    const empty = extractCatalog(snapshotFromHtml(dashboardUrl, "Dashboard", dashboardHtml(""), "Dashboard"), fetchedAt);
    assert.deepEqual(empty.news, []);
  });
});

it("ADR 0055: a news_id shown on the Dashboard and in the course keeps the course row", () => {
  const dashboard = { title: "Same", summary: "s", url: dashboardUrl, newsId: "1", provenance: { sourceUrl: dashboardUrl, fetchedAt, provider: "browser" as const } };
  const course = { ...dashboard, url: courseUrl, courseRefId: "100001", provenance: { ...dashboard.provenance, sourceUrl: courseUrl } };
  const other = { ...dashboard, newsId: "2", title: "Other" };
  assert.deepEqual(uniqueNews([dashboard, other, course]).map((news) => [news.newsId, news.courseRefId]), [["1", "100001"], ["2", undefined]]);
  assert.deepEqual(uniqueNews([course, dashboard]).map((news) => news.courseRefId), ["100001"]);
});

describe("ADR 0055 listNews over the walk", () => {
  const setup = () => {
    const opened: string[] = [];
    const session = createMemorySession({
      [origin]: snapshotFromHtml(dashboardUrl, "Dashboard", dashboardHtml(
        item("pdnews", "9001", "File: Sheet 4 uploaded", "A new file is available.", "Today, 08:22") +
        item("pdnews", "9500", "Library closed", "The library is closed on Monday.", "12. Nov 2026, 17:09"),
      ), "Dashboard Synthetic course Abmelden"),
      [courseUrl]: snapshotFromHtml(courseUrl, "Course", courseHtml(
        item("news", "9001", "File: Sheet 4 uploaded", "A new file is available.", "Today, 08:22") +
        item("news", "9002", "Room change", "Tutorial moves to room 101.", "Yesterday, 12:06"),
      ), "Course Sheet.pdf Abmelden"),
    }, { onOpen: (url) => { opened.push(url); } });
    return { provider: createBrowserProvider({ origin, clock: () => Date.parse(fetchedAt), session }), opened };
  };

  it("unscoped: adds Dashboard news, one row per news_id, the shared one attributed to its course", async () => {
    const { provider, opened } = setup();
    const result = await provider.listNews();
    assert.deepEqual(result.items.map((news) => [news.newsId, news.courseRefId]).sort(), [
      ["9001", "100001"], ["9002", "100001"], ["9500", undefined],
    ]);
    assert.equal(opened.some((url) => /block_type=|showFeedUrl|editSettings|ilcolumngui/i.test(url)), false);
  });

  it("course-scoped: Dashboard news stays out", async () => {
    const { provider } = setup();
    const result = await provider.listNews({ courseRefId: "100001" });
    assert.deepEqual(result.items.map((news) => news.newsId).sort(), ["9001", "9002"]);
  });

  it("since applies to Dashboard items too", async () => {
    const { provider } = setup();
    const result = await provider.listNews({ since: "2026-11-13T00:00:00.000Z" });
    assert.deepEqual(result.items.map((news) => news.newsId).sort(), ["9001", "9002"]);
  });
});
