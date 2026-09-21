import {
  AdamError,
  assertReadableObjectType,
  extractLocalFileText,
  isDeniedObjectType,
  looksLikeHtml,
  MAX_PAGE_CHARS,
  objectUrl,
  paginate,
  preferCalendarEvents,
  parseAdamRef,
  searchTitleHit,
  throwIfCancelled,
  withListingState,
  type AdamObject,
  type AdamObjectType,
  type AdamProvider,
  type CalendarEvent,
  type ExerciseObject,
  type ForumObject,
  type FileExtract,
  type FileObject,
  type ListOptions,
  type NewsItem,
  type ObjectOpenOptions,
  type PageContent,
  type Paginated,
  type ProgressReporter,
  type RefId,
} from "adam-core";
import { defaultOrigin } from "./config.ts";
import {
  extractCatalog,
  exerciseDeadlineFromPage,
  classifyListing,
  listingItemsOrEmpty,
  isAdamFailurePage,
  isAdamPermissionPage,
  isLoggedInSnapshot,
  isLoginSnapshot,
  type ExtractedCatalog,
} from "./extract.ts";
import { pageHeading, parseForumPage, resolveForumThreadUrl } from "./forum-parse.ts";
import { createPlaywrightSession } from "./playwright-session.ts";
import type { AdamBrowserSession, PageSnapshot, SessionStatus } from "./session-types.ts";

export type BrowserProviderOptions = {
  session?: AdamBrowserSession;
  origin?: string;
};

/** Dashboard + enrolled courses/folders/exercises. Not Magazin, not robots-disallowed GUIs. */
const MAX_LIVE_PAGES = 48;
/** Cap for getCourse embedded children; truncation is signaled when the listing is larger. */
export const MAX_COURSE_CHILDREN = 100;
const TYPE_PROBE_ORDER: AdamObjectType[] = ["crs", "fold", "file", "exc", "cat"];

/** Walk cache entry: catalog + provenance URLs only (no HTML/aria PageSnapshot body). */
export type LivePage = {
  url: string;
  title: string;
  catalog: ExtractedCatalog;
};

/** Drop full HTML/aria snapshot body after extract; keep objects, text, dates, news, provenance. */
export function retainWalkPage(snapshot: PageSnapshot, catalog: ExtractedCatalog): LivePage {
  return {
    url: snapshot.url,
    title: snapshot.title,
    catalog,
  };
}

/** Result of an enrolled-tree walk; partial means skipped pages or the page cap. */
export type WalkResult = {
  pages: LivePage[];
  partial: boolean;
  skipped: number;
};

export const WALK_PARTIAL_NOTICE =
  "Walk was partial: some pages were skipped or the page cap was reached. Results may be incomplete.";

type WalkPaginated<T> = Paginated<T> & { partial?: boolean; skipped?: number; notice?: string };

function withWalkState<T>(page: Paginated<T>, walk: WalkResult): WalkPaginated<T> {
  return walk.partial ? { ...page, partial: true, skipped: walk.skipped, notice: WALK_PARTIAL_NOTICE } : page;
}

/** Byte-ish proxy for retained walk pages (JSON length). */
export function walkRetentionByteProxy(page: LivePage): number {
  return Buffer.byteLength(JSON.stringify(page), "utf8");
}

/** Byte-ish proxy for a full live PageSnapshot (includes html). */
export function fullSnapshotByteProxy(snapshot: PageSnapshot): number {
  return Buffer.byteLength(JSON.stringify(snapshot), "utf8");
}

export class BrowserAdamProvider implements AdamProvider {
  readonly id = "browser" as const;
  private readonly origin: string;
  private sessionHandle: AdamBrowserSession | undefined;
  private readonly injected: boolean;
  private readonly typeByRefId = new Map<RefId, AdamObjectType>();
  /** Listing-derived file metadata for download-abort getFile fallback (title/mime/size). */
  private readonly fileByRefId = new Map<RefId, FileObject>();
  /**
   * PERF-1 / ADR 0015: enrolled walk memo owned by this provider instance.
   * Invalidated on login() and close(); cancelled/unauthorized/forbidden/stale_id walks never memoize.
   */
  private livePagesMemo: WalkResult | undefined;
  private livePagesInflight: Promise<WalkResult> | undefined;
  /** Bumped on clear so an in-flight walk cannot re-seed the memo after login/close. */
  private walkGeneration = 0;

