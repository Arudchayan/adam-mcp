import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdamError, syntheticPdfWithText } from "adam-core";
import { hostnameAllowed, urlAllowed } from "./allowlist.ts";
import {
  createBrowserProvider,
  retainWalkPage,
  walkRetentionByteProxy,
  fullSnapshotByteProxy,
} from "./browser-provider.ts";
import { extractCatalog, exerciseDeadlineFromPage, inferDates, isLoginSnapshot, classifyListing, mergeFrameLinks } from "./extract.ts";
import { shouldProbeOrigin } from "./playwright-session.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

const dashboardHtml = `
<nav aria-label="Hauptnavigationsleiste"><a href="/go/root/1">Magazin</a></nav>
<nav aria-label="Brotkrumen"><a href="/go/root/1">ADAM</a></nav>
<main>
  <h1>Schreibtisch</h1>
  <a href="/go/crs/100001">00000-01 – Synthetic Multimedia Seminar</a>
  <p>Written exam: 12 January 2027</p>
  <section class="news">
    <h2>News</h2>
    <article>
      <a href="/go/file/100011">00_Overview.pdf</a>
      <p>New file in Course &amp; Notes. Authenticated Users. Author: Fixture Author</p>
      <time datetime="2026-09-01T08:00:00.000Z">1 September 2026</time>
    </article>
  </section>
  <a href="/logout.php">Abmelden</a>
</main>
`;

const courseHtml = `
<nav aria-label="Brotkrumen">
  <a href="/go/root/1">ADAM</a>
</nav>
<main>
  <h1>00000-01 – Synthetic Multimedia Seminar</h1>
  <p>Written exam: 12 January 2027, 10:00–12:00, Lecture Hall A.</p>
  <a href="/go/fold/100010">03 - Course &amp; Notes</a>
  <a href="/go/fold/100020">04 - Exercises</a>
  <a href="/go/exc/100021">Exercise 1 – Retrieval summary</a>
  <a href="/logout.php">Abmelden</a>
</main>
`;

const emptyFolderHtml = `
<nav aria-label="Brotkrumen">
  <a href="/go/crs/100001">00000-01 – Synthetic Multimedia Seminar</a>
</nav>
<main>
  <h1>04 - Exercises</h1>
  <p>This folder is empty.</p>
  <a href="/logout.php">Abmelden</a>
</main>
`;

const loginHtml = `
<h1>Bei ADAM anmelden</h1>
<button>Login mit Switch edu-ID</button>
`;

const folderHtml = `
<nav aria-label="Brotkrumen">
  <a href="/go/root/1">ADAM</a>
  <a href="/go/crs/100001">00000-01 – Synthetic Multimedia Seminar</a>
</nav>
<main>
  <h1>03 - Course &amp; Notes</h1>
  <a href="/go/file/100011">00_Overview.pdf</a>
  <a href="/go/fold/100020">04 - Exercises</a>
</main>
`;

const fileHtml = `
<nav aria-label="Brotkrumen">
  <a href="/go/root/1">ADAM</a>
  <a href="/go/crs/100001">00000-01 – Synthetic Multimedia Seminar</a>
  <a href="/go/fold/100010">03 - Course &amp; Notes</a>
</nav>
<main>
  <h1>00_Overview.pdf</h1>
  <a href="/logout.php">Abmelden</a>
</main>
`;

const exerciseHtml = `
<nav aria-label="Brotkrumen">
  <a href="/go/root/1">ADAM</a>
  <a href="/go/crs/100001">00000-01 – Synthetic Multimedia Seminar</a>
</nav>
<main>
  <h1>Exercise 1 – Retrieval summary</h1>
  <p>Deadline: 22 September 2026, 23:59.</p>
  <p>Write a one-page retrieval summary. Do not submit through this connector.</p>
  <a href="/logout.php">Abmelden</a>
</main>
`;

describe("allowlist", () => {
  it("allows ADAM and SWITCH hosts only over HTTPS", () => {
    assert.equal(hostnameAllowed("adam.unibas.ch"), true);
    assert.equal(hostnameAllowed("login.eduid.ch"), true);
    assert.equal(urlAllowed("https://adam.unibas.ch/go/crs/1"), true);
    assert.equal(urlAllowed("https://evil.example/go/crs/1"), false);
    assert.equal(urlAllowed("http://adam.unibas.ch/go/crs/1"), false);
    assert.equal(hostnameAllowed("evil.adam.unibas.ch"), false);
  });
});

describe("extractCatalog", () => {
  it("reads course cards and page-embedded dates", () => {
    const snapshot = snapshotFromHtml(
      "https://adam.unibas.ch/",
      "Schreibtisch",
      dashboardHtml,
      "Schreibtisch 00000-01 Written exam: 12 January 2027 News 00_Overview.pdf New file Abmelden",
    );
    const catalog = extractCatalog(snapshot, "2026-09-05T12:00:00.000Z");
    assert.equal(catalog.objects.some((item) => item.refId === "100001"), true);
    assert.equal(inferDates(catalog.text).length > 0, true);
    assert.equal(catalog.news.some((item) => item.url.includes("/go/file/100011")), true);
  });
});

