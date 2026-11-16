import { AdamError, DEFAULT_ADAM_ORIGIN, redactText, type RefId } from "adam-core";

/**
 * ADR 0060: read-only staff views (#128). Evidence comes from the local ILIAS
 * 10.12 lab (tools/ilias-lab) as a course tutor/admin; the same views are not
 * visible to the student account on ADAM, so they are "lab-verified,
 * ADAM-unverified" and fail closed when the markup is not recognised.
 */

export type CourseMember = {
  name: string;
  /** Login as ILIAS shows it; email-shaped logins are redacted. */
  login?: string;
  roles: string[];
  passed?: boolean;
  tutorialSupport?: boolean;
  notification?: boolean;
};

export type ExerciseGradeCell = { assignment: number; assignmentId?: string; status: GradeStatus };
export type GradeStatus = "passed" | "failed" | "not_graded" | "unknown";
export type ExerciseGradeRow = {
  name: string;
  login?: string;
  grades: ExerciseGradeCell[];
  total?: GradeStatus;
};

const textOf = (html: string) => html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
const cellsOf = (row: string) => [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]!);
const headersOf = (table: string) => [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => ({ html: m[1]!, text: textOf(m[1]!).replace(/\s*(Ascending|Descending|Aufsteigend|Absteigend)$/i, "") }));
const tables = (html: string) => [...html.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((m) => m[0]);
const dataRows = (table: string) => [...table.matchAll(/<tr\b[^>]*class="[^"]*\btblrow\d?\b[^"]*"[^>]*>[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
const checkbox = (cell: string) => {
  const box = cell.match(/<input\b[^>]*type="checkbox"[^>]*>/i)?.[0];
  return box ? /\bchecked\b/i.test(box) : undefined;
};

// Official ILIAS 10.12 en/de column labels (lang files).
const COLUMN = {
  name: /^(Name)$/i,
  login: /^(Login|Benutzername|Anmeldename)$/i,
  roles: /^(Roles|Rollen)$/i,
  passed: /^(Passed|Bestanden)$/i,
  tutorialSupport: /^(Tutorial Support|Betreuung)$/i,
  notification: /^(Notification|Benachrichtigung)$/i,
  total: /^(Total Exercise|Übung gesamt|Gesamt)$/i,
};

/** Course "Members > Edit Participants" table, or undefined when not recognised. */
export function parseCourseMembers(html: string): CourseMember[] | undefined {
  for (const table of tables(html)) {
    const headers = headersOf(table).map((h) => h.text);
    const at = (pattern: RegExp) => headers.findIndex((h) => pattern.test(h));
    if (at(COLUMN.name) < 0 || at(COLUMN.roles) < 0) continue;
    const members: CourseMember[] = [];
    for (const row of dataRows(table)) {
      const cells = cellsOf(row);
      // The first cell is the row-selection checkbox column, which has no header.
      const offset = cells.length - headers.length;
      const cell = (pattern: RegExp) => { const i = at(pattern); return i < 0 ? undefined : cells[i + offset]; };
      const name = textOf(cell(COLUMN.name) ?? "");
      if (!name) continue;
      const login = textOf(cell(COLUMN.login) ?? "");
      const roles = textOf(cell(COLUMN.roles) ?? "");
      const member: CourseMember = { name: redactText(name), roles: roles ? roles.split(/\s*,\s*/).filter(Boolean) : [] };
      if (login) member.login = redactText(login);
      for (const [key, pattern] of [["passed", COLUMN.passed], ["tutorialSupport", COLUMN.tutorialSupport], ["notification", COLUMN.notification]] as const) {
        const value = checkbox(cell(pattern) ?? "");
        if (value !== undefined) member[key] = value;
      }
      members.push(member);
    }
    return members;
  }
  return undefined;
}

const STATUS_BY_ALT: Array<[RegExp, GradeStatus]> = [[/^(passed|bestanden)$/i, "passed"], [/^(failed|nicht bestanden)$/i, "failed"], [/^(not graded|nicht bewertet)$/i, "not_graded"]];
const statusOf = (cell: string): GradeStatus => {
  const alt = cell.replace(/<!--[\s\S]*?-->/g, "").match(/<img\b[^>]*\balt="([^"]*)"/i)?.[1]?.trim() ?? "";
  return STATUS_BY_ALT.find(([pattern]) => pattern.test(alt))?.[1] ?? "unknown";
};

/** Exercise "Submissions and Grades > Grades View" matrix, or undefined when not recognised. */
export function parseExerciseGrades(html: string): ExerciseGradeRow[] | undefined {
  const table = tables(html).find((t) => /<table\b[^>]*\bid="exc_grades_\d+"/i.test(t));
  if (!table) return undefined;
  const headers = headersOf(table);
  const assignmentColumns = headers
    .map((h, i) => ({ i, n: /^\d+$/.test(h.text) ? Number(h.text) : undefined, id: h.html.replace(/&amp;/g, "&").match(/[?&]ass_id=(\d+)/)?.[1] }))
    .filter((c): c is { i: number; n: number; id: string | undefined } => c.n !== undefined);
  const totalAt = headers.findIndex((h) => COLUMN.total.test(h.text));
  if (assignmentColumns.length === 0) return undefined;
  const rows: ExerciseGradeRow[] = [];
  for (const row of dataRows(table)) {
    const cells = cellsOf(row);
    const offset = cells.length - headers.length;
    const label = textOf(cells[offset] ?? "");
    if (!label) continue;
    // ILIAS renders "Lastname, Firstname [login]".
    const login = label.match(/\[([^\]]+)\]\s*$/)?.[1];
    const name = label.replace(/\s*\[[^\]]+\]\s*$/, "");
    const entry: ExerciseGradeRow = {
      name: redactText(name),
      grades: assignmentColumns.map((c) => ({ assignment: c.n, ...(c.id ? { assignmentId: c.id } : {}), status: statusOf(cells[c.i + offset] ?? "") })),
    };
    if (login) entry.login = redactText(login);
    if (totalAt >= 0) entry.total = statusOf(cells[totalAt + offset] ?? "");
    rows.push(entry);
  }
  return rows;
}

const ROUTE_KEYS = new Set(["baseClass", "cmdNode", "cmdClass", "cmd", "ref_id", "vw", "member_id", "part_id", "ass_id"]);
/** Sticky selection parameters ILIAS carries on exercise sub-tabs; digits only. */
const NUMERIC_KEYS = ["vw", "member_id", "part_id", "ass_id"];

/**
 * ADR 0060: a staff tab is followed only when the page itself advertises it:
 * pinned origin, `/ilias.php`, the expected cmdClass (and cmd, when given), the
 * same ref_id, allowlisted non-duplicated keys. Returns the validated URL.
 */
export function advertisedStaffRoute(html: string, refId: RefId, cmdClass: RegExp, cmd?: RegExp): string | undefined {
  for (const match of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)) {
    let url: URL;
    try { url = new URL(match[1]!.replace(/&amp;/gi, "&"), DEFAULT_ADAM_ORIGIN); } catch { continue; }
    if (url.origin !== DEFAULT_ADAM_ORIGIN || url.pathname !== "/ilias.php" || url.username || url.password || url.hash) continue;
    const keys = [...url.searchParams.keys()];
    if (keys.some((key) => !ROUTE_KEYS.has(key)) || new Set(keys).size !== keys.length) continue;
    if (!cmdClass.test(url.searchParams.get("cmdClass") ?? "") || url.searchParams.get("ref_id") !== refId) continue;
    const command = url.searchParams.get("cmd");
    if (cmd ? !cmd.test(command ?? "") : command !== null && !/^(show\w*|members|participants)$/i.test(command)) continue;
    if (url.searchParams.has("cmdNode") && !/^[a-z0-9:]{1,40}$/i.test(url.searchParams.get("cmdNode")!)) continue;
    if (NUMERIC_KEYS.some((key) => url.searchParams.has(key) && !/^\d{1,12}$/.test(url.searchParams.get(key)!))) continue;
    return url.href;
  }
  return undefined;
}

export function staffViewUnavailable(refId: RefId, view: string): AdamError {
  return new AdamError("forbidden", `Your role in ${refId} does not offer ADAM's "${view}" view (tutor or course-admin only). This is not a missing object.`, false);
}
