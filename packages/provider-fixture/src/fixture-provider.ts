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
  type RefId,
} from "adam-core";
import { enrolledCourseIds, fixtureCalendar, fixtureCatalog, fixtureNews } from "./catalog.ts";

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

  async extractFileText(refId: RefId, options?: { maxPages?: number }): Promise<FileExtract> {
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
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return paginate([], options);
    }
    const matches = Object.values(fixtureCatalog)
      .map((record) => record.object)
      .filter((object) => {
        if (isDeniedObjectType(object.type)) {
          return false;
        }
        const page = fixtureCatalog[object.refId]?.page?.text ?? "";
        return `${object.title}\n${page}`.toLowerCase().includes(needle);
      });
    return paginate(matches, options);
  }

  async listCalendar(
    options?: { from?: string; to?: string } & ListOptions,
  ): Promise<Paginated<CalendarEvent>> {
    const from = options?.from ? Date.parse(options.from) : Number.NEGATIVE_INFINITY;
    const to = options?.to ? Date.parse(options.to) : Number.POSITIVE_INFINITY;
    const items = fixtureCalendar.filter((event) => {
      const start = event.startsAt ? Date.parse(event.startsAt) : 0;
      return start >= from && start <= to;
    });
    return paginate(items, options);
  }

  async listNews(options?: { since?: string } & ListOptions): Promise<Paginated<NewsItem>> {
    const since = options?.since ? Date.parse(options.since) : Number.NEGATIVE_INFINITY;
    const items = fixtureNews.filter((item) => {
      const stamp = Date.parse(item.updatedAt ?? item.createdAt ?? "");
      return Number.isFinite(stamp) ? stamp >= since : true;
    });
    return paginate(items, options);
  }
}

export function createFixtureProvider(): FixtureAdamProvider {
  return new FixtureAdamProvider();
}