describe("listing classification", () => {
  const base = snapshotFromHtml(
    "https://adam.unibas.ch/go/fold/100020",
    "04 - Exercises",
    "<main><h1>04 - Exercises</h1></main>",
    "",
  );

  it("classifies real ILIAS 10 EN/DE empty copy as empty", () => {
    for (const copy of [
      "This folder is empty.",
      "This object is empty and contains no items.",
      "No Materials Available",
      "Keine Einträge",
      "Keine Objekte gefunden",
      "No items available",
    ]) {
      const classified = classifyListing({ ...base, text: copy }, 0);
      assert.equal(classified.state, "empty", copy);
      assert.equal(classified.signals.emptyCopy, true);
    }
  });

  it("classifies visible rows with no parseable links as unknown, not empty", () => {
    const classified = classifyListing({ ...base, text: "04 - Exercises", dom: { itemRows: 3, emptyCopy: false } }, 0);
    assert.equal(classified.state, "unknown");
    assert.equal(classified.signals.contentItemCount, 3);
    assert.match(classified.notice ?? "", /rows are visible/i);
  });

  it("still reports plain unknown when there are no rows and no empty copy", () => {
    const classified = classifyListing(base, 0);
    assert.equal(classified.state, "unknown");
    assert.equal(classified.signals.contentItemCount, 0);
    assert.match(classified.notice ?? "", /did not load/i);
  });
});

describe("mergeFrameLinks", () => {
  it("dedupes frame links by href and text and keeps main-frame order", () => {
    const main = [
      { href: "https://adam.unibas.ch/go/fold/100010", text: "Notes", inChrome: false, inBreadcrumb: false },
    ];
    const frames = [
      { href: "https://adam.unibas.ch/go/fold/100010", text: "Notes", inChrome: false, inBreadcrumb: false },
      { href: "https://adam.unibas.ch/go/file/100011", text: "00_Overview.pdf", inChrome: false, inBreadcrumb: false },
    ];
    const merged = mergeFrameLinks(main, frames);
    assert.deepEqual(merged.map((link) => link.text), ["Notes", "00_Overview.pdf"]);
  });
});

describe("shouldProbeOrigin", () => {
  const origin = "https://adam.unibas.ch";

  it("probes blank, foreign, root, and login URLs", () => {
    assert.equal(shouldProbeOrigin("about:blank", origin), true);
    assert.equal(shouldProbeOrigin("", origin), true);
    assert.equal(shouldProbeOrigin("https://adam.unibas.ch/", origin), true);
    assert.equal(shouldProbeOrigin("https://adam.unibas.ch/login.php", origin), true);
    assert.equal(shouldProbeOrigin("https://login.switch.ch/idp", origin), true);
    assert.equal(shouldProbeOrigin("http://[", origin), true);
  });

  it("trusts a signed-in dashboard or object page", () => {
    assert.equal(
      shouldProbeOrigin("https://adam.unibas.ch/ilias.php?baseClass=ilDashboardGUI&cmd=jumpToSelectedItems", origin),
      false,
    );
    assert.equal(shouldProbeOrigin("https://adam.unibas.ch/go/crs/2207365", origin), false);
  });
});

