import { redactText } from "adam-core";
import { textOf } from "../ui-items.ts";
import type { ObjectReader, ReaderContext } from "./index.ts";

/**
 * ADR 0062: learning sequence (`lso`) learner view, read from the ILIAS 10.12 lab as a student.
 * Evidence: `lab-verified`. The learner view's content list ("il-workflow") gives the items in
 * order. The lab markup carries no object links for the steps, so items have no refId or type.
 */

export type LearningSequenceItem = {
  position: number;
  title: string;
  description?: string;
  /** "not_started" when ILIAS marks the step as not started. Absent for other states. */
  status?: "not_started";
  /** True for the step ILIAS shows as the learner's current step. */
  current?: boolean;
};

export type LearningSequenceDetail = {
  kind: "learning-sequence";
  evidence: "lab-verified";
  items: LearningSequenceItem[];
};

const WORKFLOW = /<ul class="il-workflow-container">([\s\S]*?)<\/ul>/i;
const STEP = /<li class="il-workflow-step\b([^"]*)"[^>]*>([\s\S]*?)<\/li>/gi;

/** Ordered steps of the learner view's content list, or undefined when that list is absent. */
export function parseLearningSequenceItems(html: string): LearningSequenceItem[] | undefined {
  const container = html.match(WORKFLOW)?.[1];
  if (container === undefined) return undefined;
  const items: LearningSequenceItem[] = [];
  for (const step of container.matchAll(STEP)) {
    const classes = step[1]!.split(/\s+/);
    const label = step[2]!.match(/<span class="il-workflow-step-label"[^>]*>([\s\S]*?)<\/span>/i)?.[1];
    const title = label ? textOf(label) : "";
    if (!title) return undefined;
    const description = textOf(step[2]!.match(/<span class="il-workflow-step-description"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
    items.push({
      position: items.length + 1,
      title: redactText(title),
      ...(description ? { description: redactText(description) } : {}),
      ...(classes.includes("not-started") ? { status: "not_started" as const } : {}),
      ...(classes.includes("active") ? { current: true } : {}),
    });
  }
  return items;
}

export const readLearningSequence: ObjectReader = async (ctx: ReaderContext) => {
  const items = parseLearningSequenceItems(ctx.page.html);
  if (!items) return undefined;
  const detail: LearningSequenceDetail = { kind: "learning-sequence", evidence: "lab-verified", items };
  return { detail };
};
