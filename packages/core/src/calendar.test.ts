import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calendarEventDay, calendarEventDedupeKey, preferCalendarEvents } from "./calendar.ts";
import type { CalendarEvent } from "./types.ts";

const provenance = {
  sourceUrl: "https://adam.unibas.ch/go/exc/100021",
  fetchedAt: "2026-09-06T12:00:00.000Z",
  provider: "fixture" as const,
  freshness: "synthetic",
};

function event(partial: Partial<CalendarEvent> & Pick<CalendarEvent, "title" | "source">): CalendarEvent {
  return {
    confidence: "explicit",
    provenance,
    ...partial,
  };
}

describe("AT6 preferCalendarEvents", () => {
  it("dedupes by object+UTC day and prefers exc over page", () => {
    const items = preferCalendarEvents([
      event({
        title: "22 September 2026",
        startsAt: "2026-09-22T00:00:00.000Z",
        source: "page",
        confidence: "inferred",
        objectRefId: "100021",
      }),
      event({
        title: "Exercise deadline",
        startsAt: "2026-09-22T21:59:00.000Z",
        source: "exc",
        objectRefId: "100021",
      }),
    ]);
    assert.equal(calendarEventDay("2026-09-22T21:59:00.000Z"), "2026-09-22");
    assert.equal(items.length, 1);
    assert.equal(items[0]?.source, "exc");
    assert.equal(items[0]?.title, "Exercise deadline");
  });

  it("prefers calendar over page for the same object+day", () => {
    const items = preferCalendarEvents([
      event({
        title: "Page note",
        startsAt: "2026-11-03T13:00:00.000Z",
        source: "page",
        confidence: "inferred",
        objectRefId: "100101",
      }),
      event({
        title: "Calendar SoT",
        startsAt: "2026-11-03T09:00:00.000Z",
        source: "calendar",
        objectRefId: "100101",
      }),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.source, "calendar");
  });

  it("prefers exc over calendar over page", () => {
    const items = preferCalendarEvents([
      event({ title: "p", startsAt: "2026-09-22T08:00:00.000Z", source: "page", objectRefId: "1" }),
      event({ title: "c", startsAt: "2026-09-22T12:00:00.000Z", source: "calendar", objectRefId: "1" }),
      event({ title: "e", startsAt: "2026-09-22T21:59:00.000Z", source: "exc", objectRefId: "1" }),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.source, "exc");
  });

  it("prefers explicit evidence over source rank and keeps corroborating sources", () => {
    const items = preferCalendarEvents([
      event({
        title: "Inferred exc",
        startsAt: "2026-09-22T21:59:00.000Z",
        source: "exc",
        confidence: "inferred",
        objectRefId: "100021",
      }),
      event({
        title: "Explicit calendar",
        startsAt: "2026-09-22T08:00:00.000Z",
        source: "calendar",
        confidence: "explicit",
        objectRefId: "100021",
      }),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.source, "calendar");
    assert.deepEqual([...(items[0]?.seenIn ?? [])].sort(), ["calendar", "exc"]);
  });

  it("keeps distinct undated page notes", () => {
    const items = preferCalendarEvents([
      event({ title: "room TBA", source: "page", confidence: "inferred", objectRefId: "100101" }),
      event({ title: "other note", source: "page", confidence: "inferred", objectRefId: "100101" }),
    ]);
    assert.equal(items.length, 2);
    assert.notEqual(calendarEventDedupeKey(items[0]!), calendarEventDedupeKey(items[1]!));
  });
});

describe("page date at an exercise deadline instant (client walkthrough, 0.4.0 RC)", () => {
  it("merges the course-page copy into the exercise deadline", () => {
    const provenance = { sourceUrl: "https://adam.unibas.ch/go/crs/1", fetchedAt: "2026-11-17T10:00:00.000Z", provider: "fixture" as const, freshness: "fixture" as const };
    const items = preferCalendarEvents([
      { title: "Exercise 1 · Deadline: 20. Nov 2026, 23:59", startsAt: "2026-11-20T22:59:00.000Z", source: "page", confidence: "inferred", objectRefId: "1", provenance },
      { title: "Sheet 1 (Deadline)", startsAt: "2026-11-20T22:59:00.000Z", source: "exc", confidence: "explicit", objectRefId: "2", provenance },
      { title: "Mid-term", startsAt: "2026-11-21T09:00:00.000Z", source: "page", confidence: "inferred", objectRefId: "1", provenance },
    ]);
    assert.equal(items.length, 2);
    const deadline = items.find((item) => item.source === "exc");
    assert.deepEqual(deadline?.seenIn?.sort(), ["exc", "page"]);
    assert.ok(items.some((item) => item.title === "Mid-term"), "a page date at another instant stays");
  });
});
