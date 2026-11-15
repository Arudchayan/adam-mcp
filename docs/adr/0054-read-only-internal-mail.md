# ADR 0054: Read-only ADAM internal mail

## Status

Accepted. The inbox table shape was checked live (structure only). The message view is **not yet live-verified**.

## Context

Issue #132 (mail slice): students asked to see their ADAM internal mail. They approved read-only access, with message bodies confirm-gated like `adam_read_page`.

A structure-only live probe of ILIAS 10.12 on ADAM read no subjects, senders or bodies. It showed:

- `ilias.php?baseClass=ilMailGUI` lands on the inbox: `baseClass=ilmailgui&cmdClass=ilMailFolderGUI`.
- The inbox is a KS Data Table (`table.c-table-data__table`) with the headers `"", Status, Avatar, Sender, Subject, Attachments, Date, Actions`. Its cells use `c-table-data__cell` modifiers: `row-selection`, `--status`, `--status`, `--text` (sender), `--link` (subject), `--status` (attachments), `--date` and `rowaction`. The subject links to `cmdClass=ilMailFolderGUI&cmd=showMail&mobj_id=…&mail_id=…`.
- The same page also carries write routes: `cmd=executeTableAction` (87 times: mark read/unread, move, delete), `cmd=post&fallbackCmd=showFolder`, and tabs to `ilMailFormGUI` (compose), `ilContactGUI`, `ilMailAttachmentGUI` and `ilMailOptionsGUI`.
- In ILIAS, opening a message with `showMail` marks it as read.

## Decision

Two tools, both confirm-gated (`confirm: true`, or accepted elicitation per ADR 0019):

- **`adam_list_mail`** returns the first page of the inbox ADAM opens. Each row has `mailId`, `folderId`, `subject`, `sender` (display name), `dateText` / `sentAt`, `status` (`read` | `unread` | `unknown`) and `hasAttachments`. It never returns a body. Senders and subjects are personal correspondence, so the headers need the same student-ok as bodies; there is no ungated summary mode. Listing does not mark anything read. Results page with `cursor` / `limit` over one snapshot of the inbox table.
- **`adam_read_mail`** takes one `mailId` from the list and returns `body` as untrusted text (capped at `MAX_PAGE_CHARS`, `truncated` when capped), `sender` / `recipients` display names, and `attachments` as names and size labels only. Attachments are never downloaded.

Navigation:

- The only fixed route is `https://adam.unibas.ch/ilias.php?baseClass=ilMailGUI`. The landing page must be `baseClass=ilmailgui`, otherwise the call fails with `provider_unavailable`.
- A message opens only through the `showMail` href the inbox table advertised for that `mailId`, as in ADR 0052. That href must be on the pinned origin with `/ilias.php`, `baseClass=ilmailgui`, `cmdClass=ilMailFolderGUI` and `cmd=showMail`. `mobj_id` and `mail_id` must be decimal, and only the keys `baseClass`, `cmdNode`, `cmdClass`, `cmd`, `mobj_id` and `mail_id` are allowed, with no duplicates, userinfo or fragment. URLs are never built from ids.
- If the `mailId` is not in a row of the first inbox page (cached from the last listing, or re-read), the call returns `not_found`. A non-decimal `mailId` is rejected before any navigation.
- The landing page must be a `showMail` for the same `mail_id`, otherwise the call returns `stale_id`. A different route, such as a redirect back to the folder, returns `not_found`.
- Table actions, compose, contacts, attachment delivery, options and form posts are never requested. The tools take no URL, folder or command input.

Privacy: sender and recipient strings go through `redactText`, which replaces email addresses with `[redacted-email]`. `deepRedact` applies again at the MCP layer. Routes are not returned to the model, and the `mailId` → route cache is cleared with the other session caches on login and close.

### Mark-as-read

Opening a message in ILIAS marks it read. That is the same effect as the student opening it in a browser, and it is the only state change. The tool description and the elicitation prompt both say so ("ADAM will mark it as read, as opening it in a browser does"). Nothing tries to restore the unread flag, because that would need `executeTableAction`, which is a write. The tools keep `READ_ONLY_ANNOTATIONS`: they add no write capability. Opening a forum thread with `adam_get_forum` has the same kind of view-tracking side effect.

### Parsing

- **Inbox:** header labels (EN/DE) map to columns when the header count matches the cell count. Otherwise the parser falls back to the KS cell modifiers. Read status comes from the status icon's text, `alt`, `title` or `aria-label` (`Read` / `Unread`, `Gelesen` / `Ungelesen`), and is `unknown` when the icon does not say. A row without a valid `showMail` link is left out and counted in `notice`. If ADAM shows a total larger than the parsed page ("1 - 20 of 57"), the notice says only the first page is listed. `listingState` is `empty` for a table with no rows. It is `unknown` when there is no table, or when every row was skipped; that is not proof the inbox is empty.
- **Message (needs live verification):** labelled read-only values in the shapes ILIAS uses: legacy property-form rows (`form-group` + `<label>`), KS characteristic values, KS item properties and `<dt>/<dd>`. Labels are EN/DE: From/Von, To/An, Subject/Betreff, Date/Datum, Message/Nachricht, Attachments/Anhänge. Without a labelled body the call fails closed with `not_found` and no body is invented. Scripts and link targets are dropped.

## Consequences

- The tool list grows by `adam_list_mail` and `adam_read_mail`. The fixture provider has a synthetic two-message inbox in which reading flips `unread` → `read`. SOAP and HTML providers fail closed.
- Only the first inbox page and only the inbox are covered. Other folders (sent, drafts, trash, custom), ILIAS-side paging and the Dashboard `block_pdmail` are out of this slice.
- Live verification is still owed for the `showMail` markup (field labels, body container, attachment list) and the redirect target, the read-status icon labels, and the "x - y of n" text.
- Mail sending, replying, moving, deleting and marking stay out of scope (see `docs/scope.md`).
