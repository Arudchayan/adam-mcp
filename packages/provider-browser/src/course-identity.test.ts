import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import { createBrowserProvider } from "./browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

const emptyFolderHtml = `<main>
  <h1>04 - Exercises</h1>
  <p>This folder is empty</p>
  <a href="/logout.php">Abmelden</a>
</main>`;

describe("getCourse identity", () => {
  it("maps an absent course to not_found and a same-ref wrong type to unsupported_type", async () => {
    const absent = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession({
        "https://adam.unibas.ch/go/crs/999999": snapshotFromHtml(
          "https://adam.unibas.ch/",
          "Schreibtisch",
          "<main><h1>Schreibtisch</h1><a href=\"/logout.php\">Abmelden</a></main>",
          "Schreibtisch Abmelden",
        ),
      }),
    });
    await assert.rejects(() => absent.getCourse("999999"), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "not_found");
      assert.equal(error.retryable, false);
      return true;
    });

    const wrongType = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession({
        "https://adam.unibas.ch/go/crs/100020": snapshotFromHtml(
          "https://adam.unibas.ch/go/fold/100020",
          "04 - Exercises",
          emptyFolderHtml,
          "04 - Exercises This folder is empty Abmelden",
        ),
      }),
    });
    await assert.rejects(() => wrongType.getCourse("100020"), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "unsupported_type");
      assert.match(error.message, /fold/);
      return true;
    });
  });

  it("keeps stale_id when a file open of a course ref lands on a different category", async () => {
    const redirected = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession({
        "https://adam.unibas.ch/go/file/100001": snapshotFromHtml(
          "https://adam.unibas.ch/go/cat/100050",
          "Category",
          "<main><h1>Category</h1><a href=\"/logout.php\">Abmelden</a></main>",
          "Category Abmelden",
        ),
      }),
    });
    await assert.rejects(() => redirected.getCourse("100001", { type: "file" }), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "stale_id");
      assert.equal(error.retryable, false);
      assert.match(error.message, /not a missing object/);
      return true;
    });
  });
});
