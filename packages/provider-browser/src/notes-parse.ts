import { DEFAULT_ADAM_ORIGIN, NOTE_TEXT_LIMIT, redactText, type RefId } from "adam-core";
import { parseAdamTimestamp } from "./deadlines.ts";
import { extractClassBlocksAt, textOf } from "./ui-items.ts";

/**
 * ADR 0063: the student's Private Notes overview (ILIAS 10.12 `ilNoteGUI`, note_type=1),
 * lab-verified on the local ILIAS 10.12 lab with seeded notes (structure and synthetic text).
 *
 * The overview also carries a filter form, Edit/Delete item actions (`cmd=editNoteForm`,
 * `cmd=deleteNote`), a Comments tab (note_type=2) and export/sortation commands. This module
 * never requests, keeps or returns those links. From the page it reads only the note text, the
 * date ADAM shows, the numeric `note_id` and the Origin object's title and `ref_id`.
 */

/** Fixed landing route, the Private Notes entry of the main bar (ADR 0056). ILIAS lands on `ilNoteGUI&cmd=getNotesHTML`. */
export const NOTES_URL = `${DEFAULT_ADAM_ORIGIN}/ilias.php?baseClass=ildashboardgui&cmdClass=ilPDNotesGUI&cmd=showPrivateNotes&note_type=1`;

/** True when ADAM landed on the Private Notes list (note_type=1), not on comments, a redirect or another page. */
export function isNotesLanding(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.origin === DEFAULT_ADAM_ORIGIN &&
    url.pathname === "/ilias.php" &&
    url.searchParams.get("baseClass")?.toLowerCase() === "ildashboardgui" &&
    url.searchParams.get("cmdClass")?.toLowerCase() === "ilnotegui" &&
    url.searchParams.get("cmd") === "getNotesHTML" &&
    url.searchParams.get("note_type") === "1"
  );
}

const ORIGIN_KEYS = new Set(["baseClass", "cmd", "ref_id"]);

/**
 * `ref_id` of an Origin link: the object info screen only (`baseClass=ilrepositorygui&cmd=infoScreen&ref_id=N`),
 * pinned origin, allowlisted keys, no duplicates. The link is read for the id only and never requested.
 */
export function originRefId(raw: string): RefId | undefined {
  let url: URL;
  try {
    url = new URL(raw.replace(/&amp;/gi, "&"), DEFAULT_ADAM_ORIGIN);
  } catch {
    return undefined;
  }
  if (url.origin !== DEFAULT_ADAM_ORIGIN || url.pathname !== "/ilias.php" || url.username || url.password) return undefined;
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length || keys.some((key) => !ORIGIN_KEYS.has(key))) return undefined;
  if (url.searchParams.get("baseClass")?.toLowerCase() !== "ilrepositorygui") return undefined;
  if (url.searchParams.get("cmd") !== "infoScreen") return undefined;
  const refId = url.searchParams.get("ref_id") ?? "";
  return /^\d{1,12}$/.test(refId) ? refId : undefined;
}

export type ParsedNote = {
  noteId?: string;
  text: string;
  truncated?: boolean;
  dateText?: string;
  shownAt?: string;
  objectTitle?: string;
  objectRefId?: RefId;
};

export type ParsedNotes = {
  /** False when the page has no notes container at all (layout unknown). */
  notesFound: boolean;
  notes: ParsedNote[];
  /** Note items without readable text. */
  skipped: number;
};

/** Parse the notes list (overview or an object's notes modal). Fields absent from the HTML stay absent. */
export function parseNotes(html: string, now: Date = new Date()): ParsedNotes {
  if (!/\bid=["']ilNotes["']/.test(html)) return { notesFound: false, notes: [], skipped: 0 };
  const notes: ParsedNote[] = [];
  let skipped = 0;
  for (const { block } of extractClassBlocksAt(html, "il-std-item-container")) {
    const note = noteOf(block, now);
    if (note) notes.push(note);
    else skipped += 1;
  }
  return { notesFound: true, notes, skipped };
}

function noteOf(item: string, now: Date): ParsedNote | undefined {
  const description = extractClassBlocksAt(item, "il-item-description")[0]?.block;
  const full = description === undefined ? "" : noteText(description);
  if (!full) return undefined;
  const truncated = full.length > NOTE_TEXT_LIMIT;
  const text = redactText(truncated ? full.slice(0, NOTE_TEXT_LIMIT) : full);
  const dateText = textOf(extractClassBlocksAt(item, "il-item-title")[0]?.block ?? "") || undefined;
  const shownAt = dateText ? parseAdamTimestamp(dateText, now) : undefined;
  const noteId = item.match(/\bnote_id=(\d{1,12})\b/)?.[1];
  const origin = originOf(item);
  return {
    ...(noteId ? { noteId } : {}),
    text,
    ...(truncated ? { truncated: true } : {}),
    ...(dateText ? { dateText } : {}),
    ...(shownAt ? { shownAt } : {}),
    ...origin,
  };
}

/** The "Origin" property: the object's title, and its ref_id when the link is an allowlisted info screen. */
function originOf(item: string): { objectTitle?: string; objectRefId?: RefId } {
  const labels = extractClassBlocksAt(item, "il-item-property-name");
  const values = extractClassBlocksAt(item, "il-item-property-value");
  const at = labels.findIndex((label) => /^(?:origin|herkunft)$/i.test(textOf(label.block)));
  const value = at >= 0 ? values[at]?.block : undefined;
  if (value === undefined) return {};
  for (const match of value.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const target = match[2]!.match(/\b(?:data-action|href)=["']([^"']+)["']/i)?.[1];
    const title = textOf(match[3]!);
    if (!title) continue;
    const refId = target ? originRefId(target) : undefined;
    return { objectTitle: redactText(title), ...(refId ? { objectRefId: refId } : {}) };
  }
  const plain = textOf(value);
  return plain ? { objectTitle: redactText(plain) } : {};
}

/** Note text with line breaks kept and no markup, scripts or link targets. */
function noteText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
    .split("\n")
    .map((line) => textOf(line))
    .filter(Boolean)
    .join("\n");
}

/** Listing state of a parsed notes page (ADR 0005 semantics): empty is only shown when the container exists. */
export function notesListingState(parsed: ParsedNotes): "ok" | "empty" | "unknown" {
  if (!parsed.notesFound) return "unknown";
  if (parsed.notes.length > 0) return "ok";
  return parsed.skipped > 0 ? "unknown" : "empty";
}
