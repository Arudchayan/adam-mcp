import {
  canonicalUrl,
  objectUrl,
  parseAdamRef,
  type AdamObject,
  type AdamObjectType,
  type Breadcrumb,
  type FileObject,
  type InferredDate,
  type NewsItem,
  type Provenance,
  type RefId,
} from "adam-core";
import type { PageSnapshot, SnapshotLink } from "./session-types.ts";

export const MAX_PAGE_TEXT = 50_000;
export const MAX_HTML_BYTES = 400_000;

export function capText(value: string, max: number = MAX_PAGE_TEXT): string {
  return value.length <= max ? value : value.slice(0, max);
}

const CHROME_TITLES = new Set([
  "magazin",
  "adamtools",
  "tipps & tricks",
  "hilfe & support",
  "hilfe",
  "anmelden",
  "sprache",
  "deutsch",
  "english",
  "info barrierefreiheit",
  "impressum, datenschutz, nutzungsvereinbarung",
  "adam - einstiegsseite",
  "servicedesk",
  "nutzungsvereinbarung",
  "baumansicht ...",
  "link in zwischenablage kopieren",
]);

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

export type ExtractedCatalog = {
  current?: AdamObject;
  breadcrumbs: Breadcrumb[];
  objects: AdamObject[];
  files: FileObject[];
  news: NewsItem[];
  inferredDates: InferredDate[];
  iliasVersion?: string;
  text: string;
};

export function isLoginSnapshot(snapshot: PageSnapshot): boolean {
  const url = snapshot.url.toLowerCase();
  const haystack = `${snapshot.title}\n${snapshot.text}`.toLowerCase();
  return (
    url.includes("login.php") ||
    haystack.includes("bei adam anmelden") ||
    haystack.includes("login mit switch edu-id")
  );
}

export function isLoggedInSnapshot(snapshot: PageSnapshot): boolean {
  if (isLoginSnapshot(snapshot)) {
    return false;
  }
  const haystack = snapshot.text.toLowerCase();
  return (
    /abmelden|log out|logout|persönlicher schreibtisch|dashboard/i.test(haystack) ||
    snapshot.links.some((link) => parseAdamRef(link.href)?.type === "crs" && !link.inChrome)
  );
}

