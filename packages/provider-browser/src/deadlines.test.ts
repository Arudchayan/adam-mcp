import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exerciseDeadlineFromPage, inferDates } from "./extract.ts";
import { createBrowserProvider } from "./browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

describe("deadline correctness", () => {
  it("uses the full labelled date, not an earlier date sharing its day", () => {
    assert.equal(exerciseDeadlineFromPage("Published: 31.08.2026\nAbgabe: 31.10.2026 23:59"), "2026-10-31T22:59:00.000Z");
    assert.equal(exerciseDeadlineFromPage("Published: 31.08.2026\nAbgabe: 31.10.2026"), "2026-10-31T00:00:00.000Z");
  });
  it("does not use an unrelated date for an unparseable deadline", () => {
    assert.equal(exerciseDeadlineFromPage("Published: 2026-10-31\nDeadline: see exercise sheet"), undefined);
  });
  it("keeps unknown, negated and unrelated dates out of deadline values", () => {
    for (const text of [
      "Deadline: not announced. Lecture starts 2026-11-12.",
      "Deadline: unknown, lecture starts 12.11.2026",
      "Abgabe: noch nicht bekannt. Vorlesung am 12.11.2026",
      "Due: not 2026-11-12",
      "Deadline: no date; Lecture: 2026-11-12",
      "Deadline: see the lecture on 12 November 2026",
      "Deadline: unknown\nLecture: 2026-11-12",
      "Deadline: unknown. Published: 2026-11-12. Due: not announced",
    ]) assert.equal(exerciseDeadlineFromPage(text), undefined, text);
  });
  it("finds separately labelled dates and accepts deadline prose without splitting dotted dates", () => {
    for (const [text, expected] of [
      ["Deadline: unknown. Due: 12.11.2026", "2026-11-12T00:00:00.000Z"],
      ["Deadline: not announced\nAbgabe: am 12.11.2026 um 12:30", "2026-11-12T11:30:00.000Z"],
      ["Due: no later than 12 November 2026", "2026-11-12T00:00:00.000Z"],
      ["Abgabe bis spätestens 12.11.2026", "2026-11-12T00:00:00.000Z"],
      ["Deadline: 12.11.2026. Lecture: 13.11.2026", "2026-11-12T00:00:00.000Z"],
    ]) assert.equal(exerciseDeadlineFromPage(text), expected, text);
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

describe("exercise deadline calendar integration", () => {
  for (const [body, expected] of [
    ["Deadline: not announced. Lecture starts 2026-11-12.", undefined],
    ["Abgabe: noch nicht bekannt. Vorlesung am 12.11.2026", undefined],
    ["Deadline: unknown. Due: 12.11.2026", "2026-11-12T00:00:00.000Z"],
  ] as const) {
    it(`preserves provenance for ${body}`, async () => {
      const origin = "https://adam.unibas.ch";
      const course = `${origin}/go/crs/100001`;
      const exercise = `${origin}/go/exc/100021`;
      const provider = createBrowserProvider({ origin, session: createMemorySession({
        [`${origin}/`]: snapshotFromHtml(`${origin}/`, "Dashboard", `<main><a href="${course}">Synthetic course</a><a href="/logout.php">Abmelden</a></main>`, "Synthetic course Abmelden"),
        [course]: snapshotFromHtml(course, "Synthetic course", `<main><h1>Synthetic course</h1><a href="${exercise}">Exercise</a><a href="/logout.php">Abmelden</a></main>`, "Synthetic course Exercise Abmelden"),
        [exercise]: snapshotFromHtml(exercise, "Exercise", `<main><h1>Exercise</h1><p>${body}</p><a href="/logout.php">Abmelden</a></main>`, `Exercise ${body} Abmelden`),
      }) });
      const result = await provider.getExercise("100021");
      assert.equal(result.units[0]?.deadline, expected);
      const calendar = await provider.listCalendar();
      const items = calendar.items.filter((item) => item.objectRefId === "100021");
      if (expected) {
        assert.ok(items.some((item) => item.source === "exc" && item.confidence === "explicit" && item.startsAt === expected));
      } else {
        assert.equal(items.some((item) => item.source === "exc"), false);
        assert.ok(items.some((item) => item.source === "page" && item.startsAt?.startsWith("2026-11-12")));
      }
    });
  }
});
