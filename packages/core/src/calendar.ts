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

/** Keep the highest-ranked source for each same object+day (exc > calendar > page). */
export function preferCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
  const best = new Map<string, CalendarEvent>();
  for (const event of events) {
    const key = calendarEventDedupeKey(event);
    const prev = best.get(key);
    if (!prev || CALENDAR_SOURCE_RANK[event.source] > CALENDAR_SOURCE_RANK[prev.source]) {
      best.set(key, event);
    }
  }
  return [...best.values()];
}
