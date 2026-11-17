import { redactText } from "adam-core";
import { textOf } from "../ui-items.ts";
import type { ObjectReader } from "./index.ts";

/**
 * ADR 0062 (#165): mediacast (`mcst`) content view, lab-verified against ILIAS 10.12
 * (tools/ilias-lab, student view). The page plays one item at a time: the centre column
 * holds `div[data-elementtype="item"]` with the item's title and description, and the side
 * "Videos" playlist (`#mcst_playlist`) lists every item by title, the playing one marked
 * `mcst-current`.
 *
 * Only the item on screen carries a description; ADAM renders the others' descriptions only
 * when they are played, so the reader does not open them. No media bytes, preview pictures,
 * play times or download routes are returned.
 */

export const MCST_ITEM_CAP = 100;

export type MediacastItem = {
  title: string;
  /** Present only for the item ADAM is showing. */
  description?: string;
  /** True for the item ADAM is showing. */
  current?: true;
};

export type MediacastDetail = {
  kind: "mediacast";
  evidence: "lab-verified";
  items: MediacastItem[];
  itemCount: number;
  truncated?: boolean;
};

/** Items in playlist order, or undefined when the page carries neither a playlist nor a shown item. */
export function parseMediacastItems(html: string): { items: MediacastItem[]; itemCount: number; truncated: boolean } | undefined {
  const shown = shownItem(html);
  const playlist = playlistItems(html);
  if (!shown && !playlist) return undefined;

  let listed: MediacastItem[] = playlist ?? [];
  if (shown) {
    // The shown item takes its playlist entry (the one marked current, else the first with its title).
    const at = listed.findIndex((item) => item.current) >= 0
      ? listed.findIndex((item) => item.current)
      : listed.findIndex((item) => item.title === shown.title);
    if (at >= 0) listed = listed.map((item, index) => index === at ? { ...item, current: true, ...(shown.description ? { description: shown.description } : {}) } : item);
    else listed = [{ title: shown.title, current: true, ...(shown.description ? { description: shown.description } : {}) }, ...listed];
  }
  if (listed.length === 0) return undefined;
  return { items: listed.slice(0, MCST_ITEM_CAP), itemCount: listed.length, truncated: listed.length > MCST_ITEM_CAP };
}

/** The item in the centre column: its title and description, or undefined. */
function shownItem(html: string): { title: string; description?: string } | undefined {
  const start = html.indexOf('class="il-mcst-videocast"');
  if (start < 0) return undefined;
  const end = html.indexOf("<aside", start);
  const center = html.slice(start, end > start ? end : undefined);
  const title = center.match(/<span data-elementtype="title">([\s\S]*?)<\/span>/i)?.[1];
  if (title === undefined) return undefined;
  const description = center.match(/<span data-elementtype="description">([\s\S]*?)<\/span>/i)?.[1];
  const titleText = redactText(textOf(title));
  if (!titleText) return undefined;
  const descriptionText = description === undefined ? "" : redactText(textOf(description));
  return { title: titleText, ...(descriptionText ? { description: descriptionText } : {}) };
}

/** The side playlist, one entry per item (title only). */
function playlistItems(html: string): MediacastItem[] | undefined {
  const start = html.indexOf('id="mcst_playlist"');
  if (start < 0) return undefined;
  const end = html.indexOf("</aside>", start);
  const playlist = html.slice(start, end > start ? end : undefined);
  const items: MediacastItem[] = [];
  for (const match of playlist.matchAll(/<div class="il-item il-std-item([^"]*)" id="med_\d+"[^>]*>([\s\S]*?)(?=<div class="il-item il-std-item|$)/gi)) {
    const title = match[2]!.match(/<h4\b[^>]*class="il-item-title"[^>]*>([\s\S]*?)<\/h4>/i)?.[1];
    const text = title === undefined ? "" : redactText(textOf(title));
    if (!text) continue;
    items.push({ title: text, ...(/\bmcst-current\b/.test(match[1]!) ? { current: true as const } : {}) });
  }
  return items;
}

export const readMediacast: ObjectReader = async (ctx) => {
  const parsed = parseMediacastItems(ctx.page.html);
  if (!parsed) return undefined;
  return {
    detail: {
      kind: "mediacast",
      evidence: "lab-verified",
      items: parsed.items,
      itemCount: parsed.itemCount,
      ...(parsed.truncated ? { truncated: true } : {}),
    } satisfies MediacastDetail,
  };
};
