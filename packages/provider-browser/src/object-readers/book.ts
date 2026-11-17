import { redactText } from "adam-core";
import { textOf } from "../ui-items.ts";
import type { ObjectReader, ReaderContext } from "./index.ts";

/**
 * ADR 0062: booking pool (`book`) "Bookable Items" table, read from the ILIAS 10.12 lab as a
 * student. Evidence: `lab-verified`. Read-only: the "Book" action is never followed, and only
 * its presence is reported (`bookable`). The lab table shows no availability column, so
 * availability and free slots are not reported.
 */

export type BookableObject = {
  title: string;
  description?: string;
  /** True when the row offers ILIAS's "Book" action (a booking route, which the reader never opens). */
  bookable: boolean;
};

export type BookingPoolDetail = {
  kind: "booking-pool";
  evidence: "lab-verified";
  objects: BookableObject[];
};

const TABLE_TITLE = /<h2 class="ilHeader ilTableHeaderTitle">\s*Bookable Items\s*<\/h2>|<h2 class="ilHeader ilTableHeaderTitle">\s*Buchbare Objekte\s*<\/h2>/i;
const EMPTY_NOTICE = /This object is empty and contains no items\.|Dieses Objekt ist leer/i;
const ROW = /<tr\b[^>]*class="[^"]*\btblrow\d?\b[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;

/** Rows of the bookable-items table: title, optional description, and an actions cell. */
export function parseBookableObjects(html: string): BookableObject[] | undefined {
  const start = html.search(TABLE_TITLE);
  if (start < 0) return undefined;
  // The table form holds the filter table and the data table, so take the whole form.
  const formEnd = html.indexOf("</form>", start);
  const table = html.slice(start, formEnd < 0 ? html.length : formEnd);
  const objects: BookableObject[] = [];
  for (const row of table.matchAll(ROW)) {
    const cells = [...row[1]!.matchAll(CELL)].map((m) => m[1]!);
    if (cells.length < 2) return undefined;
    const title = textOf(cells[0]!);
    if (!title) return undefined;
    const description = cells.length >= 3 ? textOf(cells[1]!) : "";
    const bookable = /\bcmd=book\b/.test(cells[cells.length - 1]!);
    objects.push({ title: redactText(title), bookable, ...(description ? { description: redactText(description) } : {}) });
  }
  if (objects.length === 0 && !EMPTY_NOTICE.test(table)) return undefined;
  return objects;
}

export const readBookingPool: ObjectReader = async (ctx: ReaderContext) => {
  const objects = parseBookableObjects(ctx.page.html);
  if (!objects) return undefined;
  const detail: BookingPoolDetail = { kind: "booking-pool", evidence: "lab-verified", objects };
  return { detail };
};
