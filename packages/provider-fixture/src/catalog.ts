import {
  canonicalUrl,
  DEFAULT_ADAM_ORIGIN,
  type AdamObject,
  type AdamObjectType,
  type Breadcrumb,
  type CalendarEvent,
  type ExerciseObject,
  type FileObject,
  type NewsItem,
  type PageContent,
  type Provenance,
  type RefId,
} from "adam-core";

const FETCHED_AT = "2026-09-05T09:45:00.000Z";
const ILIAS_VERSION = "10.10";

export type FixtureRecord = {
  object: AdamObject;
  children: RefId[];
  page?: PageContent;
  file?: FileObject;
};

function provenance(ref: { type: AdamObjectType; refId: RefId }): Provenance {
  const sourceUrl = canonicalUrl(ref.type, ref.refId);
  return {
    sourceUrl,
    fetchedAt: FETCHED_AT,
    provider: "fixture",
    iliasVersion: ILIAS_VERSION,
    freshness: "synthetic",
  };
}

function crumb(
  type: AdamObjectType,
  refId: RefId,
  title: string,
): Breadcrumb {
  return { type, refId, title, url: canonicalUrl(type, refId) };
}

function obj(
  type: AdamObjectType,
  refId: RefId,
  title: string,
  breadcrumb: Breadcrumb[],
  extra: Partial<AdamObject> = {},
): AdamObject {
  return {
    type,
    refId,
    title,
    url: canonicalUrl(type, refId),
    breadcrumb,
    accessClass: extra.accessClass ?? "Public",
    provenance: provenance({ type, refId }),
    ...extra,
  };
}

const root = obj("root", "1", "ADAM", []);
const publicCat = obj("cat", "900001", "Public courses (synthetic)", [crumb("root", "1", "ADAM")]);
const faculty = obj("cat", "900065", "Synthetic Faculty of Science", [
  crumb("root", "1", "ADAM"),
  crumb("cat", "900001", "Public courses (synthetic)"),
]);
const department = obj("cat", "900165", "Synthetic Department of Computing", [
  crumb("root", "1", "ADAM"),
  crumb("cat", "900001", "Public courses (synthetic)"),
  crumb("cat", "900065", "Synthetic Faculty of Science"),
]);

const courseBreadcrumb = [
  crumb("root", "1", "ADAM"),
  crumb("cat", "900001", "Public courses (synthetic)"),
  crumb("cat", "900065", "Synthetic Faculty of Science"),
  crumb("cat", "900165", "Synthetic Department of Computing"),
];

const course = obj(
  "crs",
  "100001",
  "00000-01 – Synthetic Multimedia Seminar",
  courseBreadcrumb,
  {
    accessClass: "Authenticated Users",
    updatedAt: "2026-09-01T08:00:00.000Z",
  },
);

const notes = obj("fold", "100010", "03 - Course & Notes", [
  ...courseBreadcrumb,
  crumb("crs", "100001", course.title),
]);

const exercises = obj("fold", "100020", "04 - Exercises", [
  ...courseBreadcrumb,
  crumb("crs", "100001", course.title),
]);

const exercise: ExerciseObject = {
  ...obj(
    "exc",
    "100021",
    "Exercise 1 – Retrieval summary",
    [...courseBreadcrumb, crumb("crs", "100001", course.title)],
    {
      accessClass: "Authenticated Users",
      updatedAt: "2026-09-01T09:00:00.000Z",
    },
  ),
  type: "exc",
  units: [
    {
      title: "Unit 1",
      deadline: "2026-09-22T21:59:00.000Z",
      instructionText:
        "Write a one-page retrieval summary from the course notes. This connector cannot submit the exercise.",
      ownStatus: "none",
    },
  ],
};

const overviewFile: FileObject = {
  ...obj("file", "100011", "00_Overview.pdf", [
    ...courseBreadcrumb,
    crumb("crs", "100001", course.title),
    crumb("fold", "100010", notes.title),
  ], {
    accessClass: "Authenticated Users",
    author: "Fixture Author",
    createdAt: "2026-09-01T07:55:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z",
  }),
  type: "file",
  mimeType: "application/pdf",
  sizeBytes: 1_699_840,
  pageCount: 14,
};

const coursePage: PageContent = {
  ...course,
  text: [
    "Synthetic course description for local tests.",
    "Prepare the assigned reading before each session.",
    "Week 3 reading: Fourier transforms and the DFT (see 00_Overview.pdf).",
    "Written exam: 12 January 2027, 10:00–12:00, Lecture Hall A.",
    "An empty exercises folder must not be read as 'no deadlines'.",
  ].join("\n"),
  inferredDates: [
    {
      raw: "12 January 2027, 10:00–12:00, Lecture Hall A",
      iso: "2027-01-12T09:00:00.000Z",
      confidence: "explicit",
    },
  ],
};

const exercisePage: PageContent = {
  ...exercise,
  text: [
    "Exercise 1 – Retrieval summary.",
    "Deadline: 22 September 2026, 23:59.",
    "Write a one-page retrieval summary from the course notes.",
    "This connector cannot submit the exercise.",
  ].join("\n"),
  inferredDates: [
    {
      raw: "22 September 2026, 23:59",
      iso: "2026-09-22T21:59:00.000Z",
      confidence: "explicit",
    },
  ],
};

export const fixtureNews: NewsItem[] = [
  {
    title: "New file in Course & Notes",
    summary: "00_Overview.pdf was added to 03 - Course & Notes.",
    url: canonicalUrl("file", "100011"),
    courseRefId: "100001",
    folderRefId: "100010",
    createdAt: "2026-09-01T07:55:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z",
    accessClass: "Authenticated Users",
    author: "Fixture Author",
    provenance: provenance({ type: "file", refId: "100011" }),
  },
];

export const fixtureCalendar: CalendarEvent[] = [
  {
    title: "Written exam",
    startsAt: "2027-01-12T09:00:00.000Z",
    endsAt: "2027-01-12T11:00:00.000Z",
    location: "Lecture Hall A",
    source: "page",
    confidence: "explicit",
    objectRefId: "100001",
    url: canonicalUrl("crs", "100001"),
    provenance: provenance({ type: "crs", refId: "100001" }),
  },
  {
    title: "Exercise 1 deadline",
    startsAt: "2026-09-22T21:59:00.000Z",
    source: "page",
    confidence: "explicit",
    objectRefId: "100021",
    url: canonicalUrl("exc", "100021"),
    provenance: provenance({ type: "exc", refId: "100021" }),
  },
];

export const fixtureOrigin = DEFAULT_ADAM_ORIGIN;

export const fixtureCatalog: Record<RefId, FixtureRecord> = {
  "1": { object: root, children: ["900001"] },
  "900001": { object: publicCat, children: ["900065"] },
  "900065": { object: faculty, children: ["900165"] },
  "900165": { object: department, children: ["100001"] },
  "100001": {
    object: course,
    children: ["100010", "100020", "100021"],
    page: coursePage,
  },
  "100010": { object: notes, children: ["100011"] },
  "100020": { object: exercises, children: [] },
  "100021": { object: exercise, children: [], page: exercisePage },
  "100011": { object: overviewFile, children: [], file: overviewFile },
};

export const enrolledCourseIds: RefId[] = ["100001"];
