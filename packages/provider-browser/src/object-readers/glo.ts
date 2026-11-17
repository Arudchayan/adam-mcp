import { extractClassBlocksAt, textOf } from "../ui-items.ts";
import type { ObjectReader } from "./index.ts";

/**
 * ADR 0062 / #165: glossary (`glo`) reader, lab-verified against ILIAS 10.12 (tools/ilias-lab,
 * glossary ref 96, student view `ilPresentationTableGUI show`). The student's glossary page
 * lists every term inline as a presentation row: the term is the row headline, and its
 * full definition is the COPage paragraphs in the row's `il-table-presentation-desclist`.
 * The glossary has no per-term route, so a `subPage` request is not recognised.
 */

/** Definitions are untrusted learner-visible text; cap each one. */
export const GLOSSARY_DEFINITION_CAP = 1000;
/** Terms returned per read; a longer glossary is marked truncated. */
export const GLOSSARY_TERM_CAP = 200;

export type GlossaryTerm = {
  term: string;
  /** Full definition text (untrusted), capped at GLOSSARY_DEFINITION_CAP. */
  definition: string;
};

export type GlossaryDetail = {
  kind: "glossary";
  evidence: "lab-verified";
  terms: GlossaryTerm[];
  termCount: number;
  truncated?: boolean;
};

/** One presentation row per term; the row boundary is the presentation row's opening div. */
const ROW_START = /<div\b[^>]*class="(?:[^"]*\s)?il-table-presentation-row(?=[\s"])[^"]*"/gi;

/** Full definition: the COPage paragraphs of the row's expanded description. Falls back to the row's short definition. */
function definitionOf(row: string): string {
  const desc = extractClassBlocksAt(row, "il-table-presentation-desclist")[0]?.block;
  const paragraphs = desc ? [...desc.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => textOf(m[1]!)).filter(Boolean) : [];
  if (paragraphs.length > 0) return paragraphs.join(" ");
  const short = extractClassBlocksAt(row, "il-table-presentation-row-header-fields-value")[0]?.block;
  return short ? textOf(short) : "";
}

/** Terms of the glossary presentation table, or undefined when the markup is not recognised. */
export function parseGlossaryTerms(html: string): { terms: GlossaryTerm[]; termCount: number; truncated: boolean } | undefined {
  const starts = [...html.matchAll(ROW_START)].map((m) => m.index ?? 0);
  if (starts.length === 0) return undefined;
  const terms: GlossaryTerm[] = [];
  let termCount = 0;
  for (let i = 0; i < starts.length; i++) {
    const row = html.slice(starts[i], starts[i + 1] ?? html.length);
    const headline = extractClassBlocksAt(row, "il-table-presentation-row-header-headline")[0]?.block;
    if (headline === undefined) return undefined;
    const term = textOf(headline);
    if (!term) return undefined;
    termCount++;
    if (terms.length < GLOSSARY_TERM_CAP) {
      terms.push({ term, definition: definitionOf(row).slice(0, GLOSSARY_DEFINITION_CAP) });
    }
  }
  // ILIAS footer "(1 - 200 of 340)": the rendered range is smaller than the glossary.
  const footer = html.match(/\(\s*\d+\s*-\s*(\d+)\s+(?:of|von)\s+(\d+)\s*\)/i);
  const total = footer ? Number(footer[2]) : termCount;
  return { terms, termCount: Math.max(termCount, total), truncated: total > termCount || termCount > GLOSSARY_TERM_CAP };
}

export const readGlossary: ObjectReader = async (ctx) => {
  // No per-term sub-page exists on the glossary presentation; a subPage id is never recognised here.
  if (ctx.subPage) return undefined;
  const parsed = parseGlossaryTerms(ctx.page.html);
  if (!parsed) return undefined;
  const detail: GlossaryDetail = {
    kind: "glossary",
    evidence: "lab-verified",
    terms: parsed.terms,
    termCount: parsed.termCount,
    ...(parsed.truncated ? { truncated: true } : {}),
  };
  return { detail };
};