  constructor(options: BrowserProviderOptions = {}) {
    this.origin = options.origin ?? defaultOrigin();
    this.sessionHandle = options.session;
    this.injected = Boolean(options.session);
  }

  async status(): Promise<SessionStatus> {
    return this.session().status();
  }

  async login(timeoutMs?: number): Promise<SessionStatus> {
    // ADR 0015: session change invalidates enrolled-walk memo + inflight ownership.
    this.clearWalkCache();
    return this.session().loginInteractively(timeoutMs);
  }

  async close(): Promise<void> {
    this.clearWalkCache();
    this.fileByRefId.clear();
    this.typeByRefId.clear();
    if (this.sessionHandle) {
      await this.sessionHandle.close();
    }
  }

  /** Drop memo + inflight; bump generation so a racing walk cannot rememoize. */
  private clearWalkCache(): void {
    this.walkGeneration += 1;
    this.livePagesMemo = undefined;
    this.livePagesInflight = undefined;
  }

  async listCourses(options?: ListOptions): Promise<Paginated<AdamObject>> {
    throwIfCancelled(options?.signal);
    const snapshot = await this.openAuthorized(this.origin);
    const catalog = extractCatalog(snapshot, now());
    const courses = uniqueByRef(catalog.objects.filter((item) => item.type === "crs" && !isDeniedObjectType(item.type)));
    const classified = classifyListing(snapshot, courses.length);
    const page = paginate(listingItemsOrEmpty(courses, classified), options);
    return withListingState(page, classified.state, classified.signals, classified.notice);
  }

  async getCourse(refId: RefId, options?: ObjectOpenOptions): Promise<AdamObject> {
    throwIfCancelled(options?.signal);
    const snapshot = await this.openObject(refId, options?.type ?? "crs");
    const catalog = extractCatalog(snapshot, now());
    this.rememberTypes(catalog);
    const course = catalog.current?.type === "crs" ? catalog.current : catalog.objects.find((item) => item.refId === refId && item.type === "crs");
    if (!course) {
      throw new AdamError("unsupported_type", `ref_id ${refId} did not resolve to a course in the browser session.`);
    }
    const allChildren = uniqueByRef(
      catalog.objects.filter((item) => item.refId !== refId && !isDeniedObjectType(item.type)),
    );
    // Classify on the full listing before the embed cap (ADR 0005 / 0015).
    const classified = classifyListing(snapshot, allChildren.length);
    const honest = listingItemsOrEmpty(allChildren, classified);
    const truncated = honest.length > MAX_COURSE_CHILDREN;
    const children = truncated ? honest.slice(0, MAX_COURSE_CHILDREN) : honest;
    return {
      ...course,
      children,
      listingState: classified.state,
      listingSignals: classified.signals,
      ...(classified.notice ? { notice: classified.notice } : {}),
      ...(truncated
        ? { truncated: true, totalChildrenHint: honest.length }
        : {}),
    };
  }

  async listChildren(refId: RefId, options?: ListOptions): Promise<Paginated<AdamObject>> {
    throwIfCancelled(options?.signal);
    const snapshot = await this.openObject(refId, options?.type, { listingFastFail: true });
    const catalog = extractCatalog(snapshot, now());
    this.rememberTypes(catalog);
    const children = catalog.objects.filter((item) => item.refId !== refId && !isDeniedObjectType(item.type));
    const classified = classifyListing(snapshot, children.length);
    const page = paginate(listingItemsOrEmpty(children, classified), options);
    return withListingState(page, classified.state, classified.signals, classified.notice);
  }

  async readPage(refId: RefId, options?: ObjectOpenOptions): Promise<PageContent> {
    throwIfCancelled(options?.signal);
    const snapshot = await this.openObject(refId, options?.type);
    const catalog = extractCatalog(snapshot, now());
    this.rememberTypes(catalog);
    const object = catalog.current ?? catalog.objects.find((item) => item.refId === refId);
    if (!object) {
      throw new AdamError("not_found", `No page could be read for ref_id ${refId}.`);
    }
    assertReadableObjectType(object.type, object.refId);
    if (object.type === "unknown") {
      throw new AdamError("not_found", `No page could be read for ref_id ${refId}.`);
    }
    return {
      ...object,
      text: catalog.text,
      inferredDates: catalog.inferredDates,
      truncated: snapshot.text.length > MAX_PAGE_CHARS,
    };
  }

