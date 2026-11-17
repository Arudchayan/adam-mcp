import { DEFAULT_ADAM_ORIGIN, type RefId } from "adam-core";

/**
 * ADR 0062: a reader follows a link only when the page itself renders it and the link
 * passes this allowlist. That means:
 * - pinned origin and the path `/ilias.php`
 * - the expected cmdClass, plus the expected cmd when the reader requires one
 * - the same `ref_id` as the object being read
 * - only the base keys and the reader's own declared keys, each matching its pattern
 * - no duplicated keys
 *
 * `rtoken` and other CSRF/action tokens are never allowed, so write actions cannot qualify.
 */
export type RouteRule = {
  cmdClass: RegExp;
  /** When given, `cmd` must match. When absent, `cmd` must be absent or a `show*`/`view*`/`preview*`/`render*`/`infoScreen` read command. */
  cmd?: RegExp;
  /** When given, `baseClass` must match (if present). */
  baseClass?: RegExp;
  /** Extra query keys this reader needs (for example `page`, `obj_id`), each with its value pattern. */
  keys?: Record<string, RegExp>;
};

const BASE_KEYS = new Set(["baseClass", "cmdNode", "cmdClass", "cmd", "ref_id"]);
const READ_COMMAND = /^(show\w*|view\w*|preview\w*|render\w*|infoScreen|list\w*)$/i;
const NEVER = /^(rtoken|token|csrf\w*|fallbackCmd|redirectSource)$/i;

/** Every advertised `href` / `data-action` target in `html` that satisfies `rule`, as absolute URLs (first occurrence order). */
export function advertisedRoutes(html: string, refId: RefId, rule: RouteRule): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/\b(?:href|data-action)="([^"]+)"/gi)) {
    const url = acceptRoute(match[1]!, refId, rule);
    if (url && !found.includes(url)) found.push(url);
  }
  return found;
}

/** The first advertised route that satisfies `rule`, or undefined. */
export function advertisedRoute(html: string, refId: RefId, rule: RouteRule): string | undefined {
  return advertisedRoutes(html, refId, rule)[0];
}

function acceptRoute(raw: string, refId: RefId, rule: RouteRule): string | undefined {
  let url: URL;
  try { url = new URL(raw.replace(/&amp;/gi, "&"), DEFAULT_ADAM_ORIGIN); } catch { return undefined; }
  if (url.origin !== DEFAULT_ADAM_ORIGIN || url.pathname !== "/ilias.php" || url.username || url.password) return undefined;
  url.hash = "";
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length) return undefined;
  for (const key of keys) {
    if (NEVER.test(key)) return undefined;
    if (BASE_KEYS.has(key)) continue;
    const pattern = rule.keys?.[key];
    if (!pattern || !pattern.test(url.searchParams.get(key) ?? "")) return undefined;
  }
  if (url.searchParams.get("ref_id") !== refId) return undefined;
  if (!rule.cmdClass.test(url.searchParams.get("cmdClass") ?? "")) return undefined;
  const command = url.searchParams.get("cmd");
  if (rule.cmd ? !rule.cmd.test(command ?? "") : command !== null && !READ_COMMAND.test(command)) return undefined;
  const base = url.searchParams.get("baseClass");
  if (rule.baseClass && base !== null && !rule.baseClass.test(base)) return undefined;
  const node = url.searchParams.get("cmdNode");
  if (node !== null && !/^[a-z0-9:]{1,60}$/i.test(node)) return undefined;
  return url.href;
}