describe("BrowserAdamProvider with a memory session", () => {
  const overviewPdf = syntheticPdfWithText("Synthetic lecture overview");
  const session = createMemorySession(
    {
    home: snapshotFromHtml(
      "https://adam.unibas.ch/",
      "Schreibtisch",
      dashboardHtml,
      "Schreibtisch 00000-01 Written exam: 12 January 2027 News 00_Overview.pdf New file Abmelden",
    ),
    "https://adam.unibas.ch/": snapshotFromHtml(
      "https://adam.unibas.ch/",
      "Schreibtisch",
      dashboardHtml,
      "Schreibtisch 00000-01 Written exam: 12 January 2027 News 00_Overview.pdf New file Abmelden",
    ),
    "https://adam.unibas.ch/go/crs/100001": snapshotFromHtml(
      "https://adam.unibas.ch/go/crs/100001",
      "00000-01 – Synthetic Multimedia Seminar",
      courseHtml,
      "00000-01 Synthetic Multimedia Seminar Written exam: 12 January 2027 03 - Course & Notes 04 - Exercises Exercise 1 Retrieval summary Abmelden",
    ),
    "https://adam.unibas.ch/go/fold/100010": snapshotFromHtml(
      "https://adam.unibas.ch/go/fold/100010",
      "Notes",
      folderHtml,
      "03 - Course & Notes 00_Overview.pdf 04 - Exercises Abmelden",
    ),
    "https://adam.unibas.ch/go/fold/100020": snapshotFromHtml(
      "https://adam.unibas.ch/go/fold/100020",
      "04 - Exercises",
      emptyFolderHtml,
      "04 - Exercises This folder is empty Abmelden",
    ),
    "https://adam.unibas.ch/ilias.php?ref_id=100010": snapshotFromHtml(
      "https://adam.unibas.ch/ilias.php?ref_id=100010",
      "Notes",
      folderHtml,
      "03 - Course & Notes 00_Overview.pdf 04 - Exercises",
    ),
    "https://adam.unibas.ch/ilias.php?ref_id=100020": snapshotFromHtml(
      "https://adam.unibas.ch/ilias.php?ref_id=100020",
      "04 - Exercises",
      emptyFolderHtml,
      "04 - Exercises This folder is empty Abmelden",
    ),
    "https://adam.unibas.ch/go/file/100011": snapshotFromHtml(
      "https://adam.unibas.ch/go/file/100011",
      "00_Overview.pdf",
      fileHtml,
      "00_Overview.pdf Abmelden",
    ),
    "https://adam.unibas.ch/go/exc/100021": snapshotFromHtml(
      "https://adam.unibas.ch/go/exc/100021",
      "Exercise 1 – Retrieval summary",
      exerciseHtml,
      "Exercise 1 Retrieval summary Deadline: 22 September 2026 Write a one-page retrieval summary Abmelden",
    ),
    },
    {
      files: {
        "https://adam.unibas.ch/goto_adam_file_100011_download.html": {
          bytes: overviewPdf,
          contentType: "application/pdf",
        },
      },
    },
  );
  const provider = createBrowserProvider({ session, origin: "https://adam.unibas.ch" });

  it("lists courses from the signed-in dashboard", async () => {
    const listed = await provider.listCourses();
    assert.equal(listed.items[0]?.refId, "100001");
  });

  it("lists folder children including files", async () => {
    const children = await provider.listChildren("100010");
    assert.equal(children.items.some((item) => item.type === "file"), true);
    assert.equal(children.items.some((item) => item.refId === "100020"), true);
  });

  it("lists folder children via /go/fold when type is known", async () => {
    const children = await provider.listChildren("100010", { type: "fold" });
    assert.equal(children.items.some((item) => item.refId === "100011"), true);
  });

  it("returns course children from the same /go/crs snapshot", async () => {
    const course = await provider.getCourse("100001");
    const children = (course as { children?: Array<{ refId: string }> }).children ?? [];
    assert.equal(children.some((item) => item.refId === "100010"), true);
    assert.equal(children.some((item) => item.refId === "100021"), true);
  });

  it("throws not_found on ADAM failure pages", async () => {
    const locked = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession({
        "https://adam.unibas.ch/go/fold/999999": snapshotFromHtml(
          "https://adam.unibas.ch/go/fold/999999",
          "Failure Message",
          "<main><h1>Failure Message</h1><p>The requested page could not be found.</p></main>",
          "Failure Message The requested page could not be found.",
        ),
      }),
    });
    await assert.rejects(
      () => locked.listChildren("999999", { type: "fold" }),
      (error: unknown) => error instanceof AdamError && error.code === "not_found",
    );
  });

  it("searches enrolled course and folder titles, not every dashboard card", async () => {
    const overview = await provider.search("Overview");
    assert.equal(overview.items.some((item) => item.refId === "100011"), true);
    const exam = await provider.search("exam");
    assert.equal(exam.items.some((item) => item.refId === "100001"), true);
    assert.equal(exam.items.some((item) => item.refId === "100011"), false);
  });

  it("fuses dates from enrolled course pages and keeps empty folders distinct", async () => {
    const calendar = await provider.listCalendar();
    const exam = calendar.items.find((item) => /12 January 2027/i.test(item.title ?? ""));
    assert.ok(exam);
    assert.equal(exam?.source, "page");
    const empty = await provider.listChildren("100020");
    assert.deepEqual(empty.items, []);
  });

  it("reads dashboard news articles with canonical file URLs", async () => {
    const news = await provider.listNews();
    assert.equal(news.items.some((item) => item.url.includes("/go/file/100011")), true);
  });

  it("extracts PDF text from session bytes without exposing the blob", async () => {
    const extracted = await provider.extractFileText("100011");
    assert.match(extracted.pages[0]?.text ?? "", /Synthetic lecture overview/);
    assert.equal("bytes" in extracted, false);
    assert.doesNotMatch(JSON.stringify(extracted), /%PDF-/);
  });

  it("skips HTML download responses and extracts from the next candidate", async () => {
    const htmlThenPdf = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession(
        {
          "https://adam.unibas.ch/go/file/100011": snapshotFromHtml(
            "https://adam.unibas.ch/go/file/100011",
            "00_Overview.pdf",
            fileHtml,
            "00_Overview.pdf Abmelden",
          ),
        },
        {
          files: {
            "https://adam.unibas.ch/goto_adam_file_100011_download.html": {
              bytes: Buffer.from("<!DOCTYPE html><html><body>login</body></html>"),
              contentType: "text/html",
            },
            "https://adam.unibas.ch/go/file/100011": {
              bytes: overviewPdf,
              contentType: "application/pdf",
            },
          },
        },
      ),
    });
    const extracted = await htmlThenPdf.extractFileText("100011");
    assert.match(extracted.pages[0]?.text ?? "", /Synthetic lecture overview/);
  });

  it("reads an exercise as units and instructions without a submit action", async () => {
    const exercise = await provider.getExercise("100021");
    assert.equal(exercise.type, "exc");
    assert.match(exercise.units[0]?.instructionText ?? "", /retrieval summary/i);
    assert.equal(exercise.units[0]?.ownStatus, "unknown");
    assert.equal(exercise.units[0]?.deadline, "2026-09-22T00:00:00.000Z");
    assert.equal(exercise.provenance.provider, "browser");
    assert.match(exercise.url, /\/go\/exc\/100021$/);
  });

  it("treats the ADAM login page as unauthorized", async () => {
    const locked = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession({
        "https://adam.unibas.ch/": snapshotFromHtml(
          "https://adam.unibas.ch/login.php",
          "Bei ADAM anmelden: ADAM",
          loginHtml,
          "Bei ADAM anmelden Login mit Switch edu-ID",
        ),
      }),
    });
    await assert.rejects(() => locked.listCourses(), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "unauthorized");
      return true;
    });
  });

  it("refuses test objects", async () => {
    const exams = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession({
        "https://adam.unibas.ch/ilias.php?ref_id=900001": snapshotFromHtml(
          "https://adam.unibas.ch/go/tst/900001",
          "Klausur",
          "<main><h1>Klausur</h1></main>",
          "Klausur",
        ),
      }),
    });
    await assert.rejects(() => exams.readPage("900001", { type: "tst" }), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "unsupported_type");
      return true;
    });
  });
});

