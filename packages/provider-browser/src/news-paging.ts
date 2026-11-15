import { DEFAULT_ADAM_ORIGIN, type RefId } from "adam-core";
import { extractClassBlocksAt } from "./ui-items.ts";

/** Extra pages read per News block after page 1 (ADR 0055 amendment). */
export const MAX_NEWS_EXTRA_PAGES = 5;

export type NewsBlockType = "news" | "pdnews";

/**
 * A News block seen on a page, with what its later pages need: where its items
 * cite, the newest item date on this page, and the validated route to the next page.
 */
export type NewsBlockRef = {
  blockType: NewsBlockType;
  blockId: string;
  /** Course whose ref_id the course block's routes must carry (course pages only). */
  courseRefId?: RefId;
  folderRefId?: RefId;
  /** Citation shared by every item of the block. */
  url: string;
  /** 0-based page index this block shows. */
  pageIndex: number;
  /** Item dates on this page (ISO), undated items omitted. */
  dates: string[];
  itemCount: number;
  /** Validated route to page `pageIndex + 1`, when the block advertises one. */
  nextUrl?: string;
};

const BASE_CLASS: Record<NewsBlockType, string> = { news: "ilrepositorygui", pdnews: "ildashboardgui" };
const COMMON_KEYS = ["baseClass", "cmdNode", "cmdClass", "col_side", "block_type"];
const KEYS: Record<NewsBlockType, string[]> = {
  news: [...COMMON_KEYS, "ref_id"],
  pdnews: [...COMMON_KEYS, "view", "show"],
};

/**
 * ADR 0055 amendment: a News block page route is followed only when it is the
 * block's own advertised `data-action`, on the pinned origin, `/ilias.php`, with
 * the block's baseClass, `cmdClass=ilcolumngui`, the block's `block_type`, a single
 * `{block_type}_{blockId}_blnavpage` index and only allowlisted, non-duplicated keys.
 * Course routes must carry the page's course `ref_id`; there is no `cmd`, so no
 * feed URL or settings command can pass.
 */
export function newsPageRoute(
  raw: string,
  block: { blockType: NewsBlockType; blockId: string; courseRefId?: RefId },
): { url: string; index: number } | undefined {
  let url: URL;
  try {
    url = new URL(raw.replace(/&amp;/gi, "&"), DEFAULT_ADAM_ORIGIN);
  } catch {
    return undefined;
  }
  if (url.origin !== DEFAULT_ADAM_ORIGIN || url.pathname !== "/ilias.php" || url.username || url.password || url.hash) return undefined;
  const pageKey = `${block.blockType}_${block.blockId}_blnavpage`;
  const allowed = new Set([...KEYS[block.blockType], pageKey]);
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => !allowed.has(key)) || new Set(keys).size !== keys.length) return undefined;
  const param = (key: string) => url.searchParams.get(key) ?? "";
  if (param("baseClass").toLowerCase() !== BASE_CLASS[block.blockType]) return undefined;
  if (param("cmdClass").toLowerCase() !== "ilcolumngui" || param("block_type") !== block.blockType) return undefined;
  if (url.searchParams.has("cmdNode") && !/^[a-z0-9:]{1,40}$/i.test(param("cmdNode"))) return undefined;
  if (url.searchParams.has("col_side") && !/^(?:left|right)$/.test(param("col_side"))) return undefined;
  if (block.blockType === "news") {
    if (!block.courseRefId || param("ref_id") !== block.courseRefId) return undefined;
  } else {
    if (url.searchParams.has("view") && !/^\d{1,3}$/.test(param("view"))) return undefined;
    if (url.searchParams.has("show") && !/^[0-9a-f]{1,64}$/i.test(param("show"))) return undefined;
  }
  const index = param(pageKey);
  if (!/^\d{1,2}$/.test(index)) return undefined;
  return { url: url.href, index: Number(index) };
}

/** The validated route to page `index` among the block's advertised pagination buttons. */
export function advertisedNewsPage(
  blockHtml: string,
  block: { blockType: NewsBlockType; blockId: string; courseRefId?: RefId },
  index: number,
): string | undefined {
  for (const { block: pagination } of extractClassBlocksAt(blockHtml, "il-viewcontrol-pagination")) {
    for (const match of pagination.matchAll(/\bdata-action=["']([^"']+)["']/gi)) {
      const route = newsPageRoute(match[1]!, block);
      if (route && route.index === index) return route.url;
    }
  }
  return undefined;
}
