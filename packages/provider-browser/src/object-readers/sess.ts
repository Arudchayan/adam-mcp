import { redactText } from "adam-core";
import { parseAdamTimestamp } from "../deadlines.ts";
import { textOf } from "../ui-items.ts";
import type { ObjectReader, ReaderContext } from "./index.ts";

/**
 * ADR 0062: session (`sess`) info screen, read from the ILIAS 10.12 lab (tools/ilias-lab),
 * as a student. Evidence: `lab-verified`. Fields come only from markup a student sees on the
 * info screen: the page header (date range), the header description, and the "Session
 * Information" properties (location, details). Session materials are not on this screen (see
 * the PR notes), so they are not read.
 */

export type SessionDetail = {
  kind: "session";
  evidence: "lab-verified";
  /** Start of the session in ADAM's timezone (Europe/Zurich) as an ISO instant. Absent when the header shows "No date". */
  startsAt?: string;
  endsAt?: string;
  /** The date range as the header shows it, for example "10. Dec 2026, 09:00 - 11:30". */
  dateText?: string;
  location?: string;
  details?: string;
  description?: string;
};

const HEADER = /<h2 class="ilHeader">\s*(?:Session Information|Sitzungsinformation(?:en)?)\s*<\/h2>/i;
const PAGE_HEADER = /<h1\b[^>]*class="[^"]*\bil-page-content-header\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/i;
const DESCRIPTION = /<div class="ilHeaderDesc">([\s\S]*?)<\/div>/i;
const PROPERTY = /<div class="il_InfoScreenProperty\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div class="il_InfoScreenPropertyValue\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
/** "10. Dec 2026, 09:00 - 11:30" at the start of the header, before the title. */
const DATE_RANGE = /^(\d{1,2}\. [A-Za-z]{3,4} \d{4}, \d{1,2}:\d{2})(?: - (\d{1,2}:\d{2}))?(?=:\s)/;

/** Start and end of the header's date range, or undefined when the header shows "No date". */
export function sessionDates(header: string): { dateText: string; startsAt?: string; endsAt?: string } | undefined {
  const match = DATE_RANGE.exec(header);
  if (!match) return undefined;
  const dateText = match[2] ? `${match[1]} - ${match[2]}` : match[1]!;
  const startsAt = parseAdamTimestamp(match[1]!);
  const day = match[1]!.split(",")[0]!;
  const endsAt = match[2] ? parseAdamTimestamp(`${day}, ${match[2]}`) : undefined;
  return { dateText, ...(startsAt ? { startsAt } : {}), ...(endsAt ? { endsAt } : {}) };
}

export const readSession: ObjectReader = async (ctx: ReaderContext) => {
  const html = ctx.page.html;
  if (!HEADER.test(html)) return undefined;
  const detail: SessionDetail = { kind: "session", evidence: "lab-verified" };
  const header = PAGE_HEADER.exec(html)?.[1];
  const dates = header ? sessionDates(textOf(header)) : undefined;
  if (dates) Object.assign(detail, dates);
  const description = DESCRIPTION.exec(html)?.[1];
  if (description && textOf(description)) detail.description = redactText(textOf(description));
  for (const match of html.matchAll(PROPERTY)) {
    const name = textOf(match[1]!).replace(/:\s*$/, "");
    const value = textOf(match[2]!);
    if (!value) continue;
    if (/^(Location|Ort)$/i.test(name)) detail.location = redactText(value);
    else if (/^(Details\/Workflow|Details|Details\/Ablauf)$/i.test(name)) detail.details = redactText(value);
  }
  return { detail };
};
