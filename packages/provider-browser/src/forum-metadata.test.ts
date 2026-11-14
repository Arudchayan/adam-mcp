import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactText } from "adam-core";
import { parseAdamTimestamp } from "./deadlines.ts";
import { parseForumPage } from "./forum-parse.ts";
import { snapshotFromHtml } from "./memory-session.ts";

const item = (thread: string, title: string, props: Array<[string, string]>) => `
  <div class="il-item il-std-item">
    <h4 class="il-item-title"><a href="./ilias.php?baseClass=ilrepositorygui&amp;cmdClass=ilobjforumgui&amp;cmd=viewThread&amp;ref_id=100040&amp;thr_pk=${thread}&amp;page=0">${title}</a></h4>
    <div class="il-item-properties">
      ${props.map(([name, value]) => `<span class="il-item-property-name">${name}</span><span class="il-item-property-value">${value}</span>`).join("\n      ")}
    </div>
  </div>`;

const listing = `
<nav aria-label="Breadcrumbs"><a href="/go/frm/100040">Forum</a></nav>
<main><h1>Course forum</h1>
  <div class="il-panel-listing-std-container"><h2>Thread Overview</h2><div class="il-item-group">
    ${item("200001", "Office hours", [["Created by", "Lecturer Name"], ["Posts", "14 (3 Unread)"], ["Latest Post", "12. Nov 2026, 17:17"], ["Visits", "40"]])}
    ${item("200002", "Exam questions", [["Erstellt von", "Tutor Name"], ["Beiträge", "2 (0 ungelesen)"], ["Letzter Beitrag", "1. Okt 2026, 08:05"]])}
    ${item("200003", "Old thread", [["Posts", "5"]])}
  </div></div>
  <a href="/logout.php">Abmelden</a>
</main>`;

const thread = `
<nav aria-label="Breadcrumbs"><a href="/go/frm/100040">Forum</a></nav>
<main><h1>Office hours</h1><ul id="ilFrmPostList">
  <li class="ilFrmPostRow"><div class="ilFrmPostContentContainer"><a id="300001"></a>
    <div class="ilFrmPostHeader"><span class="small">Lecturer Name | 12. Nov 2026, 17:17</span><div class="ilFrmPostTitle">Office hours</div></div>
    <div class="ilFrmPostContent">Ask here.</div></div></li>
  <li class="ilFrmPostRow"><div class="ilFrmPostContentContainer"><a id="300002"></a>
    <div class="ilFrmPostHeader"><span class="small">student@example.org | 1 Sep 2026</span><div class="ilFrmPostTitle">Re: 12 Oct 2026 plan</div></div>
    <div class="ilFrmPostContent">Question.</div></div></li>
  <li class="ilFrmPostRow"><div class="ilFrmPostContentContainer"><a id="300003"></a>
    <div class="ilFrmPostHeader"><span class="small">Peer Name</span><div class="ilFrmPostTitle">Undated</div></div>
    <div class="ilFrmPostContent">No date shown.</div></div></li>
</ul><a href="/logout.php">Abmelden</a></main>`;

describe("#125 forum thread metadata", () => {
  const parsed = parseForumPage(snapshotFromHtml("https://adam.unibas.ch/go/frm/100040", "Course forum", listing, "Course forum Abmelden"));
  const byId = Object.fromEntries(parsed.threads.map((summary) => [summary.threadId, summary]));

  it("reads author, post and unread counts, and latest post time from ILIAS 10.12 item properties", () => {
    assert.equal(byId["200001"]?.author, "Lecturer Name");
    assert.equal(byId["200001"]?.postCount, 14);
    assert.equal(byId["200001"]?.unreadCount, 3);
    assert.equal(byId["200001"]?.updatedAt, "2026-11-12T16:17:00.000Z", "Zurich CET wall time");
  });

  it("reads German labels and summer-time timestamps", () => {
    assert.equal(byId["200002"]?.author, "Tutor Name");
    assert.equal(byId["200002"]?.postCount, 2);
    assert.equal(byId["200002"]?.unreadCount, 0);
    assert.equal(byId["200002"]?.updatedAt, "2026-10-01T06:05:00.000Z", "Zurich CEST wall time");
  });

  it("omits fields the page does not show and never borrows a neighbour's properties", () => {
    assert.equal(byId["200003"]?.postCount, 5);
    assert.equal(byId["200003"]?.unreadCount, undefined);
    assert.equal(byId["200003"]?.author, undefined);
    assert.equal(byId["200003"]?.updatedAt, undefined);
  });
});

describe("#125 forum post timestamps", () => {
  const posts = parseForumPage(snapshotFromHtml("https://adam.unibas.ch/go/frm/100040", "Office hours", thread, "Office hours Abmelden")).posts;

  it("reads the posting time after the author", () => {
    assert.equal(posts[0]?.createdAt, "2026-11-12T16:17:00.000Z");
    assert.equal(posts[1]?.createdAt, "2026-09-01T00:00:00.000Z", "date-only stays UTC midnight");
  });

  it("does not take a date from the post subject or invent one", () => {
    assert.equal(posts[2]?.createdAt, undefined);
  });

  it("still redacts an email shown as the author, and only the email", () => {
    assert.equal(redactText(posts[1]?.author ?? ""), "[redacted-email]");
    assert.equal(redactText(posts[0]?.author ?? ""), "Lecturer Name");
  });
});

describe("parseAdamTimestamp", () => {
  const now = new Date("2026-11-14T10:00:00Z");
  it("parses absolute and relative ILIAS display times", () => {
    assert.equal(parseAdamTimestamp("12. Oct 2026, 17:17", now), "2026-10-12T15:17:00.000Z");
    assert.equal(parseAdamTimestamp("Today, 09:05", now), "2026-11-14T08:05:00.000Z");
    assert.equal(parseAdamTimestamp("Gestern, 18:00", now), "2026-11-13T17:00:00.000Z");
  });
  it("omits unparseable or time-less relative values", () => {
    assert.equal(parseAdamTimestamp("soon", now), undefined);
    assert.equal(parseAdamTimestamp("Today", now), undefined);
    assert.equal(parseAdamTimestamp("12. Oct 2026, 25:00", now), undefined);
  });
});