describe("login snapshot detection", () => {
  it("flags the public login page", () => {
    const snapshot = snapshotFromHtml(
      "https://adam.unibas.ch/login.php",
      "Bei ADAM anmelden: ADAM",
      loginHtml,
      "Bei ADAM anmelden Login mit Switch edu-ID",
    );
    assert.equal(isLoginSnapshot(snapshot), true);
  });
});

describe("AT5 getExercise browser harden", () => {
  it("extracts deadline only when labeled; omits unlabeled page dates", () => {
    const labeled = exerciseDeadlineFromPage("Deadline: 22 September 2026, 23:59.\nWrite a summary.");
    assert.equal(labeled, "2026-09-22T00:00:00.000Z");
    const unlabeled = exerciseDeadlineFromPage(
      "Published: 1 September 2026\nWritten exam: 12 January 2027\nWrite a summary.",
    );
    assert.equal(unlabeled, undefined);
  });

  it("fail-closes unknown types instead of coercing to exc", async () => {
    const hardened = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession({
        "https://adam.unibas.ch/go/exc/100099": snapshotFromHtml(
          "https://adam.unibas.ch/ilias.php?ref_id=100099",
          "Mystery object",
          "<main><h1>Mystery object</h1><p>Deadline: 22 September 2026</p><a href=\"/logout.php\">Abmelden</a></main>",
          "Mystery object Deadline: 22 September 2026 Abmelden",
        ),
      }),
    });
    await assert.rejects(() => hardened.getExercise("100099"), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "unsupported_type");
      assert.match(error.message, /unknown/i);
      return true;
    });
  });

  it("does not invent a deadline from unlabeled dates on a real exc page", async () => {
    const hardened = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession({
        "https://adam.unibas.ch/go/exc/100022": snapshotFromHtml(
          "https://adam.unibas.ch/go/exc/100022",
          "Exercise without labeled deadline",
          `<main>
  <h1>Exercise without labeled deadline</h1>
  <p>Published: 1 September 2026</p>
  <p>Write something before the exam on 12 January 2027.</p>
  <a href="/logout.php">Abmelden</a>
</main>`,
          "Exercise without labeled deadline Published: 1 September 2026 exam 12 January 2027 Abmelden",
        ),
      }),
    });
    const exercise = await hardened.getExercise("100022");
    assert.equal(exercise.type, "exc");
    assert.equal(exercise.units[0]?.deadline, undefined);
    assert.equal("deadline" in (exercise.units[0] ?? {}), false);
  });

  it("rejects fold pages opened via getExercise (no type coercion)", async () => {
    const hardened = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession({
        "https://adam.unibas.ch/go/exc/100020": snapshotFromHtml(
          "https://adam.unibas.ch/go/fold/100020",
          "04 - Exercises",
          emptyFolderHtml,
          "04 - Exercises This folder is empty Abmelden",
        ),
      }),
    });
    await assert.rejects(() => hardened.getExercise("100020"), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "unsupported_type");
      assert.match(error.message, /fold/i);
      return true;
    });
  });
});

