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

  const byRef = new Map<string, AdamObject>();
  for (const link of snapshot.links) {
    if (link.inChrome || link.inBreadcrumb || shouldSkipTitle(link.text)) {
      continue;
    }
    const parsed = parseAdamRef(decodeAdamHref(link.href));
    if (!parsed || parsed.type === "impr" || parsed.type === "root") {
      continue;
    }
    if (current && parsed.refId === current.refId) {
      continue;
    }
    const existing = byRef.get(parsed.refId);
    // Same ref can appear as ilias.php?ref_id (unknown) and again with a typed href.
    // Keep the typed object so the citation is /go/{type}/{id}.
    if (existing && (existing.type !== "unknown" || parsed.type === "unknown")) {
      continue;
    }
    const crumbTrail = breadcrumbs.concat(current ? [toBreadcrumb(current)] : []);
    byRef.set(
      parsed.refId,
      toObject(parsed.type, parsed.refId, cleanTitle(link.text) || parsed.refId, crumbTrail, provenanceBase(link.href)),
    );
  }
  const objects = [...byRef.values()];

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
    news: extractNews(snapshot, objects, provenanceBase(snapshot.url), breadcrumbs),
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
  const mainStart = html.search(/<main\b/i);
  const mainEnd = html.search(/<\/main>/i);
  const inMain = (index: number) =>
    mainStart >= 0 && index >= mainStart && (mainEnd < 0 || index <= mainEnd);
  // ILIAS 10 chrome: header/slates/metabar live before <main>; footer and the
  // mainbar nav are explicit blocks; breadcrumbs are a labelled nav.
  const chromeRanges = [
    ...matchRanges(html, /<header\b[\s\S]*?<\/header>/gi),
    ...matchRanges(html, /<footer\b[\s\S]*?<\/footer>/gi),
    ...matchRanges(html, /<nav[^>]*aria-label=["']Hauptnavigationsleiste["'][^>]*>[\s\S]*?<\/nav>/gi),
    ...matchRanges(html, /<nav[^>]*class=["'][^"']*\bil-mainbar\b[^"']*["'][^>]*>[\s\S]*?<\/nav>/gi),
  ];
  const breadcrumbRanges = matchRanges(
    html,
    /<nav[^>]*aria-label=["'](?:Brotkrumen|Breadcrumbs?)["'][^>]*>[\s\S]*?<\/nav>/gi,
  );
  const links: SnapshotLink[] = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const href = decodeAdamHref(match[1]);
    const text = cleanTitle(stripTags(match[2]));
    const index = match.index ?? 0;
    const chromeByPosition = mainStart >= 0 && !inMain(index);
    links.push({
      href,
      text,
      inChrome: chromeByPosition || inRanges(index, chromeRanges),
      inBreadcrumb: inRanges(index, breadcrumbRanges),
    });
  }
  return links;
}

function matchRanges(html: string, pattern: RegExp): Array<[number, number]> {
  return [...html.matchAll(pattern)].map((match) => {
    const start = match.index ?? 0;
    return [start, start + match[0].length];
  });
}

function inRanges(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
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

function extractNews(
  snapshot: PageSnapshot,
  objects: AdamObject[],
  provenance: Provenance,
  breadcrumbs: Breadcrumb[] = [],
): NewsItem[] {
  const articles = extractNewsArticles(snapshot, provenance, breadcrumbs);
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

/**
 * ADR 0018 (2026-10-02 news sideblock replay): label-only `News` blocks are
 * skipped, the headline wins over the first `<a>`, and the course comes only
 * from a typed href, the page URL, or the breadcrumb — never invented.
 * Honest-empty is preserved: no headlines means no items.
 */
function isNewsLabel(text: string): boolean {
  const label = text.trim().toLowerCase();
  return (
    label === "news" ||
    label === "nachrichten" ||
    label === "aktuelles" ||
    label === "neuigkeiten" ||
    label === "news / aktuell"
  );
}

function extractNewsArticles(
  snapshot: PageSnapshot,
  provenance: Provenance,
  breadcrumbs: Breadcrumb[] = [],
): NewsItem[] {
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  const pageTyped = typedAdamRef(snapshot.url);
  const breadcrumbCrs = breadcrumbs.find((crumb) => crumb.type === "crs")?.refId;
  // Course only from typed href / page URL / breadcrumb — never invented (ADR 0018).
  const pageCourseRefId = pageTyped?.type === "crs" ? pageTyped.refId : breadcrumbCrs;
  const pageFolderRefId = pageTyped?.type === "fold" ? pageTyped.refId : undefined;

  const pushItem = (title: string, summaryText: string, chunkHtml: string, chunkHrefs: string[]) => {
    const headline = cleanTitle(title);
    if (!headline || isNewsLabel(headline)) {
      return;
    }
    const hrefTyped =
      chunkHrefs.map((href) => typedAdamRef(href)).find((ref) => ref !== undefined) ?? pageTyped;
    const datetime = chunkHtml.match(/datetime=["']([^"']+)["']/i)?.[1];
    const bodyText = cleanTitle(stripTags(chunkHtml)) || headline;
    const url = hrefTyped ? canonicalUrl(hrefTyped.type, hrefTyped.refId) : snapshot.url;
    const key = `${url}\n${headline}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    items.push({
      title: headline,
      summary: bodyText.slice(0, 280),
      url,
      courseRefId: hrefTyped?.type === "crs" ? hrefTyped.refId : pageCourseRefId,
      folderRefId: hrefTyped?.type === "fold" ? hrefTyped.refId : pageFolderRefId,
      createdAt: datetime,
      updatedAt: datetime,
      accessClass: /authenticated users|registrierte nutzer/i.test(bodyText) ? "Authenticated Users" : undefined,
      author: authorFrom(bodyText),
      provenance: { ...provenance, sourceUrl: url },
    });
  };

  const articleBlocks = [...snapshot.html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map(
    (match) => match[1] ?? "",
  );
  for (const html of articleBlocks) {
    const headlines = [...html.matchAll(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/gi)];
    if (headlines.length > 0) {
      // Per-headline split: one item per h2-h4, label-only headlines skipped.
      let cursor = 0;
      const positions = headlines.map((headline) => headline.index ?? 0);
      positions.push(html.length);
      for (let index = 0; index < headlines.length; index += 1) {
        const headlineHtml = headlines[index]?.[1] ?? "";
        const headlineText = cleanTitle(stripTags(headlineHtml));
        const chunk = html.slice(positions[index] ?? 0, positions[index + 1] ?? html.length);
        const chunkHrefs = [...chunk.matchAll(/href=["']([^"']+)["']/gi)].map(
          (hrefMatch) => hrefMatch[1],
        );
        // Headline wins over the first <a>: prefer an href inside the headline itself.
        const headlineHrefs = [...headlineHtml.matchAll(/href=["']([^"']+)["']/gi)].map(
          (hrefMatch) => hrefMatch[1],
        );
        pushItem(headlineText, chunk, chunk, [...headlineHrefs, ...chunkHrefs]);
        cursor = positions[index + 1] ?? cursor;
      }
      continue;
    }
    const text = cleanTitle(stripTags(html));
    if (!text || isNewsLabel(text)) {
      continue;
    }
    const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((hrefMatch) => hrefMatch[1]);
    const linkText = cleanTitle(stripTags(html.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? ""));
    const title = linkText && !isNewsLabel(linkText) ? linkText : text.slice(0, 80);
    pushItem(title, html, html, hrefs);
  }

  const sideblocks = [
    ...snapshot.html.matchAll(
      /<(?:section|div)[^>]*(?:news|nachricht|aktuell)[^>]*>([\s\S]*?)<\/(?:section|div)>/gi,
    ),
  ].map((match) => match[1] ?? "");
  for (const html of sideblocks) {
    const headlines = [...html.matchAll(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/gi)];
    if (headlines.length === 0) {
      // Honest-empty: a label-only News container without headlines invents nothing.
      continue;
    }
    const positions = headlines.map((headline) => headline.index ?? 0);
    positions.push(html.length);
    for (let index = 0; index < headlines.length; index += 1) {
      const headlineHtml = headlines[index]?.[1] ?? "";
      const headlineText = cleanTitle(stripTags(headlineHtml));
      if (!headlineText || isNewsLabel(headlineText)) {
        continue;
      }
      const chunk = html.slice(positions[index] ?? 0, positions[index + 1] ?? html.length);
      const chunkHrefs = [...chunk.matchAll(/href=["']([^"']+)["']/gi)].map(
        (hrefMatch) => hrefMatch[1],
      );
      const headlineHrefs = [...headlineHtml.matchAll(/href=["']([^"']+)["']/gi)].map(
        (hrefMatch) => hrefMatch[1],
      );
      pushItem(headlineText, chunk, chunk, [...headlineHrefs, ...chunkHrefs]);
    }
  }

  return items.slice(0, 20);
}

/** Undo href entities so `cmdClass` survives `&amp;` in captured HTML. */
export function decodeAdamHref(href: string): string {
  return href.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#0*39;|&apos;/gi, "'");
}

/**
 * Typed ADAM ref from a href or page URL.
 * `unknown` (ref_id with no type) is not a citation — callers must not invent `/go/unknown/`.
 */
function typedAdamRef(input: string | undefined): { type: AdamObjectType; refId: RefId } | undefined {
  if (!input) {
    return undefined;
  }
  const parsed = parseAdamRef(decodeAdamHref(input));
  if (!parsed || parsed.type === "unknown" || parsed.type === "impr" || parsed.type === "root") {
    return undefined;
  }
  return parsed;
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

/**
 * ADR 0005/0007: classify from DOM signals first. Parsed link count must not
 * promote chrome leaks into `ok` when the content area is blank, empty, or rowless.
 */
export function classifyListing(
  snapshot: PageSnapshot,
  keptCount: number,
): ListingClassification {
  const hasDom = snapshot.dom !== undefined;
  const domRows = snapshot.dom?.itemRows ?? 0;
  const emptyCopy = isAdamEmptyContainerPage(snapshot) || snapshot.dom?.emptyCopy === true;
  // Visible rows beat empty copy: a stray empty widget or frame must never hide content.
  if (domRows > 0) {
    if (keptCount > 0) {
      return {
        state: "ok",
        signals: { contentItemCount: keptCount, emptyCopy, chromeOnly: false },
      };
    }
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
  // HTML fixtures without a DOM probe: parseable non-chrome links are the listing.
  if (keptCount > 0 && !hasDom) {
    return {
      state: "ok",
      signals: { contentItemCount: keptCount, emptyCopy, chromeOnly: false },
    };
  }
  return {
    state: "unknown",
    signals: { contentItemCount: 0, emptyCopy: false, chromeOnly: true },
    notice: LISTING_UNKNOWN_NOTICE,
  };
}

/** Empty/unknown listings never carry children — zero fake trees (ADR 0005/0007). */
export function listingItemsOrEmpty<T>(items: T[], classified: ListingClassification): T[] {
  return classified.state === "ok" ? items : [];
}

/** Live ADAM English/German missing-object pages (ILIAS 10 Failure Message). ADR 0018. */
export function isAdamFailurePage(snapshot: Pick<PageSnapshot, "text" | "title" | "html">): boolean {
  if (isAdamPermissionPage(snapshot)) {
    return false;
  }
  const title = snapshot.title ?? "";
  const text = snapshot.text ?? "";
  const html = snapshot.html ?? "";
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
  // ADR 0018 live-findings 2026-10-02: absent-object copy seen on live failure pages.
  if (/\bdoes not exist\b/i.test(haystack)) {
    return true;
  }
  if (/\bno such (object|page|resource)\b/i.test(haystack)) {
    return true;
  }
  // Bare "existiert nicht" is too broad (course prose can negate other subjects),
  // so scope it to objekt/requested-page context agreeing with the failure page.
  if (/(objekt|angeforderte? (seite|objekt|ressource)|requested (page|object|resource))[^.]{0,80}existiert nicht/i.test(haystack)) {
    return true;
  }
  // Weak absent copy needs failure-HTML corroboration so course prose that
  // mentions availability does not read as a missing object (ADR 0018).
  if (/nicht vorhanden/i.test(haystack) && hasFailureHtml(title, html)) {
    return true;
  }
  if (/nicht verf[üu]gbar/i.test(haystack) && hasFailureHtml(title, html)) {
    return true;
  }
  if (/\binvalid\s+(ref|reference|object)\b/i.test(haystack) && hasFailureHtml(title, html)) {
    return true;
  }
  if (/ung[üu]ltig/i.test(haystack) && hasFailureHtml(title, html)) {
    return true;
  }
  // Failure-HTML corroboration: ILIAS failure chrome plus a weak missing hint.
  if (
    hasFailureHtml(title, html) &&
    /\bnot found\b|nicht gefunden|existiert nicht|does not exist|no such object/i.test(haystack)
  ) {
    return true;
  }
  return false;
}

/**
 * ADR 0018: failure-HTML corroboration for weak absent copy. ILIAS 10 renders
 * missing-object pages inside a failure/alert container; course prose alone
 * must not count without that chrome.
 */
function hasFailureHtml(title: string, html: string): boolean {
  return /failure message/i.test(title) || /ilFailure|failure-message|alert-danger|failureMessage/i.test(html);
}

/**
 * Authenticated permission-denied pages — must not be reported as not_found (ADR 0016).
 */
export function isAdamPermissionPage(snapshot: Pick<PageSnapshot, "text" | "title" | "html">): boolean {
  const title = snapshot.title ?? "";
  const text = snapshot.text ?? "";
  const haystack = `${title}\n${text}`;
  return (
    /keine berechtigung/i.test(haystack) ||
    /permission denied/i.test(haystack) ||
    /you do not have permission/i.test(haystack) ||
    /sie haben keine berechtigung/i.test(haystack)
  );
}