export function extractCatalog(snapshot: PageSnapshot, fetchedAt: string): ExtractedCatalog {
  const provenanceBase = (sourceUrl: string): Provenance => ({
    sourceUrl,
    fetchedAt,
    provider: "browser",
    iliasVersion: readIliasVersion(snapshot.text),
    freshness: "live-browser-session",
  });

  const breadcrumbs = snapshot.links
    .filter((link) => link.inBreadcrumb)
    .map((link) => linkToBreadcrumb(link))
    .filter((crumb): crumb is Breadcrumb => crumb !== undefined);

  const currentRef = parseAdamRef(snapshot.url);
  const current = currentRef
    ? toObject(
        currentRef.type,
        currentRef.refId,
        headingFrom(snapshot) ?? snapshot.title,
        breadcrumbs,
        provenanceBase(snapshot.url),
      )
    : undefined;

  const seen = new Set<string>();
  const objects: AdamObject[] = [];
  for (const link of snapshot.links) {
    if (link.inChrome || link.inBreadcrumb || shouldSkipTitle(link.text)) {
      continue;
    }
    const parsed = parseAdamRef(link.href);
    if (!parsed || parsed.type === "impr" || parsed.type === "root") {
      continue;
    }
    if (current && parsed.refId === current.refId) {
      continue;
    }
    const key = `${parsed.type}:${parsed.refId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const crumbTrail = link.inBreadcrumb ? breadcrumbs : breadcrumbs.concat(current ? [toBreadcrumb(current)] : []);
    objects.push(
      toObject(parsed.type, parsed.refId, cleanTitle(link.text) || parsed.refId, crumbTrail, provenanceBase(link.href)),
    );
  }

  const files = objects.filter((item): item is FileObject => item.type === "file").map((item) => ({
    ...item,
    type: "file" as const,
    ...fileHints(item.title, snapshot.text),
  }));

  const text = capText(snapshot.text, MAX_PAGE_TEXT);

  return {
    current,
    breadcrumbs,
    objects,
    files,
    news: extractNews(snapshot, objects, provenanceBase(snapshot.url)),
    inferredDates: inferDates(text),
    iliasVersion: readIliasVersion(snapshot.text),
    text,
  };
}

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

  for (const match of text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) {
    push(match[1], `${match[1]}T00:00:00.000Z`, "explicit");
  }
  for (const match of text.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g)) {
    const iso = toIso(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    push(match[0], iso, "explicit");
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
export function exerciseDeadlineFromPage(text: string, inferredDates: InferredDate[] = inferDates(text)): string | undefined {
  const labeled = [
    ...text.matchAll(/(?:deadline|abgabefrist|abgabetermin|abgabe|frist|due(?:\s+date)?)\s*(?::|bis)\s*([^\n.;]{3,80})/gi),
  ];
  if (labeled.length === 0) {
    return undefined;
  }
  for (const match of labeled) {
    const raw = match[1].trim();
    const fromLabel = inferDates(raw).find((date) => date.iso)?.iso;
    if (fromLabel) {
      return fromLabel;
    }
    const lowered = raw.toLowerCase();
    const hit = inferredDates.find(
      (date) => date.iso && (lowered.includes(date.raw.toLowerCase()) || date.raw.toLowerCase().includes(lowered.slice(0, 12))),
    );
    if (hit?.iso) {
      return hit.iso;
    }
  }
  // Labeled but unparseable — honest omit (do not invent).
  return undefined;
}

export function collectLinksFromHtml(html: string): SnapshotLink[] {
  const chromeHrefs = new Set(hrefsIn(html, /<nav[^>]*aria-label=["']Hauptnavigationsleiste["'][^>]*>[\s\S]*?<\/nav>/i));
  const breadcrumbHrefs = new Set(
    hrefsIn(html, /<nav[^>]*aria-label=["'](?:Brotkrumen|Breadcrumb)["'][^>]*>[\s\S]*?<\/nav>/i),
  );
  const links: SnapshotLink[] = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const href = match[1];
    const text = cleanTitle(stripTags(match[2]));
    links.push({
      href,
      text,
      inChrome: chromeHrefs.has(href),
      inBreadcrumb: breadcrumbHrefs.has(href),
    });
  }
  return links;
}

/** Merge main-frame links with links collected inside content frames (dedupe by href+text). */
export function mergeFrameLinks(mainLinks: SnapshotLink[], frameLinks: SnapshotLink[]): SnapshotLink[] {
  const merged = [...mainLinks];
  const seen = new Set(mainLinks.map((link) => `${link.href}\n${link.text}`));
  for (const link of frameLinks) {
    const key = `${link.href}\n${link.text}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(link);
  }
  return merged;
}

function hrefsIn(html: string, section: RegExp): string[] {
  const block = html.match(section)?.[0] ?? "";
  return [...block.matchAll(/href=["']([^"']+)["']/gi)].map((match) => match[1]);
}

function extractNews(
  snapshot: PageSnapshot,
  objects: AdamObject[],
  provenance: Provenance,
): NewsItem[] {
  const articles = extractNewsArticles(snapshot, provenance);
  if (articles.length > 0) {
    return articles;
  }
  if (!/news|nachrichten|aktuelles|new file|neue datei/i.test(snapshot.text)) {
    return [];
  }
  return objects
    .filter((item) => item.type === "blog" || item.type === "file")
    .slice(0, 10)
    .map((item) => ({
      title: item.title,
      summary: item.title,
      url: item.url,
      courseRefId: item.breadcrumb.find((crumb) => crumb.type === "crs")?.refId,
      folderRefId: item.breadcrumb.find((crumb) => crumb.type === "fold")?.refId,
      accessClass: item.accessClass,
      provenance,
    }));
}

