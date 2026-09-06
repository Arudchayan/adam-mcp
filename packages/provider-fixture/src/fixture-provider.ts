import {
  AdamError,
  assertReadableObjectType,
  extractLocalFileText,
  isDeniedObjectType,
  paginate,
  syntheticPdfWithText,
  type AdamObject,
  type AdamProvider,
  type CalendarEvent,
  type ExerciseObject,
  type FileExtract,
  type FileObject,
  type ListOptions,
  type NewsItem,
  type PageContent,
  type Paginated,
  type ProgressReporter,
  type RefId,
} from "adam-core";
import {
  enrolledCourseIds,
  fixtureCalendar,
  fixtureCatalog,
  fixtureNews,
  newsEnabledCourseIds,
} from "./catalog.ts";
import { LongWalkStub } from "./long-walk.ts";

const OVERVIEW_PDF_BYTES = syntheticPdfWithText(
  "Synthetic lecture overview: Fourier transforms, multimedia retrieval, ranking, and evaluation.",
);

function requireRecord(refId: RefId) {
  const record = fixtureCatalog[refId];
  if (!record) {
    throw new AdamError("not_found", `No ADAM object with ref_id ${refId} in the fixture catalog.`);
  }
  return record;
}

function resolveChildren(refId: RefId): AdamObject[] {
  const record = requireRecord(refId);
  return record.children
    .map((childId) => requireRecord(childId).object)
    .filter((child) => !isDeniedObjectType(child.type));
}

export class FixtureAdamProvider implements AdamProvider {
  readonly id = "fixture" as const;

  async listCourses(options?: ListOptions): Promise<Paginated<AdamObject>> {
    const courses = enrolledCourseIds.map((id) => requireRecord(id).object);
    return paginate(courses, options);
  }

  async getCourse(refId: RefId): Promise<AdamObject> {
    const record = requireRecord(refId);
    assertReadableObjectType(record.object.type, refId);
    if (record.object.type !== "crs") {
      throw new AdamError("unsupported_type", `ref_id ${refId} is ${record.object.type}, not a course.`);
    }
    return record.object;
  }

  async listChildren(refId: RefId, options?: ListOptions): Promise<Paginated<AdamObject>> {
    return paginate(resolveChildren(refId), options);
  }

  async readPage(refId: RefId): Promise<PageContent> {
    const record = requireRecord(refId);
    assertReadableObjectType(record.object.type, refId);
    if (!record.page) {
      throw new AdamError(
        "unsupported_type",
        `ref_id ${refId} has no page text in the fixture catalog.`,
      );
    }
    return record.page;
  }

  async listFiles(refId: RefId, options?: ListOptions): Promise<Paginated<FileObject>> {
    const files = resolveChildren(refId).filter((child): child is FileObject => child.type === "file");
    const nested = files.length > 0
      ? files
      : resolveChildren(refId).flatMap((child) =>
          child.type === "fold"
            ? resolveChildren(child.refId).filter((item): item is FileObject => item.type === "file")
            : [],
        );
    return paginate(nested, options);
  }

  async getFile(refId: RefId): Promise<FileObject> {
    const record = requireRecord(refId);
    if (!record.file) {
      throw new AdamError("unsupported_type", `ref_id ${refId} is not a file.`);
    }
    return record.file;
  }

  async extractFileText(
    refId: RefId,
    options?: { maxPages?: number; onProgress?: ProgressReporter },
  ): Promise<FileExtract> {
    await LongWalkStub.emit("extract", options?.onProgress);
    const file = await this.getFile(refId);
    if (file.refId !== "100011") {
      throw new AdamError("unsupported_type", `Fixture extract is only defined for 00_Overview.pdf, not ${refId}.`);
    }
    return extractLocalFileText(file, OVERVIEW_PDF_BYTES, file.mimeType, options?.maxPages);
  }

  async getExercise(refId: RefId): Promise<ExerciseObject> {
    const record = requireRecord(refId);
    assertReadableObjectType(record.object.type, refId);
    if (record.object.type !== "exc") {
      throw new AdamError("unsupported_type", `ref_id ${refId} is ${record.object.type}, not an exercise.`);
    }
    const object = record.object as ExerciseObject;
    if (object.units) {
      return object;
    }
    return {
      ...object,
      type: "exc",
      units: [
        {
          title: object.title,
          instructionText: record.page?.text,
          ownStatus: "unknown",
        },
      ],
    };
  }

