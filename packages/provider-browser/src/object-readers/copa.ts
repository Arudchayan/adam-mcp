import { redactText } from "adam-core";
import { textOf } from "../ui-items.ts";
import type { ObjectReader, ReaderContext } from "./index.ts";

/**
 * ADR 0062 reader for ILIAS 10.12 content pages (`copa`), lab-verified (tools/ilias-lab,
 * fixture copa-view-student). The page body is ILIAS COPage markup: paragraph styles are
 * `ilc_Paragraph ilc_text_block_*`, and headings carry `ilc_heading<level>_Headline<level>`.
 * Headings are read in order; each one starts a section. No sub-pages, no extra requests.
 */

export type CopaHeading = { level: number; text: string };

export function parseCopaHeadings(html: string): CopaHeading[] {
  const headings: CopaHeading[] = [];
  for (const match of html.matchAll(/<h([1-6])\b[^>]*\bclass="[^"]*\bilc_heading\d_[^"]*"[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = redactText(textOf(match[2]!));
    if (text) headings.push({ level: Number(match[1]), text });
  }
  return headings;
}

export const readContentPage: ObjectReader = async (ctx: ReaderContext) => {
  // Content pages have no sub-pages; an unknown subPage is stale (undefined), never the page itself.
  if (ctx.subPage !== undefined) return undefined;
  // Recognise the COPage body by its paragraph markup, not by any heading.
  if (!/\bilc_(?:Paragraph|text_block_)/.test(ctx.page.html)) return undefined;
  const headings = parseCopaHeadings(ctx.page.html);
  return {
    detail: {
      kind: "content-page",
      evidence: "lab-verified" as const,
      headings,
      sectionCount: headings.length,
    },
  };
};
