import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AdamError, NOTE_TEXT_LIMIT } from "adam-core";
import { createBrowserProvider } from "./browser-provider.ts";
import { isNotesLanding, NOTES_URL, notesListingState, originRefId, parseNotes } from "./notes-parse.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

/**
 * ADR 0063: captures from the local ILIAS 10.12 lab (tools/ilias-lab/seed/capture-notes.mjs), seeded
 * with synthetic notes as lab.student. The lab serves http://localhost:8080; the markup is rebased
 * onto the pinned origin before parsing, the same way ADR 0060 fixtures are used.
 */
const origin = "https://adam.unibas.ch";
const lab = (name: string) => {
  const fixture = JSON.parse(readFileSync(new URL(`../fixtures/lab/${name}.json`, import.meta.url), "utf8")) as { html: string };
  return fixture.html.replaceAll("http://localhost:8080", origin);
};
const LANDING = `${origin}/ilias.php?baseClass=ildashboardgui&cmdNode=a4:uo:kn&cmdClass=ilNoteGUI&cmd=getNotesHTML&note_type=1`;

/** One note item in the ILIAS 10.12 shape seen on the lab (overview and object modal share it). */
const item = (noteId: string, text: string, origin?: string) => `
<li class="il-std-item-container"><div class="il-item il-std-item "><h4 class="il-item-title">17. Nov 2026</h4>
<div class="il-item-actions"><div class="dropdown"><ul class="dropdown-menu"><li><button data-action="ilias.php?baseClass=ildashboardgui&amp;cmdNode=a4:uo:kn&amp;cmdClass=ilNoteGUI&amp;cmd=editNoteForm&amp;note_type=1&amp;note_id=${noteId}#note_${noteId}">Edit</button></li></ul></div></div>
<div class="il-item-description">${text}</div><hr class="il-item-divider"><div class="row">
<div class="col-md-6"><span class="il-item-property-name">Origin</span><span class="il-item-property-value">${origin ?? ""}</span></div>
<div class="col-md-6"><span class="il-item-property-name"></span><span class="il-item-property-value"></span></div></div></div></li>`;
const page = (items: string) => `<div id="ilNotes"><div class="panel il-panel-listing-std-container"><div class="il-item-group"><div class="il-item-group-items"><ul>${items}</ul></div></div></div></div>`;

describe("ADR 0063: Private Notes landing and origin allowlist", () => {
  it("accepts only the private notes list landing (note_type=1), not comments or other pages", () => {
    assert.equal(isNotesLanding(LANDING), true);
    assert.equal(isNotesLanding(LANDING.replace("note_type=1", "note_type=2")), false, "public comments");
    assert.equal(isNotesLanding(LANDING.replace("getNotesHTML", "getCommentsHTML")), false);
    assert.equal(isNotesLanding(`${origin}/ilias.php?baseClass=ilDashboardGUI`), false, "redirect to dashboard");
    assert.equal(isNotesLanding(LANDING.replace(origin, "https://example.org")), false, "foreign origin");
  });

  it("reads only the ref_id of an info-screen origin link; export, edit, token and foreign links yield nothing", () => {
    assert.equal(originRefId("ilias.php?baseClass=ilrepositorygui&cmd=infoScreen&ref_id=97#note_3"), "97");
    assert.equal(originRefId(`${origin}/ilias.php?baseClass=ilrepositorygui&amp;cmd=infoScreen&amp;ref_id=86`), "86");
    assert.equal(originRefId("ilias.php?baseClass=ildashboardgui&cmdClass=ilNoteGUI&cmd=exportNotesHTML&note_id=3"), undefined);
    assert.equal(originRefId("ilias.php?baseClass=ilrepositorygui&cmd=infoScreen&ref_id=97&rtoken=ab"), undefined);
    assert.equal(originRefId("ilias.php?baseClass=ilrepositorygui&cmd=infoScreen&ref_id=1%202"), undefined);
    assert.equal(originRefId("ilias.php?baseClass=ilrepositorygui&cmd=infoScreen&ref_id=97&ref_id=98"), undefined);
    assert.equal(originRefId("https://example.org/ilias.php?baseClass=ilrepositorygui&cmd=infoScreen&ref_id=97"), undefined);
    assert.equal(originRefId("ilias.php?baseClass=ilrepositorygui&cmd=delete&ref_id=97"), undefined);
  });
});

