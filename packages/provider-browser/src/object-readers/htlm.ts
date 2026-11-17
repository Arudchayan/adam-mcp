import type { RouteRule } from "../advertised-route.ts";
import type { ObjectReader, ReaderContext } from "./index.ts";

/**
 * ADR 0062 reader for ILIAS 10.12 HTML learning modules (`htlm`), lab-verified (tools/ilias-lab,
 * fixtures htlm-info-student and htlm-start-student).
 *
 * The object page is the Info screen. It says "No Start File" until a start file is chosen,
 * and it advertises the presentation route (`ilias.php?baseClass=ilHTLMPresentationGUI&ref_id=N`).
 * That route delivers the start file itself, so `subPage: "start"` reads its text. The other files
 * of the uploaded archive are served from per-session delivery addresses, not ILIAS routes, so they
 * are not listed or followed.
 */

const PRESENTATION: RouteRule = { cmdClass: /^$/, baseClass: /^ilhtlmpresentationgui$/i };

export const readHtmlModule: ObjectReader = async (ctx: ReaderContext) => {
  if (!ctx.route(ctx.page.html, PRESENTATION)) return undefined;
  const startFileSet = !/No Start File/i.test(ctx.page.text);
  const detail = {
    kind: "html-module",
    evidence: "lab-verified" as const,
    startFileSet,
    ...(startFileSet ? { startSubPage: "start" } : {}),
  };
  if (ctx.subPage === undefined) return { detail };
  if (ctx.subPage !== "start" || !startFileSet) return undefined;
  const route = ctx.route(ctx.page.html, PRESENTATION);
  if (!route) return undefined;
  const page = await ctx.open(route);
  return { detail, text: page.text };
};
