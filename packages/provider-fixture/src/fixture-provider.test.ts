import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import { CATALOG_ONLY_COURSE_ID, fixtureCatalog, GOLDEN_TST_REF_ID } from "./catalog.ts";
import { createFixtureProvider } from "./fixture-provider.ts";
import { LongWalkStub } from "./long-walk.ts";

describe("FixtureAdamProvider", () => {
  const provider = createFixtureProvider();

  it("lists the synthetic enrolled course", async () => {
    const listed = await provider.listCourses();
    assert.equal(listed.items.length, 2);
    assert.equal(listed.items[0]?.refId, "100001");
    assert.equal(listed.items[1]?.refId, "100101");
    assert.match(listed.items[0]?.url ?? "", /\/go\/crs\/100001$/);
  });

  it("keeps an empty exercises folder distinct from calendar deadlines", async () => {
    const children = await provider.listChildren("100020");
    assert.deepEqual(children.items, []);
    const courseChildren = await provider.listChildren("100001");
    assert.equal(courseChildren.items.some((item) => item.refId === "100021"), true);
    const calendar = await provider.listCalendar();
    assert.equal(
      calendar.items.some((item) => item.objectRefId === "100001" && item.source === "page"),
      true,
    );
    assert.equal(
      calendar.items.some((item) => item.objectRefId === "100021" && item.source === "exc"),
      true,
    );
  });

  it("extracts fixture PDF text without returning bytes", async () => {
    const extracted = await provider.extractFileText("100011");
    assert.match(extracted.pages[0]?.text ?? "", /multimedia retrieval/i);
    assert.equal("bytes" in extracted, false);
    assert.doesNotMatch(JSON.stringify(extracted), /%PDF-/);
  });

  it("returns a read-only exercise with own status and no submit payload", async () => {
    const exercise = await provider.getExercise("100021");
    assert.equal(exercise.type, "exc");
    assert.equal(exercise.units[0]?.ownStatus, "none");
    assert.match(exercise.units[0]?.instructionText ?? "", /cannot submit/);
    assert.equal("submit" in exercise, false);
    await assert.rejects(() => provider.getExercise("100001"), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "unsupported_type");
      return true;
    });
  });

  it("returns not_found for unknown ref ids", async () => {
    await assert.rejects(() => provider.getCourse("999999"), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "not_found");
      return true;
    });
  });

  it("searches titles and page text", async () => {
    const found = await provider.search("Fourier");
    assert.ok(found.items.some((item) => item.refId === "100001"));
    assert.equal(found.items.some((item) => item.refId === CATALOG_ONLY_COURSE_ID), false);
    const exam = await provider.search("exam");
    assert.equal(exam.items[0]?.refId, "100001");
  });

  it("B10: golden tst is not in happy-path lists and fail-closed on read/get/search", async () => {
    // Synthetic tst exists but is not linked under enrolled happy-path children.
    assert.equal(fixtureCatalog[GOLDEN_TST_REF_ID]?.object.type, "tst");
    const courseChildren = await provider.listChildren("100001");
    assert.deepEqual(
      courseChildren.items.map((item) => item.refId),
      ["100010", "100020", "100021"],
    );
    assert.equal(courseChildren.items.some((item) => item.type === "tst"), false);

    // Empty Exercises fold + exc+deadline unchanged.
    const emptyFold = await provider.listChildren("100020");
    assert.deepEqual(emptyFold.items, []);
    const exercise = await provider.getExercise("100021");
    assert.equal(exercise.type, "exc");
    assert.equal(exercise.units[0]?.deadline, "2026-09-22T21:59:00.000Z");

    const found = await provider.search("BLOCKED EXAM CONTENT");
    assert.equal(found.items.length, 0);
    assert.equal(found.items.some((item) => item.type === "tst"), false);

    const deny = (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "unsupported_type");
      assert.match(error.message, /tst/i);
      assert.match(error.message, /not sent to the model/i);
      assert.doesNotMatch(error.message, /DFT|Answer key|BLOCKED EXAM/i);
      return true;
    };
    await assert.rejects(() => provider.readPage(GOLDEN_TST_REF_ID), deny);
    await assert.rejects(() => provider.getCourse(GOLDEN_TST_REF_ID), deny);
    await assert.rejects(() => provider.getExercise(GOLDEN_TST_REF_ID), deny);
  });
});

describe("A2 LongWalkStub progress", () => {
  it("emits progress for search / calendar / extract when onProgress is set", async () => {
    const provider = createFixtureProvider();
    const seen: Array<{ progress: number; total?: number; message?: string }> = [];
    const onProgress = async (update: { progress: number; total?: number; message?: string }) => {
      seen.push(update);
    };

    await LongWalkStub.emit("unit", onProgress, 2);
    assert.equal(seen.length, 2);
    assert.equal(seen[0]?.progress, 1);
    assert.equal(seen[1]?.total, 2);

    seen.length = 0;
    await provider.search("Fourier", { onProgress });
    assert.ok(seen.length >= 3);
    assert.ok(seen.every((step) => typeof step.message === "string"));

    seen.length = 0;
    await provider.listCalendar({ onProgress });
    assert.ok(seen.length >= 3);

    seen.length = 0;
    await provider.extractFileText("100011", { onProgress });
    assert.ok(seen.length >= 3);
  });

  it("stays silent when onProgress is omitted", async () => {
    const provider = createFixtureProvider();
    await provider.search("Fourier");
    await provider.listCalendar();
    await provider.extractFileText("100011");
  });
});