describe("AT6 listCalendar provenance", () => {
  it("does not promote unlabeled dates on exc pages to source:exc", async () => {
    const hardened = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession({
        "https://adam.unibas.ch/": snapshotFromHtml(
          "https://adam.unibas.ch/",
          "Schreibtisch",
          `<main>
  <h1>Schreibtisch</h1>
  <a href="/go/crs/100001">00000-01 – Synthetic Multimedia Seminar</a>
  <a href="/logout.php">Abmelden</a>
</main>`,
          "Schreibtisch 00000-01 Synthetic Multimedia Seminar Abmelden",
        ),
        "https://adam.unibas.ch/go/crs/100001": snapshotFromHtml(
          "https://adam.unibas.ch/go/crs/100001",
          "00000-01 – Synthetic Multimedia Seminar",
          `<main>
  <h1>00000-01 – Synthetic Multimedia Seminar</h1>
  <a href="/go/exc/100022">Exercise without labeled deadline</a>
  <a href="/logout.php">Abmelden</a>
</main>`,
          "00000-01 Synthetic Multimedia Seminar Exercise without labeled deadline Abmelden",
        ),
        "https://adam.unibas.ch/go/exc/100022": snapshotFromHtml(
          "https://adam.unibas.ch/go/exc/100022",
          "Exercise without labeled deadline",
          `<main>
  <h1>Exercise without labeled deadline</h1>
  <p>Published: 1 September 2026</p>
  <p>Write something before the exam on 12 January 2027.</p>
  <a href="/logout.php">Abmelden</a>
</main>`,
          "Exercise without labeled deadline Published: 1 September 2026 exam 12 January 2027 Abmelden",
        ),
      }),
    });
    const calendar = await hardened.listCalendar();
    const fromExc = calendar.items.filter((item) => item.objectRefId === "100022");
    assert.ok(fromExc.length >= 1, `expected page dates from exc page, got ${JSON.stringify(calendar.items)}`);
    assert.equal(
      fromExc.every((item) => item.source === "page"),
      true,
      "unlabeled page dates on exc must stay source:page (FAIL-to-fix)",
    );
    assert.equal(fromExc.some((item) => item.source === "exc"), false);
  });

  it("surfaces labeled deadline as exc and keeps other page dates as page; dedup prefers exc", async () => {
    const hardened = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession({
        "https://adam.unibas.ch/": snapshotFromHtml(
          "https://adam.unibas.ch/",
          "Schreibtisch",
          `<main>
  <h1>Schreibtisch</h1>
  <a href="/go/crs/100001">00000-01 – Synthetic Multimedia Seminar</a>
  <a href="/logout.php">Abmelden</a>
</main>`,
          "Schreibtisch 00000-01 Synthetic Multimedia Seminar Abmelden",
        ),
        "https://adam.unibas.ch/go/crs/100001": snapshotFromHtml(
          "https://adam.unibas.ch/go/crs/100001",
          "00000-01 – Synthetic Multimedia Seminar",
          `<main>
  <h1>00000-01 – Synthetic Multimedia Seminar</h1>
  <a href="/go/exc/100021">Exercise 1 – Retrieval summary</a>
  <a href="/logout.php">Abmelden</a>
</main>`,
          "00000-01 Synthetic Multimedia Seminar Exercise 1 Retrieval summary Abmelden",
        ),
        "https://adam.unibas.ch/go/exc/100021": snapshotFromHtml(
          "https://adam.unibas.ch/go/exc/100021",
          "Exercise 1 – Retrieval summary",
          `<main>
  <h1>Exercise 1 – Retrieval summary</h1>
  <p>Published: 1 September 2026</p>
  <p>Deadline: 22 September 2026, 23:59.</p>
  <p>Write a one-page retrieval summary.</p>
  <a href="/logout.php">Abmelden</a>
</main>`,
          "Exercise 1 Retrieval summary Published: 1 September 2026 Deadline: 22 September 2026 Write a one-page retrieval summary Abmelden",
        ),
      }),
    });
    const calendar = await hardened.listCalendar();
    const published = calendar.items.find(
      (item) => item.objectRefId === "100021" && /September 2026/i.test(item.title ?? "") && item.source === "page" && item.startsAt?.startsWith("2026-09-01"),
    );
    assert.ok(published, `unlabeled published date stays page; items=${JSON.stringify(calendar.items)}`);

    const deadline = calendar.items.find((item) => item.objectRefId === "100021" && item.source === "exc");
    assert.ok(deadline, `expected labeled deadline as exc; items=${JSON.stringify(calendar.items)}`);
    assert.equal(deadline?.confidence, "explicit");
    assert.equal(deadline?.startsAt, "2026-09-22T00:00:00.000Z");

    // Same object+day: page copy of deadline must lose to exc.
    assert.equal(
      calendar.items.filter(
        (item) => item.objectRefId === "100021" && item.startsAt?.startsWith("2026-09-22"),
      ).length,
      1,
    );
  });
});


