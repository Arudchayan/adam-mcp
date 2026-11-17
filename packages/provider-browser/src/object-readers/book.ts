import { redactText } from "adam-core";
import type { RouteRule } from "../advertised-route.ts";
import { parseAdamTimestamp } from "../deadlines.ts";
import { textOf } from "../ui-items.ts";
import type { ObjectReader, ReaderContext } from "./index.ts";

/**
 * ADR 0062: booking pool (`book`), read from the ILIAS 10.12 lab as a student.
 * Evidence: `lab-verified`.
 *
 * - The pool's "Bookable Items" table gives each object's title, description and whether
 *   it can be booked.
 * - For a fixed-schedule pool, each bookable object's booking screen
 *   (`ilBookingProcessWithScheduleGUI`, `cmd=book`) is a plain GET page that shows the
 *   current week's grid. Free slots are `div.il-book-slot-*` blocks with the time range and
 *   the number of free places.
 *
 * Read-only: a reservation needs a slot to be picked and confirmed in a further step, which
 * the reader never takes. It opens each object's screen once and only reads the current week.
 */

export type FreeSlot = {
  /** Day as ADAM shows it in the week header, such as "Wednesday 18 November". */
  dayText: string;
  /** Time range as shown, such as "10:00-18:00". */
  timeText: string;
  startsAt?: string;
  endsAt?: string;
  /** Free places in this slot, when shown. */
  available?: number;
};

