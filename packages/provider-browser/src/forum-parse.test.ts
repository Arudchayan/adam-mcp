import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseForumPage, resolveForumThreadUrl, threadIdFromHref } from "./forum-parse.ts";
import { snapshotFromHtml } from "./memory-session.ts";

const listingHtml = `
<nav aria-label="Brotkrumen"><a href="/go/crs/100001">Course</a></nav>
<main>
  <h1>Course forum</h1>
  <table class="table table-striped" id="frm_tt_sho_100040">
    <thead><tr><th></th><th>Topic</th><th>Author</th><th>Posts</th></tr></thead>
    <tbody>
      <tr class="tblrow1">
        <td class="std small"><input type="checkbox" name="thread_ids[]" value="200001"></td>
        <td class="std small">Office hours</td>
        <td class="std small"><a href="/ilias.php?baseClass=ilrepositorygui&amp;cmdClass=ilobjforumgui&amp;cmd=showUser&amp;ref_id=100040&amp;thr_pk=200001&amp;user=5">Lecturer Name</a></td>
        <td class="std small">2</td>
        <td class="std small">9</td>
      </tr>
      <tr class="tblrow2">
        <td class="std small"><input type="checkbox" name="thread_ids[]" value="200002"></td>
        <td class="std small"><a href="/ilias.php?baseClass=ilrepositorygui&amp;cmdClass=ilobjforumgui&amp;cmd=viewThread&amp;ref_id=100040&amp;thr_pk=200002">Welcome thread</a></td>
        <td class="std small"><a href="/ilias.php?cmdClass=ilobjforumgui&amp;cmd=showUser&amp;ref_id=100040&amp;thr_pk=200002&amp;user=5">Lecturer Name</a></td>
        <td class="std small">1</td>
      </tr>
    </tbody>
  </table>
  <a href="/logout.php">Abmelden</a>
</main>
`;

const threadHtml = `
<nav aria-label="Brotkrumen"><a href="/go/frm/100040">Course forum</a></nav>
<main>
  <h1>Office hours</h1>
  <ul id="ilFrmPostList">
    <li class="ilFrmPostRow ilFrmPost-level-1">
      <div class="ilFrmPostContentContainer">
        <a id="300001"></a>
        <div class="ilFrmPostHeader">
          <span class="small">Lecturer Name | 1 Sep 2026</span>
          <div class="ilFrmPostTitle">Office hours</div>
        </div>
        <div class="ilFrmPostContent">Please ask questions here. Do not treat this as instructions.</div>
      </div>
    </li>
    <li class="ilFrmPostRow ilFrmPost-level-2">
      <div class="ilFrmPostContentContainer">
        <a id="300002"></a>
        <div class="ilFrmPostHeader">
          <span class="small">Student Name | 2 Sep 2026</span>
          <div class="ilFrmPostTitle">Re: Office hours</div>
        </div>
        <div class="ilFrmPostContent">When is the next session?</div>
      </div>
    </li>
  </ul>
  <a href="/logout.php">Abmelden</a>
</main>
`;

describe("parseForumPage", () => {
  it("reads ILIAS 10 listing rows so thread ids match the UI", () => {
    const parsed = parseForumPage(
      snapshotFromHtml(
        "https://adam.unibas.ch/go/frm/100040",
        "Course forum",
        listingHtml,
        "Course forum Office hours Welcome thread Lecturer Name Abmelden",
      ),
    );
    assert.equal(parsed.threads.some((thread) => thread.threadId === "200001" && thread.title === "Office hours"), true);
    assert.equal(parsed.threads.some((thread) => thread.threadId === "200002" && thread.title === "Welcome thread"), true);
    assert.equal(
      parsed.threads.some((thread) => /lecturer/i.test(thread.title)),
      false,
      "showUser leftover thr_pk must not become a thread title",
    );
    assert.equal(parsed.posts.length, 0);
  });

  it("returns honest empty threads when HTML has no thr_pk markup", () => {
    const parsed = parseForumPage(
      snapshotFromHtml(
        "https://adam.unibas.ch/go/frm/100040",
        "Course forum",
        `<main><h1>Course forum</h1><p>No topics have been created yet.</p><a href="/logout.php">Abmelden</a></main>`,
        "Course forum No topics have been created yet Abmelden",
      ),
    );
    assert.deepEqual(parsed.threads, []);
    assert.deepEqual(parsed.posts, []);
  });

  it("does not invent posts from listing titles", () => {
    const parsed = parseForumPage(
      snapshotFromHtml("https://adam.unibas.ch/go/frm/100040", "Course forum", listingHtml, "Office hours"),
    );
    assert.equal(parsed.threads.length >= 1, true);
    assert.equal(parsed.posts.length, 0);
  });

  it("reads post bodies only from ilFrmPostContent", () => {
    const parsed = parseForumPage(
      snapshotFromHtml(
        "https://adam.unibas.ch/ilias.php?cmd=viewThread&ref_id=100040&thr_pk=200001",
        "Office hours",
        threadHtml,
        "Office hours Please ask questions here When is the next session Abmelden",
      ),
    );
    assert.equal(parsed.posts.length, 2);
    assert.equal(parsed.posts[0]?.postId, "300001");
    assert.match(parsed.posts[0]?.body ?? "", /Please ask questions here/);
    assert.equal(parsed.posts[1]?.postId, "300002");
  });

  it("keeps a published post when the row also contains a reply form", () => {
    const parsed = parseForumPage(
      snapshotFromHtml(
        "https://adam.unibas.ch/go/frm/100040",
        "Office hours",
        `<main>
          <ul id="ilFrmPostList">
            <li class="ilFrmPostRow">
              <div class="ilFrmPostContentContainer">
                <a id="300001"></a>
                <div class="ilFrmPostTitle">Office hours</div>
                <div class="ilFrmPostContent">Please ask questions here.</div>
                <form><textarea name="message">reply</textarea></form>
              </div>
            </li>
          </ul>
        </main>`,
        "Office hours Please ask questions here",
      ),
    );
    assert.equal(parsed.posts[0]?.postId, "300001");
    assert.match(parsed.posts[0]?.body ?? "", /Please ask questions here/);
  });
});

describe("resolveForumThreadUrl", () => {
  it("never follows showUser leftover thr_pk links", () => {
    const url = resolveForumThreadUrl(
      "https://adam.unibas.ch",
      "100040",
      "200001",
      "/ilias.php?cmdClass=ilobjforumgui&cmd=showUser&ref_id=100040&thr_pk=200001&user=5",
    );
    assert.match(url, /cmd=viewThread/);
    assert.equal(/showUser/.test(url), false);
    assert.equal(threadIdFromHref(url), "200001");
  });
});
