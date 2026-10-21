import {
  AdamError,
  assertReadableObjectType,
  extractLocalFileText,
  isDeniedObjectType,
  looksLikeHtml,
  MAX_PAGE_CHARS,
  objectUrl,
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
import { saveLocalDownload, downloadDirectory, type LocalDownload } from "./local-download.ts";
import { filenameFromContentDisposition } from "./download-metadata.ts";
export { filenameFromContentDisposition } from "./download-metadata.ts";
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
import { pageHeading, parseForumPage, resolveForumThreadUrl, threadIdFromHref } from "./forum-parse.ts";
import { createPlaywrightSession } from "./playwright-session.ts";
import type { AdamBrowserSession, PageSnapshot, SessionStatus } from "./session-types.ts";
import { SnapshotPagination } from "./snapshot-pagination.ts";
import { SharedOperation, throwIfAborted, waitForSignal } from "./request-lifecycle.ts";

export type BrowserProviderOptions = {
  session?: AdamBrowserSession;
  origin?: string;
  /** Test seam for deterministic cache expiry. */
  clock?: () => number;
  /** Test seam; production enrolled walks have a two-minute elapsed-time budget. */
  walkTimeoutMs?: number;
};

/** Dashboard + enrolled courses/folders/exercises. Not Magazin, not robots-disallowed GUIs. */
const MAX_LIVE_PAGES = 48;
export const MAX_WALK_MS = 120_000;
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
  partialReason?: "time_budget";
  partialReasons?: Array<"time_budget" | "page_budget" | "unreadable_page" | "unknown_listing">;
};

export const WALK_PARTIAL_NOTICE =
  "Walk was partial: some pages were unreadable or the page/time budget was reached. Results may be incomplete.";

type WalkPaginated<T> = Paginated<T> & { partial?: boolean; skipped?: number; notice?: string; partialReason?: "time_budget" };

function withWalkState<T>(page: Paginated<T>, walk: WalkResult): WalkPaginated<T> {
  return walk.partial ? { ...page, ...walkMetadata(walk) } : page;
}

