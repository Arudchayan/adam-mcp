import type {
  AdamObject,
  CalendarEvent,
  ExerciseObject,
  FileExtract,
  FileObject,
  ListOptions,
  NewsItem,
  ObjectOpenOptions,
  PageContent,
  Paginated,
  ProgressReporter,
  ProviderId,
  RefId,
} from "./types.ts";

export type AdamProvider = {
  readonly id: ProviderId;
  listCourses(options?: ListOptions): Promise<Paginated<AdamObject>>;
  getCourse(refId: RefId, options?: ObjectOpenOptions): Promise<AdamObject>;
  listChildren(refId: RefId, options?: ListOptions): Promise<Paginated<AdamObject>>;
  readPage(refId: RefId, options?: ObjectOpenOptions): Promise<PageContent>;
  listFiles(refId: RefId, options?: ListOptions): Promise<Paginated<FileObject>>;
  getFile(refId: RefId, options?: ObjectOpenOptions): Promise<FileObject>;
  extractFileText(
    refId: RefId,
    options?: { maxPages?: number; onProgress?: ProgressReporter } & ObjectOpenOptions,
  ): Promise<FileExtract>;
  getExercise(refId: RefId, options?: ObjectOpenOptions): Promise<ExerciseObject>;
  search(query: string, options?: ListOptions): Promise<Paginated<AdamObject>>;
  listCalendar(options?: { from?: string; to?: string } & ListOptions): Promise<Paginated<CalendarEvent>>;
  listNews(options?: { since?: string } & ListOptions): Promise<Paginated<NewsItem>>;
};
