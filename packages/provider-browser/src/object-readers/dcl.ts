import { redactText } from "adam-core";
import { tableRange } from "../staff-views.ts";
import { sliceUntilClose, textOf } from "../ui-items.ts";
import type { ObjectReader } from "./index.ts";

/**
 * ADR 0062 (#165): data collection (`dcl`) table view, lab-verified against ILIAS 10.12
 * (tools/ilias-lab, student view). A data collection shows its table as a KS record list:
 * `table.dcl_record_list` under an `h2.ilTableHeaderTitle` (the table name), a header row of
 * sortable column links, and `tr.tblrowN` records with one `td` per field.
 *
 * Values are untrusted user-entered text. Rows are capped; the page's own "(1 - n of m)"
 * footer says when ADAM holds more records than this page shows. Other views, record
 * details and sorting are not followed (no sub-pages): the reader only reads what the
 * table already renders.
 */

export const DCL_ROW_CAP = 100;
const DCL_COLUMN_CAP = 30;

export type DataCollectionTable = {
  title?: string;
  columns: string[];
  rows: Array<{ cells: Record<string, string> }>;
  /** Records ADAM reports for the table (footer total), or the rows shown when no total is shown. */
  rowCount: number;
  truncated?: boolean;
};

export type DataCollectionDetail = {
  kind: "data-collection";
  evidence: "lab-verified";
  tables: DataCollectionTable[];
};

/** Every record table on the page, or undefined when the page carries no recognised table. */
export function parseDataCollectionTables(html: string): DataCollectionTable[] | undefined {
  const tables: DataCollectionTable[] = [];
  for (const match of html.matchAll(/<table\b[^>]*\bclass="[^"]*\bdcl_record_list\b[^"]*"[^>]*>/gi)) {
    const start = (match.index ?? 0) + match[0].length;
    const inner = sliceUntilClose(html, start, "table");
    if (inner === undefined) return undefined;
    // The footer "(1 - n of m)" follows the table, in the same form.
    const footer = html.slice(start + inner.length + "</table>".length, start + inner.length + 1200);
    const table = parseOneTable(inner, footer, html.slice(0, match.index ?? 0));
    if (!table) return undefined;
    tables.push(table);
  }
  return tables.length > 0 ? tables : undefined;
}

function parseOneTable(inner: string, footer: string, before: string): DataCollectionTable | undefined {
  const headHtml = inner.match(/<thead\b[\s\S]*?<\/thead>/i)?.[0] ?? "";
  const columns = [...headHtml.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => columnName(m[1]!));
  if (columns.length === 0) return undefined;
  const rows: Array<{ cells: Record<string, string> }> = [];
  let seen = 0;
  for (const row of inner.matchAll(/<tr\b[^>]*\bclass="[^"]*\btblrow\d+\b[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cellValue(m[1]!));
    // A record must align with the header. A row that does not is not guessed at.
    if (cells.length !== columns.length) return undefined;
    seen += 1;
    if (rows.length < DCL_ROW_CAP) {
      rows.push({ cells: Object.fromEntries(columns.slice(0, DCL_COLUMN_CAP).map((name, at) => [name, redactText(cells[at] ?? "")])) });
    }
  }
  const total = tableRange(footer)?.total;
  const title = titleBefore(before);
  return {
    ...(title ? { title } : {}),
    columns: columns.slice(0, DCL_COLUMN_CAP),
    rows,
    rowCount: total ?? seen,
    ...(total !== undefined && total > rows.length || seen > rows.length ? { truncated: true } : {}),
  };
}

/** Column label without the sort-direction words ILIAS adds to a sortable header. */
function columnName(headerHtml: string): string {
  const name = textOf(headerHtml).replace(/\s*(Ascending|Descending|Aufsteigend|Absteigend)$/i, "").trim();
  return redactText(name || "(untitled)");
}

/** Cell text, without ILIAS 10.12 responsive column-title labels (`c-table-data__cell__col-title`). */
function cellValue(cellHtml: string): string {
  return textOf(cellHtml.replace(/<span\b[^>]*\bclass="[^"]*c-table-data__cell__col-title[^"]*"[^>]*>[\s\S]*?<\/span>/gi, " "));
}

/** The view name ILIAS prints above the table (`h2.ilTableHeaderTitle`), nearest to the table. */
function titleBefore(before: string): string | undefined {
  const title = [...before.matchAll(/<h2\b[^>]*\bilTableHeaderTitle\b[^>]*>([\s\S]*?)<\/h2>/gi)].at(-1)?.[1];
  const text = title ? redactText(textOf(title)) : "";
  return text || undefined;
}

export const readDataCollection: ObjectReader = async (ctx) => {
  const tables = parseDataCollectionTables(ctx.page.html);
  if (!tables) return undefined;
  return { detail: { kind: "data-collection", evidence: "lab-verified", tables } satisfies DataCollectionDetail };
};
