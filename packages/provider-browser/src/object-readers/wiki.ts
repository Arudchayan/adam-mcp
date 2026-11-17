import type { RouteRule } from "../advertised-route.ts";
import { tableRange } from "../staff-views.ts";
import { extractClassBlocksAt, textOf } from "../ui-items.ts";
import type { ObjectReader, ReaderPage } from "./index.ts";

/**
 * ADR 0062 / #165: wiki (`wiki`) reader, lab-verified against ILIAS 10.12 (tools/ilias-lab,
 * wiki "Lab wiki pages", ref 117; student views in fixtures/lab/wiki-*-student.json).
 *
 * - `pages`: the wiki's All Pages table (the sub-tab the start page advertises).
 * - `subPage`: an opaque page slug from `pages`. The slug is the ILIAS page id (the title with
 *   underscores). The page is found by following the `gotoPage` internal links the wiki
 *   pages render, breadth first from the start page, within WIKI_CRAWL_LIMIT pages.
 *   A page the crawl does not reach returns undefined (the provider reports stale_id).
 */

/** Pages the sub-page crawl may open (on top of the All Pages listing); well under MAX_READER_PAGES. */
export const WIKI_CRAWL_LIMIT = 8;

const SLUG = /^[A-Za-z0-9_.-]{1,80}$/;
/** The All Pages sub-tab the wiki advertises from its pages. */
const ALL_PAGES: RouteRule = { cmdClass: /^ilobjwikigui$/i, cmd: /^allPages$/, keys: { page: SLUG, wpg_id: /^\d{1,9}$/ } };
/** The internal link a wiki page renders to another existing page. */
const PAGE_LINK: RouteRule = { cmdClass: /^ilobjwikigui$/i, cmd: /^gotoPage$/, keys: { page: SLUG, from_page: SLUG } };

export type WikiPage = { title: string; subPage?: string };

export type WikiDetail = {
  kind: "wiki";
  evidence: "lab-verified";
  /** Title of the wiki's start page, as the object page shows it. */
  startPage?: string;
  pages: WikiPage[];
  pageCount: number;
  truncated?: boolean;
};

/** The page title ILIAS shows as the page heading (`ilc_page_title_PageTitle`). */
export function wikiPageTitle(html: string): string | undefined {
  const text = html.match(/<h1\b[^>]*class="[^"]*\bilc_page_title_PageTitle\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  return text === undefined ? undefined : textOf(text) || undefined;
}

/** The ILIAS page id of a title: spaces become underscores. Undefined when the id would not be a safe id. */
export function wikiPageSlug(title: string): string | undefined {
  const slug = title.trim().replace(/\s+/g, "_");
  return SLUG.test(slug) ? slug : undefined;
}

/** The All Pages table: one row per page, linked to the page's `goto.php/wiki/wpage_<id>_<ref>`. */
export function parseWikiPages(html: string): { pages: WikiPage[]; pageCount: number; truncated: boolean } | undefined {
  const titles: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref="[^"]*\/wiki\/wpage_\d+_\d+"[^>]*>([\s\S]*?)<\/a>/gi)) {
    // A page title is plain text; a link with markup inside (for example the "Last Visited Page" icon) is not a row.
    if (/<[a-z!]/i.test(match[1]!)) continue;
    const title = textOf(match[1]!);
    if (title && !titles.includes(title)) titles.push(title);
  }
  if (titles.length === 0) {
    // ILIAS shows this sentence for a wiki without pages; anything else is not recognised.
    return /This object is empty/i.test(html) ? { pages: [], pageCount: 0, truncated: false } : undefined;
  }
  const pages = titles.map((title) => {
    const subPage = wikiPageSlug(title);
    return subPage ? { title, subPage } : { title };
  });
  const range = tableRange(html);
  const pageCount = Math.max(titles.length, range?.total ?? 0);
  return { pages, pageCount, truncated: pageCount > titles.length };
}

/** The wiki page content (the COPage container), or the whole page text when the container is absent. */
function contentText(html: string, fallback: string): string {
  const container = extractClassBlocksAt(html, "ilc_page_cont_PageContainer")[0]?.block;
  const text = container === undefined ? "" : textOf(container);
  return text || fallback;
}

/** Internal links to existing pages only: ILIAS marks a link to a page that does not exist with `ilWikiPageMissing`. */
function existingPageLinks(ctx: { routes(html: string, rule: RouteRule): string[] }, html: string): string[] {
  const anchors = [...html.matchAll(/<a\b[^>]*>/gi)].map((m) => m[0]).filter((tag) => !/ilWikiPageMissing/i.test(tag));
  return ctx.routes(anchors.join(""), PAGE_LINK);
}

export const readWiki: ObjectReader = async (ctx) => {
  const allUrl = ctx.route(ctx.page.html, ALL_PAGES);
  if (!allUrl) return undefined;
  const listing = await ctx.open(allUrl);
  const inventory = parseWikiPages(listing.html);
  if (!inventory) return undefined;
  const startPage = wikiPageTitle(ctx.page.html);
  const detail: WikiDetail = {
    kind: "wiki",
    evidence: "lab-verified",
    ...(startPage ? { startPage } : {}),
    pages: inventory.pages,
    pageCount: inventory.pageCount,
    ...(inventory.truncated ? { truncated: true } : {}),
  };
  if (!ctx.subPage) return { detail };

  const target = ctx.subPage;
  const startSlug = startPage ? wikiPageSlug(startPage) : undefined;
  if (target === startSlug) return { detail, text: contentText(ctx.page.html, ctx.page.text) };

  // Breadth-first over the links existing pages render, from the start page, bounded.
  const seen = new Set<string>(startSlug ? [startSlug] : []);
  const queue = existingPageLinks(ctx, ctx.page.html);
  let opened = 0;
  while (queue.length > 0 && opened < WIKI_CRAWL_LIMIT) {
    const url = queue.shift()!;
    const slug = new URL(url).searchParams.get("page");
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const next: ReaderPage = await ctx.open(url);
    opened++;
    if (slug === target) return { detail, text: contentText(next.html, next.text) };
    queue.push(...existingPageLinks(ctx, next.html));
  }
  return undefined;
};
