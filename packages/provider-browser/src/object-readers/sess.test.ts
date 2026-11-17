import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createBrowserProvider } from "../browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../memory-session.ts";
import { textOf } from "../ui-items.ts";
import { OBJECT_READERS, type ReaderContext } from "./index.ts";
import { readSession, type SessionDetail } from "./sess.ts";

/**
 * ADR 0062 (#165): the session info screen from the ILIAS 10.12 lab (tools/ilias-lab), as a
 * student. The lab serves http://localhost:8080; URLs are rebased onto ADAM's pinned origin.
 */
const ORIGIN = "https://adam.unibas.ch";
const lab = (name: string) => {
  const fixture = JSON.parse(readFileSync(new URL(`../../fixtures/lab/${name}.json`, import.meta.url), "utf8")) as { html: string };
  return fixture.html.replaceAll("http://localhost:8080", ORIGIN);
};
const ctx = (html: string) => ({ page: { url: `${ORIGIN}/go/sess/88`, html, text: textOf(html) } }) as unknown as ReaderContext;

describe("ADR 0062: session reader on the lab info screen", () => {
  it("reads the seeded location and details, with the date absent", async () => {
    const result = await readSession(ctx(lab("sess-info-student")));
    assert.ok(result);
    const detail = result.detail as SessionDetail;
    assert.equal(detail.kind, "session");
    assert.equal(detail.evidence, "lab-verified");
    assert.equal(detail.location, "Lab room 0.01 (synthetic)");
    assert.equal(detail.details, "Lab seed: bring the synthetic worksheet from the lab step list.");
    // The lab session has no appointment: the info screen shows no date and no materials.
    assert.equal(detail.startsAt, undefined);
    assert.equal(detail.dateText, undefined);
    assert.deepEqual(detail.materials, []);
  });

  it("returns undefined for pages that are not a session info screen", async () => {
    assert.equal(await readSession(ctx(lab("course-student"))), undefined);
    assert.equal(await readSession(ctx(lab("lso-learner-student"))), undefined);
    assert.equal(await readSession(ctx("<main><p>Session Information is mentioned here only</p></main>")), undefined);
  });

  it("never reads a materials link that is not an ADAM object reference", async () => {
    const html = lab("sess-info-student").replace(
      "</form>",
      '<div class="ilInfoScreenSec form-horizontal" id="infoscreen_section_9"><div class="ilFormHeader clearfix"><h2 class="ilHeader">Materials</h2></div>' +
        `<a href="https://evil.example/go/fold/87">Outside</a><a href="http://localhost:8080/goto.php/fold/87">Plain http</a><a href="${ORIGIN}/goto.php/fold/87">Lab fold</a></div></form>`,
    );
    const result = await readSession(ctx(html));
    assert.ok(result);
    const materials = (result.detail as SessionDetail).materials;
    assert.deepEqual(materials, [{ title: "Lab fold", type: "fold", refId: "87", url: `${ORIGIN}/go/fold/87` }]);
  });

  it("is registered for sess and read end-to-end through readPage", async () => {
    assert.ok(OBJECT_READERS.sess);
    const url = `${ORIGIN}/go/sess/88`;
    const pages = { [url]: snapshotFromHtml(url, "Lab sess", lab("sess-info-student"), textOf(lab("sess-info-student"))) };
    const provider = createBrowserProvider({ session: createMemorySession(pages), clock: () => Date.parse("2026-11-17T10:00:00Z") });
    const page = await provider.readPage("88", { type: "sess" });
    assert.equal(page.detailStatus, "read");
    assert.equal((page.detail as SessionDetail).location, "Lab room 0.01 (synthetic)");
    assert.equal((page.detail as SessionDetail).kind, "session");
  });
});
