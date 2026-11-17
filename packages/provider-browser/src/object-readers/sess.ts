import { canonicalUrl, parseAdamRef, redactText, type RefId } from "adam-core";
import { parseAdamTimestamp } from "../deadlines.ts";
import { textOf } from "../ui-items.ts";
import type { ObjectReader, ReaderContext } from "./index.ts";

/**
 * ADR 0062: session (`sess`) info screen, read from the ILIAS 10.12 lab (tools/ilias-lab),
 * as a student. Evidence: `lab-verified`. The lab session has no appointment, so the
 * date fields and the materials list are parsed from markup we have not yet seen with
 * a dated session. They stay absent when the markup does not show them.
 */

export type SessionMaterial = {
  title: string;
  type: string;
  refId: RefId;
  url: string;
};

export type SessionDetail = {
  kind: "session";
  evidence: "lab-verified";
  startsAt?: string;
  endsAt?: string;
  dateText?: string;
  location?: string;
  details?: string;
  description?: string;
  materials: SessionMaterial[];
};

const SECTION_INFO = /<div class="il_InfoScreenProperty\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div class="il_InfoScreenPropertyValue\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
/** The info screen's first section header; the same words elsewhere on a page do not count. */
const HEADER = /<h2 class="ilHeader">\s*(?:Session Information|Sitzungsinformation(?:en)?)\s*<\/h2>/i;
const MATERIALS_HEADER = /\bMaterials?\b|\bMaterialien\b/i;

/** Label/value pairs of the info screen, in document order. */
function properties(html: string): Array<{ name: string; value: string }> {
  return [...html.matchAll(SECTION_INFO)].map((match) => ({ name: textOf(match[1]!).replace(/:\s*$/, ""), value: textOf(match[2]!) }));
}

/** Materials sections of the info screen (a section headed "Materials"), with ADAM object links only. */
function materialsOf(html: string): SessionMaterial[] {
  const materials: SessionMaterial[] = [];
  for (const section of html.matchAll(/<div class="ilInfoScreenSec\b[\s\S]*?(?=<div class="ilInfoScreenSec\b|<\/form>|$)/gi)) {
    const header = section[0].match(/<h2 class="ilHeader">([\s\S]*?)<\/h2>/i)?.[1];
    if (!header || !MATERIALS_HEADER.test(textOf(header))) continue;
    for (const link of section[0].matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const ref = parseAdamRef(link[1]!.replace(/&amp;/gi, "&"));
      const title = textOf(link[2]!);
      if (!ref || ref.type === "unknown" || !title) continue;
      if (materials.some((m) => m.refId === ref.refId)) continue;
      materials.push({ title: redactText(title), type: ref.type, refId: ref.refId, url: canonicalUrl(ref.type, ref.refId) });
    }
  }
  return materials;
}

export const readSession: ObjectReader = async (ctx: ReaderContext) => {
  const html = ctx.page.html;
  if (!HEADER.test(html)) return undefined;
  const detail: SessionDetail = { kind: "session", evidence: "lab-verified", materials: materialsOf(html) };
  for (const { name, value } of properties(html)) {
    if (!value) continue;
    if (/^(Location|Ort)$/i.test(name)) detail.location = redactText(value);
    else if (/^(Details\/Workflow|Details|Details\/Ablauf)$/i.test(name)) detail.details = redactText(value);
    else if (/^(Description|Beschreibung)$/i.test(name)) detail.description = redactText(value);
    else if (/^(Date\/Time|Date|Datum\/Uhrzeit|Datum)$/i.test(name)) {
      detail.dateText = redactText(value);
      const start = parseAdamTimestamp(value);
      if (start) detail.startsAt = start;
    }
  }
  return { detail };
};
