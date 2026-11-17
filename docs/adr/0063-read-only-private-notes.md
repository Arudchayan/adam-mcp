# ADR 0063: Read-only Private Notes (lab-verified)

## Status

Accepted. Supersedes the Private Notes part of ADR 0056 (deferred). Evidence is from the local ILIAS 10.12 lab (`tools/ilias-lab`), not from ADAM. Live ADAM verification with a student who has notes is pending.

## Context

ADR 0056 deferred `adam_list_notes`. The only live probe was the student's Private Notes page with 0 notes, so the item markup that carries note text and origin was unverified. Notes are personal free text, and a parser written blind could leak or misattribute them.

The local lab runs the same ILIAS version as ADAM (10.12). Its student account was seeded through the Notes UI with synthetic notes only (`tools/ilias-lab/seed/seed-notes.mjs`), and the markup was captured with `tools/ilias-lab/seed/capture-notes.mjs`:

- **Overview route.** The Private Notes entry of the main bar is `ilias.php?baseClass=ildashboardgui&cmdClass=ilPDNotesGUI&cmd=showPrivateNotes&note_type=1`. ILIAS lands on `cmdClass=ilNoteGUI&cmd=getNotesHTML&note_type=1`. The bare route, without `cmdNode`, lands on the same page.
- **Item markup.** Notes are grouped by origin: `div.il-item-group > h3` is the object title, and each `li.il-std-item-container` holds an `h4.il-item-title` (the date, day only, such as "17. Nov 2026"), a `div.il-item-description` (the text), and a row of `il-item-property-name` "Origin" / `il-item-property-value`. The Origin value is a `button` whose `data-action` is `ilias.php?baseClass=ilrepositorygui&cmd=infoScreen&ref_id=N#note_K`. The item's dropdown holds Edit and Delete actions with `note_id=K`.
- **Object notes.** An object's info screen has the same notes list. It opens from the Actions dropdown's "Notes" entry, which requests `ilnotegui&cmd=getNotesHTML&ref_id=N&cadh=…`. That list shows no Origin property.
- **Other routes on the same page.** A filter form, Edit/Delete item actions (`cmd=editNoteForm`, `cmd=deleteNote`), `cmd=exportNotesHTML`, `cmd=setSortation`, and the Comments tab (`note_type=2`, `showPublicComments`).

## Decision

### Tool

**`adam_list_notes`** is confirm-gated like `adam_list_mail`: `confirm: true`, or accepted boolean elicitation (ADR 0019). Without that, it returns `confirmation_required` and no note text.

- Annotations: `READ_ONLY_ANNOTATIONS`. Opening the overview changes no ADAM state.
- Input: `confirm`, `refresh`, `cursor`, `limit`. The schema is strict. It takes no URL, route, command or token.
- Output: `untrusted: true`, a notice that the note text is untrusted, `evidence: "lab-verified"`, and `items`. Each item has `noteId`, `text`, `truncated` (when cut), `dateText` (as ADAM shows it), `shownAt` (an ISO day when it parses), `objectTitle` and `objectRefId` (when ADAM shows an Origin with an info-screen link). Pages are cursor-based over one snapshot of the overview.

### Route allowlist

- The only landing request is the fixed Private Notes route above (`note_type=1`). The landing must be `baseClass=ildashboardgui`, `cmdClass=ilNoteGUI`, `cmd=getNotesHTML`, `note_type=1`. Any other landing is `provider_unavailable`.
- No other page is requested. Export, sortation, Edit, Delete, the note forms, Comments (`note_type=2`), object notes modals and the filter are never requested.
- The Origin link is read for its numeric `ref_id` only. It is accepted only when it is on the pinned origin, `/ilias.php`, `baseClass=ilrepositorygui`, `cmd=infoScreen`, one numeric `ref_id`, and only the keys `baseClass`, `cmd` and `ref_id`. Its href is never requested, and no `rtoken` is kept. The Origin title is kept as text.
- `note_id` is read from the item's action links as a number only, and is returned as `noteId`. The action links are not kept.

### Content

- Note text is the student's own text, but it is still untrusted: it is capped at `NOTE_TEXT_LIMIT` (2 000 characters), flagged `truncated` when cut, and passed through `redactText` (email addresses become `[redacted-email]`). Scripts and markup are dropped.
- `dateText` is kept as ADAM shows it. The overview does not say whether that date is the creation or the last update, so the tool does not label it `createdAt` or `updatedAt`.

### Honest state

- `listingState`: `ok` when notes parse; `empty` only when the notes container exists and nothing is listed; `unknown` when the container is missing, or when items exist but none has readable text. `unknown` is never reported as empty.
- Items without readable text are skipped and counted in `notice`.

### Fixtures and parity

- Lab fixtures: `packages/provider-browser/fixtures/lab/notes-overview-student.json` and `notes-object-student.json` (synthetic lab notes; tokens replaced by `lab-token` before saving).
- The fixture provider returns two synthetic notes. SOAP and HTML providers fail closed (`disabled()`).

## Out of scope

- Creating, editing, deleting or exporting notes, and changing their sort order. These are writes or state changes, and the tool exposes none of them.
- Public comments (`note_type=2`) and other people's notes.
- The object-level notes modal as a tool input. The overview already lists every note with its origin.
- Object type for an Origin. The overview shows a title and a `ref_id`, not a type. Canonical object URLs are therefore not built.
- Filtering by text or origin, and the "Without reference" group beyond what the overview lists.

## Consequences

- The tool list grows by `adam_list_notes`. The student's notes are readable only after confirm.
- An unrecognised notes page is reported as `unknown`, so a layout change in ADAM cannot look like an empty notes list.

## Needs live verification

- That ADAM's overview and item markup match the lab, with a student who has at least one note. The lab was used because the live student account had no notes at the time.
- Whether ADAM's date shows the creation or the last update.
- That the Origin link format and the "Without reference" group match on ADAM.
