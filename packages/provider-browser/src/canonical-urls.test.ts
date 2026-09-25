import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBrowserProvider } from "./browser-provider.ts";
import { extractCatalog } from "./extract.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

describe("canonical ADAM citations", () => {
  it("uses /go/{type}/{id} when a news href or the open page parses", () => {
    const withType = snapshotFromHtml(
      "https://adam.unibas.ch/ilias.php?cmdClass=ilobjcoursegui&ref_id=100001",
      "Course",
      `<main>
        <article>
          <a href="https://adam.unibas.ch/ilias.php?ref_id=100011&amp;cmdClass=ilobjfilegui">Overview</a>
          <p>New file uploaded for the seminar.</p>
        </article>
        <article>
          <a href="https://example.invalid/not-adam">Elsewhere</a>
          <p>Article href is not an ADAM ref, so the open page is the citation.</p>
        </article>
      </main>`,
      "Overview New file uploaded for the seminar. Elsewhere Article href is not an ADAM ref.",
    );
    const typed = extractCatalog(withType, "2026-09-25T00:00:00.000Z");
    assert.equal(
      typed.news.find((item) => item.title === "Overview")?.url,
      "https://adam.unibas.ch/go/file/100011",
    );
    assert.equal(
      typed.news.find((item) => item.title === "Elsewhere")?.url,
      "https://adam.unibas.ch/go/crs/100001",
    );

    const untyped = snapshotFromHtml(
      "https://adam.unibas.ch/ilias.php?ref_id=100099",
      "Page",
      `<main><article><a href="https://adam.unibas.ch/ilias.php?ref_id=100088">No type</a><p>Body without a typed ref.</p></article></main>`,
      "No type Body without a typed ref.",
    );
    const plain = extractCatalog(untyped, "2026-09-25T00:00:00.000Z");
    assert.equal(plain.news[0]?.url, "https://adam.unibas.ch/ilias.php?ref_id=100099");
    assert.doesNotMatch(plain.news[0]?.url ?? "", /\/go\/unknown\//);
  });

  it("emits a typed /go/ child when an ilias.php href parses and keeps unknown refs", async () => {
    const snapshot = snapshotFromHtml(
      "https://adam.unibas.ch/go/fold/100010",
      "Notes",
      `<main>
        <h1>Notes</h1>
        <a href="https://adam.unibas.ch/ilias.php?ref_id=100011">Overview</a>
        <a href="https://adam.unibas.ch/ilias.php?ref_id=100011&amp;cmdClass=ilobjfilegui">Overview</a>
        <a href="https://adam.unibas.ch/ilias.php?ref_id=100012">Mystery item</a>
        <a href="/logout.php">Abmelden</a>
      </main>`,
      "Notes Overview Mystery item Abmelden",
    );
    const listed = await createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession({ "https://adam.unibas.ch/go/fold/100010": snapshot }),
    }).listChildren("100010", { type: "fold" });
    assert.equal(listed.listingState, "ok");
    assert.notEqual(listed.listingState, "empty");
    const file = listed.items.find((item) => item.refId === "100011");
    assert.equal(file?.type, "file");
    assert.equal(file?.url, "https://adam.unibas.ch/go/file/100011");
    const mystery = listed.items.find((item) => item.refId === "100012");
    assert.equal(mystery?.type, "unknown");
    assert.equal(mystery?.url, "https://adam.unibas.ch/ilias.php?ref_id=100012");
  });
});
