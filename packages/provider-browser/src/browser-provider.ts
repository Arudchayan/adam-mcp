import {
  AdamError,
  assertReadableObjectType,
  extractLocalFileText,
  isDeniedObjectType,
  looksLikeHtml,
  objectUrl,
  paginate,
  preferCalendarEvents,
  parseAdamRef,
  withListingState,
  type AdamObject,
  type AdamObjectType,
  type AdamProvider,
  type CalendarEvent,
  type ExerciseObject,
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
  isAdamFailurePage,
  isLoggedInSnapshot,
  isLoginSnapshot,
  type ExtractedCatalog,
} from "./extract.ts";
import { createPlaywrightSession } from "./playwright-session.ts";
import type { AdamBrowserSession, PageSnapshot, SessionStatus } from "./session-types.ts";

export type BrowserProviderOptions = {
  session?: AdamBrowserSession;
  origin?: string;
};

/** Dashboard + enrolled courses/folders/exercises. Not Magazin, not robots-disallowed GUIs. */
const MAX_LIVE_PAGES = 48;
const MAX_COURSE_CHILDREN = 100;
const TYPE_PROBE_ORDER: AdamObjectType[] = ["crs", "fold", "file", "exc", "cat"];

type LivePage = {
  snapshot: PageSnapshot;
  catalog: ExtractedCatalog;
};

export class BrowserAdamProvider implements AdamProvider {
  readonly id = "browser" as const;
  private readonly origin: string;
  private sessionHandle: AdamBrowserSession | undefined;
  private readonly injected: boolean;
  private readonly typeByRefId = new Map<RefId, AdamObjectType>();

  constructor(options: BrowserProviderOptions = {}) {
    this.origin = options.origin ?? defaultOrigin();
    this.sessionHandle = options.session;
    this.injected = Boolean(options.session);
  }

  async status(): Promise<SessionStatus> {
    return this.session().status();
  }

  async login(timeoutMs?: number): Promise<SessionStatus> {
    return this.session().loginInteractively(timeoutMs);
  }

  async close(): Promise<void> {
    if (this.sessionHandle) {
      await this.sessionHandle.close();
    }
  }

  async listCourses(options?: ListOptions): Promise<Paginated<AdamObject>> {
    const snapshot = await this.openAuthorized(this.origin);
    const catalog = extractCatalog(snapshot, now());
    const courses = uniqueByRef(catalog.objects.filter((item) => item.type === "crs" && !isDeniedObjectType(item.type)));
    const page = paginate(courses, options);
    const classified = classifyListing(snapshot, courses.length);
    return withListingState(page, classified.state, classified.signals, classified.notice);
  }

  async getCourse(refId: RefId, options?: ObjectOpenOptions): Promise<AdamObject> {
    const snapshot = await this.openObject(refId, options?.type ?? "crs");
    const catalog = extractCatalog(snapshot, now());
    this.rememberTypes(catalog);
    const course = catalog.current?.type === "crs" ? catalog.current : catalog.objects.find((item) => item.refId === refId && item.type === "crs");
    if (!course) {
      throw new AdamError("unsupported_type", `ref_id ${refId} did not resolve to a course in the browser session.`);
    }
    const children = uniqueByRef(
      catalog.objects.filter((item) => item.refId !== refId && !isDeniedObjectType(item.type)),
    ).slice(0, MAX_COURSE_CHILDREN);
    return { ...course, children };
  }

  async listChildren(refId: RefId, options?: ListOptions): Promise<Paginated<AdamObject>> {
    const snapshot = await this.openObject(refId, options?.type);
    const catalog = extractCatalog(snapshot, now());
    this.rememberTypes(catalog);
    const children = catalog.objects.filter((item) => item.refId !== refId && !isDeniedObjectType(item.type));
    const page = paginate(children, options);
    const classified = classifyListing(snapshot, children.length);
    return withListingState(page, classified.state, classified.signals, classified.notice);
  }

