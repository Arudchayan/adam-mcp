import type { ListOptions, Paginated } from "./types.ts";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(limit)));
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }
  const offset = Number.parseInt(cursor, 10);
  if (!Number.isFinite(offset) || offset < 0) {
    return 0;
  }
  return offset;
}

export function paginate<T>(items: readonly T[], options: ListOptions = {}): Paginated<T> {
  const limit = normalizeLimit(options.limit);
  const offset = decodeCursor(options.cursor);
  const slice = items.slice(offset, offset + limit);
  const nextOffset = offset + slice.length;
  return {
    items: slice,
    nextCursor: nextOffset < items.length ? String(nextOffset) : undefined,
    totalHint: items.length,
  };
}

/** Attach ADR 0005 listing honesty after slicing. Unknown omits totalHint — never report 0. */
export function withListingState<T>(
  page: Paginated<T>,
  listingState: Paginated<T>["listingState"],
  listingSignals?: Paginated<T>["listingSignals"],
  notice?: string,
): Paginated<T> {
  if (listingState === undefined) {
    return page;
  }
  if (listingState === "unknown") {
    const { totalHint: _dropped, ...rest } = page;
    return { ...rest, listingState, listingSignals, notice };
  }
  return { ...page, listingState, listingSignals, notice };
}
