export const DEFAULT_ADAM_ORIGIN = "https://adam.unibas.ch";

/** ADR 0011: page-text cap shared by fixture and browser (browser extract already used 50k). */
export const MAX_PAGE_CHARS = 50_000;

export const ADAM_OBJECT_TYPES = [
  "root",
  "cat",
  "crs",
  "fold",
  "file",
  "blog",
  "webr",
  "frm",
  "exc",
  "tst",
  "impr",
  "svy",
  "poll",
  // ADR 0057 (#130, #131): ILIAS 10.12 containers, scheduling and content modules.
  "sess",
  "grp",
  "itgr",
  "lso",
  "book",
  "copa",
  "lm",
  "htlm",
  "wiki",
  "glo",
  "dcl",
  "bibl",
  "mcst",
  "unknown",
] as const;

export type AdamObjectType = (typeof ADAM_OBJECT_TYPES)[number];

export type ProviderId = "fixture" | "soap" | "browser" | "html";

export type RefId = string;

export type Breadcrumb = {
  type: AdamObjectType;
  refId: RefId;
  title: string;
  url: string;
};

export type Provenance = {
  sourceUrl: string;
  fetchedAt: string;
  provider: ProviderId;
  iliasVersion?: string;
  freshness?: string;
};

export type AdamObject = {
  type: AdamObjectType;
  refId: RefId;
  title: string;
  url: string;
  breadcrumb: Breadcrumb[];
  createdAt?: string;
  updatedAt?: string;
  accessClass?: string;
  author?: string;
  provenance: Provenance;
  /** Present on course snapshots from getCourse (bounded). */
  children?: AdamObject[];
  /**
   * Honesty of the embedded children listing on getCourse (ADR 0005 / 0015).
   * Absent on ordinary listing rows; page-backed getCourse must set this.
   */
  listingState?: ListingState;
  listingSignals?: ListingSignals;
  /** Listing notice when state is empty/unknown (same copy as list_children). */
  notice?: string;
  /**
   * True when getCourse embedded children were capped at the provider limit,
   * or when page text was capped (PageContent). Not silent.
   */
  truncated?: boolean;
  /** Pre-cap child count when getCourse truncated embedded children. */
  totalChildrenHint?: number;
};

export type InferredDate = {
  raw: string;
  iso?: string;
  confidence: "explicit" | "inferred";
};

export type PageContent = AdamObject & {
  text: string;
  inferredDates: InferredDate[];
  /** True when page text was capped at MAX_PAGE_CHARS (ADR 0011). */
  truncated?: boolean;
  /** Selected Web Link redirect metadata only; destinations are never fetched. */
  destinations?: Array<{ url: string; sourceUrl: string }>;
  destinationNotice?: string;
  /** ADR 0062: typed structure of this object's page (per-type reader), when recognised. */
  detail?: ObjectDetail;
  /** ADR 0062: "read" when a typed reader recognised the page, "unrecognised" when it did not (text is still returned). */
  detailStatus?: "read" | "unrecognised";
  /** ADR 0062: the sub-page whose text this is (a wiki page, LM chapter, ...), when one was requested. */
  subPage?: string;
};

/**
 * ADR 0062: typed per-object structure. `kind` names the shape (for example "session",
 * "wiki", "glossary"); `evidence` says where the parser's markup came from.
 * Readers add their own fields; every field is read-only metadata or untrusted text.
 */
export type ObjectDetail = {
  kind: string;
  evidence: "lab-verified" | "live-verified";
  [field: string]: unknown;
};

/** ADR 0062: readPage options. `subPage` is an opaque id from an earlier `detail`. */
export type PageReadOptions = ObjectOpenOptions & { subPage?: string };

export type FileObject = AdamObject & {
  type: "file";
  /** Format suffix ILIAS shows in the listing row ("pdf", "ipynb"); titles often omit it (#122). */
  extension?: string;
  mimeType?: string;
  sizeBytes?: number;
  pageCount?: number;
};

export type FileExtract = {
  refId: RefId;
  title: string;
  url: string;
  mimeType?: string;
  pageCount?: number;
  pages: Array<{ page: number; text: string }>;
  truncated: boolean;
  /** First page not yet returned; pass as startPage to continue (#121). */
  nextStartPage?: number;
  sha256: string;
  provenance: Provenance;
};

export type ExerciseOwnStatus = "none" | "submitted" | "passed" | "failed" | "unknown";