  async listFiles(refId: RefId, options?: ListOptions): Promise<Paginated<FileObject>> {
    throwIfCancelled(options?.signal);
    const snapshot = await this.openObject(refId, options?.type, { listingFastFail: true });
    const catalog = extractCatalog(snapshot, now());
    this.rememberTypes(catalog);
    const direct = catalog.files.filter((item) => item.refId !== refId);
    const nested = catalog.objects.filter((item): item is FileObject => item.type === "file");
    const files = direct.length > 0 ? direct : nested;
    // Files filtered to zero while the container list hydrated is complete + [] (ADR 0005).
    const hydrated = catalog.objects.filter((item) => item.refId !== refId).length;
    const classified = classifyListing(snapshot, hydrated);
    const page = paginate(listingItemsOrEmpty(files, classified), options);
    return withListingState(page, classified.state, classified.signals, classified.notice);
  }

  async getFile(refId: RefId, options?: ObjectOpenOptions): Promise<FileObject> {
    throwIfCancelled(options?.signal);
    try {
      // Capture listing cache before rememberTypes overwrites with the page parse.
      const priorListing = this.fileByRefId.get(refId);
      const snapshot = await this.openObject(refId, options?.type ?? "file");
      const catalog = extractCatalog(snapshot, now());
      this.rememberTypes(catalog);
      const file =
        catalog.files.find((item) => item.refId === refId) ??
        (catalog.current?.type === "file" && catalog.current.refId === refId
          ? { ...catalog.current, type: "file" as const }
          : undefined);
      if (file) {
        const enriched = preferCachedFileTitle(file, priorListing);
        this.fileByRefId.set(refId, enriched);
        return enriched;
      }
      throw new AdamError("unsupported_type", `ref_id ${refId} did not resolve to a file.`);
    } catch (error) {
      if (isDownloadNavigationError(error)) {
        return this.fileFromDownloadAbort(refId);
      }
      throw error;
    }
  }

  private async fileFromDownloadAbort(refId: RefId): Promise<FileObject> {
    const sourceUrl = objectUrl("file", refId, this.origin);
    const cached = this.fileByRefId.get(refId);
    const origin = this.origin.replace(/\/$/, "");
    const downloadUrl = `${origin}/goto_adam_file_${refId}_download.html`;
    let probedTitle: string | undefined;
    let probedMime: string | undefined;
    let probedSize: number | undefined;
    const needsProbe =
      isWeakFileTitle(cached?.title, refId) || cached?.mimeType === undefined || cached?.sizeBytes === undefined;
    // HEAD only — never pull full bytes just for metadata (legacy sessions without probe skip).
    if (needsProbe && this.session().probeAuthorized) {
      try {
        const probe = await this.session().probeAuthorized!(downloadUrl);
        probedTitle = filenameFromContentDisposition(probe.contentDisposition);
        probedMime = probe.contentType;
        probedSize = probe.contentLength;
      } catch {
        // Cold probe is best-effort; fall back to cache / refId stub.
      }
    }
    const title = betterFileTitle(refId, cached?.title, probedTitle);
    const file: FileObject = {
      type: "file",
      refId,
      title,
      url: cached?.url || sourceUrl,
      breadcrumb: cached?.breadcrumb ?? [],
      mimeType: cached?.mimeType ?? probedMime,
      sizeBytes: cached?.sizeBytes ?? probedSize,
      provenance: {
        ...(cached?.provenance ?? {}),
        sourceUrl,
        fetchedAt: now(),
        provider: "browser",
        freshness: "live-browser-session",
      },
    };
    this.fileByRefId.set(refId, file);
    return file;
  }

