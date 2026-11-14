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
import { inferDates, parseAdamTimestamp } from "./deadlines.ts";
import { extractIdBlocks, parseUiItems } from "./ui-items.ts";
export { inferDates, exerciseDeadlineFromPage } from "./deadlines.ts";
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

  const currentRef = parseAdamRef(snapshot.url);
  const breadcrumbs = orderBreadcrumbs(
    snapshot.links
      .filter((link) => link.inBreadcrumb)
      .map((link) => linkToBreadcrumb(link))
      .filter((crumb): crumb is Breadcrumb => crumb !== undefined),
    currentRef?.refId,
  );

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
    const title = parsed.type === "poll" && isPollActionLabel(link.text)
      ? pollTitleNear(snapshot.html, link.href, parsed.refId)
      : cleanTitle(link.text) || parsed.refId;
    // ADR 0049: a card's "Open <title>" image link may precede its plain title link.
    if (existing && existing.type === parsed.type &&
      [`Open ${title}`, `Öffnen ${title}`, `${title} öffnen`].includes(existing.title)) {
      existing.title = title;
      continue;
    }
    // Same ref can appear as ilias.php?ref_id (unknown) and again with a typed href.
    // Keep the typed object so the citation is /go/{type}/{id}.
    if (existing && (existing.type !== "unknown" || parsed.type === "unknown")) {
      continue;
    }
    const crumbTrail = breadcrumbs.concat(current ? [toBreadcrumb(current)] : []);
    byRef.set(
      parsed.refId,
      toObject(parsed.type, parsed.refId, title, crumbTrail, provenanceBase(link.href)),
    );
  }
  // ADR 0049: inline Poll blocks render a vote form, often without a title link.
  // The form action names the poll ref; listing it never submits the form.
  for (const poll of inlinePollForms(snapshot.html)) {
    if ((current && poll.refId === current.refId) || byRef.get(poll.refId)?.type === "poll") {
      continue;
    }
    const crumbTrail = breadcrumbs.concat(current ? [toBreadcrumb(current)] : []);
    byRef.set(poll.refId, toObject("poll", poll.refId, poll.title, crumbTrail, provenanceBase(canonicalUrl("poll", poll.refId))));
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
    news: extractNewsArticles(snapshot, provenanceBase(snapshot.url), breadcrumbs),
    inferredDates: inferDates(text),
    iliasVersion: readIliasVersion(snapshot.text),
    text,
  };
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
    const text = cleanTitle(stripTags(match[2])) || ariaLinkLabel(match[0]);
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

