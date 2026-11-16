import {
  DEFAULT_ADAM_ORIGIN,
  redactText,
  type ExerciseEvaluation,
  type ExerciseFileRef,
  type ExerciseSchedule,
  type ExerciseSubmission,
  type ExerciseTeam,
  type RefId,
} from "adam-core";
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
  instructionFiles?: ExerciseFileRef[];
  sampleSolution?: ExerciseFileRef;
  team?: ExerciseTeam;
  evaluation?: ExerciseEvaluation;
};

// Official ILIAS 10.12 lang strings (en | de); lang keys in the trailing comments.
const INSTRUCTIONS = /^(?:work instructions|arbeitsanweisung(?:en)?)$/i; // exc_instruction
const SUBMISSION = /^(?:submission|abgabe)$/i;
const FILES = /^(?:files|dateien)$/i; // files
const SAMPLE_SOLUTION = /^(?:sample solution|musterlösung)$/i; // exc_global_feedback_file
const TEAM = /^team$/i; // exc_team
const EVALUATION = /^(?:evaluation by tutor|rückmeldungen)$/i; // exc_feedback
const DEADLINE = /^(?:edit until|bearbeitung bis|bearbeitbar bis|deadline|abgabetermin|ended on|beendet am|endete am)$/i;
const SUBMITTED_FILES = /^(?:submitted files|bereits abgegebene dateien)$/i; // already_delivered_files
const LAST_SUBMISSION = /^(?:last submission|datum der letzten abgabe)$/i; // exc_last_submission
const EVALUATION_STATEMENT = /^(?:evaluation statement|text-feedback)$/i; // exc_tbl_comment
const STATUS = /^status$/i;

/**
 * ADR 0053: the ILIAS 10.12 assignment detail page's `panel-sub` blocks:
 * "Work Instructions" (text column + Schedule card), "Submission", "Files",
 * "Sample Solution", "Team" and "Evaluation by Tutor" (label/value rows).
 * Metadata only: file names, never download links; buttons and forms are ignored.
 * Returns undefined when neither Work Instructions nor Submission is recognisable.
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
    } else if (FILES.test(heading)) {
      const files = fileNames(body);
      if (files.length > 0) detail.instructionFiles = files;
    } else if (SAMPLE_SOLUTION.test(heading)) {
      const [file] = fileNames(body);
      if (file) detail.sampleSolution = file;
    } else if (TEAM.test(heading)) {
      const status = panelRows(body).map((row) => row.value).filter(Boolean).join(" ");
      if (status) detail.team = { status: redactText(status) };
    } else if (EVALUATION.test(heading)) {
      const evaluation: ExerciseEvaluation = {};
      for (const row of panelRows(body)) {
        if (!row.value) continue;
        if (EVALUATION_STATEMENT.test(row.label)) evaluation.statement = redactText(row.value);
        else if (STATUS.test(row.label)) evaluation.status = row.value;
      }
      if (Object.keys(evaluation).length > 0) detail.evaluation = evaluation;
    }
  }
  return found ? detail : undefined;
}

function parseSchedule(card: string, now: Date): ExerciseSchedule | undefined {
  const schedule: ExerciseSchedule = {};
  const titles = new Set(extractClassBlocksAt(card, "card-title").map(({ block }) => block));
  for (const { block } of extractClassBlocksAt(card, "caption")) {
    if (titles.has(block)) continue;
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
  for (const { label, value } of panelRows(body)) {
    if (!value) continue;
    if (SUBMITTED_FILES.test(label)) submission.submittedFiles = value;
    else if (LAST_SUBMISSION.test(label)) submission.lastSubmission = value;
  }
  return Object.keys(submission).length > 0 ? submission : undefined;
}

/** Files / Sample Solution rows: the label is the file name; the Download link is never kept or followed. */
function fileNames(body: string): ExerciseFileRef[] {
  return panelRows(body).filter((row) => row.label).map((row) => ({ name: row.label }));
}

/** `div.row` → `control-label` text + the rest of the row as text (buttons, forms and link targets dropped). */
function panelRows(body: string): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  for (const { block } of extractClassBlocksAt(body, "row")) {
    const labelBlock = extractClassBlocksAt(block, "control-label")[0]?.block;
    if (labelBlock === undefined) continue;
    rows.push({
      label: textOf(labelBlock).replace(/[:·]\s*$/, ""),
      value: textOf(stripButtons(block.replace(labelBlock, ""))),
    });
  }
  return rows;
}

function stripButtons(html: string): string {
  return html.replace(/<button\b[\s\S]*?<\/button>/gi, " ").replace(/<(?:form|input|select|textarea)\b[^>]*>/gi, " ");
}