export type ExerciseUnit = {
  title: string;
  deadline?: string;
  /** As ADAM labels it, e.g. "Optional" / "Mandatory" (#120). */
  requirement?: string;
  /** As ADAM labels it, e.g. "Upload" (#120). */
  submissionType?: string;
  instructionText?: string;
  ownStatus: ExerciseOwnStatus;
  /** Detail-page schedule card (ADR 0053, `detail: true`). */
  schedule?: ExerciseSchedule;
  /** Detail-page submission panel, this user's own (ADR 0053, `detail: true`). */
  submission?: ExerciseSubmission;
  /** Detail-page instruction file names; metadata only, never downloaded (ADR 0053). */
  instructionFiles?: ExerciseFileRef[];
  /** Detail-page sample solution file name, when ADAM shows one (ADR 0053). */
  sampleSolution?: ExerciseFileRef;
  /** Detail-page team panel status text, redacted (ADR 0053). */
  team?: ExerciseTeam;
  /** Detail-page tutor evaluation (ADR 0053). */
  evaluation?: ExerciseEvaluation;
  /** Whether the assignment's detail page was read (ADR 0053, only with `detail: true`). */
  detailStatus?: ExerciseDetailStatus;
};

export type ExerciseSchedule = {
  deadline?: string;
  /** Deadline as ADAM printed it, e.g. "20. Nov 2026, 12:00". */
  deadlineText?: string;
  /** Raw remaining-time text, e.g. "5 Days, 12 Minutes" or "Time is up.". */
  timeRemaining?: string;
};

export type ExerciseSubmission = {
  submittedFiles?: string;
  lastSubmission?: string;
};

export type ExerciseFileRef = { name: string };

export type ExerciseTeam = { status: string };

export type ExerciseEvaluation = {
  /** Tutor's evaluation statement, redacted. */
  statement?: string;
  /** As ADAM labels it, e.g. "Passed" / "Failed". */
  status?: string;
};

/** read: parsed; no_link: no allowlisted detail link; unrecognized: page had no known panels; not_read: over the per-call cap. */
export type ExerciseDetailStatus = "read" | "no_link" | "unrecognized" | "not_read";

export type ExerciseObject = AdamObject & {
  type: "exc";
  units: ExerciseUnit[];
  /** Assignment bucket that was read, when one was requested (ADR 0052). */
  view?: "ongoing" | "upcoming" | "past" | "all";
};

export type ForumPost = {
  postId: string;
  author?: string;
  createdAt?: string;
  subject?: string;
  body: string;
};

export type ForumThreadSummary = {
  threadId: string;
  title: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  postCount?: number;
  /** Unread posts for this account, when the thread overview shows it. */
  unreadCount?: number;
};

export type ForumObject = AdamObject & {
  type: "frm";
  /** Thread summaries only — never includes post bodies. */
  threads: ForumThreadSummary[];
  /** Present only when threadId was requested and confirm gate passed. */
  selectedThread?: {
    threadId: string;
    title: string;
    posts: ForumPost[];
  };
};

export type NewsItem = {
  title: string;
  summary: string;
  url: string;
  courseRefId?: RefId;
  folderRefId?: RefId;
  createdAt?: string;
  updatedAt?: string;
  accessClass?: string;
  author?: string;
  /** ILIAS news_id when the News block item links one (ADR 0055); identifies the same news across blocks. */
  newsId?: string;
  provenance: Provenance;
};

/**
 * ADR 0060 (#128): staff views. One course member as ILIAS's Members table shows
 * it to a tutor or course admin; email-shaped values are redacted.
 */
export type CourseMember = {
  name: string;
  login?: string;
  roles: string[];
  passed?: boolean;
  tutorialSupport?: boolean;
  notification?: boolean;
};

export type CourseMembers = {
  refId: RefId;
  url: string;
  members: CourseMember[];
  /** ADAM rendered only the first table page (ADR 0060); totalHint is its footer count. */
  truncated?: true;
  totalHint?: number;
  /** Lab-verified ILIAS 10.12 markup; not yet observed on ADAM itself. */
  evidence: "lab-verified";
  provenance: Provenance;
};

export type GradeStatus = "passed" | "failed" | "not_graded" | "unknown";

/** ADR 0060: one participant row of an exercise's Grades View matrix. */
export type ExerciseGradeRow = {
  name: string;
  login?: string;
  grades: Array<{ assignment: number; assignmentId?: string; status: GradeStatus }>;
  total?: GradeStatus;
};

export type ExerciseGrades = {
  refId: RefId;
  url: string;
  participants: ExerciseGradeRow[];
  /** ADAM rendered only the first table page (ADR 0060); totalHint is its footer count. */
  truncated?: true;
  totalHint?: number;
  evidence: "lab-verified";
  provenance: Provenance;
};

/**
 * ADR 0054: one row of the ADAM internal mailbox (ilMailFolderGUI). Header
 * fields only — never the message body. Sender is a display name with any
 * email address redacted. `mailId` / `folderId` are ILIAS's own numeric ids.
 */
export type MailHeader = {
  mailId: string;
  folderId: string;
  subject: string;
  sender?: string;
  /** ISO timestamp when ADAM's date cell parses; raw text kept in dateText. */
  sentAt?: string;
  dateText?: string;
  /** As the row's status icon says; "unknown" when the row does not say. */
  status: "read" | "unread" | "unknown";
  hasAttachments?: boolean;
  provenance: Provenance;
};

