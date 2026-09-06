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
  type AdamObject,
  type AdamObjectType,
  type AdamProvider,
  type CalendarEvent,
  type ExerciseObject,
  type FileExtract,
  type FileObject,
  type ListOptions,
  type NewsItem,
  type PageContent,
  type Paginated,
  type RefId,
} from "adam-core";
import { defaultOrigin } from "./config.ts";
import { extractCatalog, exerciseDeadlineFromPage, isLoggedInSnapshot, isLoginSnapshot, type ExtractedCatalog } from "./extract.ts";
import { createPlaywrightSession } from "./playwright-session.ts";
import type { AdamBrowserSession, PageSnapshot, SessionStatus } from "./session-types.ts";

export type BrowserProviderOptions = {
  session?: AdamBrowserSession;
  origin?: string;
};

/** Dashboard + enrolled courses/folders/exercises. Not Magazin, not robots-disallowed GUIs. */
const MAX_LIVE_PAGES = 12;

type LivePage = {
  snapshot: PageSnapshot;
  catalog: ExtractedCatalog;
};

export class BrowserAdamProvider implements AdamProvider {
  readonly id = "browser" as const;
  private readonly origin: string;
  private sessionHandle: AdamBrowserSession | undefined;
  private readonly injected: boolean;

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
    return paginate(courses, options);
  }

  async getCourse(refId: RefId): Promise<AdamObject> {
    const snapshot = await this.openAuthorized(objectUrl("crs", refId, this.origin));
    const catalog = extractCatalog(snapshot, now());
    const course = catalog.current?.type === "crs" ? catalog.current : catalog.objects.find((item) => item.refId === refId && item.type === "crs");
    if (!course) {
      throw new AdamError("unsupported_type", `ref_id ${refId} did not resolve to a course in the browser session.`);
    }
    return course;
  }

  async listChildren(refId: RefId, options?: ListOptions): Promise<Paginated<AdamObject>> {
    const snapshot = await this.openAuthorized(objectUrl("unknown", refId, this.origin));
    const catalog = extractCatalog(snapshot, now());
    const children = catalog.objects.filter((item) => item.refId !== refId && !isDeniedObjectType(item.type));
    return paginate(children, options);
  }

  async readPage(refId: RefId): Promise<PageContent> {
    const snapshot = await this.openAuthorized(objectUrl("unknown", refId, this.origin));
    const catalog = extractCatalog(snapshot, now());
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
    const snapshot = await this.openAuthorized(objectUrl("unknown", refId, this.origin));
    const catalog = extractCatalog(snapshot, now());
    const direct = catalog.files.filter((item) => item.refId !== refId);
    const nested = catalog.objects.filter((item): item is FileObject => item.type === "file");
    return paginate(direct.length > 0 ? direct : nested, options);
  }

  async getFile(refId: RefId): Promise<FileObject> {
    const snapshot = await this.openAuthorized(objectUrl("file", refId, this.origin));
    const catalog = extractCatalog(snapshot, now());
    const file =
      catalog.files.find((item) => item.refId === refId) ??
      (catalog.current?.type === "file" ? { ...catalog.current, type: "file" as const } : undefined);
    if (!file) {
      throw new AdamError("unsupported_type", `ref_id ${refId} did not resolve to a file.`);
    }
    return file;
  }

  async extractFileText(refId: RefId, options?: { maxPages?: number }): Promise<FileExtract> {
    const file = await this.getFile(refId);
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

  async getExercise(refId: RefId): Promise<ExerciseObject> {
    const snapshot = await this.openAuthorized(objectUrl("exc", refId, this.origin));
    const catalog = extractCatalog(snapshot, now());
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
    const pages = await this.collectLivePages();
    const items = uniqueNews(pages.flatMap((page) => page.catalog.news));
    const since = options?.since ? Date.parse(options.since) : Number.NEGATIVE_INFINITY;
    const filtered = items.filter((item) => {
      const stamp = Date.parse(item.updatedAt ?? item.createdAt ?? "");
      return Number.isFinite(stamp) ? stamp >= since : true;
    });
    return paginate(filtered, options);
  }

  private async collectLivePages(): Promise<LivePage[]> {
    const home = await this.openAuthorized(this.origin);
    const pages: LivePage[] = [{ snapshot: home, catalog: extractCatalog(home, now()) }];
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
    const landed = parseAdamRef(snapshot.url);
    if (landed) {
      assertReadableObjectType(landed.type, landed.refId);
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
  return /object not found|kein objekt|keine berechtigung|permission denied/i.test(snapshot.text);
}

function filterRange(events: CalendarEvent[], from?: string, to?: string): CalendarEvent[] {
  const start = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
  const end = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
  return events.filter((event) => {
    const stamp = event.startsAt ? Date.parse(event.startsAt) : 0;
    return stamp >= start && stamp <= end;
  });
}
