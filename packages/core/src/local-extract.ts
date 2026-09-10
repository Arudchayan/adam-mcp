import { createHash } from "node:crypto";
import { AdamError } from "./errors.ts";
import type { FileExtract, FileObject } from "./types.ts";

export const MAX_EXTRACT_BYTES = 8 * 1024 * 1024;
export const MAX_EXTRACT_CHARS = 40_000;
export const DEFAULT_EXTRACT_PAGES = 8;
export const MAX_EXTRACT_PAGES = 20;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function normalizeMaxPages(raw?: number): number {
  if (raw === undefined) {
    return DEFAULT_EXTRACT_PAGES;
  }
  return Math.min(MAX_EXTRACT_PAGES, Math.max(1, Math.floor(raw)));
}

export function looksLikeHtml(bytes: Uint8Array, contentType?: string): boolean {
  if (contentType?.toLowerCase().includes("html")) {
    return true;
  }
  const head = Buffer.from(bytes.slice(0, 1024)).toString("utf8").trimStart().toLowerCase();
  return (
    head.startsWith("<!doctype") ||
    head.startsWith("<html") ||
    head.startsWith("<?xml") ||
    /<(?:body|form|script|meta)\b/i.test(head)
  );
}

function isPdf(bytes: Uint8Array, mimeType?: string): boolean {
  if (mimeType?.toLowerCase().includes("pdf")) {
    return true;
  }
  return bytes.length >= 5 && Buffer.from(bytes.slice(0, 5)).toString("ascii") === "%PDF-";
}

function unescapePdfLiteral(inner: string): string {
  return inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\\)/g, ")").replace(/\\\\/g, "\\");
}

function extractPdfLiterals(bytes: Uint8Array): string {
  const source = Buffer.from(bytes).toString("latin1");
  const chunks: string[] = [];
  const tj = /\((?:\\.|[^\\)])*\)\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = tj.exec(source))) {
    const inner = match[0].slice(1, match[0].lastIndexOf(")"));
    const text = unescapePdfLiteral(inner);
    if (/[A-Za-z]/.test(text)) {
      chunks.push(text);
    }
  }
  if (chunks.length > 0) {
    return chunks.join(" ");
  }
  const any = /\((?:\\.|[^\\)])*\)/g;
  while ((match = any.exec(source))) {
    const inner = match[0].slice(1, -1);
    const text = unescapePdfLiteral(inner);
    if (/[A-Za-z]/.test(text)) {
      chunks.push(text);
    }
  }
  return chunks.join(" ");
}

export async function extractLocalFileText(
  file: FileObject,
  bytes: Uint8Array,
  mimeType?: string,
  maxPages = DEFAULT_EXTRACT_PAGES,
): Promise<FileExtract> {
  if (bytes.byteLength > MAX_EXTRACT_BYTES) {
    throw new AdamError("provider_unavailable", `File is larger than the ${MAX_EXTRACT_BYTES} byte extract limit.`);
  }
  const pagesLimit = normalizeMaxPages(maxPages);
  const digest = sha256Hex(bytes);
  const type = mimeType ?? file.mimeType ?? "";
  let pages: Array<{ page: number; text: string }> = [];

  if (type.startsWith("text/") && !type.includes("html")) {
    pages = [{ page: 1, text: Buffer.from(bytes).toString("utf8") }];
  } else if (type === "application/json") {
    pages = [{ page: 1, text: Buffer.from(bytes).toString("utf8") }];
  } else if (isPdf(bytes, type)) {
    const extracted = extractPdfLiterals(bytes);
    if (!extracted.trim()) {
      throw new AdamError(
        "unsupported_type",
        "This PDF has no extractable text (likely a scan). Open it in ADAM instead.",
      );
    }
    pages = [{ page: 1, text: extracted }];
  } else {
    throw new AdamError(
      "unsupported_type",
      `Local extract supports PDF and plain text, not ${type || file.mimeType || "this type"}.`,
    );
  }

  let truncated = pages.length > pagesLimit;
  pages = pages.slice(0, pagesLimit);
  let used = 0;
  const bounded: Array<{ page: number; text: string }> = [];
  for (const page of pages) {
    const remaining = MAX_EXTRACT_CHARS - used;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const text = page.text.length > remaining ? page.text.slice(0, remaining) : page.text;
    if (text.length < page.text.length) {
      truncated = true;
    }
    bounded.push({ page: page.page, text });
    used += text.length;
  }

  return {
    refId: file.refId,
    title: file.title,
    url: file.url,
    mimeType: file.mimeType ?? mimeType,
    pageCount: file.pageCount ?? bounded.length,
    pages: bounded,
    truncated,
    sha256: digest,
    provenance: file.provenance,
  };
}
