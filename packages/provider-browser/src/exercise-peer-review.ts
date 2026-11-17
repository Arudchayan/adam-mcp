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
/** #165: the student's own review text on the closed given view, redacted and capped. */
export const PEER_REVIEW_EXCERPT_CAP = 300;

/**
 * The ILIAS 10.12 peer-review overviews this module reads (all GET): the open Given Feedback
 * list, the closed Given Feedback list with the student's own texts, and Received Feedbacks.
 */
export type PeerReviewView = "editpeerreview" | "showgivenpeerreview" | "showreceivedpeerreview";
const VIEWS = new Set<string>(["editpeerreview", "showgivenpeerreview", "showreceivedpeerreview"]);
const ALLOWED_KEYS = new Set(["baseClass", "cmdNode", "cmdClass", "cmd", "ref_id", "ass_id", "mode", "from_overview"]);
const MODES = new Set(["ongoing", "future", "past", "all"]);

/**
 * #165: a peer-review view link, allowed only when it is an ILIAS 10.12 `ilExPeerReviewGUI`
 * route for this exercise (`ref_id`) and this assignment (`ass_id`). Pinned origin,
 * `/ilias.php`, allowlisted keys only, no duplicates, no `peer_id`, no `rtoken`, and only the
 * named overview command. Edit forms (`editPeerReviewItem`), updates and every other route are
 * rejected.
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

/** The unlabelled value text of a panel row (links such as Download are dropped). */
function unlabelledRowText(panelBody: string): string[] {
  const texts: string[] = [];
  for (const { block: row } of extractClassBlocksAt(panelBody, "row")) {
    const labelBlock = extractClassBlocksAt(row, "control-label")[0]?.block;
    if (labelBlock === undefined || textOf(labelBlock)) continue;
    const value = textOf(row.replace(labelBlock, "").replace(/<a\b[\s\S]*?<\/a>/gi, " "));
    if (value) texts.push(value);
  }
  return texts;
}

/** The closed Given Feedback view's peer panels: "Feedback Recipient: N", never "Your Submission". */
function closedGivenPanels(html: string): string[] {
  const bodies: string[] = [];
  for (const { block } of extractClassBlocksAt(html, "panel-sub")) {
    const headingBlock = extractClassBlocksAt(block, "panel-heading")[0]?.block ?? "";
    if (/^feedback recipient/i.test(textOf(headingBlock))) bodies.push(block);
  }
  return bodies;
}

/**
 * #165: the student's given reviews. Two ILIAS 10.12 states:
 * - open window (`editPeerReview`): one item per peer; `completed` is ADAM's "Valid: Yes".
 * - closed window (`showGivenPeerReview`): one panel per peer with the student's own review
 *   text; `completed` is true when that text is present, and `textExcerpt` is the text, capped.
 * Undefined when neither list is recognised.
 */
export function parseGivenFeedback(html: string): { given: ExercisePeerReviewGiven[] } | undefined {
  // Only peer-review items carry ADAM's "Valid" property; overview assignment items do not.
  const items = itemBlocks(html).filter((item) => /\bil-item-title\b/i.test(item) && itemProperties(item).has("Valid"));
  if (items.length > 0) {
    return { given: items.map((item, position): ExercisePeerReviewGiven => ({
      reviewee: peerLabel(position),
      completed: itemProperties(item).get("Valid")?.toLowerCase() === "yes",
    })) };
  }
  const panels = closedGivenPanels(html);
  if (panels.length === 0) return undefined;
  return { given: panels.map((panel, position): ExercisePeerReviewGiven => {
    const text = unlabelledRowText(panel).join("\n");
    return { reviewee: peerLabel(position), completed: text.length > 0, ...(text ? { textExcerpt: capText(text, PEER_REVIEW_EXCERPT_CAP) } : {}) };
  }) };
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
    // "Feedback Giver: N" is a review of this user's work; "Feedback Recipient: N" is the closed given view.
    if (!/^feedback giver/i.test(textOf(headingBlock))) continue;
    const texts = unlabelledRowText(block);
    if (texts.length > 0) received.push({ reviewer: peerLabel(received.length), text: capText(texts.join("\n"), PEER_REVIEW_TEXT_CAP) });
  }
  return received.length > 0 ? received : undefined;
}

/** Redacts, then caps, a peer's text to `cap` characters (an ellipsis marks the cut). */
export function capText(text: string, cap: number): string {
  const redacted = redactText(text);
  return redacted.length > cap ? `${redacted.slice(0, cap)}…` : redacted;
}
