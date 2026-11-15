import { DEFAULT_ADAM_ORIGIN, type ExerciseSchedule, type ExerciseSubmission, type RefId } from "adam-core";
import { parseAdamTimestamp } from "./deadlines.ts";
import { extractClassBlocksAt, textOf } from "./ui-items.ts";

/** ADR 0053: at most this many assignment detail pages per call. */
export const EXERCISE_DETAIL_CAP = 20;

const ALLOWED_KEYS = new Set(["baseClass", "cmdNode", "cmdClass", "cmd", "ref_id", "ass_id", "from_overview", "mode"]);
/** Overview modes (same values as exercise-views.ts); title links carry one under a non-default view. */
const MODES = new Set(["ongoing", "future", "past", "all"]);

/**
 * ADR 0053: an overview assignment's own title link to `ilAssignmentPresentationGUI`.
 * Pinned origin, `/ilias.php`, same exercise `ref_id`, a numeric `ass_id`, only
 * allowlisted non-duplicated keys, an overview `mode` when present (ongoing,
 * future, past, all) and, when present, a `show…` command. The
 * overview's `ilExSubmissionFileGUI` submit screen (and anything else) is rejected.
 */
export function exerciseAssignmentDetailUrl(href: string | undefined, refId: RefId): string | undefined {
  if (!href) return undefined;
  let url: URL;
  try { url = new URL(href.replace(/&amp;/gi, "&"), DEFAULT_ADAM_ORIGIN); } catch { return undefined; }
  if (url.origin !== DEFAULT_ADAM_ORIGIN || url.pathname !== "/ilias.php" || url.username || url.password || url.hash) return undefined;
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => !ALLOWED_KEYS.has(key)) || new Set(keys).size !== keys.length) return undefined;
  const param = (key: string) => url.searchParams.get(key) ?? "";
  if (param("baseClass").toLowerCase() !== "ilexercisehandlergui") return undefined;
  if (param("cmdClass").toLowerCase() !== "ilassignmentpresentationgui") return undefined;
  if (param("ref_id") !== refId || !/^\d{1,12}$/.test(param("ass_id"))) return undefined;
  if (url.searchParams.has("cmd") && !/^show[a-z]{0,40}$/i.test(param("cmd"))) return undefined;
  if (url.searchParams.has("cmdNode") && !/^[a-z0-9:]{1,40}$/i.test(param("cmdNode"))) return undefined;
  if (url.searchParams.has("from_overview") && !/^\d{1,3}$/.test(param("from_overview"))) return undefined;
  if (url.searchParams.has("mode") && !MODES.has(param("mode"))) return undefined;
  return url.href;
}

export type ExerciseDetail = {
  instructionText?: string;
  schedule?: ExerciseSchedule;
  submission?: ExerciseSubmission;
};

const INSTRUCTIONS = /^(?:work instructions|arbeitsanweisungen?)$/i;
const SUBMISSION = /^(?:submission|abgabe)$/i;
const DEADLINE = /^(?:edit until|bearbeitung bis|bearbeitbar bis|deadline|abgabetermin|ended on|beendet am|endete am)$/i;
const SUBMITTED_FILES = /^(?:submitted files|abgegebene dateien)$/i;
const LAST_SUBMISSION = /^(?:last submission|letzte abgabe)$/i;

/**
 * ADR 0053: the ILIAS 10.12 assignment detail page's `panel-sub` blocks
 * "Work Instructions" (text column + Schedule card) and "Submission" (label/value
 * rows). Instruction files, sample solutions and feedback are not parsed (no live
 * evidence yet). Returns undefined when neither panel is recognisable.
 */
export function parseExerciseDetail(html: string, now: Date = new Date()): ExerciseDetail | undefined {
  let found = false;
  const detail: ExerciseDetail = {};
  for (const { block } of extractClassBlocksAt(html, "panel-sub")) {
    const headingBlock = extractClassBlocksAt(block, "panel-heading")[0]?.block ?? "";
    const heading = textOf(headingBlock).replace(/[:·]\s*$/, "");
    const body = headingBlock ? block.replace(headingBlock, "") : block;
    if (INSTRUCTIONS.test(heading)) {
      found = true;
      const card = extractClassBlocksAt(body, "il-card")[0]?.block;
      const instructionText = textOf(stripButtons(card ? body.replace(card, "") : body));
      if (instructionText) detail.instructionText = instructionText;
      const schedule = card ? parseSchedule(card, now) : undefined;
      if (schedule) detail.schedule = schedule;
    } else if (SUBMISSION.test(heading)) {
      found = true;
      const submission = parseSubmission(body);
      if (submission) detail.submission = submission;
    }
  }
  return found ? detail : undefined;
}

function parseSchedule(card: string, now: Date): ExerciseSchedule | undefined {
  const schedule: ExerciseSchedule = {};
  for (const { block } of extractClassBlocksAt(card, "caption")) {
    if (/\bcard-title\b/.test(block) || /<div\b[^>]*class=["'][^"']*\bcaption\b/i.test(block)) continue;
    const strong = block.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1];
    if (strong !== undefined) {
      const remaining = textOf(strong);
      if (remaining) schedule.timeRemaining = remaining;
      continue;
    }
    const text = textOf(block);
    const at = text.indexOf(":");
    if (at <= 0) continue;
    const label = text.slice(0, at).trim();
    const value = text.slice(at + 1).trim();
    if (!DEADLINE.test(label) || !value) continue;
    schedule.deadlineText = value;
    const deadline = parseAdamTimestamp(value, now);
    if (deadline) schedule.deadline = deadline;
  }
  return Object.keys(schedule).length > 0 ? schedule : undefined;
}

function parseSubmission(body: string): ExerciseSubmission | undefined {
  const submission: ExerciseSubmission = {};
  for (const { block } of extractClassBlocksAt(body, "row")) {
    const labelBlock = extractClassBlocksAt(block, "control-label")[0]?.block;
    if (labelBlock === undefined) continue;
    const label = textOf(labelBlock).replace(/[:·]\s*$/, "");
    const value = textOf(stripButtons(block.replace(labelBlock, "")));
    if (!value) continue;
    if (SUBMITTED_FILES.test(label)) submission.submittedFiles = value;
    else if (LAST_SUBMISSION.test(label)) submission.lastSubmission = value;
  }
  return Object.keys(submission).length > 0 ? submission : undefined;
}

function stripButtons(html: string): string {
  return html.replace(/<button\b[\s\S]*?<\/button>/gi, " ").replace(/<(?:form|input|select|textarea)\b[^>]*>/gi, " ");
}
