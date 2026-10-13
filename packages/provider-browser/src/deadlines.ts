import type { InferredDate } from "adam-core";

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
  januar: 0,
  februar: 1,
  marz: 2,
  märz: 2,
  mär: 2,
  mai: 4,
  juni: 5,
  juli: 6,
  oktober: 9,
  okt: 9,
  dezember: 11,
  dez: 11,
};

/** Longest-first so "September" wins over "Sep". */
const MONTH_PATTERN = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");

export function inferDates(text: string): InferredDate[] {
  const found: InferredDate[] = [];
  const seen = new Set<string>();

  const push = (raw: string, iso: string | undefined, confidence: InferredDate["confidence"]) => {
    const key = raw.trim();
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    found.push({ raw: key, iso, confidence });
  };

  for (const match of text.matchAll(/\b(\d{4}-\d{2}-\d{2})(?!\d)/g)) {
    const iso = toIso(Number(match[1].slice(0, 4)), Number(match[1].slice(5, 7)) - 1, Number(match[1].slice(8, 10)));
    push(match[1], iso, iso ? "explicit" : "inferred");
  }
  for (const match of text.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g)) {
    const iso = toIso(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    push(match[0], iso, iso ? "explicit" : "inferred");
  }
  const dayFirst = new RegExp(`\\b(\\d{1,2})\\.?\\s+(${MONTH_PATTERN})\\.?\\s+(\\d{4})\\b`, "gi");
  for (const match of text.matchAll(dayFirst)) {
    const month = MONTHS[match[2].toLowerCase().replace("ä", "a")];
    const iso = month === undefined ? undefined : toIso(Number(match[3]), month, Number(match[1]));
    push(match[0], iso, iso ? "explicit" : "inferred");
  }
  const monthFirst = new RegExp(`\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "gi");
  for (const match of text.matchAll(monthFirst)) {
    const month = MONTHS[match[1].toLowerCase().replace("ä", "a")];
    const iso = month === undefined ? undefined : toIso(Number(match[3]), month, Number(match[2]));
    push(match[0], iso, iso ? "explicit" : "inferred");
  }

  return found.slice(0, 20);
}

/**
 * AT5: only surface a unit deadline when the page labels one (Deadline/Abgabe/Due).
 * Do not promote unrelated page dates (exam, published, session) into invented deadlines.
 */
export function exerciseDeadlineFromPage(text: string, _inferredDates?: InferredDate[]): string | undefined {
  const labeled = [
    ...text.matchAll(/\b(?:deadline|abgabefrist|abgabetermin|abgabe|frist|due(?:\s+date)?)\s*(?::|bis)\s*([^\n;]{3,120})/gi),
  ];
  if (labeled.length === 0) {
    return undefined;
  }
  for (const match of labeled) {
    const raw = match[1].trim();
    const date = inferDates(raw).sort((a, b) => raw.indexOf(a.raw) - raw.indexOf(b.raw))[0];
    if (!date?.iso) continue;
    const tail = raw.slice(raw.indexOf(date.raw) + date.raw.length);
    const time = tail.match(/^(?:\s*(?:,|um|at|T))?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(Z|[+-]\d{2}:?\d{2})?/i);
    if (!time) return date.iso; // Date-only evidence stays date-only (UTC midnight convention).
    const hour = Number(time[1]), minute = Number(time[2]), second = Number(time[3] ?? 0);
    if (hour > 23 || minute > 59 || second > 59) continue;
    const day = date.iso.slice(0, 10);
    const clock = `${String(hour).padStart(2, "0")}:${time[2]}:${String(second).padStart(2, "0")}`;
    if (time[4]) {
      const stamp = Date.parse(`${day}T${clock}${time[4]}`);
      if (Number.isFinite(stamp)) return new Date(stamp).toISOString();
      continue;
    }
    const resolved = zurichLocalTime(day, hour, minute, second);
    if (resolved) return resolved;
  }
  // Labeled but unparseable — honest omit (do not invent).
  return undefined;
}

function toIso(year: number, monthIndex: number, day: number): string | undefined {
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) {
    return undefined;
  }
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthIndex || date.getUTCDate() !== day) return undefined;
  return date.toISOString();
}

/** Reject nonexistent or ambiguous DST clock times rather than inventing an instant. */
function zurichLocalTime(day: string, hour: number, minute: number, second: number): string | undefined {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const naive = Date.parse(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}Z`);
  const matches: string[] = [];
  for (const offsetMinutes of [60, 120]) {
    const candidate = new Date(naive - offsetMinutes * 60_000);
    const parts = Object.fromEntries(formatter.formatToParts(candidate).map((part) => [part.type, part.value]));
    if (`${parts.year}-${parts.month}-${parts.day}` === day && Number(parts.hour) === hour && Number(parts.minute) === minute && Number(parts.second) === second) {
      matches.push(candidate.toISOString());
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}