export type BookableObject = {
  title: string;
  description?: string;
  /** True when the row offers ILIAS's "Book" action. */
  bookable: boolean;
  /** Free slots in the current week, from the object's booking screen (fixed-schedule pools). */
  freeSlots?: FreeSlot[];
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
/** Objects whose booking screen is read, and slots kept per object. */
export const MAX_SLOT_OBJECTS = 5;
export const MAX_SLOTS_PER_OBJECT = 10;

/** The read-only booking screen of one object. `cmd=book` here only shows the week grid. */
export const BOOKING_SCREEN: RouteRule = {
  cmdClass: /^ilBookingProcessWithScheduleGUI$/i,
  cmd: /^book$/,
  keys: { object_id: /^\d{1,9}$/, returnCmd: /^week$/, seed: /^\d{4}-\d{2}-\d{2}$/ },
};

type ParsedRow = BookableObject & { objectId?: string };

/** Rows of the bookable-items table: title, optional description, and an actions cell. */
export function parseBookableObjects(html: string): BookableObject[] | undefined {
  return parseRows(html)?.map(({ objectId: _id, ...object }) => object);
}

function parseRows(html: string): ParsedRow[] | undefined {
  const start = html.search(TABLE_TITLE);
  if (start < 0) return undefined;
  // The table form holds the filter table and the data table, so take the whole form.
  const formEnd = html.indexOf("</form>", start);
  const table = html.slice(start, formEnd < 0 ? html.length : formEnd);
  const objects: ParsedRow[] = [];
  for (const row of table.matchAll(ROW)) {
    const cells = [...row[1]!.matchAll(CELL)].map((m) => m[1]!);
    if (cells.length < 2) return undefined;
    const title = textOf(cells[0]!);
    if (!title) return undefined;
    const description = cells.length >= 3 ? textOf(cells[1]!) : "";
    const actions = cells[cells.length - 1]!.replace(/&amp;/g, "&");
    const bookable = /\bcmd=book\b/.test(actions);
    const objectId = bookable ? actions.match(/\bcmd=book\b[^"]*?[?&]object_id=(\d{1,9})\b/)?.[1] ?? actions.match(/[?&]object_id=(\d{1,9})\b[^"]*?\bcmd=book\b/)?.[1] : undefined;
    objects.push({ title: redactText(title), bookable, ...(description ? { description: redactText(description) } : {}), ...(objectId ? { objectId } : {}) });
  }
  if (objects.length === 0 && !EMPTY_NOTICE.test(table)) return undefined;
  return objects;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTHS_DE = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];

/** The year of the shown week, from the week-navigation `seed=YYYY-MM-DD` links nearest the first day. */
function weekYear(html: string, firstDay: { day: number; month: number } | undefined): number | undefined {
  const seeds = [...html.replace(/&amp;/g, "&").matchAll(/[?&]seed=(\d{4})-(\d{2})-(\d{2})\b/g)].map((m) => Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (seeds.length === 0 || !firstDay) return undefined;
  let best: { year: number; distance: number } | undefined;
  for (const seed of seeds) {
    const year = new Date(seed).getUTCFullYear();
    for (const candidate of [year - 1, year, year + 1]) {
      const distance = Math.abs(Date.UTC(candidate, firstDay.month, firstDay.day) - seed);
      if (!best || distance < best.distance) best = { year: candidate, distance };
    }
  }
  return best && best.distance <= 14 * 86_400_000 ? best.year : undefined;
}

function dayOf(label: string): { day: number; month: number } | undefined {
  const match = label.match(/(\d{1,2})\.?\s+([A-Za-zäÄ]+)/);
  if (!match) return undefined;
  const name = match[2]!.toLowerCase();
  const month = MONTHS.indexOf(name) >= 0 ? MONTHS.indexOf(name) : MONTHS_DE.indexOf(name);
  return month >= 0 ? { day: Number(match[1]), month } : undefined;
}

/**
 * Free slots of an object's booking screen (`table.il-cal-week`). Columns are resolved
 * through the grid's rowspans, so each slot gets the day of the column it sits in.
 * Returns undefined when the page has no week grid.
 */
export function parseFreeSlots(html: string): FreeSlot[] | undefined {
  const tableStart = html.search(/<table\b[^>]*class="[^"]*\bil-cal-week\b/i);
  if (tableStart < 0) return undefined;
  const tableEnd = html.indexOf("</table>", tableStart);
  const table = html.slice(tableStart, tableEnd < 0 ? html.length : tableEnd);
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]!);
  const header = rows.find((row) => /<th\b/i.test(row) && !/<td\b/i.test(row));
  if (!header) return undefined;
  const days = [...header.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => textOf(m[1]!.replace(/<br\s*\/?>/gi, " "))).slice(1);
  if (days.length === 0) return undefined;
  const year = weekYear(html, dayOf(days[0]!));
  const busyUntil: number[] = days.map(() => 0);
  const slots: FreeSlot[] = [];
  rows.forEach((row, rowIndex) => {
    if (row === header) return;
    const cells = [...row.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)];
    let column = 0;
    for (const cell of cells) {
      while (column < days.length && busyUntil[column]! > rowIndex) column++;
      if (column >= days.length) break;
      const span = Number(cell[1]!.match(/\browspan="(\d{1,3})"/)?.[1] ?? "1") || 1;
      busyUntil[column] = rowIndex + span;
      for (const block of cell[2]!.matchAll(/<div class="il-book-slot-\d+">([\s\S]*?)<\/div>\s*<\/div>|<div class="il-book-slot-\d+">([\s\S]*?)(?=<div class="il-book-slot-|$)/g)) {
        const parts = [...(block[1] ?? block[2] ?? "").matchAll(/<div>([\s\S]*?)(?:<\/div>|$)/g)].map((m) => textOf(m[1]!));
        const timeText = parts.find((part) => /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(part));
        if (!timeText) continue;
        const available = parts.map((part) => part.match(/^\((\d{1,4})\)$/)?.[1]).find(Boolean);
        const dayText = days[column]!;
        const day = dayOf(dayText);
        const [from, to] = timeText.split(/\s*-\s*/);
        const stamp = (time: string) => (day && year !== undefined ? parseAdamTimestamp(`${day.day} ${MONTHS[day.month]} ${year}, ${time}`) : undefined);
        const startsAt = stamp(from!);
        const endsAt = stamp(to!);
        slots.push({ dayText, timeText, ...(startsAt ? { startsAt } : {}), ...(endsAt ? { endsAt } : {}), ...(available ? { available: Number(available) } : {}) });
      }
      column++;
    }
  });
  return slots;
}

export const readBookingPool: ObjectReader = async (ctx: ReaderContext) => {
  const rows = parseRows(ctx.page.html);
  if (!rows) return undefined;
  const screens = new Map(ctx.routes(ctx.page.html, BOOKING_SCREEN).map((url) => [new URL(url).searchParams.get("object_id")!, url]));
  const objects: BookableObject[] = [];
  let opened = 0;
  for (const { objectId, ...object } of rows) {
    const screen = objectId ? screens.get(objectId) : undefined;
    if (screen && opened < MAX_SLOT_OBJECTS) {
      opened++;
      try {
        const slots = parseFreeSlots((await ctx.open(screen)).html);
        if (slots) {
          objects.push({ ...object, freeSlots: slots.slice(0, MAX_SLOTS_PER_OBJECT) });
          continue;
        }
      } catch {
        // A screen that fails to open leaves the row without slots; the table is still read.
      }
    }
    objects.push(object);
  }
  const detail: BookingPoolDetail = { kind: "booking-pool", evidence: "lab-verified", objects };
  return { detail };
};
