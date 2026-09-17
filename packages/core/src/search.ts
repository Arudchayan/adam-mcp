/** Case-fold and trim a search query. Empty after trim means “no match”. */
export function normalizeSearchNeedle(query: string): string {
  return query.trim().toLowerCase();
}

/** True for `pdf` / `PDF` / `.pdf` (optional leading dot, case-insensitive). */
export function isPdfSearchQuery(needle: string): boolean {
  const token = needle.startsWith(".") ? needle.slice(1) : needle;
  return token === "pdf";
}

export type SearchableObject = {
  type: string;
  title: string;
  mimeType?: string;
};

/**
 * Title-rank match: object title, file extension, or PDF mime.
 * `pdf` / `.pdf` also match existing `type=file` objects (student-coverage bar).
 * Does not invent types that are not on the object.
 */
export function searchTitleHit(needle: string, object: SearchableObject): boolean {
  if (!needle) {
    return false;
  }
  if (object.title.toLowerCase().includes(needle)) {
    return true;
  }
  if (object.type !== "file") {
    return false;
  }
  const mime = object.mimeType?.toLowerCase() ?? "";
  if (mime.includes(needle)) {
    return true;
  }
  // Enrolled file objects surface for pdf / .pdf even when the listing title
  // omits the extension (live ADAM often shows "Skript" + type=file).
  return isPdfSearchQuery(needle);
}
