import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractCatalog } from "./extract.ts";
import { snapshotFromHtml } from "./memory-session.ts";

// Mirrors the live ILIAS 10.12 course News block shape (structure-only probe, #118).
const newsItem = (id: string, title: string, description: string, date: string) => `
  <li class="il-std-item-container"><div class="il-item il-std-item">
    <h4 class="il-item-title"><a href="ilias.php?baseClass=ilrepositorygui&amp;cmdClass=ilNewsForContextBlockGUI&amp;cmd=showNews&amp;ref_id=100001&amp;col_side=right&amp;block_type=news&amp;news_context=1&amp;news_id=${id}">${title}<br></a></h4>
    <div class="il-item-description">${description}</div>
    <hr class="il-item-divider">
    <div class="row">
      <div class="col-md-6 il-multi-line-cap-3"><span class="il-item-property-name">Date</span><span class="il-item-property-value">${date}</span></div>
      <div class="col-md-6 il-multi-line-cap-3"><span class="il-item-property-name"></span><span class="il-item-property-value"></span></div>
    </div>
  </div></li>`;

const coursePage = (items: string) => `
<nav aria-label="Breadcrumbs"><a href="/go/root/1">ADAM</a><a href="/go/crs/100001">Course</a></nav>
<main><div id="il_center_col"><div class="ilContainerListItemOuter"><a href="/go/file/100011">Sheet.pdf</a></div></div>
<div id="il_right_col"><div id="block_news_4242"><div class="panel panel-secondary panel-flex">
  <div class="panel-heading ilHeader"><div class="panel-title"><h2>News</h2></div>
    <div class="panel-viewcontrols l-bar__space-keeper"><div class="il-viewcontrol-pagination l-bar__element"><button class="btn btn-link engaged">1</button></div></div>
    <div class="panel-controls"></div></div>
  <div class="panel-body"><div class="il-item-group"><div class="il-item-group-items"><ul>${items}</ul></div></div></div>
</div></div></div><a href="/logout.php">Abmelden</a></main>`;

describe("#118 course News block", () => {
  const fetchedAt = "2026-11-14T10:00:00.000Z";
  const catalog = extractCatalog(snapshotFromHtml("https://adam.unibas.ch/go/crs/100001", "Course", coursePage(
    newsItem("9001", "File: Sheet 4 uploaded", "A new file is available.", "Today, 08:22") +
    newsItem("9002", "Room change", "Tutorial moves to room 101.", "Yesterday, 12:06") +
    newsItem("9003", "Exam registration", "Register by Friday.", "12. Nov 2026, 17:09"),
  ), "Course Abmelden"), fetchedAt);

  it("returns every item in the block with its date, course and summary", () => {
    assert.deepEqual(catalog.news.map((item) => [item.title, item.createdAt, item.courseRefId, item.summary]), [
      ["File: Sheet 4 uploaded", "2026-11-14T07:22:00.000Z", "100001", "A new file is available."],
      ["Room change", "2026-11-13T11:06:00.000Z", "100001", "Tutorial moves to room 101."],
      ["Exam registration", "2026-11-12T16:09:00.000Z", "100001", "Register by Friday."],
    ]);
  });

  it("cites the course, not the block's internal news link", () => {
    assert.equal(catalog.news.every((item) => item.url === "https://adam.unibas.ch/go/crs/100001"), true);
  });

  it("never turns the News label into an item, and stays empty without items", () => {
    assert.equal(catalog.news.some((item) => /^news$/i.test(item.title)), false);
    const empty = extractCatalog(snapshotFromHtml("https://adam.unibas.ch/go/crs/100001", "Course", coursePage(""), "Course"), fetchedAt);
    assert.deepEqual(empty.news, []);
  });
});

it("#118: keeps distinct news items that share a title", () => {
  const catalog = extractCatalog(snapshotFromHtml("https://adam.unibas.ch/go/crs/100001", "Course", coursePage(
    newsItem("9101", "File: Notes.pdf", "Updated.", "Today, 08:22") + newsItem("9102", "File: Notes.pdf", "Updated again.", "Today, 09:40"),
  ), "Course"), "2026-11-14T10:00:00.000Z");
  assert.equal(catalog.news.length, 2);
});