/** Image-only card links carry their name in aria-label (ADR 0049). */
function ariaLinkLabel(anchorHtml: string): string {
  const label = anchorHtml.match(/^<a\b[^>]*\baria-label=["']([^"']+)["']/i)?.[1];
  return label ? cleanTitle(decodeAdamHref(label)) : "";
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
  const seen = new Map(mainLinks.map((link, index) => [`${link.href}\n${link.text}\n${link.inBreadcrumb}`, index]));
  for (const link of frameLinks) {
    const key = `${link.href}\n${link.text}\n${link.inBreadcrumb}`;
    const existing = seen.get(key);
    if (existing !== undefined) {
      if (merged[existing].inChrome && !link.inChrome) merged[existing] = link;
      continue;
    }
    seen.set(key, merged.length);
    merged.push(link);
  }
  return merged;
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

  const pushItem = (
    title: string,
    _summaryText: string,
    chunkHtml: string,
    chunkHrefs: string[],
    known: { summary?: string; createdAt?: string; newsId?: string } = {},
  ) => {
    const headline = cleanTitle(title);
    if (!headline || isNewsLabel(headline)) {
      return;
    }
    const hrefTyped =
      chunkHrefs.map((href) => typedAdamRef(href)).find((ref) => ref !== undefined) ?? pageTyped;
    const datetime = known.createdAt ?? chunkHtml.match(/datetime=["']([^"']+)["']/i)?.[1];
    const bodyText = cleanTitle(known.summary ?? stripTags(chunkHtml)) || headline;
    const url = hrefTyped ? canonicalUrl(hrefTyped.type, hrefTyped.refId) : snapshot.url;
    // Distinct ILIAS news can share a title (repeated "File: …" notices): key on news_id when known.
    const key = known.newsId ? `news:${known.newsId}` : `${url}\n${headline}`;
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

  // #118: ILIAS 10.12 course News is a `block_news_{id}` panel of KS UI items
  // (title, description, "Date" property), not <article>s.
  for (const block of extractIdBlocks(snapshot.html, /^block_news_\d+$/)) {
    for (const item of parseUiItems(block)) {
      if (!item.title || isNewsLabel(item.title)) continue;
      const date = item.properties.find((property) => /^(?:date|datum)$/i.test(property.name))?.value;
      const createdAt = date ? parseAdamTimestamp(date, new Date(provenance.fetchedAt)) : undefined;
      const newsId = item.href?.match(/[?&]news_id=(\d+)/)?.[1];
      pushItem(item.title, "", "", [], { summary: item.description ?? item.title, createdAt, newsId });
    }
  }

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

const POLL_ACTION_LABEL = /^(?:vote|abstimmen|stimme abgeben|submit vote|show results|results|ergebnisse(?: anzeigen)?|resultate|teilnehmen|participate)?$/i;

function isPollActionLabel(text: string): boolean {
  return POLL_ACTION_LABEL.test(cleanTitle(text));
}

/**
 * Inline poll forms inside the page content (ADR 0049). Chrome before `<main>`
 * and after `</main>` is ignored when a main element exists.
 */
export function inlinePollForms(html: string): Array<{ refId: RefId; title: string }> {
  const mainStart = html.search(/<main\b/i);
  const mainEnd = html.search(/<\/main>/i);
  const found: Array<{ refId: RefId; title: string }> = [];
  const seen = new Set<RefId>();
  for (const match of html.matchAll(/<form\b[^>]*\baction=["']([^"']+)["'][^>]*>/gi)) {
    const index = match.index ?? 0;
    if (mainStart >= 0 && (index < mainStart || (mainEnd >= 0 && index > mainEnd))) continue;
    const parsed = parseAdamRef(decodeAdamHref(match[1]));
    if (parsed?.type !== "poll" || seen.has(parsed.refId)) continue;
    seen.add(parsed.refId);
    found.push({ refId: parsed.refId, title: pollTitleBefore(html, index, parsed.refId) });
  }
  return found;
}

function pollTitleNear(html: string, href: string, refId: RefId): string {
  const raw = html.indexOf(href);
  const index = raw >= 0 ? raw : html.indexOf(href.replace(/&/g, "&amp;"));
  return index >= 0 ? pollTitleBefore(html, index, refId) : `Poll ${refId}`;
}

/** Nearest heading or list-item title before the poll control, else a neutral label. */
function pollTitleBefore(html: string, index: number, refId: RefId): string {
  const window = html.slice(Math.max(0, index - 3_000), index);
  const titles = [
    ...window.matchAll(/<(h[2-5])\b[^>]*>([\s\S]*?)<\/\1>/gi),
    ...window.matchAll(/<(div|span|p)\b[^>]*class=["'][^"']*(?:il_ContainerItemTitle|il-item-title|ilBlockHeader|il-block-title)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi),
  ]
    .map((match) => ({ at: match.index ?? 0, text: cleanTitle(stripTags(match[2] ?? "")) }))
    .filter((entry) => entry.text && !isPollActionLabel(entry.text) && !shouldSkipTitle(entry.text))
    .sort((a, b) => a.at - b.at);
  return titles.at(-1)?.text ?? `Poll ${refId}`;
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

/**
 * Ancestors of the current page, root to parent. ILIAS 10.12 renders the
 * breadcrumb nav leaf-first in the DOM (current object first, repository root
 * last) and includes the current object itself (#122). Orient by those
 * anchors, drop the current object and repeated refs.
 */
export function orderBreadcrumbs(crumbs: Breadcrumb[], currentRefId?: RefId): Breadcrumb[] {
  const seen = new Set<RefId>();
  const unique = crumbs.filter((crumb) => !seen.has(crumb.refId) && Boolean(seen.add(crumb.refId)));
  const rootIndex = unique.findIndex((crumb) => crumb.type === "root");
  const leafFirst = unique.length > 1 && (
    (rootIndex >= 0 ? rootIndex === unique.length - 1 && rootIndex > 0 : unique[0].refId === currentRefId)
  );
  const ordered = leafFirst ? [...unique].reverse() : unique;
  return ordered.filter((crumb) => crumb.refId !== currentRefId);
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
  const emptyCopy = hasDom ? snapshot.dom?.emptyCopy === true : isAdamEmptyContainerPage(snapshot);
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
  if (/\bdoes not exist\b/i.test(haystack) && hasFailureHtml(title, html)) {
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
