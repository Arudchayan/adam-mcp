import type {
  AdamObject,
  CalendarEvent,
  CourseMembers,
  ExerciseGrades,
  ExerciseObject,
  ForumObject,
  FileExtract,
  FileObject,
  ListOptions,
  MailHeader,
  MailListOptions,
  MailMessage,
  MailReadOptions,
  NewsItem,
  ObjectOpenOptions,
  PageContent,
  PageReadOptions,
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
  /** ADR 0062: `subPage` reads one sub-page listed in an earlier `detail`. */
  readPage(refId: RefId, options?: PageReadOptions): Promise<PageContent>;
  listFiles(refId: RefId, options?: ListOptions): Promise<Paginated<FileObject>>;
  getFile(refId: RefId, options?: ObjectOpenOptions): Promise<FileObject>;
  extractFileText(
    refId: RefId,
    options?: { maxPages?: number; startPage?: number; onProgress?: ProgressReporter } & ObjectOpenOptions,
  ): Promise<FileExtract>;
  getExercise(refId: RefId, options?: ObjectOpenOptions & { view?: "ongoing" | "upcoming" | "past" | "all"; detail?: boolean }): Promise<ExerciseObject>;
  getForum(
    refId: RefId,
    options?: ObjectOpenOptions & { threadId?: string },
  ): Promise<ForumObject>;
  search(query: string, options?: ListOptions): Promise<Paginated<AdamObject>>;
  listCalendar(options?: { from?: string; to?: string } & ListOptions): Promise<Paginated<CalendarEvent>>;
  listNews(options?: { since?: string } & ListOptions): Promise<Paginated<NewsItem>>;
  /** ADR 0054: mailbox headers (confirm-gated at the MCP layer). */
  listMail(options?: MailListOptions): Promise<Paginated<MailHeader>>;
  /** ADR 0054: one message body by its listed folderId + mailId. Opening it marks it read in ADAM, as a browser would. */
  readMail(folderId: string, mailId: string, options?: MailReadOptions): Promise<MailMessage>;
  /** ADR 0060: a course's Members table (tutor / course admin only). */
  getCourseMembers(refId: RefId, options?: ObjectOpenOptions): Promise<CourseMembers>;
  /** ADR 0060: an exercise's Grades View matrix (tutor / course admin only). */
  getExerciseGrades(refId: RefId, options?: ObjectOpenOptions): Promise<ExerciseGrades>;
};
