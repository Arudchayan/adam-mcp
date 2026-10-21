import assert from "node:assert/strict";
import { it } from "node:test";
import { AdamError } from "adam-core";
import { createBrowserProvider } from "./browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";
import { resolveForumThreadUrl } from "./forum-parse.ts";

const origin = "https://adam.unibas.ch";
const forumUrl = `${origin}/go/frm/100040`;
const threadUrl = (id: string) => resolveForumThreadUrl(origin, "100040", id);
const post = (label: string) => `<main><h1>${label}</h1><div class="ilFrmPostContentContainer"><a id="300001"></a><div class="ilFrmPostTitle">${label}</div><div class="ilFrmPostContent">Body of ${label}</div></div><a href="/logout.php">Abmelden</a></main>`;
const snapshot = (url: string, label: string) => snapshotFromHtml(url, label, post(label), `${label} Abmelden`);

it("opens the requested thread instead of relabelling posts from an overview redirect", async () => {
  const opened: string[] = [];
  const provider = createBrowserProvider({ session: createMemorySession({
    [forumUrl]: snapshot(threadUrl("200001"), "Thread A"),
    [threadUrl("200002")]: snapshot(threadUrl("200002"), "Thread B"),
  }, { onOpen: (url) => opened.push(url) }) });
  const forum = await provider.getForum("100040", { threadId: "200002" });
  assert.equal(forum.selectedThread?.threadId, "200002");
  assert.equal(forum.selectedThread?.posts[0]?.body, "Body of Thread B");
  assert.deepEqual(opened, [forumUrl, threadUrl("200002")]);
});

for (const landed of [threadUrl("200001"), forumUrl]) {
  it(`rejects a requested thread landing with mismatched/absent identity: ${landed}`, async () => {
    const provider = createBrowserProvider({ session: createMemorySession({
      [forumUrl]: snapshotFromHtml(forumUrl, "Forum", '<main><h1>Forum</h1><a href="/logout.php">Abmelden</a></main>', "Forum Abmelden"),
      [threadUrl("200002")]: snapshot(landed, "Wrong thread"),
    }) });
    await assert.rejects(() => provider.getForum("100040", { threadId: "200002" }),
      (error: unknown) => error instanceof AdamError && error.code === "stale_id");
  });
}

it("reuses initial posts only when the landed thread matches, without a second navigation", async () => {
  let opens = 0;
  const provider = createBrowserProvider({ session: createMemorySession({ [forumUrl]: snapshot(threadUrl("200001"), "Thread A") }, { onOpen: () => opens++ }) });
  assert.equal((await provider.getForum("100040", { threadId: "200001" })).selectedThread?.posts[0]?.body, "Body of Thread A");
  assert.equal(opens, 1);
});

for (const href of [
  "/logout.php?thr_pk=200002",
  "/logout.php?cmd=viewThread&thr_pk=200002",
  "/ilias.php?cmd=deleteThread&ref_id=100040&thr_pk=200002",
  "https://example.org/ilias.php?cmd=viewThread&ref_id=100040&thr_pk=200002",
  "/ilias.php?cmd=viewThread&ref_id=999999&thr_pk=200002",
  "/ilias.php?%63md=logout&thr_pk=200002",
  "/ilias.php?cmd=viewThread&%63md=deleteThread&ref_id=100040&thr_pk=200002",
  "/ilias.php?cmd=viewThread&cmd=deleteThread&ref_id=100040&thr_pk=200002",
  "/ilias.php?cmd=viewThread&ref_id=999999&ref_id=100040&thr_pk=200002&thr_pk=999999",
  "/logout.php#thr_pk=200002",
  "/ilias.php?cmd=viewThread&thr_pk=200002#cmd=logout",
  "/goto.php?target=frm_999999_200002",
  "./ilias.php?cmd=viewThread&ref_id=100040&thr_pk=200002&page=0",
]) {
  it(`never uses a source href as the authenticated thread target: ${href}`, async () => {
    const opened: string[] = [];
    const listing = `<main><h1>Forum</h1><h4 class="il-item-title"><a href="${href.replaceAll("&", "&amp;")}">Thread B</a></h4><a href="/logout.php">Abmelden</a></main>`;
    const provider = createBrowserProvider({ session: createMemorySession({
      [forumUrl]: snapshotFromHtml(forumUrl, "Forum", listing, "Forum Thread B Abmelden"),
      [threadUrl("200002")]: snapshot(threadUrl("200002"), "Thread B"),
    }, { onOpen: (url) => opened.push(url) }) });
    const forum = await provider.getForum("100040", { threadId: "200002" });
    assert.equal(forum.selectedThread?.posts[0]?.body, "Body of Thread B");
    assert.deepEqual(opened, [forumUrl, threadUrl("200002")]);
  });
}

for (const [refId, threadId] of [["100040", ""], ["100040", "200002&cmd=logout"], ["100040", "200002\n"], ["100040&cmd=logout", "200002"]]) {
  it(`rejects malformed requested forum/thread IDs before opening: ${JSON.stringify([refId, threadId])}`, async () => {
    const opened: string[] = [];
    const provider = createBrowserProvider({ session: createMemorySession({ [forumUrl]: snapshot(forumUrl, "Forum") }, { onOpen: (url) => opened.push(url) }) });
    await assert.rejects(() => provider.getForum(refId!, { threadId }), (error: unknown) => error instanceof AdamError && error.code === "stale_id");
    assert.deepEqual(opened, []);
  });
}

const courseUrl = `${origin}/go/crs/100001`;
const home = snapshotFromHtml(`${origin}/ilias.php?baseClass=ilDashboardGUI`, "Dashboard", '<main><a href="/go/crs/100001">Course</a></main>', "Dashboard Course Abmelden");
function newsProvider(html: string) {
  return createBrowserProvider({ session: createMemorySession({
    [origin]: home,
    [courseUrl]: snapshotFromHtml(courseUrl, "Course", `<main><h1>Course</h1>${html}<a href="/logout.php">Abmelden</a></main>`, "Course News Old file Abmelden"),
  }) });
}

it("does not turn an empty News label and an old file into activity", async () => {
  const provider = newsProvider('<section class="news"><h2>News</h2></section><a href="/go/file/100011">Old notes.txt</a>');
  assert.deepEqual((await provider.listNews()).items, []);
  assert.deepEqual((await provider.listNews({ since: "2099-01-01T00:00:00Z" })).items, []);
});

it("keeps distinct course announcements and excludes undated items only for cutoff queries", async () => {
  const provider = newsProvider('<section class="news"><article><h3>Undated item</h3><p>Unknown publication time</p></article><article><h3>Dated item</h3><time datetime="2026-10-01T12:00:00Z">1 October</time></article></section>');
  assert.deepEqual((await provider.listNews()).items.map((item) => item.title), ["Undated item", "Dated item"]);
  assert.deepEqual((await provider.listNews({ since: "2026-09-01T00:00:00Z" })).items.map((item) => item.title), ["Dated item"]);
  assert.deepEqual((await provider.listNews({ since: "2099-01-01T00:00:00Z" })).items, []);
});

it("rejects invalid cutoffs before performing the enrolled walk", async () => {
  let opens = 0;
  const provider = createBrowserProvider({ session: createMemorySession({ [origin]: home }, { onOpen: () => opens++ }) });
  await assert.rejects(() => provider.listNews({ since: "not a date" }), AdamError);
  assert.equal(opens, 0);
});
