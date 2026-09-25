import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import { createBrowserProvider } from "./browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

describe("page snapshot reuse", () => {
  it("opens a course URL once for get_course, list_children, and list_files", async () => {
    const opens: string[] = [];
    const courseUrl = "https://adam.unibas.ch/go/crs/100001";
    const courseHtml = `<main>
      <h1>Synthetic course</h1>
      <a href="/go/fold/100010">Notes</a>
      <a href="/logout.php">Abmelden</a>
    </main>`;
    const reused = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession(
        {
          [courseUrl]: snapshotFromHtml(
            courseUrl,
            "Synthetic course",
            courseHtml,
            "Synthetic course Notes Abmelden",
          ),
        },
        { onOpen: (url) => opens.push(url) },
      ),
    });

    await reused.getCourse("100001");
    await reused.listChildren("100001", { type: "crs" });
    await reused.listFiles("100001", { type: "crs" });
    assert.deepEqual(opens, [courseUrl]);

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => reused.getCourse("100001", { signal: controller.signal }), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "cancelled");
      return true;
    });
    assert.deepEqual(opens, [courseUrl], "cancellation must not open another page");

    await reused.login();
    await reused.getCourse("100001");
    assert.deepEqual(opens, [courseUrl, courseUrl], "login() drops the page snapshot cache");
  });
});
