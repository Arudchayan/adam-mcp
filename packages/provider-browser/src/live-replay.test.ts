import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseAdamRef } from "adam-core";
import { createBrowserProvider } from "./browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";
import type { PageSnapshot } from "./session-types.ts";

/**
 * Replays scrubbed captures of real ILIAS 10.11 pages (scripts/capture-fixtures.mjs)
 * through the memory session, so markup regressions are caught without live access.
 */
const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/live");
const origin = "https://adam.unibas.ch";

type Fixture = {
  name: string;
  kind: "dashboard" | "course" | "blank-fold" | "blank-course";
  url: string;
  title: string;
  dom: PageSnapshot["dom"];
  text: string;
  html: string;
};

function loadFixtures(): Fixture[] {
  return readdirSync(fixturesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as Fixture);
}

describe("live fixture replay (scrubbed)", () => {
  const fixtures = loadFixtures();

  it("ships at least four scrubbed ILIAS fixtures", () => {
    assert.ok(fixtures.length >= 4, `expected >= 4 fixtures, found ${fixtures.length}`);
    assert.equal(fixtures.some((fixture) => fixture.kind === "course"), true);
    assert.ok(fixtures.filter((fixture) => fixture.kind === "blank-fold").length >= 1);
  });

  for (const fixture of fixtures) {
    it(`${fixture.name}: ${fixture.kind}`, async () => {
      const snapshot: PageSnapshot = {
        ...snapshotFromHtml(fixture.url, fixture.title, fixture.html, fixture.text),
        ...(fixture.dom ? { dom: fixture.dom } : {}),
      };
      const parsed = parseAdamRef(fixture.url);
      const requestUrl = fixture.kind === "dashboard" ? origin : fixture.url;
      const session = createMemorySession({ [requestUrl]: snapshot });
      const provider = createBrowserProvider({ session, origin });

      if (fixture.kind === "dashboard") {
        const listed = await provider.listCourses();
        assert.equal(listed.listingState, "ok");
        assert.ok(listed.items.length >= 1, "dashboard lists enrolled courses");
        assert.equal(listed.items.some((item) => item.type !== "crs"), false);
        return;
      }

      assert.ok(parsed && parsed.type !== "unknown", `fixture url must resolve: ${fixture.url}`);
      const listed = await provider.listChildren(parsed.refId, { type: parsed.type });
      if (fixture.kind === "course") {
        assert.equal(listed.listingState, "ok");
        assert.ok(listed.items.length >= 1, "course lists child objects");
      } else {
        assert.equal(listed.listingState, "unknown");
        assert.equal(listed.items.length, 0);
        assert.match(listed.notice ?? "", /blank content area/i);
        assert.equal(listed.listingSignals?.contentItemCount, 0);
      }
    });
  }
});
