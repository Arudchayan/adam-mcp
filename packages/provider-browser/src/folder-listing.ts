import { AdamError, parseAdamRef } from "adam-core";
import { classifyListing, extractCatalog } from "./extract.ts";
import type { PageSnapshot } from "./session-types.ts";

export const FOLDER_CONTENT_TABS_SCRIPT = `(() => [...document.querySelectorAll(
  "#ilTab a[href], .il-tabs a[href], a[role='tab'][href], [role='tablist'] a[href]"
)].filter((a) => /^(Content|Inhalt)$/i.test((a.textContent || "").trim()))
  .slice(0, 20).map((a) => a.href))()`;

/** Follow an advertised read-only tab, never invent a GUI command or click a button. */
export function folderContentTab(hrefs: string[], currentUrl: string, refId: string): string | undefined {
  for (const href of hrefs.slice(0, 20)) {
    try {
      const url = new URL(href, currentUrl);
      if (url.origin !== "https://adam.unibas.ch" || url.username || url.password || url.hash) continue;
      if (url.href === currentUrl || url.pathname !== "/ilias.php") continue;
      const entries = [...url.searchParams];
      // A deliberately narrow allowlist: no actions, item_ref_id, return URLs, or duplicate keys.
      if (new Set(entries.map(([key]) => key.toLowerCase())).size !== entries.length) continue;
      if (entries.some(([key]) => !["baseclass", "cmdclass", "cmd", "ref_id", "cmdnode"].includes(key.toLowerCase()))) continue;
      const params = new Map(entries.map(([key, value]) => [key.toLowerCase(), value]));
      if (params.get("ref_id") !== refId || params.get("cmdclass")?.toLowerCase() !== "ilobjfoldergui") continue;
      if (params.get("baseclass") && params.get("baseclass")?.toLowerCase() !== "ilrepositorygui") continue;
      if (!/^(render|view)$/i.test(params.get("cmd") ?? "")) continue;
      if (params.has("cmdnode") && !/^[\d:]+$/.test(params.get("cmdnode")!)) continue;
      return url.href;
    } catch { /* Ignore malformed advertised links. */ }
  }
  return undefined;
}

export function folderListingState(snapshot: PageSnapshot) {
  const catalog = extractCatalog(snapshot, "");
  return classifyListing(snapshot, catalog.objects.filter((item) => item.refId !== catalog.current?.refId && item.type !== "tst").length);
}

/** Only the same folder can supply recovery links; never follow a stale parent/other object. */
export function sameFolderLanding(snapshot: PageSnapshot, refId: string): boolean {
  const landed = parseAdamRef(snapshot.url);
  return new URL(snapshot.url).origin === "https://adam.unibas.ch" && landed?.refId === refId &&
    (landed.type === "fold" || landed.type === "unknown");
}

export function rejectUnresolvedFolder(snapshot: PageSnapshot, refId: string, recoveryAttempted: boolean): void {
  const listing = folderListingState(snapshot);
  if (listing.state !== "unknown") return;
  const reason = snapshot.dom?.contentBlank ? "blank_content" : listing.signals.contentItemCount > 0 ? "unparsed_rows" : "no_listing_evidence";
  throw new FolderListingError(
    `Folder listing unavailable (${reason}; content_tab_recovery=${recoveryAttempted ? "attempted" : "unavailable"}). ` +
    `No child inventory was verified; this is not an empty folder or proof of denied access. ` +
    `Open https://adam.unibas.ch/go/fold/${refId} in Chrome and select Content/Inhalt. ` +
    `If children are visible there, report this diagnostic with the server version; do not repeatedly retry the same MCP call.`);
}

/** Preserves the unknown-listing reason when enrolled walks aggregate errors. */
export class FolderListingError extends AdamError {
  constructor(message: string) {
    super("provider_unavailable", message, false);
  }
}
