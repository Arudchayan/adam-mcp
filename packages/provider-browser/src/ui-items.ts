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
  return extractIdBlocksWithId(html, id).map((block) => block.html);
}

/** Like extractIdBlocks, with each block's element id. */
export function extractIdBlocksWithId(html: string, id: RegExp): Array<{ id: string; html: string }> {
  const blocks: Array<{ id: string; html: string }> = [];
  for (const match of html.matchAll(/<(div|section|aside)\b([^>]*\bid=["']([^"']+)["'][^>]*)>/gi)) {
    if (!id.test(match[3] ?? "")) continue;
    const inner = sliceUntilClose(html, (match.index ?? 0) + match[0].length, match[1]!);
    if (inner !== undefined) blocks.push({ id: match[3]!, html: inner });
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
    const href = block.match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/gi, "&") ?? sameOriginDataAction(block);
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

/**
 * ADR 0056: KS button titles (e.g. the ILIAS 10.12 Tasks page) carry their
 * route in `data-action` instead of `<a href>`. Only an ADAM-relative path or
 * an `https://adam.unibas.ch` URL is accepted; anything else is ignored.
 */
function sameOriginDataAction(block: string): string | undefined {
  const raw = block.match(/\bdata-action=["']([^"']+)["']/i)?.[1];
  if (!raw) return undefined;
  const action = raw.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#0*39;|&apos;/gi, "'").trim();
  if (action.startsWith("/") && !action.startsWith("//")) return action;
  try {
    return new URL(action).origin === "https://adam.unibas.ch" ? action : undefined;
  } catch {
    return undefined;
  }
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
const ENTITY = /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(amp|quot|apos|lt|gt|nbsp));/gi;

/**
 * Decodes the HTML entities ADAM text carries. ILIAS escapes some news and item text
 * twice (`&amp;amp;`), so a second pass runs only while a literal `&amp;` entity remains.
 */
export function decodeEntities(text: string): string {
  const once = (value: string) => value.replace(ENTITY, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    const code = dec !== undefined ? Number(dec) : parseInt(hex!, 16);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : whole;
  });
  const first = once(text);
  return /&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[0-9a-f]+);/i.test(first) && /&amp;/i.test(text) ? once(first) : first;
}

export function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
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