  async extractFileText(
    refId: RefId,
    options?: { maxPages?: number; onProgress?: ProgressReporter } & ObjectOpenOptions,
  ): Promise<FileExtract> {
    throwIfCancelled(options?.signal);
    const file = await this.getFile(refId, options);
    const origin = this.origin.replace(/\/$/, "");
    const candidates = uniqueUrls([`${origin}/goto_adam_file_${refId}_download.html`, file.url]);
    let sawHtml = false;
    let lastError: unknown;
    for (const url of candidates) {
      try {
        const fetched = await this.session().fetchAuthorized(url);
        const type = fetched.contentType ?? file.mimeType;
        if (looksLikeHtml(fetched.bytes, type) && !type?.toLowerCase().startsWith("text/plain")) {
          sawHtml = true;
          continue;
        }
        return extractLocalFileText(file, fetched.bytes, type, options?.maxPages);
      } catch (error) {
        lastError = error;
      }
    }
    if (sawHtml) {
      throw new AdamError(
        "unsupported_type",
        "ADAM returned a web page instead of file bytes. Open the canonical ADAM URL in Chrome instead of sending the file to the model.",
      );
    }
    if (lastError instanceof AdamError) {
      throw lastError;
    }
    throw new AdamError("not_found", `Could not fetch extractable bytes for file ${refId}.`);
  }

  async getExercise(refId: RefId, options?: ObjectOpenOptions): Promise<ExerciseObject> {
    throwIfCancelled(options?.signal);
    const snapshot = await this.openObject(refId, options?.type ?? "exc");
    const catalog = extractCatalog(snapshot, now());
    this.rememberTypes(catalog);
    const object = catalog.current ?? catalog.objects.find((item) => item.refId === refId);
    if (!object) {
      throw new AdamError("not_found", `No exercise could be read for ref_id ${refId}.`);
    }
    assertReadableObjectType(object.type, object.refId);
    // AT5: type===exc fail-closed — never coerce unknown/other types into exercises.
    if (object.type !== "exc") {
      throw new AdamError("unsupported_type", `ref_id ${refId} is ${object.type}, not an exercise.`);
    }
    const deadline = exerciseDeadlineFromPage(catalog.text, catalog.inferredDates);
    return {
      ...object,
      type: "exc",
      units: [
        {
          title: object.title,
          ...(deadline ? { deadline } : {}),
          instructionText: catalog.text,
          ownStatus: "unknown",
        },
      ],
    };
  }

  async getForum(
    refId: RefId,
    options?: ObjectOpenOptions & { threadId?: string },
  ): Promise<ForumObject> {
    throwIfCancelled(options?.signal);
    // Fail-closed on client type hint: wrong hint must not return forum posts/meta.
    if (options?.type !== undefined && options.type !== "frm") {
      throw new AdamError(
        "unsupported_type",
        `Client type hint "${options.type}" is not frm; refusing forum read for ref_id ${refId}.`,
      );
    }
    const snapshot = await this.openObject(refId, options?.type ?? "frm");
    const catalog = extractCatalog(snapshot, now());
    this.rememberTypes(catalog);
    const object = catalog.current ?? catalog.objects.find((item) => item.refId === refId);
    if (!object) {
      throw new AdamError("not_found", `No forum could be read for ref_id ${refId}.`);
    }
    assertReadableObjectType(object.type, object.refId);
    // Fail-closed: type===frm — never coerce unknown/other types into forums (AT5 mirror).
    if (object.type !== "frm") {
      throw new AdamError("unsupported_type", `ref_id ${refId} is ${object.type}, not a forum.`);
    }
    const parsed = parseForumPage(snapshot);
    const threads = parsed.threads;
    if (!options?.threadId) {
      return { ...object, type: "frm", threads };
    }
    throwIfCancelled(options.signal);
    let posts = parsed.posts;
    let threadTitle = threads.find((thread) => thread.threadId === options.threadId)?.title;
    if (posts.length === 0) {
      const threadUrl = resolveForumThreadUrl(
        this.origin,
        refId,
        options.threadId,
        parsed.threadHrefs[options.threadId],
      );
      try {
        const threadSnapshot = await this.openAuthorized(threadUrl);
        const threadParsed = parseForumPage(threadSnapshot);
        posts = threadParsed.posts;
        threadTitle =
          threadTitle ??
          threadParsed.threads.find((thread) => thread.threadId === options.threadId)?.title ??
          pageHeading(threadSnapshot.html);
      } catch (error) {
        if (!(error instanceof AdamError && error.code === "not_found")) {
          throw error;
        }
      }
    }
    if (posts.length === 0) {
      throw new AdamError(
        "not_found",
        `No parseable posts for forum thread ${options.threadId} on ref_id ${refId}; refusing to invent post bodies.`,
      );
    }
    const title = threadTitle ?? posts[0]?.subject ?? options.threadId;
    const selected = threads.find((thread) => thread.threadId === options.threadId) ?? {
      threadId: options.threadId,
      title,
    };
    return {
      ...object,
      type: "frm",
      threads: [selected],
      selectedThread: {
        threadId: options.threadId,
        title,
        posts,
      },
    };
  }