export type MailAttachment = {
  name: string;
  /** As ADAM labels it ("12 KB"); never downloaded. */
  sizeText?: string;
};

/** ADR 0054: one opened message. Body is untrusted text; attachments are names only. */
export type MailMessage = Omit<MailHeader, "status" | "hasAttachments"> & {
  body: string;
  recipients?: string;
  attachments: MailAttachment[];
  truncated?: boolean;
};

/** ADR 0054: the inbox ADAM opens (first page of its table); no folder switching in this slice. */
export type MailListOptions = Pick<ListOptions, "cursor" | "limit" | "refresh" | "signal">;

export type MailReadOptions = {
  signal?: AbortSignal;
};

/** Longest note text returned to the model (ADR 0063). Longer notes are cut and flagged `truncated`. */
export const NOTE_TEXT_LIMIT = 2_000;

/**
 * ADR 0063: one of the student's Private Notes (ILIAS `ilNoteGUI`, note_type=1).
 * `text` is the note as the student wrote it: untrusted, capped at NOTE_TEXT_LIMIT.
 * `dateText` is the date ADAM shows; the overview does not say whether that is the
 * creation or the last-update date, so no createdAt/updatedAt is inferred.
 */
export type NoteItem = {
  noteId?: string;
  text: string;
  truncated?: boolean;
  dateText?: string;
  shownAt?: string;
  /** Title of the object the note sits on, as ADAM's "Origin" shows it. Absent when ADAM shows none. */
  objectTitle?: string;
  objectRefId?: RefId;
  provenance: Provenance;
};

/** ADR 0063: the notes overview is one snapshot; cursor/limit page over it. */
export type NoteListOptions = Pick<ListOptions, "cursor" | "limit" | "refresh" | "signal">;

export type CalendarEvent = {
  title: string;
  startsAt?: string;
  endsAt?: string;
  location?: string;
  source: "exc" | "page" | "calendar";
  confidence: "explicit" | "inferred";
  objectRefId?: RefId;
  url?: string;
  provenance: Provenance;
  /** Corroborating sources merged into this event (AT6 dedup). */
  seenIn?: Array<CalendarEvent["source"]>;
};

export type Paginated<T> = {
  items: T[];
  /** Immutable result snapshot creation time; per-item provenance has fetch times. */
  snapshotAt?: string;
  nextCursor?: string;
  totalHint?: number;
  /** Honesty of the source listing (ADR 0005). Walks may omit; page-backed lists must set. */
  listingState?: ListingState;
  listingSignals?: ListingSignals;
  notice?: string;
};

/** Honesty of the source listing, not of this cursor page (ADR 0005). */
export type ListingState = "ok" | "empty" | "unknown";

export type ListingSignals = {
  /** Non-chrome, non-breadcrumb /go/{type}/{id} objects (pre-paginate). */
  contentItemCount: number;
  /** EN/DE empty-folder copy in content text. */
  emptyCopy: boolean;
  /** After stripping chrome/nav/footer/breadcrumb, no listing body. */
  chromeOnly: boolean;
  /** ADR 0050: empty because ILIAS rendered a childless content root, not because of empty copy. */
  structurallyEmpty?: boolean;
};

export type ProgressUpdate = {
  progress: number;
  total?: number;
  message?: string;
};

export type ProgressReporter = (update: ProgressUpdate) => void | Promise<void>;

/** Optional type from a prior listing so providers open /go/{type}/{id}. */
export type ObjectOpenOptions = {
  type?: AdamObjectType;
  /** Cooperative cancellation for long walks (notifications/cancelled). */
  signal?: AbortSignal;
};

export type ListOptions = {
  cursor?: string;
  limit?: number;
  /** Optional enrolled-course scope for search/calendar/news only. */
  courseRefId?: RefId;
  /** Start a fresh discovery snapshot; never combine with cursor. */
  refresh?: boolean;
  /** Optional long-walk progress (search / calendar / extract / news). */
  onProgress?: ProgressReporter;
} & ObjectOpenOptions;

/**
 * Shared provider/MCP error taxonomy (one set — do not invent parallel codes).
 * - unauthorized: session/login required
 * - not_found: object truly missing (HTTP 404 / ADAM failure page / no resolved object)
 * - forbidden: authenticated but no access (HTTP 403 / permission page) — never “does not exist”
 * - stale_id: requested ref_id resolved to a different live object (identity mismatch)
 * - provider_unavailable: transient upstream (5xx, 429, typed nav/net timeouts) — only retryable default
 * - unsupported_type: a resolved object of the wrong type (not an absent ref)
 * - confirmation_required / cancelled: policy / gates
 */
export const ADAM_ERROR_CODES = [
  "unauthorized",
  "not_found",
  "forbidden",
  "stale_id",
  "unsupported_type",
  "provider_unavailable",
  "confirmation_required",
  "cancelled",
] as const;

export type AdamErrorCode = (typeof ADAM_ERROR_CODES)[number];
