import { AdamError, DEFAULT_ADAM_ORIGIN, MAX_PAGE_CHARS, redactText, type MailAttachment } from "adam-core";
import { parseAdamTimestamp } from "./deadlines.ts";
import { extractClassBlocksAt, sliceUntilClose, textOf } from "./ui-items.ts";

/**
 * ADR 0054: read-only ADAM internal mail (ILIAS 10.12 `ilMailFolderGUI`).
 *
 * The mailbox page also carries table actions (mark read/unread, move, delete),
 * compose, contacts, attachments and options routes. This module never builds
 * or returns any of them: the only route it accepts is a `showMail` link the
 * inbox table itself advertises, validated key by key.
 */

/** Fixed landing route; ILIAS redirects it to the inbox folder view. */
export const MAILBOX_URL = `${DEFAULT_ADAM_ORIGIN}/ilias.php?baseClass=ilMailGUI`;

const SHOW_MAIL_KEYS = new Set(["baseClass", "cmdNode", "cmdClass", "cmd", "mobj_id", "mail_id"]);
const NUMERIC_ID = /^\d{1,12}$/;

export type MailRoute = { url: string; folderId: string; mailId: string };

/**
 * Accept only `ilias.php?baseClass=ilmailgui&cmdClass=ilMailFolderGUI&cmd=showMail`
 * on the pinned origin with numeric `mobj_id` / `mail_id`, allowlisted keys and
 * no duplicates. Everything else (executeTableAction, post, compose, delivery
 * of attachments, …) returns undefined.
 */
export function showMailRoute(raw: string, base: string = DEFAULT_ADAM_ORIGIN): MailRoute | undefined {
  let url: URL;
  try {
    url = new URL(raw.replace(/&amp;/gi, "&"), base);
  } catch {
    return undefined;
  }
  if (url.origin !== DEFAULT_ADAM_ORIGIN || url.pathname !== "/ilias.php" || url.username || url.password || url.hash) return undefined;
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => !SHOW_MAIL_KEYS.has(key)) || new Set(keys).size !== keys.length) return undefined;
  const param = (key: string) => url.searchParams.get(key) ?? "";
  if (param("baseClass").toLowerCase() !== "ilmailgui") return undefined;
  if (param("cmdClass").toLowerCase() !== "ilmailfoldergui" || param("cmd") !== "showMail") return undefined;
  if (url.searchParams.has("cmdNode") && !/^[a-z0-9:]{1,40}$/i.test(param("cmdNode"))) return undefined;
  const folderId = param("mobj_id");
  const mailId = param("mail_id");
  if (!NUMERIC_ID.test(folderId) || !NUMERIC_ID.test(mailId)) return undefined;
  return { url: url.href, folderId, mailId };
}

/** True when ADAM landed on the mail GUI (inbox list or a message), not elsewhere. */
export function isMailGuiUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.origin === DEFAULT_ADAM_ORIGIN && url.pathname === "/ilias.php" && url.searchParams.get("baseClass")?.toLowerCase() === "ilmailgui";
  } catch {
    return false;
  }
}

export function assertMailId(mailId: string): void {
  if (!NUMERIC_ID.test(mailId)) {
    throw new AdamError("stale_id", "mailId must be the decimal id from adam_list_mail.", false);
  }
}

export type ParsedMailRow = {
  mailId: string;
  folderId: string;
  url: string;
  subject: string;
  sender?: string;
  dateText?: string;
  sentAt?: string;
  status: "read" | "unread" | "unknown";
  hasAttachments?: boolean;
};

export type ParsedMailbox = {
  /** False when no KS data table was found at all (layout unknown). */
  tableFound: boolean;
  rows: ParsedMailRow[];
  /** Rows whose subject link was missing or failed route validation. */
  skippedRows: number;
  /** Total ADAM reports for the folder ("1 - 20 of 57"), when shown. */
  reportedTotal?: number;
};

type Column = "status" | "sender" | "subject" | "attachments" | "date" | "other";

const HEADER_COLUMNS: Array<[RegExp, Column]> = [
  [/^status/i, "status"],
  [/^(?:sender|from|absender(?:in)?|von)/i, "sender"],
  [/^(?:subject|betreff)/i, "subject"],
  [/^(?:attachments?|anh[äa]nge?|anhang)(?![a-zäöü])/i, "attachments"],
  [/^(?:date|datum|sent|gesendet)/i, "date"],
];