  async search(query: string, options?: ListOptions): Promise<WalkPaginated<AdamObject>> {
    throwIfCancelled(options?.signal);
    const needle = query.trim().toLowerCase();
    const walk = await this.collectLivePages(options?.onProgress, options?.signal);
    const titleMatches: AdamObject[] = [];
    const bodyMatches: AdamObject[] = [];
    for (const { catalog } of walk.pages) {
      const filesByRef = new Map(catalog.files.map((file) => [file.refId, file]));
      if (
        catalog.current &&
        !isDeniedObjectType(catalog.current.type) &&
        catalog.current.type !== "root" &&
        catalog.text.toLowerCase().includes(needle)
      ) {
        const current = filesByRef.get(catalog.current.refId) ?? catalog.current;
        const titleHit = searchTitleHit(needle, current);
        (titleHit ? titleMatches : bodyMatches).push(current);
      }
      for (const item of catalog.objects) {
        if (isDeniedObjectType(item.type)) {
          continue;
        }
        const candidate = filesByRef.get(item.refId) ?? item;
        if (searchTitleHit(needle, candidate)) {
          titleMatches.push(candidate);
        }
      }
    }
    // AT3: title matches before page-body matches; enrolled walk only (collectLivePages).
    return withWalkState(paginate(uniqueByRef([...titleMatches, ...bodyMatches]), options), walk);
  }

  async listCalendar(
    options?: { from?: string; to?: string } & ListOptions,
  ): Promise<WalkPaginated<CalendarEvent>> {
    throwIfCancelled(options?.signal);
    const walk = await this.collectLivePages(options?.onProgress, options?.signal);
    const events: CalendarEvent[] = [];
    for (const page of walk.pages) {
      const { catalog } = page;
      const provenance = catalog.current?.provenance ?? {
        sourceUrl: page.url,
        fetchedAt: now(),
        provider: "browser" as const,
        freshness: "live-browser-session",
      };
      const objectRefId = catalog.current?.refId;
      const url = catalog.current?.url ?? page.url;

      // AT6: unlabeled / page-inferred dates stay source:page — never promote all dates on exc pages to exc.
      for (const date of catalog.inferredDates) {
        events.push({
          title: date.raw,
          ...(date.iso ? { startsAt: date.iso } : {}),
          source: "page",
          confidence: date.confidence,
          objectRefId,
          url,
          provenance,
        });
      }

      // Labeled exercise deadline only (AT5 labeling) → source:exc.
      if (catalog.current?.type === "exc") {
        const deadline = exerciseDeadlineFromPage(catalog.text, catalog.inferredDates);
        if (deadline) {
          events.push({
            title: `${catalog.current.title} deadline`,
            startsAt: deadline,
            source: "exc",
            confidence: "explicit",
            objectRefId: catalog.current.refId,
            url: catalog.current.url,
            provenance: catalog.current.provenance,
          });
        }
      }
    }
    // AT6: same event prefers exc > calendar > page.
    return withWalkState(paginate(preferCalendarEvents(filterRange(events, options?.from, options?.to)), options), walk);
  }

  async listNews(options?: { since?: string } & ListOptions): Promise<WalkPaginated<NewsItem>> {
    throwIfCancelled(options?.signal);
    // A2-news-browser: long enrolled walk reports progress when onProgress is set (fixture parity).
    const walk = await this.collectLivePages(options?.onProgress, options?.signal);
    const items = uniqueNews(walk.pages.flatMap((page) => page.catalog.news));
    const since = options?.since ? Date.parse(options.since) : Number.NEGATIVE_INFINITY;
    const filtered = items.filter((item) => {
      const stamp = Date.parse(item.updatedAt ?? item.createdAt ?? "");
      return Number.isFinite(stamp) ? stamp >= since : true;
    });
    return withWalkState(paginate(filtered, options), walk);
  }

