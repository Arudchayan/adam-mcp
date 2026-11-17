import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createBrowserProvider } from "../browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../memory-session.ts";
import { textOf } from "../ui-items.ts";
import { OBJECT_READERS, type ReaderContext } from "./index.ts";
import { readSession, sessionDates, type SessionDetail } from "./sess.ts";

/**
 * ADR 0062 (#165): the session info screen from the ILIAS 10.12 lab (tools/ilias-lab), as a
 * student. The lab serves http://localhost:8080; URLs are rebased onto ADAM's pinned origin.
 */
const ORIGIN = "https://adam.unibas.ch";
const lab = (name: string) => {
  const fixture = JSON.parse(readFileSync(new URL(`../../fixtures/lab/${name}.json`, import.meta.url), "utf8")) as { html: string };
  return fixture.html.replaceAll("http://localhost:8080", ORIGIN);
};
const ctx = (html: string) => ({ page: { url: `${ORIGIN}/go/sess/116`, html, text: textOf(html) } }) as unknown as ReaderContext;

describe("ADR 0062: session reader on the lab info screen", () => {
  it("reads the seeded date range, location, details and description", async () => {
    const result = await readSession(ctx(lab("sess-info-student")));
    assert.ok(result);
    const detail = result.detail as SessionDetail;
    assert.equal(detail.kind, "session");
    assert.equal(detail.evidence, "lab-verified");
    assert.equal(detail.dateText, "10. Dec 2026, 09:00 - 11:30");
    // 09:00 and 11:30 Europe/Zurich in December (UTC+1).
    assert.equal(detail.startsAt, "2026-12-10T08:00:00.000Z");
    assert.equal(detail.endsAt, "2026-12-10T10:30:00.000Z");
    assert.equal(detail.location, "Lab room 0.01 (synthetic)");
    assert.equal(detail.details, "Lab seed: bring the synthetic worksheet from the lab step list.");
    assert.equal(detail.description, "Lab seed: synthetic session description for the reader tests. Not real course content.");
  });

  it("leaves the date fields absent for an undated session", async () => {
    const result = await readSession(ctx(lab("sess-info-undated-student")));
    assert.ok(result);
    const detail = result.detail as SessionDetail;
    assert.equal(detail.startsAt, undefined);
    assert.equal(detail.endsAt, undefined);
    assert.equal(detail.dateText, undefined);
    assert.equal(detail.location, "Lab room 0.01 (synthetic)");
  });

  it("parses the header date range in Europe/Zurich and rejects other text", () => {
    assert.equal(sessionDates("No date - No date: Lab sess"), undefined);
    assert.deepEqual(sessionDates("10. Dec 2026, 09:00 - 11:30: Lab sess dated"), {
      dateText: "10. Dec 2026, 09:00 - 11:30",
      startsAt: "2026-12-10T08:00:00.000Z",
      endsAt: "2026-12-10T10:30:00.000Z",
    });
  });

  it("returns undefined for pages that are not a session info screen", async () => {
    assert.equal(await readSession(ctx(lab("course-student"))), undefined);
    assert.equal(await readSession(ctx(lab("lso-learner-student"))), undefined);
    assert.equal(await readSession(ctx("<main><p>Session Information is mentioned here only</p></main>")), undefined);
  });

  it("is registered for sess and read end-to-end through readPage", async () => {
    assert.ok(OBJECT_READERS.sess);
    const url = `${ORIGIN}/go/sess/116`;
    const html = lab("sess-info-student");
    const pages = { [url]: snapshotFromHtml(url, "Lab sess dated", html, textOf(html)) };
    const provider = createBrowserProvider({ session: createMemorySession(pages), clock: () => Date.parse("2026-11-17T10:00:00Z") });
    const page = await provider.readPage("116", { type: "sess" });
    assert.equal(page.detailStatus, "read");
    assert.equal((page.detail as SessionDetail).startsAt, "2026-12-10T08:00:00.000Z");
    assert.equal((page.detail as SessionDetail).location, "Lab room 0.01 (synthetic)");
  });
});
