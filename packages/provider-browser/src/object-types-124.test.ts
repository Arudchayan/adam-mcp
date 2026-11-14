import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdamError, parseAdamRef } from "adam-core";
import { createBrowserProvider } from "./browser-provider.ts";
import { classifyListing, extractCatalog, inlinePollForms } from "./extract.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

// ADR 0049 / #124: synthetic markup modelled on ILIAS 10.12. No live ADAM content.
const ORIGIN = "https://adam.unibas.ch";
const FETCHED_AT = "2026-11-14T10:00:00.000Z";

const courseHtml = `<main><h1>Synthetic course</h1>
  <div class="ilContainerListItemOuter"><a class="il_ContainerItemTitle" href="${ORIGIN}/go/svy/700010">Course evaluation</a></div>
  <div class="ilContainerListItemOuter"><a class="il_ContainerItemTitle" href="${ORIGIN}/ilias.php?baseClass=ilObjSurveyGUI&amp;ref_id=700011&amp;cmd=infoScreen">Second survey</a></div>
  <div class="ilContainerListItemOuter">
    <div class="il_ContainerItemTitle">Which tutorial slot suits you?</div>
    <form method="post" action="${ORIGIN}/ilias.php?baseClass=ilRepositoryGUI&amp;cmdClass=ilObjPollGUI&amp;cmd=vote&amp;ref_id=700020">
      <input type="radio" name="aw" value="1"> Monday <button type="submit">Vote</button>
    </form>
  </div>
  <a href="/logout.php">Abmelden</a>
</main>`;

const rootHtml = `<main><h1>Magazin</h1><div class="il-deck">
  <div class="il-card thumbnail">
    <a href="${ORIGIN}/go/cat/900001" aria-label="Open Synthetic Faculty"><img src="x.svg" alt="Category"></a>
    <button aria-label="Actions for Synthetic Faculty"></button>
    <div class="card-title"><a href="${ORIGIN}/go/cat/900001">Synthetic Faculty</a></div>
  </div>
  <div class="il-card thumbnail">
    <a href="${ORIGIN}/go/cat/900002" aria-label="Open Synthetic Library"><img src="x.svg" alt="Category"></a>
    <div class="card-title"><a href="${ORIGIN}/go/cat/900002">Synthetic Library</a></div>
  </div>
</div><a href="/logout.php">Abmelden</a></main>`;

describe("#124 object types", () => {
  it("parses svy and poll refs from /go, goto, cmdClass and baseClass URLs", () => {
    assert.deepEqual(parseAdamRef(`${ORIGIN}/go/svy/700010`), { type: "svy", refId: "700010" });
    assert.deepEqual(parseAdamRef(`${ORIGIN}/goto.php?target=poll_700020`), { type: "poll", refId: "700020" });
    assert.deepEqual(
      parseAdamRef(`${ORIGIN}/ilias.php?baseClass=ilObjSurveyGUI&ref_id=700011&cmd=infoScreen`),
      { type: "svy", refId: "700011" },
    );
    assert.deepEqual(
      parseAdamRef(`${ORIGIN}/ilias.php?baseClass=ilRepositoryGUI&cmdClass=ilObjPollGUI&cmd=vote&ref_id=700020`),
      { type: "poll", refId: "700020" },
    );
    // A generic baseClass still says nothing about the ref's type.
    assert.deepEqual(parseAdamRef(`${ORIGIN}/ilias.php?baseClass=ilRepositoryGUI&ref_id=700030`), { type: "unknown", refId: "700030" });
    // cmdClass still wins over baseClass.
    assert.equal(parseAdamRef(`${ORIGIN}/ilias.php?baseClass=ilObjSurveyGUI&cmdClass=ilObjTestGUI&ref_id=1`)?.type, "tst");
  });

  it("lists surveys with /go/svy citations and inline polls from their vote form", () => {
    const catalog = extractCatalog(
      snapshotFromHtml(`${ORIGIN}/go/crs/700000`, "Synthetic course", courseHtml, "Synthetic course"),
      FETCHED_AT,
    );
    const byRef = new Map(catalog.objects.map((item) => [item.refId, item]));
    assert.equal(byRef.get("700010")?.type, "svy");
    assert.equal(byRef.get("700010")?.url, `${ORIGIN}/go/svy/700010`);
    assert.equal(byRef.get("700011")?.type, "svy");
    assert.equal(byRef.get("700011")?.url, `${ORIGIN}/go/svy/700011`);
    const poll = byRef.get("700020");
    assert.equal(poll?.type, "poll");
    assert.equal(poll?.title, "Which tutorial slot suits you?");
    assert.equal(poll?.url, `${ORIGIN}/go/poll/700020`);
    assert.equal(catalog.objects.filter((item) => item.refId === "700020").length, 1);
  });

  it("ignores poll forms outside main and falls back to a neutral title", () => {
    const html = `<header><form action="${ORIGIN}/go/poll/1"></form></header><main><form action="${ORIGIN}/goto.php?target=poll_2"><button>Vote</button></form></main>`;
    assert.deepEqual(inlinePollForms(html), [{ refId: "2", title: "Poll 2" }]);
  });

  it("parses repository-root category cards and prefers the plain title over 'Open …'", () => {
    const snapshot = { ...snapshotFromHtml(`${ORIGIN}/go/root/1`, "Magazin", rootHtml, "Magazin"), dom: { itemRows: 2, emptyCopy: false } };
    const catalog = extractCatalog(snapshot, FETCHED_AT);
    assert.deepEqual(
      catalog.objects.map((item) => [item.type, item.refId, item.title]),
      [["cat", "900001", "Synthetic Faculty"], ["cat", "900002", "Synthetic Library"]],
    );
    assert.equal(classifyListing(snapshot, catalog.objects.length).state, "ok");
  });

  it("names image-only card links from aria-label", () => {
    const html = `<main><div class="il-card"><a href="${ORIGIN}/go/cat/900003" aria-label="Open Synthetic Archive"><img alt="Category"></a></div></main>`;
    const catalog = extractCatalog(snapshotFromHtml(`${ORIGIN}/go/root/1`, "Magazin", html, "Magazin"), FETCHED_AT);
    assert.deepEqual(catalog.objects.map((item) => item.title), ["Open Synthetic Archive"]);
  });
});

