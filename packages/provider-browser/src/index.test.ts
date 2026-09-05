import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdamError, syntheticPdfWithText } from "adam-core";
import { hostnameAllowed, urlAllowed } from "./allowlist.ts";
import { createBrowserProvider } from "./browser-provider.ts";
import { extractCatalog, inferDates, isLoginSnapshot } from "./extract.ts";
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

  it("searches enrolled course and folder titles, not every dashboard card", async () => {
    const overview = await provider.search("Overview");
    assert.equal(overview.items.some((item) => item.refId === "100011"), true);
    const exam = await provider.search("exam");
    assert.equal(exam.items.some((item) => item.refId === "100001"), true);
    assert.equal(exam.items.some((item) => item.refId === "100011"), false);
  });

  it("fuses dates from enrolled course pages and keeps empty folders distinct", async () => {
    const calendar = await provider.listCalendar();
    assert.equal(calendar.items.some((item) => /12 January 2027/i.test(item.title)), true);
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
    await assert.rejects(() => exams.readPage("900001"), (error: unknown) => {
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
