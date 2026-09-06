export const DEFAULT_ADAM_ORIGIN = "https://adam.unibas.ch";

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
};

export type InferredDate = {
  raw: string;
  iso?: string;
  confidence: "explicit" | "inferred";
};

export type PageContent = AdamObject & {
  text: string;
  inferredDates: InferredDate[];
};

export type FileObject = AdamObject & {
  type: "file";
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
  sha256: string;
  provenance: Provenance;
};

export type ExerciseOwnStatus = "none" | "submitted" | "passed" | "failed" | "unknown";

export type ExerciseUnit = {
  title: string;
  deadline?: string;
  instructionText?: string;
  ownStatus: ExerciseOwnStatus;
};

export type ExerciseObject = AdamObject & {
  type: "exc";
  units: ExerciseUnit[];
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
  provenance: Provenance;
};

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
};

export type Paginated<T> = {
  items: T[];
  nextCursor?: string;
  totalHint?: number;
};

export type ProgressUpdate = {
  progress: number;
  total?: number;
  message?: string;
};

export type ProgressReporter = (update: ProgressUpdate) => void | Promise<void>;

export type ListOptions = {
  cursor?: string;
  limit?: number;
  /** Optional long-walk progress (search / calendar / extract). */
  onProgress?: ProgressReporter;
};

export const ADAM_ERROR_CODES = [
  "unauthorized",
  "not_found",
  "stale_id",
  "rate_limited",
  "unsupported_type",
  "provider_unavailable",
  "confirmation_required",
] as const;

export type AdamErrorCode = (typeof ADAM_ERROR_CODES)[number];
