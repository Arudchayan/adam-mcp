import { parseAdamRef, type RefId } from "adam-core";
import { parseAdamTimestamp } from "./deadlines.ts";
import { extractClassBlocksAt, parseUiItems, textOf } from "./ui-items.ts";

/**
 * #122: metadata ILIAS 10.12 renders in each file row of a course/folder
 * listing — format suffix ("pdf"), size ("184.8 KB"), last-change time
 * ("12. Oct 2026, 17:17") and PDF page count ("49 pages"). Every value comes
 * from the row that links the file; nothing is borrowed from a neighbour.
 */
export type FileRowHints = {
  extension?: string;
  mimeType?: string;
  sizeBytes?: number;
  pageCount?: number;
  updatedAt?: string;
  /** Row text the timestamp came from, so date scans can attribute it to this file (#119). */
  updatedAtRaw?: string;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  html: "text/html",
  htm: "text/html",
  json: "application/json",
  ipynb: "application/x-ipynb+json",
  py: "text/x-python",
  r: "text/x-r",
  tex: "application/x-tex",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const SIZE = /^(\d+(?:[.,]\d+)?)\s*(bytes?|B|KB|kB|KiB|MB|MiB|GB|GiB)$/i;
const PAGES = /^(\d+)\s*(?:pages?|seiten?)$/i;
const UNITS: Record<string, number> = { b: 1, byte: 1, bytes: 1, kb: 1024, kib: 1024, mb: 1024 ** 2, mib: 1024 ** 2, gb: 1024 ** 3, gib: 1024 ** 3 };

/** File-row hints keyed by file refId. A file linked from two rows with disagreeing values keeps only what agrees. */
export function parseFileRows(html: string, now: Date = new Date()): Map<RefId, FileRowHints> {
  const result = new Map<RefId, FileRowHints>();
  const conflicted = new Set<RefId>();
  const add = (refId: RefId, hints: FileRowHints) => {
    if (conflicted.has(refId)) return;
    const prior = result.get(refId);
    if (!prior) {
      result.set(refId, hints);
      return;
    }
    const merged: FileRowHints = {};
    for (const key of Object.keys({ ...prior, ...hints }) as Array<keyof FileRowHints>) {
      const a = prior[key], b = hints[key];
      if (a === undefined) (merged as Record<string, unknown>)[key] = b;
      else if (b === undefined || a === b) (merged as Record<string, unknown>)[key] = a;
    }
    if (Object.keys(merged).length === 0) {
      conflicted.add(refId);
      result.delete(refId);
      return;
    }
    result.set(refId, merged);
  };

  // Legacy repository list rows (ilObjListGUI): <li class="ilObjListRow"> / <div class="il_ContainerListItem">.
  const rows = [
    ...extractClassBlocksAt(html, "ilObjListRow"),
    ...extractClassBlocksAt(html, "il_ContainerListItem"),
  ].sort((a, b) => a.index - b.index);
  const seenRows: Array<[number, number]> = [];
  for (const { block, index } of rows) {
    // An il_ContainerListItem nested inside an already-parsed ilObjListRow is the same row.
    if (seenRows.some(([start, end]) => index > start && index < end)) continue;
    seenRows.push([index, index + block.length]);
    const refId = rowFileRef(block);
    if (!refId) continue;
    const properties = extractClassBlocksAt(block, "il_ItemProperty").map(({ block: value }) => textOf(value));
    const hints = hintsFromTokens(properties, now);
    if (hints) add(refId, hints);
  }

  // Kitchen Sink items (ILIAS 10 list presentation): property name/value pairs.
  for (const item of parseUiItems(html)) {
    const refId = item.href ? fileRefOf(item.href) : undefined;
    if (!refId) continue;
    const tokens = item.properties.flatMap(({ name, value }) => [value, name && value ? `${name}: ${value}` : ""]).filter(Boolean);
    const hints = hintsFromTokens(tokens, now);
    if (hints) add(refId, hints);
  }
  return result;
}

function rowFileRef(block: string): RefId | undefined {
  const title = extractClassBlocksAt(block, "il_ContainerItemTitle")[0]?.block ?? block;
  const href = title.match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1];
  return href ? fileRefOf(href) : undefined;
}

function fileRefOf(href: string): RefId | undefined {
  const parsed = parseAdamRef(href.replace(/&amp;/gi, "&"));
  return parsed?.type === "file" ? parsed.refId : undefined;
}

/** Each token is one rendered property; a value is kept only when exactly one token yields it. */
function hintsFromTokens(rawTokens: string[], now: Date): FileRowHints | undefined {
  const tokens = rawTokens.map((token) => token.replace(/\s+/g, " ").trim()).filter(Boolean);
  const extensions = new Set<string>(), sizes = new Set<number>(), pages = new Set<number>();
  const stamps = new Map<string, string>();
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (/^[a-z0-9]{1,5}$/.test(lower) && MIME_BY_EXTENSION[lower]) {
      extensions.add(lower);
      continue;
    }
    const size = token.match(SIZE);
    if (size) {
      sizes.add(Math.round(Number.parseFloat(size[1].replace(",", ".")) * UNITS[size[2].toLowerCase()]));
      continue;
    }
    const pageCount = token.match(PAGES);
    if (pageCount) {
      pages.add(Number.parseInt(pageCount[1], 10));
      continue;
    }
    // A value like "12. Oct 2026, 17:17" — or "Last update: …" — but never free text that merely mentions a date.
    const value = token.replace(/^[^:\d]{1,40}:\s*/, "");
    if (value.length <= 40) {
      const stamp = parseAdamTimestamp(value, now);
      if (stamp && !stamps.has(stamp)) stamps.set(stamp, value);
    }
  }
  const hints: FileRowHints = {};
  if (extensions.size === 1) {
    const [extension] = extensions;
    hints.extension = extension;
    hints.mimeType = MIME_BY_EXTENSION[extension];
  }
  if (sizes.size === 1) [hints.sizeBytes] = sizes;
  if (pages.size === 1) [hints.pageCount] = pages;
  if (stamps.size === 1) {
    const [[iso, raw]] = stamps;
    hints.updatedAt = iso;
    hints.updatedAtRaw = raw;
  }
  return Object.keys(hints).length > 0 ? hints : undefined;
}
