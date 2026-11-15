/**
 * ILIAS 10 Kitchen Sink "Item" listings (forum threads, exercise assignments):
 * an `il-item-title`, optional `il-item-description`, and ordered
 * `il-item-property-name` / `il-item-property-value` pairs. Honest parse only:
 * fields absent from the HTML stay absent.
 */
export type UiItem = {
  index: number;
  title: string;
  href?: string;
  description?: string;
  properties: Array<{ name: string; value: string }>;
};

export function extractClassBlocksAt(html: string, className: string): Array<{ block: string; index: number }> {
  const blocks: Array<{ block: string; index: number }> = [];
  const open = new RegExp(
    `<(div|li|article|span|h2|h3|h4|h5|p|dt|dd)\\b([^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*)>`,
    "gi",
  );
  for (const match of html.matchAll(open)) {
    const tag = match[1];
    const start = (match.index ?? 0) + match[0].length;
    const inner = sliceUntilClose(html, start, tag);
    if (inner !== undefined) {
      blocks.push({ block: inner, index: match.index ?? 0 });
    }
  }
  return blocks;
}

/** Inner HTML of every element whose id matches (nesting-aware, unlike a lazy regex). */
export function extractIdBlocks(html: string, id: RegExp): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(/<(div|section|aside)\b([^>]*\bid=["']([^"']+)["'][^>]*)>/gi)) {
    if (!id.test(match[3] ?? "")) continue;
    const inner = sliceUntilClose(html, (match.index ?? 0) + match[0].length, match[1]!);
    if (inner !== undefined) blocks.push(inner);
  }
  return blocks;
}

/** Items in document order; each item's fields come only from its own segment. */
export function parseUiItems(html: string): UiItem[] {
  const titles = [
    ...extractClassBlocksAt(html, "il-item-title"),
    ...extractClassBlocksAt(html, "c-item__title"),
  ].sort((a, b) => a.index - b.index);
  return titles.map(({ block, index }, position) => {
    const segment = html.slice(index, titles[position + 1]?.index ?? html.length);
    const names = extractClassBlocksAt(segment, "il-item-property-name");
    const values = extractClassBlocksAt(segment, "il-item-property-value");
    const description = textOf(extractClassBlocksAt(segment, "il-item-description")[0]?.block ?? "");
    const href = block.match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/gi, "&");
    return {
      index,
      title: textOf(block),
      ...(href ? { href } : {}),
      ...(description ? { description } : {}),
      properties: names.map((name, at) => ({
        name: textOf(name.block).replace(/[:·]\s*$/, "").trim(),
        value: textOf(values[at]?.block ?? ""),
      })),
    };
  });
}

export function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function sliceUntilClose(html: string, start: number, tag: string): string | undefined {
  const openRe = new RegExp(`<${tag}\\b`, "i");
  const closeRe = new RegExp(`</${tag}>`, "i");
  const closeLen = `</${tag}>`.length;
  let depth = 1;
  let cursor = start;
  while (cursor < html.length && depth > 0) {
    const rest = html.slice(cursor);
    const nextOpen = rest.search(openRe);
    const nextClose = rest.search(closeRe);
    if (nextClose < 0) {
      return undefined;
    }
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      cursor += nextOpen + 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return html.slice(start, cursor + nextClose);
    }
    cursor += nextClose + closeLen;
  }
  return undefined;
}
