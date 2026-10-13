import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exerciseDeadlineFromPage, inferDates } from "./extract.ts";

describe("deadline correctness", () => {
  it("uses the full labelled date, not an earlier date sharing its day", () => {
    assert.equal(exerciseDeadlineFromPage("Published: 31.08.2026\nAbgabe: 31.10.2026 23:59"), "2026-10-31T22:59:00.000Z");
    assert.equal(exerciseDeadlineFromPage("Published: 31.08.2026\nAbgabe: 31.10.2026"), "2026-10-31T00:00:00.000Z");
  });
  it("does not use an unrelated date for an unparseable deadline", () => {
    assert.equal(exerciseDeadlineFromPage("Published: 2026-10-31\nDeadline: see exercise sheet"), undefined);
  });
  it("rejects invalid calendar days in numeric and ISO formats", () => {
    for (const raw of ["31.02.2026", "2026-02-31", "29.02.2025"]) {
      assert.equal(inferDates(raw)[0]?.iso, undefined);
      assert.equal(exerciseDeadlineFromPage(`Abgabe: ${raw}`), undefined);
    }
    assert.equal(exerciseDeadlineFromPage("Abgabe: 29.02.2024"), "2024-02-29T00:00:00.000Z");
  });
  it("preserves Zurich winter/summer clocks and explicit offsets", () => {
    assert.equal(exerciseDeadlineFromPage("Due: 2026-07-01 23:59"), "2026-07-01T21:59:00.000Z");
    assert.equal(exerciseDeadlineFromPage("Due: 2026-12-01 23:59"), "2026-12-01T22:59:00.000Z");
    assert.equal(exerciseDeadlineFromPage("Deadline: 2026-07-01T23:59:12Z"), "2026-07-01T23:59:12.000Z");
    assert.equal(exerciseDeadlineFromPage("Deadline: 2026-07-01T23:59+02:00"), "2026-07-01T21:59:00.000Z");
  });
  it("omits invalid, nonexistent and ambiguous clocks", () => {
    for (const raw of ["2026-07-01 25:00", "2026-07-01 12:60", "2026-03-29 02:30", "2026-10-25 02:30"]) {
      assert.equal(exerciseDeadlineFromPage(`Due: ${raw}`), undefined);
    }
  });
});
