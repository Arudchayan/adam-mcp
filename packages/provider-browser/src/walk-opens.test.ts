import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBrowserProvider } from "./browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

const dashboardHtml = `
<nav aria-label="Hauptnavigationsleiste"><a href="/go/root/1">Magazin</a></nav>
<main>
  <h1>Schreibtisch</h1>
  <a href="/go/crs/100001">Synthetic course</a>
  <a href="/logout.php">Abmelden</a>
</main>
`;

const courseHtml = `
<nav aria-label="Brotkrumen"><a href="/go/root/1">ADAM</a></nav>
<main>
  <h1>Synthetic course</h1>
  <p>Written exam: 12 January 2027.</p>
  <a href="/go/fold/100010">Notes</a>
  <a href="/go/fold/100020">Exercises</a>
  <a href="/go/exc/100021">Exercise 1</a>
  <a href="/go/file/100011">00_Overview.pdf</a>
  <a href="/logout.php">Abmelden</a>
</main>
`;

const notesHtml = `
<nav aria-label="Brotkrumen"><a href="/go/crs/100001">Synthetic course</a></nav>
<main>
  <h1>Notes</h1>
  <a href="/go/file/100011">00_Overview.pdf</a>
  <a href="/go/fold/100020">Exercises</a>
  <a href="https://adam.unibas.ch/ilias.php?ref_id=100012">Mystery item</a>
  <a href="/logout.php">Abmelden</a>
</main>
`;

const emptyFolderHtml = `
<nav aria-label="Brotkrumen"><a href="/go/crs/100001">Synthetic course</a></nav>
<main>
  <h1>Exercises</h1>
  <p>This folder is empty.</p>
  <a href="/logout.php">Abmelden</a>
</main>
`;

const exerciseHtml = `
<main>
  <h1>Exercise 1</h1>
  <p>Deadline: 22 September 2026.</p>
  <a href="/logout.php">Abmelden</a>
</main>
`;

describe("enrolled walk open bound", () => {
  it("opens each course, folder, and exercise once and never opens files", async () => {
    const opens: string[] = [];
    const provider = createBrowserProvider({
      origin: "https://adam.unibas.ch",
      session: createMemorySession(
        {
          "https://adam.unibas.ch/": snapshotFromHtml(
            "https://adam.unibas.ch/",
            "Schreibtisch",
            dashboardHtml,
            "Schreibtisch Synthetic course Abmelden",
          ),
          "https://adam.unibas.ch/go/crs/100001": snapshotFromHtml(
            "https://adam.unibas.ch/go/crs/100001",
            "Synthetic course",
            courseHtml,
            "Synthetic course Written exam: 12 January 2027 Notes Exercises Exercise 1 00_Overview.pdf Abmelden",
          ),
          "https://adam.unibas.ch/go/fold/100010": snapshotFromHtml(
            "https://adam.unibas.ch/go/fold/100010",
            "Notes",
            notesHtml,
            "Notes 00_Overview.pdf Exercises Mystery item Abmelden",
          ),
          "https://adam.unibas.ch/go/fold/100020": snapshotFromHtml(
            "https://adam.unibas.ch/go/fold/100020",
            "Exercises",
            emptyFolderHtml,
            "Exercises This folder is empty Abmelden",
          ),
          "https://adam.unibas.ch/go/exc/100021": snapshotFromHtml(
            "https://adam.unibas.ch/go/exc/100021",
            "Exercise 1",
            exerciseHtml,
            "Exercise 1 Deadline: 22 September 2026 Abmelden",
          ),
          "https://adam.unibas.ch/go/file/100011": snapshotFromHtml(
            "https://adam.unibas.ch/go/file/100011",
            "00_Overview.pdf",
            "<main><h1>00_Overview.pdf</h1></main>",
            "00_Overview.pdf",
          ),
        },
        { onOpen: (url) => opens.push(url) },
      ),
    });

    const calendar = await provider.listCalendar();
    assert.deepEqual(opens, [
      "https://adam.unibas.ch",
      "https://adam.unibas.ch/go/crs/100001",
      "https://adam.unibas.ch/go/fold/100010",
      "https://adam.unibas.ch/go/fold/100020",
      "https://adam.unibas.ch/go/exc/100021",
    ]);
    assert.equal(calendar.items.some((item) => item.source === "exc"), true);

    const found = await provider.search("Overview");
    await provider.listNews();
    assert.equal(opens.length, 5, "search and news must reuse the walk memo");
    assert.equal(
      found.items.some((item) => item.type === "file" && item.refId === "100011"),
      true,
    );
  });
});
