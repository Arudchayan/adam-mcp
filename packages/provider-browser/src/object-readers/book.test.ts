import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createBrowserProvider } from "../browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../memory-session.ts";
import { textOf } from "../ui-items.ts";
import { OBJECT_READERS, type ReaderContext } from "./index.ts";
import { parseBookableObjects, readBookingPool, type BookingPoolDetail } from "./book.ts";

/**
 * ADR 0062 (#165): the booking pool "Bookable Items" table from the ILIAS 10.12 lab
 * (tools/ilias-lab), as a student. URLs are rebased onto ADAM's pinned origin.
 */
const ORIGIN = "https://adam.unibas.ch";
const lab = (name: string) => {
  const fixture = JSON.parse(readFileSync(new URL(`../../fixtures/lab/${name}.json`, import.meta.url), "utf8")) as { html: string };
  return fixture.html.replaceAll("http://localhost:8080", ORIGIN);
};
const ctx = (html: string) => ({ page: { url: `${ORIGIN}/go/book/91`, html, text: textOf(html) } }) as unknown as ReaderContext;

describe("ADR 0062: booking pool reader on the lab table", () => {
  it("lists the seeded bookable items with descriptions and bookable flags", async () => {
    const result = await readBookingPool(ctx(lab("book-objects-student")));
    assert.ok(result);
    const detail = result.detail as BookingPoolDetail;
    assert.equal(detail.kind, "booking-pool");
    assert.equal(detail.evidence, "lab-verified");
    assert.deepEqual(detail.objects.map((item) => item.title), ["Lab item A (tablet)", "Lab item B (projector)", "Lab item C (laptop)"]);
    assert.equal(detail.objects[0]!.description, "Lab seed: synthetic bookable tablet.");
    assert.ok(detail.objects.every((item) => item.bookable === true));
    // Availability is not in the lab table, so no availability fields are invented.
    assert.equal("availableText" in detail.objects[0]!, false);
  });

  it("never follows the Book action, and reports no booking write", () => {
    const html = lab("book-objects-student");
    assert.match(html, /cmd=book&amp;ref_id=91&amp;object_id=1/);
    const objects = parseBookableObjects(html);
    assert.ok(objects);
    assert.equal(objects.length, 3);
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
    const pages = { [url]: snapshotFromHtml(url, "Lab book", html, textOf(html)) };
    const provider = createBrowserProvider({ session: createMemorySession(pages), clock: () => Date.parse("2026-11-17T10:00:00Z") });
    const page = await provider.readPage("91", { type: "book" });
    assert.equal(page.detailStatus, "read");
    assert.equal((page.detail as BookingPoolDetail).objects.length, 3);
  });
});