describe("A2-news-browser listNews onProgress", () => {
  const session = createMemorySession({
    "https://adam.unibas.ch/": snapshotFromHtml(
      "https://adam.unibas.ch/",
      "Schreibtisch",
      dashboardHtml,
      "Schreibtisch 00000-01 Written exam: 12 January 2027 News 00_Overview.pdf New file Abmelden",
    ),
    "https://adam.unibas.ch/go/crs/100001": snapshotFromHtml(
      "https://adam.unibas.ch/go/crs/100001",
      "00000-01 – Synthetic Multimedia Seminar",
      courseHtml,
      "00000-01 Written exam: 12 January 2027 Course Notes Exercises Exercise 1 Abmelden",
    ),
    "https://adam.unibas.ch/go/fold/100010": snapshotFromHtml(
      "https://adam.unibas.ch/go/fold/100010",
      "03 - Course & Notes",
      folderHtml,
      "03 - Course Notes 00_Overview.pdf Abmelden",
    ),
    "https://adam.unibas.ch/go/fold/100020": snapshotFromHtml(
      "https://adam.unibas.ch/go/fold/100020",
      "04 - Exercises",
      emptyFolderHtml,
      "04 - Exercises This folder is empty Abmelden",
    ),
    "https://adam.unibas.ch/go/exc/100021": snapshotFromHtml(
      "https://adam.unibas.ch/go/exc/100021",
      "Exercise 1 – Retrieval summary",
      exerciseHtml,
      "Exercise 1 Retrieval summary Deadline: 22 September 2026 Abmelden",
    ),
  });
  const provider = createBrowserProvider({ session, origin: "https://adam.unibas.ch" });

  it("emits progress during the live page walk when onProgress is set", async () => {
    const seen: Array<{ progress: number; total?: number; message?: string }> = [];
    const news = await provider.listNews({
      onProgress: async (update) => {
        seen.push(update);
      },
    });
    assert.ok(seen.length >= 1, `expected progress during news walk; got ${seen.length}`);
    assert.ok(seen.every((step) => step.progress >= 1));
    assert.ok(seen.every((step) => typeof step.message === "string" && /news:/i.test(step.message ?? "")));
    assert.equal(news.items.some((item) => item.url.includes("/go/file/100011")), true);
  });

  it("stays silent when onProgress is omitted", async () => {
    // Omit onProgress — walk must complete without requiring a reporter.
    const news = await provider.listNews();
    assert.equal(news.items.some((item) => item.url.includes("/go/file/100011")), true);
  });

  it("keeps AT4 honesty: HTTPS provenance, since filter, no Magazin invention", async () => {
    const news = await provider.listNews();
    assert.ok(news.items.length >= 1);
    for (const item of news.items) {
      assert.match(item.url, /^https:\/\/adam\.unibas\.ch\//);
      assert.equal(item.provenance.provider, "browser");
      assert.match(item.provenance.sourceUrl, /^https:\/\/adam\.unibas\.ch\//);
      assert.equal(typeof item.provenance.fetchedAt, "string");
    }
    // Magazin nav is present in the dashboard fixture HTML but must not invent Magazin news.
    assert.equal(news.items.some((item) => /Magazin/i.test(item.title) || item.url.includes("/go/root/")), false);

    const recent = await provider.listNews({ since: "2026-09-01T00:00:00.000Z" });
    assert.equal(recent.items.some((item) => item.url.includes("/go/file/100011")), true);

    const future = await provider.listNews({ since: "2099-01-01T00:00:00.000Z" });
    assert.deepEqual(future.items, []);
  });
});

describe("ADR 0005 listing honesty", () => {
  it("marks populated folder listings ok and honest empty folds empty", async () => {
    const honest = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession({
        "https://adam.unibas.ch/go/fold/100010": snapshotFromHtml(
          "https://adam.unibas.ch/go/fold/100010",
          "Notes",
          folderHtml,
          "03 - Course & Notes 00_Overview.pdf 04 - Exercises Abmelden",
        ),
        "https://adam.unibas.ch/go/fold/100020": snapshotFromHtml(
          "https://adam.unibas.ch/go/fold/100020",
          "04 - Exercises",
          emptyFolderHtml,
          "04 - Exercises This folder is empty Abmelden",
        ),
      }),
    });
    const children = await honest.listChildren("100010", { type: "fold" });
    assert.equal(children.listingState, "ok");
    assert.ok(children.items.length > 0);
    const empty = await honest.listChildren("100020", { type: "fold" });
    assert.deepEqual(empty.items, []);
    assert.equal(empty.listingState, "empty");
  });

  it("marks chrome-only folder snapshots unknown, never empty", async () => {
    const chromeOnly = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession({
        "https://adam.unibas.ch/go/fold/100099": snapshotFromHtml(
          "https://adam.unibas.ch/ilias.php?baseClass=ilrepositorygui&cmdNode=xs:nl&cmdClass=ilobjfoldergui&ref_id=100099&item_ref_id=0",
          "Content: Mystery folder: ADAM",
          "<main><h1>Mystery folder</h1><p>Content Info</p></main>",
          "ADAM Search Dashboard Content (Selected) Info Accessibility Rendered by its-ilias-web-prod-04 - 10.11",
        ),
      }),
    });
    const listed = await chromeOnly.listChildren("100099", { type: "fold" });
    assert.deepEqual(listed.items, []);
    assert.equal(listed.listingState, "unknown");
  });

  it("parses ILIAS container item titles with parent ref_id cmdClass hrefs", async () => {
    const ks = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession({
        "https://adam.unibas.ch/go/fold/100010": snapshotFromHtml(
          "https://adam.unibas.ch/go/fold/100010",
          "03 - Course & Notes",
          `<nav aria-label="Brotkrumen"><a href="/go/crs/100001">Course</a></nav>
<main>
  <h1>03 - Course & Notes</h1>
  <div class="ilContainerListItemOuter">
    <div class="il_ContainerItemTitle">
      <a class="il_ContainerItemTitle" href="https://adam.unibas.ch/ilias.php?ref_id=100011&cmdClass=ilobjfilegui&cmdNode=ab:cd">00_Overview.pdf</a>
    </div>
  </div>
  <div class="ilContainerListItemOuter">
    <div class="il_ContainerItemTitle">
      <a class="il_ContainerItemTitle" href="https://adam.unibas.ch/ilias.php?ref_id=100020&cmdClass=ilobjfoldergui&cmdNode=ef:gh">04 - Exercises</a>
    </div>
  </div>
  <a href="/logout.php">Abmelden</a>
</main>`,
          "03 - Course & Notes 00_Overview.pdf 04 - Exercises Abmelden",
        ),
      }),
    });
    const children = await ks.listChildren("100010", { type: "fold" });
    assert.ok(children.items.some((item) => item.refId === "100011" && item.type === "file"));
    assert.ok(children.items.some((item) => item.refId === "100020" && item.type === "fold"));
    assert.equal(children.listingState, "ok");
  });

  it("populated KS HTML plus [] is a scrape-miss FAIL never honest empty", async () => {
    const toy = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession({
        "https://adam.unibas.ch/go/fold/100010": snapshotFromHtml(
          "https://adam.unibas.ch/go/fold/100010",
          "Notes",
          folderHtml,
          "03 - Course & Notes 00_Overview.pdf 04 - Exercises Abmelden",
        ),
      }),
    });
    const children = await toy.listChildren("100010", { type: "fold" });
    assert.notDeepEqual(children.items, []);
  });
});