describe("ADR 0063: parseNotes on ILIAS 10.12 lab markup", () => {
  it("parses the overview: text, date as shown, note ids and the Origin object; no action links kept", () => {
    const parsed = parseNotes(lab("notes-overview-student"), new Date("2026-11-17T12:00:00Z"));
    assert.equal(parsed.notesFound, true);
    assert.equal(parsed.skipped, 0);
    assert.deepEqual(
      parsed.notes.map((note) => [note.noteId, note.text, note.objectTitle, note.objectRefId, note.shownAt]),
      [
        ["3", "Lab note 3: synthetic note on the Lab bibliography object.", "Lab bibl", "97", "2026-11-17T00:00:00.000Z"],
        ["2", "Lab note 2: synthetic second note on the same course.", "Lab Course", "86", "2026-11-17T00:00:00.000Z"],
        ["1", "Lab note 1: synthetic reminder for the Lab Course (not real content).", "Lab Course", "86", "2026-11-17T00:00:00.000Z"],
      ],
    );
    assert.equal(notesListingState(parsed), "ok");
    const serialized = JSON.stringify(parsed);
    assert.doesNotMatch(serialized, /editNoteForm|deleteNote|exportNotes|setSortation|rtoken|cmdClass|showPublicComments/);
  });

  it("parses an object's notes modal (no Origin property) without inventing origin fields", () => {
    const parsed = parseNotes(lab("notes-object-student"));
    assert.equal(parsed.notesFound, true);
    assert.ok(parsed.notes.length >= 2, "both course notes are listed");
    assert.ok(parsed.notes.every((note) => note.objectRefId === undefined), "the object's own list shows no Origin");
    assert.match(parsed.notes.map((note) => note.text).join("\n"), /Lab note 1/);
  });

  it("honest state: no container → unknown; empty container → empty; unreadable items → unknown with skipped count", () => {
    assert.deepEqual(parseNotes("<main>Notes</main>"), { notesFound: false, notes: [], skipped: 0 });
    assert.equal(notesListingState(parseNotes("<main>Notes</main>")), "unknown");

    const empty = parseNotes(`<div id="ilNotes"><div class="alert alert-info">No notes have been attached yet.</div></div>`);
    assert.equal(notesListingState(empty), "empty");

    const unreadable = parseNotes(`<div id="ilNotes"><ul><li class="il-std-item-container"><div class="il-item"><h4 class="il-item-title">17. Nov 2026</h4></div></li></ul></div>`);
    assert.equal(unreadable.skipped, 1);
    assert.equal(notesListingState(unreadable), "unknown", "an unreadable item is not an empty list");
  });

  it("caps note text at NOTE_TEXT_LIMIT and flags it; redacts email addresses; drops markup and scripts", () => {
    const long = "x".repeat(NOTE_TEXT_LIMIT + 500);
    const parsed = parseNotes(page(item("9", `${long}`) + item("8", `Mail a.student@example.org<script>alert(1)</script><br>line two &amp; more`)));
    assert.equal(parsed.notes[0]!.text.length, NOTE_TEXT_LIMIT);
    assert.equal(parsed.notes[0]!.truncated, true);
    assert.equal(parsed.notes[1]!.truncated, undefined);
    assert.equal(parsed.notes[1]!.text, "Mail [redacted-email]\nline two & more");
    assert.doesNotMatch(JSON.stringify(parsed), /alert|<script|a\.student@example/);
  });
});

describe("ADR 0063: BrowserAdamProvider.listNotes", () => {
  const build = (pages: Record<string, ReturnType<typeof snapshotFromHtml>>) => {
    const opened: string[] = [];
    const session = createMemorySession(pages, { onOpen: (url) => opened.push(url) });
    return { provider: createBrowserProvider({ session, origin }), opened };
  };

  it("opens only the fixed notes route; cursor pages reuse the snapshot; no link or token in the output", async () => {
    const { provider, opened } = build({ [NOTES_URL]: snapshotFromHtml(LANDING, "Private Notes", lab("notes-overview-student"), "Private Notes") });
    const first = await provider.listNotes({ limit: 2 });
    assert.deepEqual(first.items.map((note) => note.noteId), ["3", "2"]);
    assert.ok(first.nextCursor);
    const next = await provider.listNotes({ cursor: first.nextCursor });
    assert.deepEqual(next.items.map((note) => note.noteId), ["1"]);
    assert.deepEqual(opened, [NOTES_URL], "cursor page does not re-open; no other route opened");
    assert.equal(first.items[0]!.provenance.sourceUrl, NOTES_URL);
  });

  it("refuses a landing that is not the notes list, and a cursor with refresh", async () => {
    const elsewhere = build({ [NOTES_URL]: snapshotFromHtml(`${origin}/ilias.php?baseClass=ildashboardgui`, "Dashboard", "<main></main>", "Dashboard") });
    await assert.rejects(() => elsewhere.provider.listNotes(), (error: unknown) => error instanceof AdamError && error.code === "provider_unavailable");
    const { provider } = build({ [NOTES_URL]: snapshotFromHtml(LANDING, "Private Notes", lab("notes-overview-student"), "") });
    await assert.rejects(() => provider.listNotes({ refresh: true, cursor: "abc" }), (error: unknown) => error instanceof AdamError && error.code === "stale_id");
  });

  it("an unrecognised page is unknown with a notice, never empty", async () => {
    const { provider } = build({ [NOTES_URL]: snapshotFromHtml(LANDING, "Private Notes", "<main>Notes</main>", "Notes") });
    const page = await provider.listNotes();
    assert.equal(page.listingState, "unknown");
    assert.match(page.notice ?? "", /not proof there are no notes/);
  });
});
