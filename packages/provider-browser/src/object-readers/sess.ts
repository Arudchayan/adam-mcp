import { canonicalUrl, parseAdamRef, redactText, type AdamObjectType, type RefId } from "adam-core";
import { advertisedRoute, type RouteRule } from "../advertised-route.ts";
import { parseAdamTimestamp } from "../deadlines.ts";
import { textOf } from "../ui-items.ts";
import type { ObjectReader, ReaderContext } from "./index.ts";

/**
 * ADR 0062: session (`sess`) info screen, read from the ILIAS 10.12 lab (tools/ilias-lab),
 * as a student. Evidence: `lab-verified`.
 *
 * Fields come from the info screen: the page header (date range), the header description and
 * the "Session Information" properties (location, details).
 *
 * Materials: the session's info screen does not list them. The parent course's listing does,
 * as sub-items of the session row, when the course is expanded at that session. The reader
 * follows the parent course (breadcrumb, pinned origin) and the course's expand link for this
 * session only (`advertisedRoute` on the session's own row), then reads the sub-items whose
 * `lg_div_{ref}_pref_{session}` marks them as belonging to this session. That is up to three
 * pages in total, well inside MAX_READER_PAGES.
 */

export type SessionMaterial = {
  title: string;
  type: AdamObjectType;
  refId: RefId;
  url: string;
};

export type SessionDetail = {
  kind: "session";
  evidence: "lab-verified";
  /** Start of the session in Europe/Zurich as an ISO instant. Absent when the header shows "No date". */
  startsAt?: string;
  endsAt?: string;
  /** The date range as the header shows it, for example "10. Dec 2026, 09:00 - 11:30". */
  dateText?: string;
  location?: string;
  details?: string;
  description?: string;
  /** Present when the parent is a course: the session's materials as the course listing shows them. */
  materials?: SessionMaterial[];
};

const HEADER = /<h2 class="ilHeader">\s*(?:Session Information|Sitzungsinformation(?:en)?)\s*<\/h2>/i;
const PAGE_HEADER = /<h1\b[^>]*class="[^"]*\bil-page-content-header\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/i;
const DESCRIPTION = /<div class="ilHeaderDesc">([\s\S]*?)<\/div>/i;
const PROPERTY = /<div class="il_InfoScreenProperty\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div class="il_InfoScreenPropertyValue\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
/** "10. Dec 2026, 09:00 - 11:30" at the start of the header, before the title. */
const DATE_RANGE = /^(\d{1,2}\. [A-Za-z]{3,4} \d{4}, \d{1,2}:\d{2})(?: - (\d{1,2}:\d{2}))?(?=:\s)/;
/** Rule for the course's expand link of one item: any expand value, view command, same course. */
const COURSE_EXPAND: RouteRule = { cmdClass: /^ilobjcoursegui$/i, cmd: /^view$/i, keys: { expand: /^-?\d+$/ } };
/** Icon alt text (ILIAS 10.12 English) for sub-item types whose links carry no `goto` target. */
const ICON_TYPE: Record<string, AdamObjectType> = { Folder: "fold", Weblink: "webr" };

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

/** The parent course from the breadcrumb (the only course link on the info screen). */
export function parentCourse(html: string): RefId | undefined {
  const crumbs = html.match(/<nav aria-label="Breadcrumbs"[\s\S]*?<\/nav>/i)?.[0] ?? "";
  for (const link of crumbs.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)) {
    const ref = parseAdamRef(link[1]!.replace(/&amp;/gi, "&"));
    if (ref?.type === "crs") return ref.refId;
  }
  return undefined;
}

/** The markup of one course item row (`item_row_sess-{ref}`) up to the next item row. */
export function itemRow(html: string, ref: RefId): string | undefined {
  const start = html.indexOf(`id="item_row_sess-${ref}"`);
  if (start < 0) return undefined;
  const next = html.indexOf('id="item_row_', start + 10);
  return html.slice(start, next < 0 ? html.length : next);
}

/**
 * The sub-items that belong to one session (`lg_div_{item}_pref_{session}`), with their
 * type and link. Sub-items of other sessions or of course items are not returned.
 */
export function sessionMaterials(row: string, sessionRef: RefId): SessionMaterial[] {
  const materials: SessionMaterial[] = [];
  const own = new RegExp(`data-list-item-id="lg_div_(\\d+)_pref_${sessionRef}"`);
  for (const piece of row.split('<div class="subitem">').slice(1)) {
    const refId = piece.match(own)?.[1];
    if (!refId) continue;
    const title = textOf(piece.match(/<h3 class="il_ContainerItemTitle">([\s\S]*?)<\/h3>/i)?.[1] ?? "");
    const href = piece.match(/<a\b[^>]*\bhref="([^"]+)"[^>]*class="il_ContainerItemTitle"/i)?.[1];
    const linked = href ? parseAdamRef(href.replace(/&amp;/gi, "&")) : undefined;
    const icon = piece.match(/<img alt="([^"]+)"/i)?.[1];
    const type = linked?.type ?? (icon ? ICON_TYPE[icon] : undefined);
    if (!title || !type || type === "unknown" || (linked && linked.refId !== refId)) continue;
    materials.push({ title: redactText(title), type, refId, url: canonicalUrl(type, refId) });
  }
  return materials;
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
  const sessionRef = ctx.refId;
  const course = parentCourse(html);
  if (course) {
    // Parent course page (collapsed), then the expanded view of this session only.
    const parent = await ctx.open(canonicalUrl("crs", course));
    const row = itemRow(parent.html, sessionRef);
    const expand = row ? advertisedRoute(row, course, COURSE_EXPAND) : undefined;
    if (!expand) {
      detail.materials = [];
    } else {
      const expanded = await ctx.open(expand);
      const expandedRow = itemRow(expanded.html, sessionRef);
      detail.materials = expandedRow ? sessionMaterials(expandedRow, sessionRef) : [];
    }
  }
  return { detail };
};