describe("PERF-1 slim walk snapshots + shared memo + unknown fast-fail", () => {
  it("slims retained walk pages: no html body; byte proxy smaller than full snapshot", () => {
    const fatHtml = `${folderHtml}\n<!-- ${"x".repeat(20_000)} -->`;
    const snapshot = snapshotFromHtml(
      "https://adam.unibas.ch/go/fold/100010",
      "03 - Course & Notes",
      fatHtml,
      "03 - Course Notes 00_Overview.pdf Abmelden",
    );
    const catalog = extractCatalog(snapshot, "2026-09-09T08:00:00.000Z");
    const retained = retainWalkPage(snapshot, catalog);
    assert.equal("html" in retained, false);
    assert.equal("links" in retained, false);
    assert.equal(retained.url, snapshot.url);
    assert.ok(retained.catalog.objects.length > 0);
    assert.ok(typeof retained.catalog.text === "string");
    const slim = walkRetentionByteProxy(retained);
    const full = fullSnapshotByteProxy(snapshot);
    assert.ok(slim < full, `expected slim ${slim} < full ${full}`);
    // Across MAX_LIVE_PAGES (48) the retained shape stays without html.
    let slimSum = 0;
    let fullSum = 0;
    for (let i = 0; i < 48; i += 1) {
      slimSum += slim;
      fullSum += full;
    }
    assert.ok(slimSum < fullSum);
  });

  it("shares collectLivePages memo across search/calendar/news; invalidate on close()", async () => {
    const opens: string[] = [];
    const session = createMemorySession(
      {
        "https://adam.unibas.ch/": snapshotFromHtml(
          "https://adam.unibas.ch/",
          "Schreibtisch",
          dashboardHtml,
          "Schreibtisch 00000-01 Written exam: 12 January 2027 News 00_Overview.pdf New file Abmelden",
        ),
        "https://adam.unibas.ch/go/crs/100001": snapshotFromHtml(
          "https://adam.unibas.ch/go/crs/100001",
          "00000-01 – Synthetic Multimedia Seminar",
          courseHtml,
          "00000-01 Written exam: 12 January 2027 Course Notes Exercises Exercise 1 Abmelden",
        ),
        "https://adam.unibas.ch/go/fold/100010": snapshotFromHtml(
          "https://adam.unibas.ch/go/fold/100010",
          "03 - Course & Notes",
          folderHtml,
          "03 - Course Notes 00_Overview.pdf Abmelden",
        ),
        "https://adam.unibas.ch/go/fold/100020": snapshotFromHtml(
          "https://adam.unibas.ch/go/fold/100020",
          "04 - Exercises",
          emptyFolderHtml,
          "04 - Exercises This folder is empty Abmelden",
        ),
        "https://adam.unibas.ch/go/exc/100021": snapshotFromHtml(
          "https://adam.unibas.ch/go/exc/100021",
          "Exercise 1 – Retrieval summary",
          exerciseHtml,
          "Exercise 1 Retrieval summary Deadline: 22 September 2026 Abmelden",
        ),
      },
      { onOpen: (url) => opens.push(url) },
    );
    const provider = createBrowserProvider({ session, origin: "https://adam.unibas.ch" });

    await provider.search("exam");
    const afterSearch = opens.length;
    assert.ok(afterSearch >= 2, `expected enrolled walk opens; got ${afterSearch}`);

    await provider.listCalendar();
    assert.equal(opens.length, afterSearch, "calendar must reuse walk memo (no re-walk)");

    const progress: unknown[] = [];
    await provider.listNews({
      onProgress: async (update) => {
        progress.push(update);
      },
    });
    assert.equal(opens.length, afterSearch, "news must reuse walk memo (no re-walk)");
    // Memo hit: no progress callbacks (reuse path is silent).
    assert.deepEqual(progress, []);

    await provider.close();
    await provider.search("exam");
    assert.ok(opens.length > afterSearch, "close() invalidates memo; next walk re-opens");
  });

  it("unknown list_children returns immediately; ≤1 retry; no TYPE_PROBE storm", async () => {
    const opens: string[] = [];
    const unknownFold = snapshotFromHtml(
      "https://adam.unibas.ch/ilias.php?baseClass=ilrepositorygui&cmdClass=ilobjfoldergui&ref_id=100099",
      "Content: Mystery folder: ADAM",
      `<nav aria-label="Hauptnavigationsleiste"><a href="/go/fold/888888">Chrome trap</a></nav>
<main><h1>Mystery folder</h1><p>Content Info</p></main>`,
      "ADAM Search Dashboard Content (Selected) Info Accessibility Rendered by its-ilias-web-prod-04 - 10.11",
    );
    const notFound = (type: string) =>
      snapshotFromHtml(
        `https://adam.unibas.ch/go/${type}/100099`,
        "Failure Message",
        "<main><h1>Failure Message</h1><p>The requested page could not be found.</p></main>",
        "Failure Message The requested page could not be found.",
      );

    // Typed list: one open, unknown, never coerce to empty, no further probes.
    const typedOpens: string[] = [];
    const typed = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession(
        {
          "https://adam.unibas.ch/go/fold/100099": unknownFold,
        },
        { onOpen: (url) => typedOpens.push(url) },
      ),
    });
    const listed = await typed.listChildren("100099", { type: "fold" });
    assert.equal(listed.listingState, "unknown");
    assert.deepEqual(listed.items, []);
    assert.ok(listed.notice);
    assert.equal(typedOpens.length, 1, `expected single open, got ${typedOpens.join(",")}`);

    // Untyped list against all-not-found: ≤2 probes (preferred absent → ≤1 retry budget), not full TYPE_PROBE_ORDER.
    const storm = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession(
        {
          "https://adam.unibas.ch/go/crs/100099": notFound("crs"),
          "https://adam.unibas.ch/go/fold/100099": notFound("fold"),
          "https://adam.unibas.ch/go/file/100099": notFound("file"),
          "https://adam.unibas.ch/go/exc/100099": notFound("exc"),
          "https://adam.unibas.ch/go/cat/100099": notFound("cat"),
        },
        { onOpen: (url) => opens.push(url) },
      ),
    });
    await assert.rejects(() => storm.listChildren("100099"), (error: unknown) => {
      return error instanceof AdamError && error.code === "not_found";
    });
    assert.ok(opens.length <= 2, `TYPE_PROBE storm: ${opens.length} opens (${opens.join(",")})`);
    assert.ok(opens.length >= 1);
  });

  it("walk prunes unknown listing branches; continues enrolled ok branches; never Magazin-only", async () => {
    const opens: string[] = [];
    const unknownFoldHtml = `<nav aria-label="Hauptnavigationsleiste"><a href="/go/fold/888888">Chrome trap</a></nav>
<main><h1>Mystery folder</h1><p>Content Info</p></main>`;
    const courseWithUnknown = `
<nav aria-label="Brotkrumen"><a href="/go/root/1">ADAM</a></nav>
<main>
  <h1>00000-01 – Synthetic Multimedia Seminar</h1>
  <a href="/go/fold/100099">Mystery folder</a>
  <a href="/go/fold/100010">03 - Course &amp; Notes</a>
  <a href="/go/exc/100021">Exercise 1 – Retrieval summary</a>
  <a href="/logout.php">Abmelden</a>
</main>`;
    const provider = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession(
        {
          "https://adam.unibas.ch/": snapshotFromHtml(
            "https://adam.unibas.ch/",
            "Schreibtisch",
            dashboardHtml,
            "Schreibtisch 00000-01 Written exam Abmelden",
          ),
          "https://adam.unibas.ch/go/crs/100001": snapshotFromHtml(
            "https://adam.unibas.ch/go/crs/100001",
            "00000-01 – Synthetic Multimedia Seminar",
            courseWithUnknown,
            "00000-01 Mystery folder Course Notes Exercise 1 Abmelden",
          ),
          "https://adam.unibas.ch/go/fold/100099": snapshotFromHtml(
            "https://adam.unibas.ch/go/fold/100099",
            "Content: Mystery folder: ADAM",
            unknownFoldHtml,
            "ADAM Search Dashboard Content (Selected) Info Accessibility Rendered by its-ilias-web-prod-04 - 10.11",
          ),
          "https://adam.unibas.ch/go/fold/100010": snapshotFromHtml(
            "https://adam.unibas.ch/go/fold/100010",
            "03 - Course & Notes",
            folderHtml,
            "03 - Course Notes 00_Overview.pdf Abmelden",
          ),
          "https://adam.unibas.ch/go/fold/100020": snapshotFromHtml(
            "https://adam.unibas.ch/go/fold/100020",
            "04 - Exercises",
            emptyFolderHtml,
            "04 - Exercises This folder is empty Abmelden",
          ),
          "https://adam.unibas.ch/go/exc/100021": snapshotFromHtml(
            "https://adam.unibas.ch/go/exc/100021",
            "Exercise 1 – Retrieval summary",
            exerciseHtml,
            "Exercise 1 Deadline: 22 September 2026 Abmelden",
          ),
          "https://adam.unibas.ch/go/fold/888888": snapshotFromHtml(
            "https://adam.unibas.ch/go/fold/888888",
            "Should not open",
            "<main><h1>trap</h1></main>",
            "trap",
          ),
        },
        { onOpen: (url) => opens.push(url) },
      ),
    });

    const found = await provider.search("Overview");
    assert.equal(found.items.some((item) => item.refId === "100011"), true);
    assert.equal(
      opens.some((url) => url.includes("888888")),
      false,
      `Magazin/chrome trap must not be crawled: ${opens.join(",")}`,
    );
    assert.equal(opens.some((url) => url.includes("100099")), true, "unknown fold is visited once");
    assert.equal(opens.some((url) => url.includes("100010")), true, "ok fold still walked");
    assert.equal(opens.some((url) => url.includes("/go/exc/100021")), true, "ok exc still walked");
  });

  it("direct readPage still full-opens (not walk-cache only)", async () => {
    const opens: string[] = [];
    const provider = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession(
        {
          "https://adam.unibas.ch/go/fold/100010": snapshotFromHtml(
            "https://adam.unibas.ch/go/fold/100010",
            "03 - Course & Notes",
            folderHtml,
            "03 - Course Notes 00_Overview.pdf Abmelden",
          ),
        },
        { onOpen: (url) => opens.push(url) },
      ),
    });
    const page = await provider.readPage("100010", { type: "fold" });
    assert.match(page.text, /Course/);
    assert.equal(opens.length, 1);
  });
});

describe("probe type caching", () => {
  it("does not cache the probed type when the landing URL is unknown", async () => {
    const opens: string[] = [];
    const provider = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession(
        {
          "https://adam.unibas.ch/go/fold/100010": snapshotFromHtml(
            "https://adam.unibas.ch/ilias.php?ref_id=100010&item_ref_id=0",
            "03 - Course & Notes",
            folderHtml,
            "03 - Course & Notes 00_Overview.pdf Abmelden",
          ),
        },
        { onOpen: (url) => opens.push(url) },
      ),
    });

    const first = await provider.listChildren("100010");
    assert.equal(first.items.some((item) => item.refId === "100011"), true);
    assert.ok(opens.length >= 1);

    opens.length = 0;
    await provider.listChildren("100010");
    assert.deepEqual(
      opens.map((url) => new URL(url).pathname),
      ["/go/crs/100010", "/go/fold/100010"],
      "an unknown landing must not confirm the fold probe; crs is probed again",
    );
  });
});
