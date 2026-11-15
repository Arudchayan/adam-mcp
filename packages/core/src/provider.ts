import type {
  AdamObject,
  CalendarEvent,
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
    options?: { maxPages?: number; startPage?: number; onProgress?: ProgressReporter } & ObjectOpenOptions,
  ): Promise<FileExtract>;
  getExercise(refId: RefId, options?: ObjectOpenOptions & { view?: "ongoing" | "upcoming" | "past" | "all" }): Promise<ExerciseObject>;
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
};