  private async collectLivePages(onProgress?: ProgressReporter, signal?: AbortSignal): Promise<WalkResult> {
    throwIfCancelled(signal);
    // PERF-1 / ADR 0015: reuse enrolled walk across search / calendar / news.
    // Invalidation: login() + close(). Memo hit emits no progress.
    // Cancelled / unauthorized / forbidden / stale_id walks are never memoized (ADR 0011 / 0015 / 0016).
    if (this.livePagesMemo) {
      throwIfCancelled(signal);
      return this.livePagesMemo;
    }
    if (this.livePagesInflight) {
      return this.livePagesInflight;
    }
    const generation = this.walkGeneration;
    const inflight = this.walkLivePages(onProgress, signal)
      .then((pages) => {
        if (generation === this.walkGeneration) {
          this.livePagesMemo = pages;
        }
        return pages;
      })
      .finally(() => {
        if (this.livePagesInflight === inflight) {
          this.livePagesInflight = undefined;
        }
      });
    this.livePagesInflight = inflight;
    return inflight;
  }

  private async walkLivePages(onProgress?: ProgressReporter, signal?: AbortSignal): Promise<WalkResult> {
    const report = async (progress: number) => {
      if (!onProgress) {
        return;
      }
      await onProgress({
        progress,
        total: MAX_LIVE_PAGES,
        message: `news: page ${progress}/${MAX_LIVE_PAGES}`,
      });
    };

    const home = await this.openAuthorized(this.origin);
    const homeCatalog = extractCatalog(home, now());
    this.rememberTypes(homeCatalog);
    const pages: LivePage[] = [retainWalkPage(home, homeCatalog)];
    await report(pages.length);
    const seen = new Set<string>(homeCatalog.current?.refId ? [homeCatalog.current.refId] : []);
    const queue: Array<{ type: AdamObjectType; refId: RefId }> = [];

    const enqueue = (type: AdamObjectType, refId: RefId) => {
      if (isDeniedObjectType(type) || type === "file" || type === "impr" || type === "cat" || type === "root") {
        return;
      }
      if (type !== "crs" && type !== "fold" && type !== "exc") {
        return;
      }
      if (seen.has(refId)) {
        return;
      }
      seen.add(refId);
      queue.push({ type, refId });
    };

    const homeChildren = homeCatalog.objects.filter(
      (item) => item.refId !== homeCatalog.current?.refId && !isDeniedObjectType(item.type),
    );
    const homeListing = classifyListing(home, homeChildren.length);
    if (homeListing.state === "ok") {
      for (const item of homeCatalog.objects) {
        if (item.type === "crs") {
          enqueue(item.type, item.refId);
        }
      }
    }

    let skipped = 0;
    while (queue.length > 0 && pages.length < MAX_LIVE_PAGES) {
      throwIfCancelled(signal);
      const next = queue.shift();
      if (!next) {
        break;
      }
      try {
        // Prefer ADR 0004 typed open (listingFastFail) so wrong link types can retry once
        // instead of hard-skipping — same path as listChildren.
        const snapshot = await this.openObject(next.refId, next.type, { listingFastFail: true });
        const catalog = extractCatalog(snapshot, now());
        this.rememberTypes(catalog);
        pages.push(retainWalkPage(snapshot, catalog));
        await report(pages.length);
        throwIfCancelled(signal);
        const childCount = catalog.objects.filter(
          (item) => item.refId !== catalog.current?.refId && !isDeniedObjectType(item.type),
        ).length;
        const listing = classifyListing(snapshot, childCount);
        // PERF-1 / ADR 0005: unknown (and empty) — prune branch; never deepen from untrustworthy list.
        if (listing.state !== "ok") {
          continue;
        }
        if (catalog.current?.type === "crs" || catalog.current?.type === "fold") {
          for (const child of catalog.objects) {
            enqueue(child.type, child.refId);
          }
        }
      } catch (error) {
        if (
          error instanceof AdamError &&
          (error.code === "cancelled" ||
            error.code === "unauthorized" ||
            error.code === "forbidden" ||
            error.code === "stale_id")
        ) {
          // Do not skip+memoize cancel, auth, permission, or stale identity — surface (ADR 0015 / 0016).
          throw error;
        }
        skipped += 1;
        continue;
      }
    }
    return {
      pages,
      partial: homeListing.state === "unknown" || skipped > 0 || queue.length > 0,
      skipped,
    };
  }

