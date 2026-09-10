import type { CalendarEvent } from "./types.ts";

/** AT6: when the same event appears from multiple SoTs, prefer exc > calendar > page. */
export const CALENDAR_SOURCE_RANK: Record<CalendarEvent["source"], number> = {
  exc: 3,
  calendar: 2,
  page: 1,
};

/** UTC calendar day (YYYY-MM-DD) from an ISO startsAt, or undefined if unparseable. */
export function calendarEventDay(startsAt: string | undefined): string | undefined {
  if (!startsAt) {
    return undefined;
  }
  const stamp = Date.parse(startsAt);
  if (!Number.isFinite(stamp)) {
    return undefined;
  }
  return new Date(stamp).toISOString().slice(0, 10);
}

/**
 * AT6 same-event key: objectRefId + UTC day when startsAt parses.
 * Undated items keep title so distinct honest-omit notes do not collapse.
 */
export function calendarEventDedupeKey(event: CalendarEvent): string {
  const day = calendarEventDay(event.startsAt);
  if (day) {
    return `${event.objectRefId ?? ""}|${day}`;
  }
  return `${event.objectRefId ?? ""}||${event.title}`;
}

/**
 * Keep the best event per same object+day (exc > calendar > page), but rank
 * explicit evidence above source preference and keep the corroborating sources
 * in `seenIn` instead of silently dropping them.
 */
export function preferCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
  const best = new Map<string, CalendarEvent>();
  for (const event of events) {
    const key = calendarEventDedupeKey(event);
    const prev = best.get(key);
    if (!prev) {
      best.set(key, { ...event, seenIn: [...new Set([...(event.seenIn ?? []), event.source])] });
      continue;
    }
    const winner = prefersConfidence(event, prev) ? event : prev;
    best.set(key, {
      ...winner,
      seenIn: [...new Set([...(prev.seenIn ?? [prev.source]), ...(event.seenIn ?? [event.source]), event.source])],
    });
  }
  return [...best.values()];
}

/** Explicit evidence beats inferred; when confidence ties, source rank decides. */
function prefersConfidence(candidate: CalendarEvent, current: CalendarEvent): boolean {
  if (candidate.confidence !== current.confidence) {
    return candidate.confidence === "explicit";
  }
  return CALENDAR_SOURCE_RANK[candidate.source] > CALENDAR_SOURCE_RANK[current.source];
}
