import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { debugCaptureDir } from "./config.ts";
import type { SnapshotLink } from "./session-types.ts";

/**
 * Redacted, privacy-safe debug capture for live listing troubleshooting.
 * Records structure only: patternized hrefs, tag/class skeleton, DOM counts.
 * Never records page text, titles, cookies, storage state, or file bytes.
 */
export type DebugCaptureInput = {
  origin: string;
  url: string;
  /** Title length only; the title itself can contain student content. */
  titleLength: number;
  dom?: { itemRows: number; emptyCopy: boolean };
  frameOrigins: string[];
  skeleton: string[];
  links: SnapshotLink[];
};

/** Patternize an href: same-origin path + structural params only, ids/names masked. */
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
      if (!value) {
        continue;
      }
      if ((key === "cmdClass" || key === "baseClass") && /^[a-z0-9_]{1,40}$/i.test(value)) {
        kept.push(`${key}=${value.toLowerCase()}`);
        continue;
      }
      if (key === "ref_id" || key === "item_ref_id") {
        kept.push(`${key}=${value.replace(/\d+/g, "{id}")}`);
        continue;
      }
      const target = /^([a-z]+)_\d+$/i.exec(value);
      if (target) {
        kept.push(`${key}=${target[1]!.toLowerCase()}_{id}`);
        continue;
      }
      kept.push(`${key}={value}`);
    }
    const path = url.pathname
      .split("/")
      .map((segment) => {
        const masked = segment.replace(/\d+/g, "{id}");
        if (/\.(?:php|html?)$/i.test(masked) || !masked.includes(".")) {
          return masked;
        }
        return "{file}";
      })
      .join("/");
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
    titleLength: input.titleLength,
    dom: input.dom ?? null,
    frameOrigins: [...new Set(input.frameOrigins)],
    skeleton: input.skeleton,
    linkPatterns,
    note: "Redacted debug capture. No page text, titles, cookies, or storage state.",
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
