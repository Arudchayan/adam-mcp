import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { debugCaptureDir } from "./config.ts";
import type { SnapshotLink } from "./session-types.ts";

/**
 * Redacted, privacy-safe debug capture for live listing troubleshooting.
 * Records structure only: patternized hrefs, tag/class skeleton, DOM counts.
 * Never records page text, cookies, storage state, or file bytes.
 */
export type DebugCaptureInput = {
  origin: string;
  url: string;
  title: string;
  dom?: { itemRows: number; emptyCopy: boolean };
  frameOrigins: string[];
  skeleton: string[];
  links: SnapshotLink[];
};

/** Patternize an href: same-origin path + ref_id/item_ref_id/cmdClass/baseClass, numeric ids masked. */
export function patternizeHref(href: string, origin: string): string {
  try {
    const base = new URL(origin);
    const url = new URL(href, origin);
    if (url.origin !== base.origin) {
      return `[external] ${url.origin}`;
    }
    const kept: string[] = [];
    for (const key of ["ref_id", "item_ref_id", "cmdClass", "baseClass", "target"]) {
      const value = url.searchParams.get(key);
      if (value) {
        kept.push(`${key}=${value.replace(/\d+/g, "{id}")}`);
      }
    }
    const path = url.pathname.replace(/\d+/g, "{id}");
    return kept.length > 0 ? `${path}?${kept.join("&")}` : path;
  } catch {
    return "[unparseable]";
  }
}

export function buildDebugCapture(input: DebugCaptureInput, capturedAt = new Date().toISOString()): string {
  const linkPatterns = [
    ...new Set(
      input.links.map((link) => {
        const slot = link.inChrome ? "chrome" : link.inBreadcrumb ? "crumb" : "content";
        return `${patternizeHref(link.href, input.origin)} [${slot}]`;
      }),
    ),
  ].slice(0, 200);
  const payload = {
    capturedAt,
    origin: input.origin,
    url: patternizeHref(input.url, input.origin),
    title: input.title,
    dom: input.dom ?? null,
    frameOrigins: [...new Set(input.frameOrigins)],
    skeleton: input.skeleton,
    linkPatterns,
    note: "Redacted debug capture. No page text, cookies, or storage state.",
  };
  return JSON.stringify(payload, null, 2);
}

/** Best-effort write; debug capture must never break a live request. */
export async function writeDebugCapture(
  label: string,
  json: string,
  dir: string = debugCaptureDir(),
): Promise<string | undefined> {
  try {
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = join(dir, `${label}-${stamp}.json`);
    await writeFile(file, json, "utf8");
    return file;
  } catch {
    return undefined;
  }
}
