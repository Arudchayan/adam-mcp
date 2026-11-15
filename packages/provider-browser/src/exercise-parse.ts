import type { ExerciseOwnStatus, ExerciseUnit } from "adam-core";
import { parseAdamTimestamp } from "./deadlines.ts";
import { parseUiItems, type UiItem } from "./ui-items.ts";

// Past assignments label the closed deadline "Ended On" (live ILIAS 10.12, ADR 0052).
const DEADLINE = /^(?:edit until|bearbeitung bis|bearbeitbar bis|deadline|abgabetermin|abgabefrist|submission until|abgabe bis|end(?:s)?|ende|ended on|beendet am|endete am)$/i;
const REQUIREMENT = /^(?:requirement|anforderung|pflicht)$/i;
const LAST_SUBMISSION = /^(?:last submission|letzte abgabe)$/i;
const SUBMISSION_TYPE = /^(?:type|typ|abgabetyp)$/i;
const STATUS = /^(?:status)$/i;
const ASSIGNMENT_LABELS = [DEADLINE, REQUIREMENT, LAST_SUBMISSION, SUBMISSION_TYPE, STATUS];
const NO_ASSIGNMENTS = /\b(?:no assignments available|keine aufgaben (?:vorhanden|verfügbar)|es sind keine aufgaben)\b/i;

/**
 * #120: ILIAS 10.12 exercise overview assignments are UI items whose properties
 * carry the deadline, requirement, last submission, type and status. Returns
 * `[]` when ADAM says no assignments are available, and `undefined` when the
 * page shows no recognisable assignment structure (callers keep the page text).
 */
export function parseExerciseUnits(html: string, text: string, now: Date = new Date()): ExerciseUnit[] | undefined {
  const assignments = parseUiItems(html).filter((item) => item.title && isAssignment(item));
  if (assignments.length > 0) return assignments.map((item) => toUnit(item, now));
  return NO_ASSIGNMENTS.test(text) ? [] : undefined;
}

function isAssignment(item: UiItem): boolean {
  return item.properties.some((property) => ASSIGNMENT_LABELS.some((label) => label.test(property.name)));
}

function toUnit(item: UiItem, now: Date): ExerciseUnit {
  const value = (label: RegExp) => item.properties.find((property) => label.test(property.name))?.value || undefined;
  const deadlineText = value(DEADLINE);
  const deadline = deadlineText ? parseAdamTimestamp(deadlineText, now) : undefined;
  const requirement = value(REQUIREMENT);
  const submissionType = value(SUBMISSION_TYPE);
  const lines = [
    item.description,
    ...item.properties.filter((property) => property.value).map((property) => `${property.name}: ${property.value}`),
  ].filter(Boolean);
  return {
    title: item.title,
    ...(deadline ? { deadline } : {}),
    ...(requirement ? { requirement } : {}),
    ...(submissionType ? { submissionType } : {}),
    ...(lines.length > 0 ? { instructionText: lines.join("\n") } : {}),
    ownStatus: ownStatus(value(STATUS), value(LAST_SUBMISSION), now),
  };
}

function ownStatus(status: string | undefined, lastSubmission: string | undefined, now: Date): ExerciseOwnStatus {
  if (status && /\b(?:failed|nicht bestanden)\b/i.test(status)) return "failed";
  if (status && /\b(?:passed|bestanden)\b/i.test(status)) return "passed";
  if (lastSubmission) {
    if (/\b(?:no submission|keine abgabe|noch nicht abgegeben|noch keine)\b/i.test(lastSubmission)) return "none";
    if (parseAdamTimestamp(lastSubmission, now)) return "submitted";
  }
  return "unknown";
}
