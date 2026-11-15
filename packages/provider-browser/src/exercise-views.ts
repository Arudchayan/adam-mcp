import { AdamError, DEFAULT_ADAM_ORIGIN, type RefId } from "adam-core";

/** Assignment buckets of the ILIAS 10.12 exercise overview (ADR 0052). */
export const EXERCISE_VIEWS = ["ongoing", "upcoming", "past", "all"] as const;
export type ExerciseView = (typeof EXERCISE_VIEWS)[number];

const MODE_BY_VIEW: Record<ExerciseView, string> = { ongoing: "ongoing", upcoming: "future", past: "past", all: "all" };
const ALLOWED_KEYS = new Set(["baseClass", "cmdNode", "cmdClass", "cmd", "ref_id", "mode", "from_overview"]);

/**
 * ADR 0052: the overview advertises its mode buttons as `data-action` routes.
 * Accept only a read-only `showOverview` of the same exercise with the requested
 * mode on the pinned origin, with allowlisted, non-duplicated query keys.
 * Returns undefined when the page does not advertise that view.
 */
export function exerciseViewUrl(html: string, refId: RefId, view: ExerciseView): string | undefined {
  const mode = MODE_BY_VIEW[view];
  for (const match of html.matchAll(/\bdata-action=["']([^"']+)["']/gi)) {
    const raw = match[1]!.replace(/&amp;/gi, "&");
    let url: URL;
    try { url = new URL(raw, DEFAULT_ADAM_ORIGIN); } catch { continue; }
    if (url.origin !== DEFAULT_ADAM_ORIGIN || url.pathname !== "/ilias.php" || url.username || url.password || url.hash) continue;
    const keys = [...url.searchParams.keys()];
    if (keys.some((key) => !ALLOWED_KEYS.has(key)) || new Set(keys).size !== keys.length) continue;
    const param = (key: string) => url.searchParams.get(key) ?? "";
    if (param("baseClass").toLowerCase() !== "ilexercisehandlergui") continue;
    if (param("cmdClass").toLowerCase() !== "ilobjexercisegui" || param("cmd") !== "showOverview") continue;
    if (param("ref_id") !== refId || param("mode") !== mode) continue;
    if (url.searchParams.has("cmdNode") && !/^[a-z0-9:]{1,40}$/i.test(param("cmdNode"))) continue;
    if (url.searchParams.has("from_overview") && !/^\d{1,3}$/.test(param("from_overview"))) continue;
    return url.href;
  }
  return undefined;
}

export function unavailableExerciseView(refId: RefId, view: ExerciseView): AdamError {
  return new AdamError(
    "unsupported_type",
    `Exercise ${refId} does not offer the "${view}" assignment view on its overview. Read it without view (current assignments), or open the ADAM URL.`,
    false,
  );
}
