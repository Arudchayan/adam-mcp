import {
  DEFAULT_ADAM_ORIGIN,
  redactText,
  type ExercisePeerReviewGiven,
  type ExercisePeerReviewReceived,
  type RefId,
} from "adam-core";
import { parseAdamTimestamp } from "./deadlines.ts";
import { extractClassBlocksAt, sliceUntilClose, textOf } from "./ui-items.ts";

/** #165: a peer's review text is untrusted; it is redacted and capped before it is returned. */
export const PEER_REVIEW_TEXT_CAP = 1000;

/** The two ILIAS 10.12 peer-review overviews this module reads (both GET). */
export type PeerReviewView = "editpeerreview" | "showreceivedpeerreview";
const VIEWS = new Set<string>(["editpeerreview", "showreceivedpeerreview"]);
const ALLOWED_KEYS = new Set(["baseClass", "cmdNode", "cmdClass", "cmd", "ref_id", "ass_id", "mode", "from_overview"]);
const MODES = new Set(["ongoing", "future", "past", "all"]);

/**
 * #165: a peer-review view link, allowed only when it is an ILIAS 10.12 `ilExPeerReviewGUI`
 * route for this exercise (`ref_id`) and this assignment (`ass_id`). Pinned origin,
 * `/ilias.php`, allowlisted keys only, no duplicates, no `peer_id`, no `rtoken`, and only
 * the Given Feedback or Received Feedbacks overview command. Edit forms
 * (`editPeerReviewItem`), updates and every other route are rejected.
 */
export function exercisePeerReviewUrl(href: string | undefined, refId: RefId, assId: string, view: PeerReviewView): string | undefined {
  if (!href) return undefined;
  let url: URL;
  try { url = new URL(href.replace(/&amp;/gi, "&"), DEFAULT_ADAM_ORIGIN); } catch { return undefined; }
  if (url.origin !== DEFAULT_ADAM_ORIGIN || url.pathname !== "/ilias.php" || url.username || url.password || url.hash) return undefined;
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => !ALLOWED_KEYS.has(key)) || new Set(keys).size !== keys.length) return undefined;
  const param = (key: string) => url.searchParams.get(key) ?? "";
  if (param("baseClass").toLowerCase() !== "ilexercisehandlergui") return undefined;
  if (param("cmdClass").toLowerCase() !== "ilexpeerreviewgui") return undefined;
  const cmd = param("cmd").toLowerCase();
  if (!VIEWS.has(cmd) || cmd !== view) return undefined;
  if (param("ref_id") !== refId || param("ass_id") !== assId) return undefined;
  if (url.searchParams.has("mode") && !MODES.has(param("mode"))) return undefined;
  if (url.searchParams.has("cmdNode") && !/^[a-z0-9:]{1,40}$/i.test(param("cmdNode"))) return undefined;
  if (url.searchParams.has("from_overview") && !/^\d{1,3}$/.test(param("from_overview"))) return undefined;
  return url.href;
}