  private rememberTypes(catalog: ExtractedCatalog): void {
    if (catalog.current && catalog.current.type !== "unknown" && !isDeniedObjectType(catalog.current.type)) {
      this.typeByRefId.set(catalog.current.refId, catalog.current.type);
    }
    for (const item of catalog.objects) {
      if (item.type !== "unknown" && !isDeniedObjectType(item.type)) {
        this.typeByRefId.set(item.refId, item.type);
      }
    }
    // Seed from objects, then catalog.files (fileHints); always merge with prior cache.
    for (const item of catalog.objects) {
      if (item.type === "file") {
        const next = { ...item, type: "file" as const };
        this.fileByRefId.set(item.refId, preferCachedFileTitle(next, this.fileByRefId.get(item.refId)));
      }
    }
    for (const file of catalog.files) {
      this.fileByRefId.set(file.refId, preferCachedFileTitle(file, this.fileByRefId.get(file.refId)));
    }
    if (catalog.current?.type === "file") {
      const next = { ...catalog.current, type: "file" as const };
      this.fileByRefId.set(
        catalog.current.refId,
        preferCachedFileTitle(next, this.fileByRefId.get(catalog.current.refId)),
      );
    }
  }

  private async openObject(
    refId: RefId,
    typeHint?: AdamObjectType,
    opts?: { listingFastFail?: boolean },
  ): Promise<PageSnapshot> {
    if (!/^\d+$/.test(refId)) {
      throw new AdamError("not_found", "ADAM ref_id must contain digits only.");
    }
    const preferred = typeHint && typeHint !== "unknown" ? typeHint : this.typeByRefId.get(refId);
    const tried = new Set<AdamObjectType>();
    let lastNotFound: AdamError | undefined;
    // PERF-1: page-backed lists — preferred + ≤1 retry; no TYPE_PROBE_ORDER storm.
    const maxAttempts = opts?.listingFastFail ? 2 : TYPE_PROBE_ORDER.length + 1;

    const tryType = async (type: AdamObjectType): Promise<PageSnapshot | undefined> => {
      if (tried.has(type)) {
        return undefined;
      }
      if (tried.size >= maxAttempts) {
        return undefined;
      }
      tried.add(type);
      assertReadableObjectType(type, refId);
      try {
        const snapshot = await this.openAuthorized(objectUrl(type, refId, this.origin));
        const landed = parseAdamRef(snapshot.url);
        // Only cache when the landed object is the requested one (ADR 0005).
        // Folder GUIs render as ilias.php?ref_id=PARENT&item_ref_id=CHILD, which
        // now parses as unknown/CHILD — never cache that as the parent's type.
        // An unknown landing never confirms the probed type either: caching the
        // guess would poison later opens.
        if (landed && landed.type !== "unknown" && landed.refId === refId && !isDeniedObjectType(landed.type)) {
          this.typeByRefId.set(refId, landed.type);
        }
        return snapshot;
      } catch (error) {
        if (error instanceof AdamError && error.code === "not_found") {
          lastNotFound = error;
          return undefined;
        }
        throw error;
      }
    };

    if (preferred) {
      const hit = await tryType(preferred);
      if (hit) {
        return hit;
      }
    }
    for (const type of TYPE_PROBE_ORDER) {
      const hit = await tryType(type);
      if (hit) {
        return hit;
      }
    }
    throw lastNotFound ?? new AdamError("not_found", `ADAM did not return an object for ${refId}.`);
  }

  private session(): AdamBrowserSession {
    if (!this.sessionHandle) {
      this.sessionHandle = createPlaywrightSession({ origin: this.origin });
    }
    return this.sessionHandle;
  }

