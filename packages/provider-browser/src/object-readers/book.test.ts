import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { advertisedRoute, advertisedRoutes } from "../advertised-route.ts";
import { createBrowserProvider } from "../browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../memory-session.ts";
import { textOf } from "../ui-items.ts";
import { OBJECT_READERS, type ReaderContext } from "./index.ts";
import { BOOKING_SCREEN, parseBookableObjects, parseFreeSlots, readBookingPool, type BookingPoolDetail } from "./book.ts";

/**
 * ADR 0062 (#165): the booking pool "Bookable Items" table and one object's booking
 * screen (week grid) from the ILIAS 10.12 lab (tools/ilias-lab), as a student. URLs are
 * rebased onto ADAM's pinned origin.
 */
const ORIGIN = "https://adam.unibas.ch";
const lab = (name: string) => {
  const fixture = JSON.parse(readFileSync(new URL(`../../fixtures/lab/${name}.json`, import.meta.url), "utf8")) as { html: string };
  return fixture.html.replaceAll("http://localhost:8080", ORIGIN);
};

/** A reader context whose `open` serves the lab booking screen, or fails for the given ids. */
const ctx = (html: string, options: { failFor?: string[]; opened?: string[] } = {}) => ({
  refId: "91",
  type: "book",
  page: { url: `${ORIGIN}/go/book/91`, html, text: textOf(html) },
  routes: (source: string, rule: Parameters<typeof advertisedRoutes>[2]) => advertisedRoutes(source, "91", rule),
  route: (source: string, rule: Parameters<typeof advertisedRoute>[2]) => advertisedRoute(source, "91", rule),
  open: async (url: string) => {
    options.opened?.push(url);
    const id = new URL(url).searchParams.get("object_id")!;
    if (options.failFor?.includes(id)) throw new Error("screen unavailable");
    const slots = lab("book-slots-student");
    return { url, html: slots, text: textOf(slots) };
  },
}) as unknown as ReaderContext;

describe("ADR 0062: booking pool reader on the lab pages", () => {
  it("lists the seeded bookable items with descriptions and their free slots this week", async () => {
    const opened: string[] = [];
    const result = await readBookingPool(ctx(lab("book-objects-student"), { opened }));
    assert.ok(result);
    const detail = result.detail as BookingPoolDetail;
    assert.equal(detail.kind, "booking-pool");
    assert.equal(detail.evidence, "lab-verified");
    assert.deepEqual(detail.objects.map((item) => item.title), ["Lab item A (tablet)", "Lab item B (projector)", "Lab item C (laptop)"]);
    assert.equal(detail.objects[0]!.description, "Lab seed: synthetic bookable tablet.");
    assert.ok(detail.objects.every((item) => item.bookable === true));
    assert.equal(opened.length, 3, "one read-only booking screen per bookable object");
    assert.ok(opened.every((url) => new URL(url).searchParams.get("cmd") === "book" && !/confirm|rsv|rtoken/i.test(url)));
    assert.deepEqual(detail.objects[0]!.freeSlots?.map((slot) => [slot.dayText, slot.timeText, slot.available]), [
      ["Wednesday 18 November", "10:00-18:00", 1],
      ["Thursday 19 November", "10:00-18:00", 1],
      ["Friday 20 November", "10:00-18:00", 1],
    ]);
    assert.equal(detail.objects[0]!.freeSlots?.[0]!.startsAt, "2026-11-18T09:00:00.000Z", "10:00 Europe/Zurich");
    assert.equal(detail.objects[0]!.freeSlots?.[0]!.endsAt, "2026-11-18T17:00:00.000Z");
  });

  it("keeps a row without slots when its booking screen cannot be read", async () => {
    const result = await readBookingPool(ctx(lab("book-objects-student"), { failFor: ["2"] }));
    const objects = (result!.detail as BookingPoolDetail).objects;
    assert.equal(objects.length, 3);
    assert.equal(objects[1]!.freeSlots, undefined);
    assert.ok(objects[0]!.freeSlots?.length);
  });

  it("parses the week grid's columns through rowspans, and only that grid", () => {
    const slots = parseFreeSlots(lab("book-slots-student"));
    assert.ok(slots);
    assert.equal(slots.length, 3);
    assert.equal(parseFreeSlots(lab("book-objects-student")), undefined);
    assert.equal(parseFreeSlots("<table class=\"il-cal-week\"><tr><td>x</td></tr></table>"), undefined);
  });

  it("follows only the object's read-only booking screen route", () => {
    const html = lab("book-objects-student");
    assert.equal(advertisedRoutes(html, "91", BOOKING_SCREEN).length, 3);
    const link = (href: string) => `<a href="${href}">x</a>`;
    const base = `${ORIGIN}/ilias.php?baseClass=ilrepositorygui&cmdClass=ilBookingProcessWithScheduleGUI&cmd=book&ref_id=91&object_id=1`;
    assert.ok(advertisedRoute(link(base), "91", BOOKING_SCREEN));
    assert.equal(advertisedRoute(link(base.replace("cmd=book", "cmd=confirmedBooking")), "91", BOOKING_SCREEN), undefined);
    assert.equal(advertisedRoute(link(`${base}&rtoken=abc`), "91", BOOKING_SCREEN), undefined);
    assert.equal(advertisedRoute(link(`${base}&slot=1`), "91", BOOKING_SCREEN), undefined);
    assert.equal(advertisedRoute(link(base.replace("ref_id=91", "ref_id=92")), "91", BOOKING_SCREEN), undefined);
  });

  it("returns undefined for pages that are not the bookable items table", async () => {
    assert.equal(await readBookingPool(ctx(lab("course-student"))), undefined);
    assert.equal(await readBookingPool(ctx(lab("lso-learner-student"))), undefined);
    assert.equal(parseBookableObjects("<h2 class=\"ilHeader ilTableHeaderTitle\">Other</h2>"), undefined);
  });

  it("is registered for book and read end-to-end through readPage", async () => {
    assert.ok(OBJECT_READERS.book);
    const url = `${ORIGIN}/go/book/91`;
    const html = lab("book-objects-student");
    const slots = lab("book-slots-student");
    const pages = {
      [url]: snapshotFromHtml(url, "Lab book", html, textOf(html)),
      // Keyed by the exact advertised booking-screen URLs, as readPage opens them.
      ...Object.fromEntries(advertisedRoutes(html, "91", BOOKING_SCREEN).map((screen) => [screen, snapshotFromHtml(screen, "Book", slots, textOf(slots))])),
    };
    const provider = createBrowserProvider({ session: createMemorySession(pages), clock: () => Date.parse("2026-11-17T10:00:00Z") });
    const page = await provider.readPage("91", { type: "book" });
    assert.equal(page.detailStatus, "read");
    const detail = page.detail as BookingPoolDetail;
    assert.equal(detail.objects.length, 3);
    assert.equal(detail.objects[2]!.freeSlots?.length, 3);
  });
});
