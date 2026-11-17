import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createBrowserProvider } from "../browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../memory-session.ts";
import { textOf } from "../ui-items.ts";
import { OBJECT_READERS, type ReaderContext, type ReaderPage } from "./index.ts";
import { itemRow, parentCourse, readSession, sessionDates, sessionMaterials, type SessionDetail } from "./sess.ts";

/**
 * ADR 0062 (#165): the session info screen and the parent course listing from the ILIAS 10.12
 * lab (tools/ilias-lab), as a student. The lab serves http://localhost:8080; URLs are rebased
 * onto ADAM's pinned origin.
 */
const ORIGIN = "https://adam.unibas.ch";
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../fixtures/lab/${name}.json`, import.meta.url), "utf8")) as { url: string; html: string };
const lab = (name: string) => fixture(name).html.replaceAll("http://localhost:8080", ORIGIN);
const labUrl = (name: string) => fixture(name).url.replaceAll("http://localhost:8080", ORIGIN).replace(/#.*$/, "");
const COURSE_URL = `${ORIGIN}/go/crs/86`;
const EXPANDED_URL = labUrl("course-sess-expanded-student");

/** A reader context whose `open` serves the given pages by URL and fails on anything else. */
const ctx = (html: string, pages: Record<string, string> = {}, refId = "116") => {
  const opened: string[] = [];
  return {
    opened,
    value: {
      refId,
      type: "sess",
      page: { url: `${ORIGIN}/go/sess/${refId}`, html, text: textOf(html) } as ReaderPage,
      open: async (url: string) => {
        opened.push(url);
        const html = pages[url];
        if (html === undefined) throw new Error(`unexpected open ${url}`);
        return { url, html, text: textOf(html) } as ReaderPage;
      },
      route: () => undefined,
      routes: () => [],
    } as unknown as ReaderContext,
  };
};
const sessionPages = { [COURSE_URL]: lab("course-sessions-student"), [EXPANDED_URL]: lab("course-sess-expanded-student") };

describe("ADR 0062: session reader on the lab info screen", () => {
  it("reads the seeded date range, location, details and description", async () => {
    const { value } = ctx(lab("sess-info-student"), sessionPages);
    const result = await readSession(value);
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
    const { value } = ctx(lab("sess-info-undated-student"), { [COURSE_URL]: lab("course-sessions-student") }, "88");
    // The undated session's expand link is not in the fixture pages, so the course is served as-is.
    const open = value.open;
    value.open = async (url: string) => (url === COURSE_URL ? open(url) : { url, html: lab("course-sessions-student"), text: "" } as ReaderPage);
    const result = await readSession(value);
    assert.ok(result);
    const detail = result.detail as SessionDetail;
    assert.equal(detail.startsAt, undefined);
    assert.equal(detail.endsAt, undefined);
    assert.equal(detail.dateText, undefined);
    assert.equal(detail.location, "Lab room 0.01 (synthetic)");
    assert.deepEqual(detail.materials, []);
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
    assert.equal(await readSession(ctx(lab("course-student")).value), undefined);
    assert.equal(await readSession(ctx(lab("lso-learner-student")).value), undefined);
    assert.equal(await readSession(ctx("<main><p>Session Information is mentioned here only</p></main>").value), undefined);
  });
});

describe("ADR 0062: session materials from the parent course's expanded listing", () => {
  it("follows the parent course, expands this session only, and lists its assigned materials", async () => {
    const { value, opened } = ctx(lab("sess-info-student"), sessionPages);
    const result = await readSession(value);
    assert.ok(result);
    assert.deepEqual((result.detail as SessionDetail).materials, [
      { title: "Lab fold", type: "fold", refId: "87", url: `${ORIGIN}/go/fold/87` },
      { title: "Lab webr", type: "webr", refId: "100", url: `${ORIGIN}/go/webr/100` },
    ]);
    // The parent course (canonical URL), then the advertised expand link: two pages, within the cap.
    assert.deepEqual(opened, [COURSE_URL, EXPANDED_URL]);
  });

  it("finds the parent course from the breadcrumb only", () => {
    assert.equal(parentCourse(lab("sess-info-student")), "86");
    assert.equal(parentCourse("<nav aria-label=\"Breadcrumbs\"><a href=\"https://adam.unibas.ch/goto.php/root/1\">Repository</a></nav>"), undefined);
  });

  it("does not include materials of other sessions or of plain course items", () => {
    const row = itemRow(lab("course-sess-expanded-student"), "116");
    assert.ok(row);
    // Plain course items (bibliography, exercise) sit outside the session's sub-items.
    const materials = sessionMaterials(row, "116");
    assert.equal(materials.some((m) => m.refId === "115" || m.title === "Lab bibl upload"), false);
    // A sub-item that belongs to session 88 inside session 116's row is ignored.
    const foreign = `<div class="subitem"><div data-list-item-id="lg_div_999_pref_88" id="lg_div_999_pref_88"><div class="ilContainerListItemIcon "><img alt="Folder" src="x.svg"></div><div class="ilContainerListItemContent "><div class="il_ContainerListItem"><h3 class="il_ContainerItemTitle"><a href="http://localhost:8080/goto.php/fold/999" class="il_ContainerItemTitle">Other session</a></h3></div></div></div></div>`;
    assert.deepEqual(sessionMaterials(row + foreign, "116").map((m) => m.refId), ["87", "100"]);
  });

  it("returns no materials when the session has none", () => {
    const row = itemRow(lab("course-sess-expanded-student"), "116")!;
    assert.deepEqual(sessionMaterials(row, "88"), []);
  });

  it("is registered for sess and reads the materials end-to-end through readPage", async () => {
    assert.ok(OBJECT_READERS.sess);
    const url = `${ORIGIN}/go/sess/116`;
    const html = lab("sess-info-student");
    const pages = { [url]: snapshotFromHtml(url, "Lab sess dated", html, textOf(html)), ...Object.fromEntries(Object.entries(sessionPages).map(([u, h]) => [u, snapshotFromHtml(u, "Lab Course", h, textOf(h))])) };
    const provider = createBrowserProvider({ session: createMemorySession(pages), clock: () => Date.parse("2026-11-17T10:00:00Z") });
    const page = await provider.readPage("116", { type: "sess" });
    assert.equal(page.detailStatus, "read");
    assert.equal((page.detail as SessionDetail).startsAt, "2026-12-10T08:00:00.000Z");
    assert.equal((page.detail as SessionDetail).materials?.length, 2);
  });
});
