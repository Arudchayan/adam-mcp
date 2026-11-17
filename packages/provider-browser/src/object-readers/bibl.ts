import { redactText } from "adam-core";
import { advertisedRoutes, type RouteRule } from "../advertised-route.ts";
import { textOf } from "../ui-items.ts";
import type { ObjectReader, ReaderPage } from "./index.ts";

/**
 * ADR 0062 (#165): bibliography (`bibl`) content view, lab-verified against ILIAS 10.12
 * (tools/ilias-lab, student view with a BibTeX upload). The view lists entries as
 * presentation rows: `h4.il-table-presentation-row-header-headline` (title, then the authors
 * in `<small>`), the year in `dd.il-table-presentation-row-header-fields-value`, and a
 * "Detail View" button whose `data-action` is `cmd=showDetails&entry_id=<n>`.
 *
 * A `subPage` is an entry id from an earlier `detail`. Reading it opens that one advertised
 * detail route and returns its label/value rows (`il-listing-characteristic-value`) as the
 * selected entry. The original file download (`cmd=sendFile`) is never followed.
 */

export const BIBL_ENTRY_CAP = 200;
const FIELD_CAP = 30;

/** Advertised entry detail routes only: this object, `showDetails`, a numeric entry_id. */
const ENTRY_ROUTE: RouteRule = { cmdClass: /^ilobjbibliographicgui$/i, cmd: /^showDetails$/i, keys: { entry_id: /^\d{1,9}$/ } };

export type BibliographyEntry = {
  title: string;
  authors?: string;
  year?: number;
  /** BibTeX cite key as ILIAS shows it (the "Bib Cite" row). */
  citeKey?: string;
  /** Opaque id for `subPage`, present when ADAM advertises the entry's detail route. */
  subPage?: string;
};

export type BibliographyDetail = {
  kind: "bibliography";
  evidence: "lab-verified";
  entries: BibliographyEntry[];
  entryCount: number;
  truncated?: boolean;
  /** The entry read through `subPage`: its label/value rows as ADAM shows them. */
  entry?: { title?: string; fields: Array<{ label: string; value: string }> };
};

/** Entry rows of the bibliography page, in ADAM's order. */
export function parseBibliographyEntries(html: string): BibliographyEntry[] | undefined {
  // Exactly the row element (`il-table-presentation-row` plus state classes), not its `-controls`/`-header` parts.
  const rows = [...html.matchAll(/<div class="il-table-presentation-row(?:\s[^"]*)?"[^>]*>/gi)];
  if (rows.length === 0) return undefined;
  const entries: BibliographyEntry[] = [];
  rows.forEach((row, index) => {
    const start = row.index ?? 0;
    const end = rows[index + 1]?.index ?? html.length;
    const block = html.slice(start, end);
    const headline = block.match(/<h4\b[^>]*class="[^"]*il-table-presentation-row-header-headline[^"]*"[^>]*>([\s\S]*?)<\/h4>/i)?.[1];
    if (headline === undefined) return;
    const authorsHtml = headline.match(/<small\b[^>]*>([\s\S]*?)<\/small>/i)?.[1];
    const title = redactText(textOf(headline.replace(/<small\b[\s\S]*?<\/small>/gi, " ")));
    if (!title) return;
    const authors = authorsHtml === undefined ? "" : redactText(textOf(authorsHtml));
    const year = textOf(block.match(/<dd\b[^>]*class="[^"]*il-table-presentation-row-header-fields-value[^"]*"[^>]*>([\s\S]*?)<\/dd>/i)?.[1] ?? "");
    const citeKey = redactText(textOf(labelledRows(block).find((field) => field.label === "Bib Cite")?.value ?? ""));
    const entryId = block.match(/data-action="[^"]*\bcmd=showDetails&amp;ref_id=\d+&amp;entry_id=(\d{1,9})"/i)?.[1]
      ?? block.match(/data-action="[^"]*\bentry_id=(\d{1,9})"/i)?.[1];
    entries.push({
      title,
      ...(authors ? { authors } : {}),
      ...(/^\d{4}$/.test(year) ? { year: Number(year) } : {}),
      ...(citeKey ? { citeKey } : {}),
      ...(entryId ? { subPage: entryId } : {}),
    });
  });
  return entries.length > 0 ? entries : undefined;
}

/** `dt`-less label/value rows of an ILIAS characteristic list, in order. */
function labelledRows(html: string): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  for (const match of html.matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gi)) {
    rows.push({ label: textOf(match[1]!), value: textOf(match[2]!) });
  }
  for (const match of html.matchAll(/<div class="il-listing-characteristic-value-label">([\s\S]*?)<\/div>\s*<div class="il-listing-characteristic-value-item">([\s\S]*?)<\/div>/gi)) {
    rows.push({ label: textOf(match[1]!), value: textOf(match[2]!) });
  }
  return rows;
}

/** The selected entry's rows from its detail page (`Detail View` panel). */
function entryDetail(page: ReaderPage): { title?: string; fields: Array<{ label: string; value: string }> } {
  const fields = labelledRows(page.html)
    .filter((row) => row.label && row.value)
    .slice(0, FIELD_CAP)
    .map((row) => ({ label: row.label, value: redactText(row.value) }));
  const title = fields.find((row) => row.label === "Title")?.value;
  return { ...(title ? { title } : {}), fields };
}

export const readBibliography: ObjectReader = async (ctx) => {
  const all = parseBibliographyEntries(ctx.page.html);
  if (!all) return undefined;
  // A subPage id is kept only when ADAM advertises that entry's detail route on this page.
  const routes = advertisedRoutes(ctx.page.html, ctx.refId, ENTRY_ROUTE);
  const advertised = new Set(routes.map((url) => new URL(url).searchParams.get("entry_id")));
  const entries = all.slice(0, BIBL_ENTRY_CAP).map((entry) => (entry.subPage && advertised.has(entry.subPage) ? entry : withoutSubPage(entry)));
  const detail: BibliographyDetail = {
    kind: "bibliography",
    evidence: "lab-verified",
    entries,
    entryCount: all.length,
    ...(all.length > BIBL_ENTRY_CAP ? { truncated: true } : {}),
  };
  if (!ctx.subPage) return { detail };

  const target = routes.find((url) => new URL(url).searchParams.get("entry_id") === ctx.subPage);
  if (!target) return undefined;
  const page = await ctx.open(target);
  return {
    detail: { ...detail, entry: entryDetail(page) },
    text: page.text,
  };
};

function withoutSubPage(entry: BibliographyEntry): BibliographyEntry {
  const { subPage: _subPage, ...rest } = entry;
  return rest;
}