/** Every `ilExPeerReviewGUI` href or data-action in the markup (buttons, tabs), unvalidated. */
export function peerReviewRoutes(html: string): string[] {
  const routes: string[] = [];
  for (const match of html.matchAll(/\b(?:data-action|href)=["']([^"']*cmdClass=ilExPeerReviewGUI[^"']*)["']/gi)) {
    const value = match[1] ?? "";
    if (!routes.includes(value)) routes.push(value);
  }
  return routes;
}

export type PeerReviewPanel = { deadline?: string; deadlineText?: string };

const PEER_HEADING = /^peer-feedback$/i;
const FEEDBACK_DEADLINE = /^feedback deadline$/i;

/**
 * #165: the assignment detail page's "Peer-Feedback" `panel-sub`: the feedback deadline row.
 * Undefined when the page shows no such panel.
 */
export function parsePeerReviewPanel(html: string, now: Date = new Date()): PeerReviewPanel | undefined {
  for (const { block } of extractClassBlocksAt(html, "panel-sub")) {
    const headingBlock = extractClassBlocksAt(block, "panel-heading")[0]?.block ?? "";
    if (!PEER_HEADING.test(textOf(headingBlock).replace(/[:·]\s*$/, ""))) continue;
    const panel: PeerReviewPanel = {};
    for (const { block: row } of extractClassBlocksAt(block, "row")) {
      const labelBlock = extractClassBlocksAt(row, "control-label")[0]?.block;
      if (labelBlock === undefined || !FEEDBACK_DEADLINE.test(textOf(labelBlock))) continue;
      const deadlineText = textOf(row.replace(labelBlock, ""));
      if (!deadlineText) continue;
      panel.deadlineText = deadlineText;
      const deadline = parseAdamTimestamp(deadlineText, now);
      if (deadline) panel.deadline = deadline;
    }
    return panel;
  }
  return undefined;
}

/** A `div.il-item` block; token match, so `il-item-title` and friends are not items. */
function itemBlocks(html: string): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(/<div\b([^>]*\bclass=["'](?:[^"']*\s)?il-item(?=[\s"'])[^"']*["'][^>]*)>/gi)) {
    const inner = sliceUntilClose(html, (match.index ?? 0) + match[0].length, "div");
    if (inner !== undefined) blocks.push(inner);
  }
  return blocks;
}

/** Name/value pairs from an item's `il-item-property-name` and `il-item-property-value` spans. */
function itemProperties(item: string): Map<string, string> {
  const properties = new Map<string, string>();
  for (const match of item.matchAll(/<span\b[^>]*class=["'][^"']*\bil-item-property-name\b[^"']*["'][^>]*>([\s\S]*?)<\/span>\s*<span\b[^>]*class=["'][^"']*\bil-item-property-value\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)) {
    properties.set(textOf(match[1] ?? ""), textOf(match[2] ?? ""));
  }
  return properties;
}

/** Peers are numbered "Peer 1", "Peer 2" … in ADAM's order; ADAM's own labels are never returned. */
export const peerLabel = (position: number): string => `Peer ${position + 1}`;

/**
 * #165: the "Given Feedback" overview: one item per peer to review. `completed` is ADAM's
 * "Valid: Yes". Undefined when no item list is recognised.
 */
export function parseGivenFeedback(html: string): { given: ExercisePeerReviewGiven[]; status?: string } | undefined {
  // Only peer-review items carry ADAM's "Valid" property; overview assignment items do not.
  const items = itemBlocks(html).filter((item) => /\bil-item-title\b/i.test(item) && itemProperties(item).has("Valid"));
  if (items.length === 0) return undefined;
  const given = items.map((item, position): ExercisePeerReviewGiven => ({
    reviewee: peerLabel(position),
    completed: itemProperties(item).get("Valid")?.toLowerCase() === "yes",
  }));
  const message = extractClassBlocksAt(html, "alert")[0]?.block;
  const status = message ? textOf(message) : "";
  return status ? { given, status: redactText(status) } : { given };
}

/**
 * #165: the "Received Feedbacks" overview: one panel per peer review of this user's work.
 * The review text is the unlabelled value row; the Download link is never kept.
 * Undefined when no review panel is recognised (for example before access is granted).
 */
export function parseReceivedFeedback(html: string): ExercisePeerReviewReceived[] | undefined {
  const received: ExercisePeerReviewReceived[] = [];
  for (const { block } of extractClassBlocksAt(html, "panel-sub")) {
    const headingBlock = extractClassBlocksAt(block, "panel-heading")[0]?.block ?? "";
    if (!/^feedback (?:recipient|giver)/i.test(textOf(headingBlock))) continue;
    const texts: string[] = [];
    for (const { block: row } of extractClassBlocksAt(block, "row")) {
      const labelBlock = extractClassBlocksAt(row, "control-label")[0]?.block;
      if (labelBlock === undefined || textOf(labelBlock)) continue;
      const value = textOf(row.replace(labelBlock, "").replace(/<a\b[\s\S]*?<\/a>/gi, " "));
      if (value) texts.push(value);
    }
    if (texts.length > 0) received.push({ reviewer: peerLabel(received.length), text: capPeerText(texts.join("\n")) });
  }
  return received.length > 0 ? received : undefined;
}

/** Redacts, then caps, a peer's review text. */
export function capPeerText(text: string): string {
  const redacted = redactText(text);
  return redacted.length > PEER_REVIEW_TEXT_CAP ? `${redacted.slice(0, PEER_REVIEW_TEXT_CAP)}…` : redacted;
}