function walkMetadata(walk: WalkResult): object {
  return walk.partial ? { partial: true, skipped: walk.skipped, notice: WALK_PARTIAL_NOTICE, ...(walk.partialReason ? { partialReason: walk.partialReason } : {}), ...(walk.partialReasons ? { partialReasons: walk.partialReasons } : {}) } : {};
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
  private readonly clock: () => number;
  private readonly pagination: SnapshotPagination;
  private readonly walkTimeoutMs: number;
  private metadataExpiresAt = 0;
  /** Identity-sensitive; cleared on login() / close() (ADR 0015). */
  private readonly typeByRefId = new Map<RefId, AdamObjectType>();
  /** Listing-derived file metadata for download-abort getFile; cleared on login() / close(). */
  private readonly fileByRefId = new Map<RefId, FileObject>();
  /**
   * PERF-1 / ADR 0015: enrolled walk memo owned by this provider instance.
   * Invalidated on login() and close() with type/file maps; cancelled/unauthorized/forbidden/stale_id walks never memoize.
   */
  private readonly walks = new Map<string, { result: WalkResult; fetchedAt: number }>();
  private readonly walkInflight = new Map<string, SharedOperation<WalkResult>>();
  /** Refresh detaches reuse keys, but session invalidation must still cancel their work. */
  private readonly ownedWalks = new Set<SharedOperation<WalkResult>>();
  private readonly ownedPages = new Set<SharedOperation<PageSnapshot>>();
  /** Bumped on clear so an in-flight walk cannot re-seed the memo after login/close. */
  private walkGeneration = 0;
  /**
   * Typed same-ref page opens for this generation. get_course, list_children, and list_files
   * often ask for the same URL; reuse the snapshot instead of navigating again.
   * Unknown landings are not stored. Cleared with the walk memo on login()/close() (ADR 0015).
   * Not a second walk memo: cancelled / unauthorized / forbidden / stale_id still throw and are not stored.
   */
  private pageByUrl = new Map<string, { snapshot: PageSnapshot; fetchedAt: number }>();
  private pageInflight = new Map<string, SharedOperation<PageSnapshot>>();
  private snapshotFetchedAt = new WeakMap<PageSnapshot, string>();
  private catalogBySnapshot = new WeakMap<PageSnapshot, ExtractedCatalog>();

  constructor(options: BrowserProviderOptions = {}) {
    this.origin = options.origin ?? defaultOrigin();
    this.sessionHandle = options.session;
    this.injected = Boolean(options.session);
    this.clock = options.clock ?? Date.now;
    this.pagination = new SnapshotPagination(this.clock);
    this.walkTimeoutMs = options.walkTimeoutMs ?? MAX_WALK_MS;
  }

  async status(): Promise<SessionStatus> {
    const status = await this.session().status();
    if (!status.loggedIn) this.clearSessionCaches();
    return status;
  }

  async login(timeoutMs?: number, signal?: AbortSignal, onProgress?: ProgressReporter): Promise<SessionStatus> {
    // ADR 0015: session change invalidates walk memo + identity-sensitive type/file maps.
    this.clearSessionCaches();
    return this.session().loginInteractively(timeoutMs, { signal, onProgress });
  }

  async close(): Promise<void> {
    this.clearSessionCaches();
    if (this.sessionHandle) {
      await this.sessionHandle.close();
    }
  }

  /**
   * Drop walk memo/inflight, type/file maps, and bump generation so a racing walk cannot
   * rememoize or repopulate type/file caches (ADR 0015).
   * Ordinary reads must not call this.
   */
  private clearSessionCaches(): void {
    this.walkGeneration += 1;
    this.walks.clear();
    for (const operation of this.ownedWalks) operation.cancel();
    this.walkInflight.clear();
    this.pageByUrl.clear();
    for (const operation of this.ownedPages) operation.cancel();
    this.pageInflight.clear();
    this.snapshotFetchedAt = new WeakMap();
    this.catalogBySnapshot = new WeakMap();
    this.typeByRefId.clear();
    this.fileByRefId.clear();
    this.metadataExpiresAt = 0;
    this.pagination.clear();
  }

  /** True when generation still matches — false after login()/close() cleared caches. */
  private cachesCurrent(generation: number): boolean {
    return generation === this.walkGeneration;
  }

  private async assertSessionEnabled(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (await this.session().explicitlyLoggedOut?.()) {
      this.clearSessionCaches();
      throw new AdamError("unauthorized", "ADAM was explicitly logged out. Run adam-mcp login to reconnect.", false);
    }
    throwIfAborted(signal);
    if (this.clock() >= this.metadataExpiresAt) {
      this.typeByRefId.clear();
      this.fileByRefId.clear();
      this.metadataExpiresAt = this.clock() + 60_000;
      for (const [url, page] of this.pageByUrl) {
        if (this.clock() - page.fetchedAt >= 60_000) this.pageByUrl.delete(url);
      }
      for (const [scope, walk] of this.walks) {
        if (this.clock() - walk.fetchedAt >= 60_000) this.walks.delete(scope);
      }
    }
  }

  private prepareDiscovery(options?: ListOptions): void {
    if (options?.courseRefId !== undefined && !/^\d+$/.test(options.courseRefId)) throw new AdamError("unsupported_type", "courseRefId must be an enrolled course ID from adam_list_courses.", false);
    if (options?.refresh && options.cursor !== undefined) throw new AdamError("stale_id", "Refresh starts a new listing. Omit cursor.", false);
    if (!options?.refresh) return;
    // Detach old work without cancelling other callers or deleting their cursors.
    this.walkGeneration += 1;
    this.walks.clear();
    this.walkInflight.clear();
    this.pageByUrl.clear();
    this.pageInflight.clear();
    this.typeByRefId.clear();
    this.fileByRefId.clear();
    this.metadataExpiresAt = this.clock() + 60_000;
  }

  private fetchedAt(snapshot: PageSnapshot): string {
    return this.snapshotFetchedAt.get(snapshot) ?? now();
  }

  private catalog(snapshot: PageSnapshot): ExtractedCatalog {
    let catalog = this.catalogBySnapshot.get(snapshot);
    if (!catalog) {
      catalog = extractCatalog(snapshot, this.fetchedAt(snapshot));
      this.catalogBySnapshot.set(snapshot, catalog);
    }
    return catalog;
  }

  async listCourses(options?: ListOptions): Promise<Paginated<AdamObject>> {
    throwIfCancelled(options?.signal);
    await this.assertSessionEnabled(options?.signal);
    const continuation = this.pagination.continue<AdamObject>("courses", options);
    if (continuation) return continuation;
    const snapshot = await this.openAuthorized(this.origin, options?.signal);
    const catalog = this.catalog(snapshot);
    const courses = uniqueByRef(catalog.objects.filter((item) => item.type === "crs" && !isDeniedObjectType(item.type)));
    const classified = classifyListing(snapshot, courses.length);
    const page = this.pagination.first("courses", listingItemsOrEmpty(courses, classified), options, { listingState: classified.state, listingSignals: classified.signals, notice: classified.notice });
    return withListingState(page, classified.state, classified.signals, classified.notice);
  }

  async getCourse(refId: RefId, options?: ObjectOpenOptions): Promise<AdamObject> {
    throwIfCancelled(options?.signal);
    await this.assertSessionEnabled(options?.signal);
    const generation = this.walkGeneration;
    const snapshot = await this.openObject(refId, options?.type ?? "crs", { cacheGeneration: generation, signal: options?.signal });
    const catalog = this.catalog(snapshot);
    this.rememberTypes(catalog, generation);
    const course = catalog.current?.type === "crs" ? catalog.current : catalog.objects.find((item) => item.refId === refId && item.type === "crs");
    if (!course) {
      // ADR 0018: a live failure page beats an uncorroborated same-ref hit — absent
      // stays not_found. A resolved same-ref fold still reports unsupported_type below,
      // and a different typed landing stays stale_id from openAuthorizedOnce (ADR 0016).
      if (isAdamFailurePage(snapshot)) {
        throw new AdamError("not_found", `ref_id ${refId} did not resolve to a course in the browser session.`);
      }
      const sameRef =
        catalog.current?.refId === refId
          ? catalog.current
          : catalog.objects.find((item) => item.refId === refId);
      if (sameRef && sameRef.type !== "unknown" && sameRef.type !== "crs") {
        throw new AdamError("unsupported_type", `ref_id ${refId} is ${sameRef.type}, not a course.`);
      }
      throw new AdamError("not_found", `ref_id ${refId} did not resolve to a course in the browser session.`);
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
    await this.assertSessionEnabled(options?.signal);
    const key = `children:${refId}:${options?.type ?? ""}`;
    const continuation = this.pagination.continue<AdamObject>(key, options);
    if (continuation) return continuation;
    const generation = this.walkGeneration;
    const snapshot = await this.openObject(refId, options?.type, {
      listingFastFail: true,
      cacheGeneration: generation,
      signal: options?.signal,
    });
    const catalog = this.catalog(snapshot);
    this.rememberTypes(catalog, generation);
    const children = catalog.objects.filter((item) => item.refId !== refId && !isDeniedObjectType(item.type));
    const classified = classifyListing(snapshot, children.length);
    const page = this.pagination.first(key, listingItemsOrEmpty(children, classified), options, { listingState: classified.state, listingSignals: classified.signals, notice: classified.notice });
    return withListingState(page, classified.state, classified.signals, classified.notice);
  }

  async readPage(refId: RefId, options?: ObjectOpenOptions): Promise<PageContent> {
    throwIfCancelled(options?.signal);
    await this.assertSessionEnabled(options?.signal);
    const generation = this.walkGeneration;
    const snapshot = await this.openObject(refId, options?.type, { cacheGeneration: generation, signal: options?.signal });
    const catalog = this.catalog(snapshot);
    this.rememberTypes(catalog, generation);
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
    await this.assertSessionEnabled(options?.signal);
    const key = `files:${refId}:${options?.type ?? ""}`;
    const continuation = this.pagination.continue<FileObject>(key, options);
    if (continuation) return continuation;
    const generation = this.walkGeneration;
    const snapshot = await this.openObject(refId, options?.type, {
      listingFastFail: true,
      cacheGeneration: generation,
      signal: options?.signal,
    });
    const catalog = this.catalog(snapshot);
    this.rememberTypes(catalog, generation);
    const direct = catalog.files.filter((item) => item.refId !== refId);
    const nested = catalog.objects.filter((item): item is FileObject => item.type === "file");
    const files = direct.length > 0 ? direct : nested;
    // Files filtered to zero while the container list hydrated is complete + [] (ADR 0005).
    const hydrated = catalog.objects.filter((item) => item.refId !== refId).length;
    const classified = classifyListing(snapshot, hydrated);
    const page = this.pagination.first(key, listingItemsOrEmpty(files, classified), options, { listingState: classified.state, listingSignals: classified.signals, notice: classified.notice });
    return withListingState(page, classified.state, classified.signals, classified.notice);
  }

  async getFile(refId: RefId, options?: ObjectOpenOptions): Promise<FileObject> {
    throwIfCancelled(options?.signal);
    await this.assertSessionEnabled(options?.signal);
    const generation = this.walkGeneration;
    try {
      // Capture listing cache before rememberTypes overwrites with the page parse.
      const priorListing = this.fileByRefId.get(refId);
      const snapshot = await this.openObject(refId, options?.type ?? "file", { cacheGeneration: generation, signal: options?.signal });
      const catalog = this.catalog(snapshot);
      this.rememberTypes(catalog, generation);
      const file =
        catalog.files.find((item) => item.refId === refId) ??
        (catalog.current?.type === "file" && catalog.current.refId === refId
          ? { ...catalog.current, type: "file" as const }
          : undefined);
      if (file) {
        const enriched = preferCachedFileTitle(file, priorListing);
        if (this.cachesCurrent(generation)) {
          this.fileByRefId.set(refId, enriched);
        }
        return enriched;
      }
      throw new AdamError("unsupported_type", `ref_id ${refId} did not resolve to a file.`);
    } catch (error) {
      if (isDownloadNavigationError(error)) {
        return this.fileFromDownloadAbort(refId, generation, options?.signal);
      }
      throw error;
    }
  }

  private async fileFromDownloadAbort(refId: RefId, generation = this.walkGeneration, signal?: AbortSignal): Promise<FileObject> {
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
        const probe = await this.session().probeAuthorized!(downloadUrl, { signal });
        probedTitle = filenameFromContentDisposition(probe.contentDisposition);
        probedMime = probe.contentType;
        probedSize = probe.contentLength;
      } catch {
        throwIfAborted(signal);
        // Cold probe is best-effort; fall back to cache / refId stub.
      }
    }
    throwIfAborted(signal);
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
    if (this.cachesCurrent(generation)) {
      this.fileByRefId.set(refId, file);
    }
    return file;
  }

  async extractFileText(
    refId: RefId,
    options?: { maxPages?: number; onProgress?: ProgressReporter } & ObjectOpenOptions,
  ): Promise<FileExtract> {
    throwIfCancelled(options?.signal);
    await this.assertSessionEnabled(options?.signal);
    const file = await this.getFile(refId, options);
    const origin = this.origin.replace(/\/$/, "");
    const candidates = uniqueUrls([`${origin}/goto_adam_file_${refId}_download.html`, file.url]);
    let sawHtml = false;
    let lastError: unknown;
    for (const url of candidates) {
      try {
        const fetched = await this.session().fetchAuthorized(url, { signal: options?.signal });
        const type = fetched.contentType ?? file.mimeType;
        if (looksLikeHtml(fetched.bytes, type) && !type?.toLowerCase().startsWith("text/plain")) {
          sawHtml = true;
          continue;
        }
        return extractLocalFileText(file, fetched.bytes, type, options?.maxPages, options?.signal);
      } catch (error) {
        if (error instanceof AdamError && error.code === "cancelled") throw error;
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

  /** CLI only: no download method is advertised through AdamProvider or MCP. */
  async downloadFile(refId: RefId, directory: string, options?: { signal?: AbortSignal }): Promise<LocalDownload> {
    // Reject invalid destinations before navigating an authenticated session.
    const destination = await downloadDirectory(directory);
    throwIfCancelled(options?.signal);
    await this.assertSessionEnabled(options?.signal);
    const file = await this.getFile(refId, { type: "file", signal: options?.signal });
    return saveLocalDownload(this.session(), file, destination, options?.signal);
  }

  async getExercise(refId: RefId, options?: ObjectOpenOptions): Promise<ExerciseObject> {
    throwIfCancelled(options?.signal);
    await this.assertSessionEnabled(options?.signal);
    const generation = this.walkGeneration;
    const snapshot = await this.openObject(refId, options?.type ?? "exc", { cacheGeneration: generation, signal: options?.signal });
    const catalog = this.catalog(snapshot);
    this.rememberTypes(catalog, generation);
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
    // Validate before any authenticated navigation, including opening the overview.
    const threadUrl = options?.threadId !== undefined
      ? resolveForumThreadUrl(this.origin, refId, options.threadId)
      : undefined;
    await this.assertSessionEnabled(options?.signal);
    // Fail-closed on client type hint: wrong hint must not return forum posts/meta.
    if (options?.type !== undefined && options.type !== "frm") {
      throw new AdamError(
        "unsupported_type",
        `Client type hint "${options.type}" is not frm; refusing forum read for ref_id ${refId}.`,
      );
    }
    const generation = this.walkGeneration;
    const snapshot = await this.openObject(refId, options?.type ?? "frm", { cacheGeneration: generation, signal: options?.signal });
    const catalog = this.catalog(snapshot);
    this.rememberTypes(catalog, generation);
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
    // An overview may land on a previous thread. Only that exact identity can supply bodies.
    let posts = threadIdFromHref(snapshot.url) === options.threadId ? parsed.posts : [];
    let threadTitle = threads.find((thread) => thread.threadId === options.threadId)?.title;
    if (posts.length === 0) {
      try {
        const threadSnapshot = await this.openAuthorized(threadUrl!, options.signal);
        if (parseAdamRef(threadSnapshot.url)?.refId !== refId || threadIdFromHref(threadSnapshot.url) !== options.threadId) {
          throw new AdamError("stale_id", "ADAM opened a different or unidentified forum thread. Refresh the thread listing and retry.", false);
        }
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
    this.prepareDiscovery(options);
    throwIfCancelled(options?.signal);
    await this.assertSessionEnabled(options?.signal);
    if (!query.trim()) return this.pagination.first(`search:`, [], options);
    const key = `search:${query.trim().toLowerCase()}:course=${options?.courseRefId ?? ""}`;
    const continuation = this.pagination.continue<AdamObject>(key, options);
    if (continuation) return continuation;
    const needle = query.trim().toLowerCase();
    const walk = await this.collectLivePages(options?.onProgress, options?.signal, options?.courseRefId);
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
        if (options?.courseRefId && item.type === "crs" && item.refId !== options.courseRefId) continue;
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
    return withWalkState(this.pagination.first(key, uniqueByRef([...titleMatches, ...bodyMatches]), options, walkMetadata(walk)), walk);
  }

  async listCalendar(
    options?: { from?: string; to?: string } & ListOptions,
  ): Promise<WalkPaginated<CalendarEvent>> {
    this.prepareDiscovery(options);
    throwIfCancelled(options?.signal);
    await this.assertSessionEnabled(options?.signal);
    const key = `calendar:${options?.from ?? ""}:${options?.to ?? ""}:course=${options?.courseRefId ?? ""}`;
    const continuation = this.pagination.continue<CalendarEvent>(key, options);
    if (continuation) return continuation;
    const walk = await this.collectLivePages(options?.onProgress, options?.signal, options?.courseRefId);
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
    return withWalkState(this.pagination.first(key, preferCalendarEvents(filterRange(events, options?.from, options?.to)), options, walkMetadata(walk)), walk);
  }

  async listNews(options?: { since?: string } & ListOptions): Promise<WalkPaginated<NewsItem>> {
    this.prepareDiscovery(options);
    throwIfCancelled(options?.signal);
    await this.assertSessionEnabled(options?.signal);
    const since = options?.since ? Date.parse(options.since) : Number.NEGATIVE_INFINITY;
    if (Number.isNaN(since)) throw new AdamError("unsupported_type", "since must be an ISO timestamp.", false);
    const key = `news:${options?.since ?? ""}:course=${options?.courseRefId ?? ""}`;
    const continuation = this.pagination.continue<NewsItem>(key, options);
    if (continuation) return continuation;
    // A2-news-browser: long enrolled walk reports progress when onProgress is set (fixture parity).
    const walk = await this.collectLivePages(options?.onProgress, options?.signal, options?.courseRefId);
    const items = uniqueNews(walk.pages.flatMap((page) => page.catalog.news));
    const filtered = items.filter((item) => {
      const stamp = Date.parse(item.updatedAt ?? item.createdAt ?? "");
      return Number.isFinite(stamp) ? stamp >= since : options?.since === undefined;
    });
    return withWalkState(this.pagination.first(key, filtered, options, walkMetadata(walk)), walk);
  }

  private async collectLivePages(onProgress?: ProgressReporter, signal?: AbortSignal, courseRefId?: RefId): Promise<WalkResult> {
    throwIfAborted(signal);
    const scope = courseRefId ?? "all";
    // PERF-1 / ADR 0015: reuse enrolled walk across search / calendar / news.
    // Invalidation: login() + close(). Memo hit emits no progress.
    // Cancelled / unauthorized / forbidden / stale_id walks are never memoized (ADR 0011 / 0015 / 0016).
    const cached = this.walks.get(scope);
    if (cached && this.clock() - cached.fetchedAt < 60_000) {
      throwIfCancelled(signal);
      return cached.result;
    }
    this.walks.delete(scope);
    const existing = this.walkInflight.get(scope);
    if (existing && !existing.aborted) {
      return existing.join(signal, onProgress);
    }
    if (this.ownedWalks.size >= 32) throw new AdamError("provider_unavailable", "ADAM discovery queue is full. Retry after current discovery finishes.", true);
    const generation = this.walkGeneration;
    const inflight = new SharedOperation((workSignal, report) => this.walkLivePages(report, workSignal, generation, courseRefId)
      .then((pages) => {
        if (generation === this.walkGeneration && !workSignal.aborted && !pages.partial) {
          this.walks.set(scope, { result: pages, fetchedAt: this.clock() });
          while (this.walks.size > 32) this.walks.delete(this.walks.keys().next().value!);
        }
        return pages;
      }));
    void inflight.promise.finally(() => {
        this.ownedWalks.delete(inflight);
        if (this.walkInflight.get(scope) === inflight) {
          this.walkInflight.delete(scope);
        }
      }).catch(() => undefined);
    this.walkInflight.set(scope, inflight);
    this.ownedWalks.add(inflight);
    return inflight.join(signal, onProgress);
  }

  private async walkLivePages(
    onProgress: ProgressReporter | undefined,
    signal: AbortSignal | undefined,
    generation: number,
    courseRefId?: RefId,
  ): Promise<WalkResult> {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      controller.abort(new AdamError("provider_unavailable", "ADAM's two-minute read budget was reached before a usable listing. Retry or narrow the request.", true));
    }, this.walkTimeoutMs);
    try {
      return await this.walkLivePagesWithinBudget(onProgress, controller.signal, generation, () => expired, courseRefId);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  private async walkLivePagesWithinBudget(
    onProgress: ProgressReporter | undefined,
    signal: AbortSignal,
    generation: number,
    expired: () => boolean,
    courseRefId?: RefId,
  ): Promise<WalkResult> {
    const report = async (progress: number) => {
      if (!onProgress) {
        return;
      }
      await waitForSignal(Promise.resolve(onProgress({
        progress,
        total: MAX_LIVE_PAGES,
        message: `ADAM: page ${progress}/${MAX_LIVE_PAGES}`,
      })), signal);
    };

    const home = await this.openAuthorized(this.origin, signal);
    const homeCatalog = this.catalog(home);
    this.rememberTypes(homeCatalog, generation);
    const pages: LivePage[] = courseRefId ? [] : [retainWalkPage(home, homeCatalog)];
    await report(pages.length);
    const seen = new Set<string>(homeCatalog.current?.refId ? [homeCatalog.current.refId] : []);
    const queue: Array<{ type: AdamObjectType; refId: RefId }> = [];

    const enqueue = (type: AdamObjectType, refId: RefId) => {
      if (courseRefId && type === "crs" && refId !== courseRefId) return;
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
    if (courseRefId) {
      if (homeListing.state === "unknown") throw new AdamError("provider_unavailable", "Enrolled course scope could not be verified. Retry adam_list_courses.", true);
      const enrolled = listingItemsOrEmpty(homeCatalog.objects, homeListing);
      if (!enrolled.some((item) => item.type === "crs" && item.refId === courseRefId)) throw new AdamError("forbidden", "Requested course is not in the verified enrolled course listing. Choose a course from adam_list_courses.", false);
    }
    if (homeListing.state === "ok") {
      for (const item of homeCatalog.objects) {
        if (item.type === "crs" && (!courseRefId || item.refId === courseRefId)) {
          enqueue(item.type, item.refId);
        }
      }
    }

    let skipped = 0;
    while (queue.length > 0 && pages.length < MAX_LIVE_PAGES) {
      if (expired()) break;
      throwIfAborted(signal);
      const next = queue.shift();
      if (!next) {
        break;
      }
      try {
        // Prefer ADR 0004 typed open (listingFastFail) so wrong link types can retry once
        // instead of hard-skipping — same path as listChildren.
        const snapshot = await this.openObject(next.refId, next.type, {
          listingFastFail: true,
          cacheGeneration: generation,
          signal,
        });
        const catalog = this.catalog(snapshot);
        this.rememberTypes(catalog, generation);
        pages.push(retainWalkPage(snapshot, catalog));
        await report(pages.length);
        throwIfAborted(signal);
        const childCount = catalog.objects.filter(
          (item) => item.refId !== catalog.current?.refId && !isDeniedObjectType(item.type),
        ).length;
        const listing = classifyListing(snapshot, childCount);
        if (listing.state === "unknown" && (catalog.current?.type === "crs" || catalog.current?.type === "fold")) {
          skipped += 1;
        }
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
        if (expired()) { skipped += 1; break; }
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
      partial: expired() || homeListing.state === "unknown" || skipped > 0 || queue.length > 0,
      skipped,
      ...(expired() ? { partialReason: "time_budget" as const } : {}),
      partialReasons: [
        ...(expired() ? ["time_budget" as const] : []),
        ...(queue.length > 0 && pages.length >= MAX_LIVE_PAGES ? ["page_budget" as const] : []),
        ...(skipped > 0 ? ["unreadable_page" as const] : []),
        ...(homeListing.state === "unknown" ? ["unknown_listing" as const] : []),
      ],
    };
  }

  private rememberTypes(catalog: ExtractedCatalog, generation: number): void {
    if (!this.cachesCurrent(generation)) {
      return;
    }
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
    opts?: { listingFastFail?: boolean; cacheGeneration?: number; signal?: AbortSignal },
  ): Promise<PageSnapshot> {
    if (!/^\d+$/.test(refId)) {
      throw new AdamError("not_found", "ADAM ref_id must contain digits only.");
    }
    const generation = opts?.cacheGeneration ?? this.walkGeneration;
    const preferred = typeHint && typeHint !== "unknown" ? typeHint : this.typeByRefId.get(refId);
    const tried = new Set<AdamObjectType>();
    let lastNotFound: AdamError | undefined;
    // PERF-1: page-backed lists — preferred + ≤1 retry; no TYPE_PROBE_ORDER storm.
    const maxAttempts = opts?.listingFastFail ? 2 : TYPE_PROBE_ORDER.length + 1;

    const tryType = async (type: AdamObjectType): Promise<PageSnapshot | undefined> => {
      throwIfAborted(opts?.signal);
      if (tried.has(type)) {
        return undefined;
      }
      if (tried.size >= maxAttempts) {
        return undefined;
      }
      tried.add(type);
      assertReadableObjectType(type, refId);
      try {
        const snapshot = await this.openAuthorized(objectUrl(type, refId, this.origin), opts?.signal);
        const landed = parseAdamRef(snapshot.url);
        // Only cache when the landed object is the requested one (ADR 0005).
        // Folder GUIs render as ilias.php?ref_id=PARENT&item_ref_id=CHILD, which
        // now parses as unknown/CHILD — never cache that as the parent's type.
        // An unknown landing never confirms the probed type either: caching the
        // guess would poison later opens.
        if (
          landed &&
          landed.type !== "unknown" &&
          landed.refId === refId &&
          !isDeniedObjectType(landed.type) &&
          this.cachesCurrent(generation)
        ) {
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

  private async openAuthorized(url: string, signal?: AbortSignal): Promise<PageSnapshot> {
    throwIfAborted(signal);
    const generation = this.walkGeneration;
    const cached = this.pageByUrl.get(url);
    if (cached && this.cachesCurrent(generation) && this.clock() - cached.fetchedAt < 60_000) {
      return cached.snapshot;
    }
    const existing = this.pageInflight.get(url);
    if (existing && !existing.aborted && this.cachesCurrent(generation)) {
      return existing.join(signal);
    }
    const pending = new SharedOperation((workSignal) => this.openAuthorizedOnce(url, generation, workSignal));
    this.pageInflight.set(url, pending);
    this.ownedPages.add(pending);
    void pending.promise.finally(() => {
      this.ownedPages.delete(pending);
      if (this.pageInflight.get(url) === pending) {
        this.pageInflight.delete(url);
      }
    }).catch(() => undefined);
    return pending.join(signal);
  }

  private async openAuthorizedOnce(url: string, generation: number, signal: AbortSignal): Promise<PageSnapshot> {
    const parsed = parseAdamRef(url);
    if (parsed) {
      assertReadableObjectType(parsed.type, parsed.refId);
    }
    const snapshot = await this.session().open(url, { signal });
    throwIfAborted(signal);
    // Test/in-process sessions may reuse the same snapshot object on a fresh open.
    this.catalogBySnapshot.delete(snapshot);
    this.snapshotFetchedAt.set(snapshot, now());
    const landed = parseAdamRef(snapshot.url);
    if (landed) {
      assertReadableObjectType(landed.type, landed.refId);
    }
    if (parsed && landed && parsed.refId !== landed.refId && landed.type !== "unknown") {
      throw new AdamError(
        "stale_id",
        `ADAM opened ${landed.type}/${landed.refId} instead of the requested ref_id ${parsed.refId}. Refresh listings and retry with the current identity — this is not a missing object.`,
      );
    }
    if (isLoginSnapshot(snapshot)) {
      throw new AdamError(
        "unauthorized",
        "ADAM is showing the login page. Run adam_login or `npm run login` and complete SWITCH edu-ID in Chrome. Do not paste the password into chat.",
      );
    }
    if (isAdamPermissionPage(snapshot)) {
      throw new AdamError(
        "forbidden",
        `ADAM denied access to ${parsed?.refId ?? url}. Permission denied for this account — the object is not reported as missing.`,
      );
    }
    if (looksMissing(snapshot)) {
      throw new AdamError("not_found", `ADAM did not return an object for ${parsed?.refId ?? url}.`);
    }
    if (!this.injected && url.replace(/\/$/, "") === this.origin.replace(/\/$/, "") && !isLoggedInSnapshot(snapshot)) {
      throw new AdamError(
        "unauthorized",
        "The local Chrome profile is not signed in to ADAM. Run adam_login and complete SWITCH edu-ID in the browser window.",
      );
    }
    // Only a typed landing of this ref is reusable. An unknown landing must not
    // confirm the probed type or skip the next probe (ADR 0005 / 0018).
    if (
      this.cachesCurrent(generation) &&
      landed &&
      landed.type !== "unknown" &&
      (!parsed || parsed.refId === landed.refId)
    ) {
      const catalog = this.catalog(snapshot);
      const container = catalog.current?.type === "crs" || catalog.current?.type === "fold";
      const children = catalog.objects.filter((item) => item.refId !== catalog.current?.refId);
      if (!container || classifyListing(snapshot, children.length).state !== "unknown") {
        this.pageByUrl.set(url, { snapshot, fetchedAt: this.clock() });
        while (this.pageByUrl.size > 128) this.pageByUrl.delete(this.pageByUrl.keys().next().value!);
      }
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
    const key = `${item.url}\n${item.title}\n${item.updatedAt ?? item.createdAt ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
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


function filterRange(events: CalendarEvent[], from?: string, to?: string): CalendarEvent[] {
  const start = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
  const end = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
  return events.filter((event) => {
    const stamp = event.startsAt ? Date.parse(event.startsAt) : 0;
    return stamp >= start && stamp <= end;
  });
}