function extractNewsArticles(snapshot: PageSnapshot, provenance: Provenance): NewsItem[] {
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  const blocks = [
    ...snapshot.html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi),
    ...snapshot.html.matchAll(
      /<(?:section|div)[^>]*(?:news|nachricht|aktuell)[^>]*>([\s\S]*?)<\/(?:section|div)>/gi,
    ),
  ];
  for (const match of blocks) {
    const html = match[1];
    const text = cleanTitle(stripTags(html));
    if (!text) {
      continue;
    }
    const href = html.match(/href=["']([^"']+)["']/i)?.[1];
    const parsed = href ? parseAdamRef(href) : undefined;
    const datetime = html.match(/datetime=["']([^"']+)["']/i)?.[1];
    const url = parsed ? canonicalUrl(parsed.type, parsed.refId) : snapshot.url;
    if (seen.has(url + text)) {
      continue;
    }
    seen.add(url + text);
    const linkText = cleanTitle(stripTags(html.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? ""));
    items.push({
      title: linkText || text.slice(0, 80),
      summary: text.slice(0, 280),
      url,
      courseRefId: parsed?.type === "crs" ? parsed.refId : undefined,
      folderRefId: parsed?.type === "fold" ? parsed.refId : undefined,
      createdAt: datetime,
      updatedAt: datetime,
      accessClass: /authenticated users|registrierte nutzer/i.test(text) ? "Authenticated Users" : undefined,
      author: authorFrom(text),
      provenance: { ...provenance, sourceUrl: url },
    });
  }
  return items.slice(0, 20);
}

function authorFrom(text: string): string | undefined {
  const match = text.match(/\b(?:author|autor|von)\s*[:\-]?\s*([A-ZÄÖÜ][\wÄÖÜäöüß.\-]+(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß.\-]+)?)/i);
  return match?.[1];
}

function readIliasVersion(text: string): string | undefined {
  const match = text.match(/rendered by[^\n]*-\s*(\d+\.\d+)\s*-/i);
  return match?.[1];
}

function headingFrom(snapshot: PageSnapshot): string | undefined {
  const match = snapshot.html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match) {
    return undefined;
  }
  return cleanTitle(stripTags(match[1])) || undefined;
}

function shouldSkipTitle(title: string): boolean {
  return CHROME_TITLES.has(title.trim().toLowerCase()) || title.trim().length === 0;
}

function linkToBreadcrumb(link: SnapshotLink): Breadcrumb | undefined {
  const parsed = parseAdamRef(link.href);
  if (!parsed) {
    return undefined;
  }
  return {
    type: parsed.type,
    refId: parsed.refId,
    title: cleanTitle(link.text) || parsed.refId,
    url: objectUrl(parsed.type, parsed.refId),
  };
}

function toBreadcrumb(object: AdamObject): Breadcrumb {
  return {
    type: object.type,
    refId: object.refId,
    title: object.title,
    url: object.url,
  };
}

function toObject(
  type: AdamObjectType,
  refId: RefId,
  title: string,
  breadcrumb: Breadcrumb[],
  provenance: Provenance,
): AdamObject {
  return {
    type,
    refId,
    title,
    url: objectUrl(type, refId),
    breadcrumb,
    provenance,
  };
}

function fileHints(title: string, pageText: string): Pick<FileObject, "mimeType" | "sizeBytes" | "pageCount"> {
  const hints: Pick<FileObject, "mimeType" | "sizeBytes" | "pageCount"> = {};
  if (/\.pdf\b/i.test(title)) {
    hints.mimeType = "application/pdf";
  }
  const size = pageText.match(new RegExp(`${escapeRegExp(title)}[^\\n]{0,80}?(\\d+(?:[.,]\\d+)?)\\s*(KB|MB|GB)`, "i"));
  if (size) {
    const amount = Number.parseFloat(size[1].replace(",", "."));
    const unit = size[2].toUpperCase();
    const multiplier = unit === "GB" ? 1024 * 1024 * 1024 : unit === "MB" ? 1024 * 1024 : 1024;
    hints.sizeBytes = Math.round(amount * multiplier);
  }
  const pages = pageText.match(new RegExp(`${escapeRegExp(title)}[^\\n]{0,80}?(\\d+)\\s*(pages|seiten)`, "i"));
  if (pages) {
    hints.pageCount = Number.parseInt(pages[1], 10);
  }
  return hints;
}

function toIso(year: number, monthIndex: number, day: number): string | undefined {
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) {
    return undefined;
  }
  return new Date(Date.UTC(year, monthIndex, day)).toISOString();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function cleanTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** ILIAS 10 EN/DE empty-container copy, list and card markup. Absence of copy must not mean empty. */