  async readPage(refId: RefId, options?: ObjectOpenOptions): Promise<PageContent> {
    const snapshot = await this.openObject(refId, options?.type);
    const catalog = extractCatalog(snapshot, now());
    this.rememberTypes(catalog);
    const object = catalog.current ?? catalog.objects.find((item) => item.refId === refId);
    if (!object) {
      throw new AdamError("not_found", `No page could be read for ref_id ${refId}.`);
    }
    return {
      ...object,
      text: catalog.text,
      inferredDates: catalog.inferredDates,
    };
  }

  async listFiles(refId: RefId, options?: ListOptions): Promise<Paginated<FileObject>> {
    const snapshot = await this.openObject(refId, options?.type);
    const catalog = extractCatalog(snapshot, now());
    this.rememberTypes(catalog);
    const direct = catalog.files.filter((item) => item.refId !== refId);
    const nested = catalog.objects.filter((item): item is FileObject => item.type === "file");
    const files = direct.length > 0 ? direct : nested;
    const page = paginate(files, options);
    // Files filtered to zero while the container list hydrated is complete + [] (ADR 0005).
    const hydrated = catalog.objects.filter((item) => item.refId !== refId).length;
    const classified = files.length > 0 || hydrated > 0
      ? { state: "ok" as const, signals: classifyListing(snapshot, hydrated).signals, notice: undefined as string | undefined }
      : classifyListing(snapshot, 0);
    return withListingState(page, classified.state, classified.signals, classified.notice);
  }

  async getFile(refId: RefId, options?: ObjectOpenOptions): Promise<FileObject> {
    try {
      const snapshot = await this.openObject(refId, options?.type ?? "file");
      const catalog = extractCatalog(snapshot, now());
      this.rememberTypes(catalog);
      const file =
        catalog.files.find((item) => item.refId === refId) ??
        (catalog.current?.type === "file" && catalog.current.refId === refId
          ? { ...catalog.current, type: "file" as const }
          : undefined);
      if (file) {
        return file;
      }
      throw new AdamError("unsupported_type", `ref_id ${refId} did not resolve to a file.`);
    } catch (error) {
      if (isDownloadNavigationError(error)) {
        return {
          type: "file",
          refId,
          title: refId,
          url: objectUrl("file", refId, this.origin),
          breadcrumb: [],
          provenance: {
            sourceUrl: objectUrl("file", refId, this.origin),
            fetchedAt: now(),
            provider: "browser",
            freshness: "live-browser-session",
          },
        };
      }
      throw error;
    }
  }