/** Parse the first KS data table on the inbox page. Fields absent from the HTML stay absent. */
export function parseMailbox(html: string, now: Date = new Date()): ParsedMailbox {
  const table = firstTable(html);
  if (table === undefined) return { tableFound: false, rows: [], skippedRows: 0 };
  const headers = blocks(table, "th").map((cell) => columnFor(textOf(cell)));
  const rows: ParsedMailRow[] = [];
  let skippedRows = 0;
  for (const row of blocks(table, "tr")) {
    const cells = blocks(row, "td", true);
    if (cells.length === 0) continue;
    if (cells.length === 1 && !/<a\b/i.test(cells[0]!.inner)) continue; // "No records" row
    const byColumn = new Map<Column, string>();
    const aligned = headers.length === cells.length;
    let statusSeen = false;
    cells.forEach((cell, at) => {
      let column: Column = aligned ? headers[at]! : "other";
      if (!aligned || column === "other") column = columnFromModifier(cell.attrs, statusSeen, byColumn);
      if (column === "status") statusSeen = true;
      if (column !== "other" && !byColumn.has(column)) byColumn.set(column, cell.inner);
    });
    const subjectCell = byColumn.get("subject") ?? cells.map((cell) => cell.inner).find((inner) => /cmd=showMail/i.test(inner));
    const href = subjectCell ? showMailHref(subjectCell) : undefined;
    const route = href ? showMailRoute(href) : undefined;
    if (!route || !subjectCell) {
      skippedRows += 1;
      continue;
    }
    const sender = redactText(labelOf(byColumn.get("sender") ?? ""));
    const dateText = labelOf(byColumn.get("date") ?? "");
    const sentAt = dateText ? parseAdamTimestamp(dateText, now) : undefined;
    const attachments = byColumn.get("attachments");
    rows.push({
      mailId: route.mailId,
      folderId: route.folderId,
      url: route.url,
      subject: textOf(subjectCell) || "(no subject)",
      ...(sender ? { sender } : {}),
      ...(dateText ? { dateText } : {}),
      ...(sentAt ? { sentAt } : {}),
      status: readStatus(byColumn.get("status") ?? "", row),
      ...(attachments !== undefined ? { hasAttachments: hasAttachment(attachments) } : {}),
    });
  }
  const total = textOf(html).match(/\b\d+\s*[-–]\s*\d+\s*(?:of|von|aus)\s*(\d+)\b/i)?.[1];
  return { tableFound: true, rows, skippedRows, ...(total ? { reportedTotal: Number(total) } : {}) };
}

export type ParsedMailMessage = {
  subject?: string;
  sender?: string;
  recipients?: string;
  dateText?: string;
  sentAt?: string;
  body: string;
  truncated: boolean;
  attachments: MailAttachment[];
};

type Field = "sender" | "recipients" | "subject" | "date" | "body" | "attachments";

const FIELD_LABELS: Array<[RegExp, Field]> = [
  [/^(?:from|sender|von|absender(?:in)?)$/i, "sender"],
  [/^(?:to|an|empfänger(?:in)?|recipients?)$/i, "recipients"],
  [/^(?:subject|betreff)$/i, "subject"],
  [/^(?:date|datum|sent|gesendet)$/i, "date"],
  [/^(?:message|nachricht|body|text|mitteilung|inhalt)$/i, "body"],
  [/^(?:attachments?|anh[äa]nge?|anhang|dateien)$/i, "attachments"],
];

/**
 * NEEDS LIVE VERIFICATION (ADR 0054): the 10.12 `showMail` markup was not probed.
 * Accepts the label/value shapes ILIAS renders read-only data in — legacy
 * property-form rows (`form-group` + `control-label`), KS characteristic values,
 * KS item properties and `<dt>/<dd>` — and fails closed without a labelled body.
 */
export function parseMailMessage(html: string, now: Date = new Date()): ParsedMailMessage | undefined {
  const fields = new Map<Field, string>();
  for (const { label, value } of labelledValues(html)) {
    const field = FIELD_LABELS.find(([pattern]) => pattern.test(label))?.[1];
    if (field && !fields.has(field)) fields.set(field, value);
  }
  const bodyHtml = fields.get("body");
  if (bodyHtml === undefined) return undefined;
  const fullBody = bodyText(bodyHtml);
  const truncated = fullBody.length > MAX_PAGE_CHARS;
  const sender = redactText(textOf(fields.get("sender") ?? ""));
  const recipients = redactText(textOf(fields.get("recipients") ?? ""));
  const subject = textOf(fields.get("subject") ?? "");
  const dateText = textOf(fields.get("date") ?? "");
  const sentAt = dateText ? parseAdamTimestamp(dateText, now) : undefined;
  return {
    ...(subject ? { subject } : {}),
    ...(sender ? { sender } : {}),
    ...(recipients ? { recipients } : {}),
    ...(dateText ? { dateText } : {}),
    ...(sentAt ? { sentAt } : {}),
    body: truncated ? fullBody.slice(0, MAX_PAGE_CHARS) : fullBody,
    truncated,
    attachments: attachmentsOf(fields.get("attachments") ?? ""),
  };
}

function labelledValues(html: string): Array<{ label: string; value: string }> {
  const pairs: Array<{ label: string; value: string }> = [];
  // Legacy read-only property form: <div class="form-group"><label …>From</label><div class="col-…">value</div></div>
  for (const { block } of extractClassBlocksAt(html, "form-group")) {
    const label = block.match(/<label\b[^>]*>([\s\S]*?)<\/label>/i);
    if (!label) continue;
    const rest = block.slice((label.index ?? 0) + label[0].length);
    pairs.push({ label: cleanLabel(label[1]!), value: rest });
  }
  // KS Listing Characteristic Value and KS Item properties: label/value siblings in order.
  for (const [labelClass, valueClass] of [
    ["c-listing-characteristic-value__label", "c-listing-characteristic-value__item"],
    ["il-item-property-name", "il-item-property-value"],
  ] as const) {
    const labels = extractClassBlocksAt(html, labelClass);
    const values = extractClassBlocksAt(html, valueClass);
    labels.forEach((label, at) => {
      const value = values[at];
      if (value) pairs.push({ label: cleanLabel(label.block), value: value.block });
    });
  }
  for (const match of html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
    pairs.push({ label: cleanLabel(match[1]!), value: match[2]! });
  }
  return pairs;
}

