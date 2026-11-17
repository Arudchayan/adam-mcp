import { DEFAULT_ADAM_ORIGIN, type RefId } from "adam-core";
import type { RouteRule } from "../advertised-route.ts";
import { tableRange } from "../staff-views.ts";
import { extractClassBlocksAt, textOf } from "../ui-items.ts";
import type { ObjectReader } from "./index.ts";

/**
 * ADR 0062 / #165: wiki (`wiki`) reader, lab-verified against ILIAS 10.12 (tools/ilias-lab,
 * wiki "Lab wiki pages", ref 117; student views in fixtures/lab/wiki-*-student.json).
 *
 * - `pages`: the wiki's All Pages table, one row per page. Only the page title, its numeric
 *   id and the table footer count are read. The last editor (avatar, login) and dates are not.
 * - `subPage`: the numeric page id (`wpage_{id}`). Reading one opens the page's own permalink
 *   (`goto.php/wiki/wpage_{id}_{ref}`), which the All Pages view advertises. No crawl.
 */

/** The All Pages sub-tab the wiki advertises from its pages. */
const ALL_PAGES: RouteRule = { cmdClass: /^ilobjwikigui$/i, cmd: /^allPages$/, keys: { page: /^[A-Za-z0-9_.-]{1,80}$/, wpg_id: /^\d{1,9}$/ } };
const PAGE_ID = /^\d{1,9}$/;
const PERMALINK_PATH = /^\/(?:goto\.php\/wiki|go\/wiki)\/wpage_(\d{1,9})_(\d{1,9})$/;

export type WikiPage = { title: string; subPage: string };

export type WikiDetail = {
  kind: "wiki";
  evidence: "lab-verified";
  /** Title of the wiki's start page, as the object page shows it. */
  startPage?: string;
  pages: WikiPage[];
  pageCount: number;
  truncated?: boolean;
};

/**
 * The permalink of one wiki page, as the All Pages view links it. Accepts `goto.php/wiki/wpage_{id}_{ref}`
 * and `go/wiki/wpage_{id}_{ref}` on the pinned origin only, with no query string, no fragment and no
 * credentials. Returns the absolute URL, or undefined when the href is anything else (another ref,
 * another wiki, a foreign origin, a query, or a non-digit id). `pageId` restricts it to one id.
 */
export function wikiPermalink(raw: string, refId: RefId, pageId?: string): string | undefined {
  // A bare "?" or "#" is still a query or fragment, so check the raw href as well as the parsed URL.
  if (/[?#]/.test(raw)) return undefined;
  let url: URL;
  try { url = new URL(raw.replace(/&amp;/gi, "&"), DEFAULT_ADAM_ORIGIN); } catch { return undefined; }
  if (url.origin !== DEFAULT_ADAM_ORIGIN || url.username || url.password) return undefined;
  if (url.search !== "" || url.hash !== "") return undefined;
  const match = url.pathname.match(PERMALINK_PATH);
  if (!match) return undefined;
  const [, id, ref] = match;
  if (ref !== refId) return undefined;
  if (pageId !== undefined && (!PAGE_ID.test(pageId) || id !== pageId)) return undefined;
  return url.href;
}

/** Permalinks of pages in this wiki (any id), as `{ id, title }`. Markup inside a link (icons) is not a page row. */
function pageRows(html: string, refId: RefId): Array<{ id: string; title: string }> {
  const rows: Array<{ id: string; title: string }> = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (/<[a-z!]/i.test(match[2]!)) continue;
    const url = wikiPermalink(match[1]!, refId);
    const id = url?.match(/wpage_(\d{1,9})_/)?.[1];
    const title = textOf(match[2]!);
    if (!id || !title || rows.some((row) => row.id === id)) continue;
    rows.push({ id, title });
  }
  return rows;
}

/** The page title ILIAS shows as the page heading (`ilc_page_title_PageTitle`). */
export function wikiPageTitle(html: string): string | undefined {
  const text = html.match(/<h1\b[^>]*class="[^"]*\bilc_page_title_PageTitle\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  return text === undefined ? undefined : textOf(text) || undefined;
}

/** The All Pages table: one row per page, with the page id from its permalink. */
export function parseWikiPages(html: string, refId: RefId): { pages: WikiPage[]; pageCount: number; truncated: boolean } | undefined {
  const rows = pageRows(html, refId);
  if (rows.length === 0) {
    // ILIAS shows this sentence for a wiki without pages; anything else is not recognised.
    return /This object is empty/i.test(html) ? { pages: [], pageCount: 0, truncated: false } : undefined;
  }
  const pages = rows.map(({ id, title }) => ({ title, subPage: id }));
  const range = tableRange(html);
  const pageCount = Math.max(rows.length, range?.total ?? 0);
  return { pages, pageCount, truncated: pageCount > rows.length };
}

/** The wiki page content (the COPage container), or the whole page text when the container is absent. */
function contentText(html: string, fallback: string): string {
  const container = extractClassBlocksAt(html, "ilc_page_cont_PageContainer")[0]?.block;
  const text = container === undefined ? "" : textOf(container);
  return text || fallback;
}

export const readWiki: ObjectReader = async (ctx) => {
  const allUrl = ctx.route(ctx.page.html, ALL_PAGES);
  if (!allUrl) return undefined;
  const listing = await ctx.open(allUrl);
  const inventory = parseWikiPages(listing.html, ctx.refId);
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

  // The id must be one the listing advertises; its permalink is the only page opened.
  if (!inventory.pages.some((page) => page.subPage === ctx.subPage)) return undefined;
  const permalink = wikiPermalinkFor(listing.html, ctx.refId, ctx.subPage);
  if (!permalink) return undefined;
  const page = await ctx.open(permalink);
  return { detail, text: contentText(page.html, page.text) };
};

/** The advertised permalink for one page id in the All Pages listing, or undefined. */
function wikiPermalinkFor(listingHtml: string, refId: RefId, pageId: string): string | undefined {
  for (const match of listingHtml.matchAll(/<a\b[^>]*\bhref="([^"]*)"/gi)) {
    const url = wikiPermalink(match[1]!, refId, pageId);
    if (url) return url;
  }
  return undefined;
}