  async extractFileText(
    refId: RefId,
    options?: { maxPages?: number; onProgress?: ProgressReporter } & ObjectOpenOptions,
  ): Promise<FileExtract> {
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

  async search(query: string, options?: ListOptions): Promise<Paginated<AdamObject>> {
    const needle = query.trim().toLowerCase();
    const pages = await this.collectLivePages();
    const titleMatches: AdamObject[] = [];
    const bodyMatches: AdamObject[] = [];
    for (const { catalog } of pages) {
      if (
        catalog.current &&
        !isDeniedObjectType(catalog.current.type) &&
        catalog.current.type !== "root" &&
        catalog.text.toLowerCase().includes(needle)
      ) {
        const titleHit = catalog.current.title.toLowerCase().includes(needle);
        (titleHit ? titleMatches : bodyMatches).push(catalog.current);
      }
      for (const item of catalog.objects) {
        if (isDeniedObjectType(item.type)) {
          continue;
        }
        if (item.title.toLowerCase().includes(needle)) {
          titleMatches.push(item);
        }
      }
    }
    // AT3: title matches before page-body matches; enrolled walk only (collectLivePages).
    return paginate(uniqueByRef([...titleMatches, ...bodyMatches]), options);
  }

  async listCalendar(
    options?: { from?: string; to?: string } & ListOptions,
  ): Promise<Paginated<CalendarEvent>> {
    const pages = await this.collectLivePages();
    const events: CalendarEvent[] = [];
    for (const { snapshot, catalog } of pages) {
      const provenance = catalog.current?.provenance ?? {
        sourceUrl: snapshot.url,
        fetchedAt: now(),
        provider: "browser" as const,
        freshness: "live-browser-session",
      };
      const objectRefId = catalog.current?.refId;
      const url = catalog.current?.url ?? snapshot.url;

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
    return paginate(preferCalendarEvents(filterRange(events, options?.from, options?.to)), options);
  }

  async listNews(options?: { since?: string } & ListOptions): Promise<Paginated<NewsItem>> {
    // A2-news-browser: long enrolled walk reports progress when onProgress is set (fixture parity).
    const pages = await this.collectLivePages(options?.onProgress);
    const items = uniqueNews(pages.flatMap((page) => page.catalog.news));
    const since = options?.since ? Date.parse(options.since) : Number.NEGATIVE_INFINITY;
    const filtered = items.filter((item) => {
      const stamp = Date.parse(item.updatedAt ?? item.createdAt ?? "");
      return Number.isFinite(stamp) ? stamp >= since : true;
    });
    return paginate(filtered, options);
  }

  private async collectLivePages(onProgress?: ProgressReporter): Promise<LivePage[]> {
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
    const pages: LivePage[] = [{ snapshot: home, catalog: extractCatalog(home, now()) }];
    await report(pages.length);
    const seen = new Set<string>(pages[0]?.catalog.current?.refId ? [pages[0].catalog.current.refId] : []);
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

    for (const item of pages[0]?.catalog.objects ?? []) {
      if (item.type === "crs") {
        enqueue(item.type, item.refId);
      }
    }

    while (queue.length > 0 && pages.length < MAX_LIVE_PAGES) {
      const next = queue.shift();
      if (!next) {
        break;
      }
      try {
        const snapshot = await this.openAuthorized(objectUrl(next.type, next.refId, this.origin));
        const catalog = extractCatalog(snapshot, now());
        pages.push({ snapshot, catalog });
        await report(pages.length);
        if (catalog.current?.type === "crs" || catalog.current?.type === "fold") {
          for (const child of catalog.objects) {
            enqueue(child.type, child.refId);
          }
        }
      } catch {
        continue;
      }
    }
    return pages;
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
  }

  private async openObject(refId: RefId, typeHint?: AdamObjectType): Promise<PageSnapshot> {
    if (!/^\d+$/.test(refId)) {
      throw new AdamError("not_found", "ADAM ref_id must contain digits only.");
    }
    const preferred = typeHint && typeHint !== "unknown" ? typeHint : this.typeByRefId.get(refId);
    const tried = new Set<AdamObjectType>();
    let lastNotFound: AdamError | undefined;

    const tryType = async (type: AdamObjectType): Promise<PageSnapshot | undefined> => {
      if (tried.has(type)) {
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
        if (landed && landed.type !== "unknown" && landed.refId === refId && !isDeniedObjectType(landed.type)) {
          this.typeByRefId.set(refId, landed.type);
        } else if (!landed || landed.type === "unknown") {
          this.typeByRefId.set(refId, type);
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
      // Folder GUIs carry ref_id=PARENT&item_ref_id=CHILD in the URL while showing
      // the parent container. Accept when the parent ref_id matches the request.
      const parentRef = snapshot.url.match(/[?&]ref_id=(\d+)/i)?.[1];
      if (parentRef !== requested.refId) {
        throw new AdamError("not_found", `ADAM did not return an object for ${requested.refId}.`);
      }
    }
    if (isLoginSnapshot(snapshot)) {
      throw new AdamError(
        "unauthorized",
        "ADAM is showing the login page. Run adam_login or `npm run login` and complete SWITCH edu-ID in Chrome. Do not paste the password into chat.",
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

function filterRange(events: CalendarEvent[], from?: string, to?: string): CalendarEvent[] {
  const start = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
  const end = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
  return events.filter((event) => {
    const stamp = event.startsAt ? Date.parse(event.startsAt) : 0;
    return stamp >= start && stamp <= end;
  });
}