  async search(query: string, options?: ListOptions): Promise<Paginated<AdamObject>> {
    await LongWalkStub.emit("search", options?.onProgress);
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return paginate([], options);
    }
    // AT3: enrolled-tree only (not Magazin / whole-catalog). Title hits before page body.
    return paginate(rankEnrolledSearch(needle), options);
  }

  async listCalendar(
    options?: { from?: string; to?: string } & ListOptions,
  ): Promise<Paginated<CalendarEvent>> {
    await LongWalkStub.emit("calendar", options?.onProgress);
    const events = aggregateFixtureDeadlines();
    const from = options?.from ? Date.parse(options.from) : Number.NEGATIVE_INFINITY;
    const to = options?.to ? Date.parse(options.to) : Number.POSITIVE_INFINITY;
    const items = events.filter((event) => {
      // Honest omit: undated items (no startsAt) always pass range filters.
      if (!event.startsAt) {
        return true;
      }
      const start = Date.parse(event.startsAt);
      return start >= from && start <= to;
    });
    return paginate(items, options);
  }

  async listNews(options?: { since?: string } & ListOptions): Promise<Paginated<NewsItem>> {
    await LongWalkStub.emit("news", options?.onProgress);
    // AT4: enrolled + News-enabled courses only. Never invent activity for news-off / Magazin.
    const enrolled = new Set(enrolledCourseIds);
    const newsOn = new Set(newsEnabledCourseIds);
    const since = options?.since ? Date.parse(options.since) : Number.NEGATIVE_INFINITY;
    const items = fixtureNews.filter((item) => {
      if (!item.courseRefId || !enrolled.has(item.courseRefId) || !newsOn.has(item.courseRefId)) {
        return false;
      }
      const stamp = Date.parse(item.updatedAt ?? item.createdAt ?? "");
      return Number.isFinite(stamp) ? stamp >= since : true;
    });
    return paginate(items, options);
  }
}



/** AT3: walk enrolled courses only; rank title matches ahead of page-body matches. */
function rankEnrolledSearch(needle: string): AdamObject[] {
  type Ranked = { object: AdamObject; rank: 0 | 1 };
  const matches: Ranked[] = [];
  const seen = new Set<RefId>();

  const visit = (refId: RefId, walked: Set<RefId>) => {
    if (walked.has(refId)) {
      return;
    }
    walked.add(refId);
    const record = fixtureCatalog[refId];
    if (!record || isDeniedObjectType(record.object.type)) {
      return;
    }

    const object = record.object;
    if (!seen.has(object.refId)) {
      const titleHit = object.title.toLowerCase().includes(needle);
      const pageHit = (record.page?.text ?? "").toLowerCase().includes(needle);
      if (titleHit || pageHit) {
        seen.add(object.refId);
        matches.push({ object, rank: titleHit ? 0 : 1 });
      }
    }

    for (const childId of record.children) {
      visit(childId, walked);
    }
  };

  for (const courseId of enrolledCourseIds) {
    visit(courseId, new Set());
  }

  matches.sort((a, b) => {
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    return a.object.refId.localeCompare(b.object.refId, "en");
  });
  return matches.map((entry) => entry.object);
}

/** AT1/AT2: cross-course deadlines from calendar SoT + page dates + exc units. */
function aggregateFixtureDeadlines(): CalendarEvent[] {
  const events: CalendarEvent[] = [...fixtureCalendar];
  const seen = new Set(events.map(eventKey));

  const visit = (refId: RefId, walked: Set<RefId>) => {
    if (walked.has(refId)) {
      return;
    }
    walked.add(refId);
    const record = fixtureCatalog[refId];
    if (!record || isDeniedObjectType(record.object.type)) {
      return;
    }

    if (record.page) {
      for (const date of record.page.inferredDates) {
        const event: CalendarEvent = {
          title: date.raw,
          ...(date.iso ? { startsAt: date.iso } : {}),
          source: "page",
          confidence: date.confidence,
          objectRefId: record.object.refId,
          url: record.object.url,
          provenance: record.object.provenance,
        };
        const key = eventKey(event);
        if (!seen.has(key)) {
          seen.add(key);
          events.push(event);
        }
      }
    }

    if (record.object.type === "exc") {
      const exercise = record.object as ExerciseObject;
      for (const unit of exercise.units ?? []) {
        if (!unit.deadline) {
          continue;
        }
        const event: CalendarEvent = {
          title: `${exercise.title} deadline`,
          startsAt: unit.deadline,
          source: "exc",
          confidence: "explicit",
          objectRefId: exercise.refId,
          url: exercise.url,
          provenance: exercise.provenance,
        };
        const key = eventKey(event);
        if (!seen.has(key)) {
          seen.add(key);
          events.push(event);
        }
      }
    }

    for (const childId of record.children) {
      visit(childId, walked);
    }
  };

  for (const courseId of enrolledCourseIds) {
    visit(courseId, new Set());
  }
  return events;
}

function eventKey(event: CalendarEvent): string {
  return [
    event.source,
    event.objectRefId ?? "",
    event.startsAt ?? "",
    event.title,
  ].join("|");
}

export function createFixtureProvider(): FixtureAdamProvider {
  return new FixtureAdamProvider();
}