  private async openAuthorized(url: string): Promise<PageSnapshot> {
    const parsed = parseAdamRef(url);
    if (parsed) {
      assertReadableObjectType(parsed.type, parsed.refId);
    }
    const snapshot = await this.session().open(url);
    const requested = parseAdamRef(url);
    const landed = parseAdamRef(snapshot.url);
    if (landed) {
      assertReadableObjectType(landed.type, landed.refId);
    }
    if (requested && landed && requested.refId !== landed.refId && landed.type !== "unknown") {
      throw new AdamError(
        "stale_id",
        `ADAM opened ${landed.type}/${landed.refId} instead of the requested ref_id ${requested.refId}. Refresh listings and retry with the current identity — this is not a missing object.`,
      );
    }
    if (isLoginSnapshot(snapshot)) {
      throw new AdamError(
        "unauthorized",
        "ADAM is showing the login page. Run adam_login or `npm run login` and complete SWITCH edu-ID in Chrome. Do not paste the password into chat.",
      );
    }
    if (isAdamPermissionPage(snapshot)) {
      const parsed = parseAdamRef(url);
      throw new AdamError(
        "forbidden",
        `ADAM denied access to ${parsed?.refId ?? url}. Permission denied for this account — the object is not reported as missing.`,
      );
    }
    if (looksMissing(snapshot)) {
      const parsed = parseAdamRef(url);
      throw new AdamError("not_found", `ADAM did not return an object for ${parsed?.refId ?? url}.`);
    }
    if (!this.injected && url.replace(/\/$/, "") === this.origin.replace(/\/$/, "") && !isLoggedInSnapshot(snapshot)) {
      throw new AdamError(
        "unauthorized",
        "The local Chrome profile is not signed in to ADAM. Run adam_login and complete SWITCH edu-ID in the browser window.",
      );
    }
    return snapshot;
  }
}

export function createBrowserProvider(options?: BrowserProviderOptions): BrowserAdamProvider {
  return new BrowserAdamProvider(options);
}

function now(): string {
  return new Date().toISOString();
}

function uniqueByRef(items: AdamObject[]): AdamObject[] {
  const seen = new Set<string>();
  const unique: AdamObject[] = [];
  for (const item of items) {
    if (seen.has(item.refId)) {
      continue;
    }
    seen.add(item.refId);
    unique.push(item);
  }
  return unique;
}

function uniqueUrls(urls: string[]): string[] {
  return [...new Set(urls)];
}


function uniqueNews(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const unique: NewsItem[] = [];
  for (const item of items) {
    if (seen.has(item.url)) {
      continue;
    }
    seen.add(item.url);
    unique.push(item);
  }
  return unique;
}

function looksMissing(snapshot: PageSnapshot): boolean {
  return isAdamFailurePage(snapshot);
}

function isDownloadNavigationError(error: unknown): boolean {
  return error instanceof Error && /download is starting|net::ERR_ABORTED|Download is starting/i.test(error.message);
}

function isWeakFileTitle(title: string | undefined, refId: RefId): boolean {
  if (!title) {
    return true;
  }
  const t = title.trim();
  if (!t || t === refId || /^\d+$/.test(t)) {
    return true;
  }
  return /^ADAM$/i.test(t) || /:\s*ADAM$/i.test(t);
}

/** Prefer a human listing title over a bare refId or chrome tab title. */
function betterFileTitle(refId: RefId, ...candidates: Array<string | undefined>): string {
  for (const c of candidates) {
    if (!isWeakFileTitle(c, refId)) {
      return c!.trim();
    }
  }
  return refId;
}

function preferCachedFileTitle(file: FileObject, cached: FileObject | undefined): FileObject {
  const title = betterFileTitle(file.refId, cached?.title, file.title);
  if (title === file.title && !cached?.mimeType && !cached?.sizeBytes) {
    return file;
  }
  return {
    ...file,
    title,
    mimeType: file.mimeType ?? cached?.mimeType,
    sizeBytes: file.sizeBytes ?? cached?.sizeBytes,
  };
}

export function filenameFromContentDisposition(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }
  const star = /filename\*=(?:UTF-8''|utf-8'')([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, "")).replace(/^.*[/\\]/, "") || undefined;
    } catch {
      // fall through
    }
  }
  const plain = /filename="([^"]+)"|filename=([^;]+)/i.exec(header);
  const raw = (plain?.[1] ?? plain?.[2])?.trim().replace(/^"|"$/g, "");
  if (!raw) {
    return undefined;
  }
  return raw.replace(/^.*[/\\]/, "") || undefined;
}

function filterRange(events: CalendarEvent[], from?: string, to?: string): CalendarEvent[] {
  const start = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
  const end = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
  return events.filter((event) => {
    const stamp = event.startsAt ? Date.parse(event.startsAt) : 0;
    return stamp >= start && stamp <= end;
  });
}
