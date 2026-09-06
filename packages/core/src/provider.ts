import type {
  AdamObject,
  CalendarEvent,
  ExerciseObject,
  FileExtract,
  FileObject,
  ListOptions,
  NewsItem,
  PageContent,
  Paginated,
  ProgressReporter,
  ProviderId,
  RefId,
} from "./types.ts";

export type AdamProvider = {
  readonly id: ProviderId;
  listCourses(options?: ListOptions): Promise<Paginated<AdamObject>>;
  getCourse(refId: RefId): Promise<AdamObject>;
  listChildren(refId: RefId, options?: ListOptions): Promise<Paginated<AdamObject>>;
  readPage(refId: RefId): Promise<PageContent>;
  listFiles(refId: RefId, options?: ListOptions): Promise<Paginated<FileObject>>;
  getFile(refId: RefId): Promise<FileObject>;
  extractFileText(refId: RefId, options?: { maxPages?: number; onProgress?: ProgressReporter }): Promise<FileExtract>;
  getExercise(refId: RefId): Promise<ExerciseObject>;
  search(query: string, options?: ListOptions): Promise<Paginated<AdamObject>>;
  listCalendar(options?: { from?: string; to?: string } & ListOptions): Promise<Paginated<CalendarEvent>>;
  listNews(options?: { since?: string } & ListOptions): Promise<Paginated<NewsItem>>;
};