function cleanLabel(html: string): string {
  return textOf(html).replace(/[:·*]\s*$/, "").trim();
}

/** Keep line structure of the message; never keep markup or link targets. */
function bodyText(html: string): string {
  const withBreaks = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6]|pre|blockquote)>/gi, "\n");
  return withBreaks
    .split("\n")
    .map((line) => textOf(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const SIZE = /\(?\s*(\d+(?:[.,]\d+)?\s*(?:bytes?|[kmg]i?b|[kmg]o))\s*\)?/i;

function attachmentsOf(html: string): MailAttachment[] {
  if (!html.trim()) return [];
  const entries: string[] = [];
  for (const match of html.matchAll(/<(a|li|option)\b[^>]*>([\s\S]*?)<\/\1>/gi)) entries.push(match[2]!);
  if (entries.length === 0) entries.push(...html.split(/<br\s*\/?>/i));
  const attachments: MailAttachment[] = [];
  for (const entry of entries) {
    const text = textOf(entry);
    if (!text) continue;
    const size = text.match(SIZE);
    const name = (size ? text.replace(size[0], "") : text).replace(/[\s,;]+$/, "").trim();
    if (!name || attachments.some((item) => item.name === name)) continue;
    attachments.push({ name, ...(size ? { sizeText: size[1]!.trim() } : {}) });
  }
  return attachments;
}

function firstTable(html: string): string | undefined {
  const open = html.match(/<table\b[^>]*class=["'][^"']*\bc-table-data__table\b[^"']*["'][^>]*>/i);
  if (!open) return undefined;
  return sliceUntilClose(html, (open.index ?? 0) + open[0].length, "table");
}

type Cell = { attrs: string; inner: string };

function blocks(html: string, tag: string): string[];
function blocks(html: string, tag: string, withAttrs: true): Cell[];
function blocks(html: string, tag: string, withAttrs = false): string[] | Cell[] {
  const found: Cell[] = [];
  const open = new RegExp(`<${tag}\\b([^>]*)>`, "gi");
  let cursor = 0;
  for (const match of html.matchAll(open)) {
    if ((match.index ?? 0) < cursor) continue; // nested inside the previous block
    const start = (match.index ?? 0) + match[0].length;
    const inner = sliceUntilClose(html, start, tag);
    if (inner === undefined) continue;
    found.push({ attrs: match[1] ?? "", inner });
    cursor = start + inner.length;
  }
  return withAttrs ? found : found.map((cell) => cell.inner);
}

function columnFor(label: string): Column {
  return HEADER_COLUMNS.find(([pattern]) => pattern.test(label))?.[1] ?? "other";
}

/** Fallback when headers and cells do not line up: the KS cell modifier classes. */
function columnFromModifier(attrs: string, statusSeen: boolean, seen: Map<Column, string>): Column {
  if (/c-table-data__cell--link\b/.test(attrs)) return "subject";
  if (/c-table-data__cell--date\b/.test(attrs)) return "date";
  if (/c-table-data__cell--text\b/.test(attrs) && !seen.has("sender")) return "sender";
  if (/c-table-data__cell--status\b/.test(attrs)) {
    if (!statusSeen) return "status";
    // Status, Avatar, then Attachments after the subject link.
    if (seen.has("subject")) return "attachments";
  }
  return "other";
}

/** Visible text plus the accessible labels of icons (alt / title / aria-label). */
function labelOf(html: string): string {
  const labels = [...html.matchAll(/\b(?:alt|title|aria-label)=["']([^"']*)["']/gi)].map((match) => match[1]!);
  return [textOf(html), ...labels.map((label) => textOf(label))].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function showMailHref(html: string): string | undefined {
  for (const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)) {
    if (/cmd=showMail\b/i.test(match[1]!)) return match[1];
  }
  return undefined;
}

function readStatus(statusCell: string, row: string): ParsedMailRow["status"] {
  const label = labelOf(statusCell);
  if (/\b(?:unread|ungelesen|new|neu)\b/i.test(label)) return "unread";
  if (/\b(?:read|gelesen)\b/i.test(label)) return "read";
  // Some renders mark the row itself (e.g. bold / "unread" class).
  if (/class=["'][^"']*\b(?:unread|mailunread)\b/i.test(row)) return "unread";
  return "unknown";
}

function hasAttachment(cell: string): boolean {
  const label = labelOf(cell);
  if (/\b(?:no attachments?|keine anh[äa]nge?)\b/i.test(label)) return false;
  return label.length > 0 || /<(?:img|svg|span\b[^>]*glyph)/i.test(cell);
}