describe("AT1/AT2 cross-course deadline aggregation", () => {
  const provider = createFixtureProvider();

  it("aggregates exc + page + calendar SoT across enrolled courses with provenance", async () => {
    const emptyFold = await provider.listChildren("100020");
    assert.deepEqual(emptyFold.items, []);

    const calendar = await provider.listCalendar();
    const items = calendar.items;

    const sources = new Set(items.map((item) => item.source));
    assert.equal(sources.has("exc"), true);
    assert.equal(sources.has("page"), true);
    assert.equal(sources.has("calendar"), true);

    const exercise = items.find((item) => item.objectRefId === "100021" && item.source === "exc");
    assert.ok(exercise);
    assert.equal(exercise?.startsAt, "2026-09-22T21:59:00.000Z");
    assert.equal(exercise?.confidence, "explicit");
    assert.equal(exercise?.url, "https://adam.unibas.ch/go/exc/100021");
    assert.equal(exercise?.provenance.provider, "fixture");
    assert.ok(exercise?.provenance.sourceUrl);
    assert.ok(exercise?.provenance.fetchedAt);
    assert.ok(exercise?.provenance.iliasVersion || exercise?.provenance.freshness);

    const course2Exc = items.find((item) => item.objectRefId === "100121" && item.source === "exc");
    assert.ok(course2Exc, "cross-course exc deadline from 100101 must surface");
    assert.equal(course2Exc?.startsAt, "2026-10-05T21:59:00.000Z");

    const course2Page = items.find((item) => item.objectRefId === "100101" && item.source === "page" && item.startsAt);
    assert.ok(course2Page);
    assert.equal(course2Page?.confidence, "inferred");

    const undated = items.find(
      (item) => item.objectRefId === "100101" && item.source === "page" && !item.startsAt,
    );
    assert.ok(undated, "honest omit: page date without iso must omit startsAt");

    const calSot = items.find((item) => item.source === "calendar");
    assert.ok(calSot);
    assert.equal(calSot?.confidence, "explicit");

    // Empty fold is not represented as a fabricated no-deadlines event.
    assert.equal(items.some((item) => item.objectRefId === "100020"), false);

    for (const item of items) {
      assert.ok(["exc", "page", "calendar"].includes(item.source));
      assert.ok(["explicit", "inferred"].includes(item.confidence));
      assert.match(item.provenance.sourceUrl, /^https:\/\/adam\.unibas\.ch\//);
      assert.equal(typeof item.provenance.fetchedAt, "string");
      assert.equal(item.provenance.provider, "fixture");
    }
  });
});

describe("AT3 enrolled-tree search ranking", () => {
  const provider = createFixtureProvider();

  it("scopes hits to enrolled trees and ranks title before page body", async () => {
    assert.equal(fixtureCatalog[CATALOG_ONLY_COURSE_ID]?.object.type, "crs");
    assert.match(fixtureCatalog[CATALOG_ONLY_COURSE_ID]?.object.title ?? "", /Fourier/i);
    assert.match(fixtureCatalog[CATALOG_ONLY_COURSE_ID]?.page?.text ?? "", /Fourier/i);

    const fourier = await provider.search("Fourier");
    assert.ok(fourier.items.some((item) => item.refId === "100001"), "enrolled course page hit");
    assert.equal(
      fourier.items.some((item) => item.refId === CATALOG_ONLY_COURSE_ID),
      false,
      "catalog-only Magazin course must not appear",
    );
    assert.equal(
      fourier.items.some((item) => item.refId === "900001" || item.refId === "900065" || item.refId === "1"),
      false,
      "root/Magazin cats must not appear",
    );

    // Title hit (100020 "04 - Exercises") before page-body hit (100001 page text).
    const exercises = await provider.search("Exercises");
    const ids = exercises.items.map((item) => item.refId);
    assert.ok(ids.includes("100020"), "title match on empty Exercises fold");
    assert.ok(ids.includes("100001"), "page-body match on enrolled course");
    assert.ok(ids.indexOf("100020") < ids.indexOf("100001"), "title rank before body rank");

    // Deterministic: same query same order.
    const again = await provider.search("Exercises");
    assert.deepEqual(
      again.items.map((item) => item.refId),
      ids,
    );

    // B10 regression: tst still denied from search.
    const blocked = await provider.search("BLOCKED EXAM CONTENT");
    assert.equal(blocked.items.length, 0);
  });
});