describe("#124 browser provider", () => {
  it("lists the repository root through cards", async () => {
    const provider = createBrowserProvider({
      origin: ORIGIN,
      session: createMemorySession({
        [`${ORIGIN}/go/root/1`]: { ...snapshotFromHtml(`${ORIGIN}/go/root/1`, "Magazin", rootHtml, "Magazin Abmelden"), dom: { itemRows: 2, emptyCopy: false } },
      }),
    });
    const page = await provider.listChildren("1", { type: "root" });
    assert.equal(page.listingState, "ok");
    assert.deepEqual(page.items.map((item) => `${item.type}/${item.refId}`), ["cat/900001", "cat/900002"]);
  });

  it("reads a survey info page through /go/svy once its type is known", async () => {
    const surveyUrl = `${ORIGIN}/ilias.php?baseClass=ilObjSurveyGUI&ref_id=700010&cmd=infoScreen`;
    const provider = createBrowserProvider({
      origin: ORIGIN,
      session: createMemorySession({
        [`${ORIGIN}/go/svy/700010`]: snapshotFromHtml(
          surveyUrl,
          "Course evaluation",
          "<main><h1>Course evaluation</h1><p>You have already completed the survey.</p><a href=\"/logout.php\">Abmelden</a></main>",
          "Course evaluation You have already completed the survey. Abmelden",
        ),
      }),
    });
    const page = await provider.readPage("700010", { type: "svy" });
    assert.equal(page.type, "svy");
    assert.equal(page.url, `${ORIGIN}/go/svy/700010`);
    assert.match(page.text, /already completed/);
  });

  it("reports unsupported_type, not stale_id, when a guessed type redirects to the parent course", async () => {
    const parent = snapshotFromHtml(`${ORIGIN}/go/crs/700000`, "Synthetic course", courseHtml, "Synthetic course Abmelden");
    const provider = createBrowserProvider({
      origin: ORIGIN,
      session: createMemorySession({ [`${ORIGIN}/go/crs/700099`]: parent }),
    });
    await assert.rejects(() => provider.readPage("700099"), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "unsupported_type");
      assert.equal(error.retryable, false);
      assert.match(error.message, /could not identify this object's type/);
      return true;
    });
  });

  it("keeps stale_id when the caller passed the type explicitly", async () => {
    const parent = snapshotFromHtml(`${ORIGIN}/go/crs/700000`, "Synthetic course", courseHtml, "Synthetic course Abmelden");
    const provider = createBrowserProvider({
      origin: ORIGIN,
      session: createMemorySession({ [`${ORIGIN}/go/svy/700099`]: parent }),
    });
    await assert.rejects(() => provider.readPage("700099", { type: "svy" }), (error: unknown) =>
      error instanceof AdamError && error.code === "stale_id");
  });
});