export const EMPTY_CONTAINER_COPY =
  /this (?:folder|object) is empty(?: and contains no items)?|dieser ordner ist leer|no items available|no materials available|keine eintr[äa]ge(?: vorhanden)?|keine objekte gefunden/i;

export function isAdamEmptyContainerPage(snapshot: Pick<PageSnapshot, "text">): boolean {
  return EMPTY_CONTAINER_COPY.test(snapshot.text ?? "");
}

export type ListingClassification = {
  state: "ok" | "empty" | "unknown";
  signals: { contentItemCount: number; emptyCopy: boolean; chromeOnly: boolean };
  notice?: string;
};

export const LISTING_EMPTY_NOTICE =
  "Listed successfully; this folder has no child objects. Not a failure. Not 'no deadlines'.";
export const LISTING_UNKNOWN_NOTICE =
  "Folder page opened but the object list did not load. Do not treat this as empty. Retry with type from the parent listing, or open the ADAM URL.";
export const LISTING_ROWS_UNPARSED_NOTICE =
  "Object rows are visible on this page, but no parseable ADAM links were found. Do not treat this as empty. Retry with type from the parent listing, or open the ADAM URL.";
export const LISTING_BLANK_CONTENT_NOTICE =
  "The folder view rendered a blank content area: no items and no empty message. It may be empty, or its contents may not be visible to this account. Do not claim it is empty or that nothing exists; open the ADAM URL to check.";

/** ADR 0005: classify from DOM signals in extract, not from waits. First match wins. */
export function classifyListing(
  snapshot: PageSnapshot,
  keptCount: number,
): ListingClassification {
  const domRows = snapshot.dom?.itemRows ?? 0;
  const emptyCopy = isAdamEmptyContainerPage(snapshot) || snapshot.dom?.emptyCopy === true;
  if (keptCount > 0) {
    return {
      state: "ok",
      signals: { contentItemCount: keptCount, emptyCopy, chromeOnly: false },
    };
  }
  // Visible rows beat empty copy: a stray empty widget or frame must never hide content.
  if (domRows > 0) {
    return {
      state: "unknown",
      signals: { contentItemCount: domRows, emptyCopy: false, chromeOnly: false },
      notice: LISTING_ROWS_UNPARSED_NOTICE,
    };
  }
  if (emptyCopy) {
    return {
      state: "empty",
      signals: { contentItemCount: 0, emptyCopy: true, chromeOnly: false },
      notice: LISTING_EMPTY_NOTICE,
    };
  }
  if (snapshot.dom?.contentBlank === true) {
    return {
      state: "unknown",
      signals: { contentItemCount: 0, emptyCopy: false, chromeOnly: false },
      notice: LISTING_BLANK_CONTENT_NOTICE,
    };
  }
  return {
    state: "unknown",
    signals: { contentItemCount: 0, emptyCopy: false, chromeOnly: true },
    notice: LISTING_UNKNOWN_NOTICE,
  };
}

/** Live ADAM English/German missing-object pages (ILIAS 10 Failure Message). */
export function isAdamFailurePage(snapshot: Pick<PageSnapshot, "text" | "title" | "html">): boolean {
  const title = snapshot.title ?? "";
  const text = snapshot.text ?? "";
  const haystack = `${title}\n${text}`;
  if (/the requested page could not be found/i.test(haystack)) {
    return true;
  }
  if (/failure message/i.test(title) && /could not be found|nicht gefunden/i.test(haystack)) {
    return true;
  }
  if (/die angeforderte seite konnte nicht gefunden werden/i.test(haystack)) {
    return true;
  }
  if (/objekt konnte nicht gefunden/i.test(haystack) || /\bobject not found\b/i.test(haystack) || /\bkein objekt\b/i.test(haystack)) {
    return true;
  }
  if (
    (/keine berechtigung/i.test(haystack) || /permission denied/i.test(haystack)) &&
    (/failure message/i.test(haystack) || /fehler/i.test(title) || /nicht gefunden/i.test(haystack))
  ) {
    return true;
  }
  return false;
}
