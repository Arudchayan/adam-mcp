import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import { createFixtureProvider } from "./fixture-provider.ts";

describe("FixtureAdamProvider", () => {
  const provider = createFixtureProvider();

  it("lists the synthetic enrolled course", async () => {
    const listed = await provider.listCourses();
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0]?.refId, "100001");
    assert.match(listed.items[0]?.url ?? "", /\/go\/crs\/100001$/);
  });

  it("keeps an empty exercises folder distinct from calendar deadlines", async () => {
    const children = await provider.listChildren("100020");
    assert.deepEqual(children.items, []);
    const courseChildren = await provider.listChildren("100001");
    assert.equal(courseChildren.items.some((item) => item.refId === "100021"), true);
    const calendar = await provider.listCalendar();
    assert.equal(calendar.items.some((item) => item.title === "Written exam"), true);
    assert.equal(calendar.items.some((item) => item.objectRefId === "100021"), true);
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
    assert.equal(found.items.length, 0);
    const exam = await provider.search("exam");
    assert.equal(exam.items[0]?.refId, "100001");
  });
});
