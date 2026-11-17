import { redactText } from "adam-core";
import type { RouteRule } from "../advertised-route.ts";
import { textOf } from "../ui-items.ts";
import type { ObjectReader, ReaderContext } from "./index.ts";

/**
 * ADR 0062 reader for ILIAS 10.12 learning modules (`lm`), lab-verified (tools/ilias-lab,
 * fixtures lm-start-student and lm-page-student).
 *
 * The student's presentation view carries the module's table of contents as a KS tree
 * (`ul.c-tree`). Chapters are nodes with `icon_st.svg`, pages are nodes with `icon_pg.svg`,
 * and each node links to `ilias.php?baseClass=illmpresentationgui&cmd=layout&ref_id=…&obj_id=N`.
 * The page's own `obj_id` is the opaque `subPage` id. Reading a sub-page opens that one
 * advertised route and returns its title and paragraphs. Nothing else is followed.
 */

export type LmPage = { title: string; subPage: string };
export type LmChapter = { title: string; pages: LmPage[] };
export type LmTree = { chapters: LmChapter[]; pages: LmPage[] };

const TREE_TOKEN = /<ul\b[^>]*>|<\/ul>|<span class="c-tree__node__label">[\s\S]*?<\/span>/g;
const LINK = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
const ICON = /icon_(st|pg|lm)\.svg/i;

/** Page route the module advertises: presentation layout command, no cmdClass. Obj ids are digits. */
const pageRule = (objId: RegExp): RouteRule => ({
  cmdClass: /^$/,
  cmd: /^layout$/,
  baseClass: /^illmpresentationgui$/i,
  keys: { obj_id: objId },
});

/** Pages and chapters of the presentation view's tree, in order. Undefined when no tree is present. */
export function parseLmTree(html: string): LmTree | undefined {
  type Node = { kind: "st" | "pg" | "lm"; depth: number; id: string; title: string };
  const nodes: Node[] = [];
  let depth = 0;
  let inTree = false;
  for (const token of html.matchAll(TREE_TOKEN)) {
    const text = token[0];
    if (text.startsWith("<ul")) {
      if (!inTree && /\bc-tree\b/.test(text)) inTree = true;
      if (inTree) depth++;
    } else if (text === "</ul>") {
      if (inTree) {
        depth--;
        if (depth === 0) break;
      }
    } else if (inTree) {
      const inner = text.replace(/^<span class="c-tree__node__label">/, "").replace(/<\/span>$/, "");
      const icon = inner.match(ICON)?.[1]?.toLowerCase();
      const link = inner.match(LINK);
      if (!icon || !link) continue;
      const kind = icon as Node["kind"];
      const href = link[1]!.replace(/&amp;/gi, "&");
      const id = href.match(/[?&]obj_id=(\d{1,12})(?!\d)/)?.[1];
      if (!id) continue;
      const title = redactText(textOf(link[2]!));
      if (!title) continue;
      nodes.push({ kind, depth, id, title });
    }
  }
  if (nodes.length === 0) return undefined;
  const tree: LmTree = { chapters: [], pages: [] };
  let chapter: { node: Node; entry: LmChapter } | undefined;
  for (const node of nodes) {
    if (chapter && node.depth <= chapter.node.depth) chapter = undefined;
    if (node.kind === "lm") continue;
    if (node.kind === "st") {
      const entry: LmChapter = { title: node.title, pages: [] };
      tree.chapters.push(entry);
      chapter = { node, entry };
      continue;
    }
    const page: LmPage = { title: node.title, subPage: node.id };
    if (chapter) chapter.entry.pages.push(page);
    else tree.pages.push(page);
  }
  return tree;
}

/** The sub-page's title and paragraphs, from its ILIAS content frame. */
export function parseLmPageText(html: string): string | undefined {
  const blocks = [...html.matchAll(/<(h1|h2|h3|h4|h5|h6|p)\b[^>]*\bclass="[^"]*\bilc_(?:page_title|Paragraph|heading\d_)[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi)];
  const lines = blocks.map((m) => redactText(textOf(m[2]!))).filter(Boolean);
  return lines.length > 0 ? lines.join("\n\n") : undefined;
}

export const readLearningModule: ObjectReader = async (ctx: ReaderContext) => {
  const tree = parseLmTree(ctx.page.html);
  if (!tree) return undefined;
  const pageCount = tree.chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0) + tree.pages.length;
  const detail = {
    kind: "learning-module",
    evidence: "lab-verified" as const,
    chapters: tree.chapters,
    ...(tree.pages.length > 0 ? { pages: tree.pages } : {}),
    pageCount,
  };
  if (ctx.subPage === undefined) return { detail };
  if (!/^\d{1,12}$/.test(ctx.subPage)) return undefined;
  const known = [...tree.chapters.flatMap((chapter) => chapter.pages), ...tree.pages].some((page) => page.subPage === ctx.subPage);
  if (!known) return undefined;
  const route = ctx.route(ctx.page.html, pageRule(new RegExp(`^${ctx.subPage}$`)));
  if (!route) return undefined;
  const page = await ctx.open(route);
  return { detail, text: parseLmPageText(page.html) ?? page.text };
};
