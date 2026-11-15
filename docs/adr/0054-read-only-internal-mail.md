# ADR 0054: Read-only ADAM internal mail

## Status

Accepted. The inbox table, the subject-link shape, the read route and the message view were probed live on ILIAS 10.12 (structure only). The coordinator re-verifies counts before merge.

## Context

Issue #132 (mail slice): students asked to see their ADAM internal mail. They approved read-only access, with message bodies confirm-gated like `adam_read_page`.

Structure-only live probes of ILIAS 10.12 on ADAM read no subjects, senders or bodies. Only an already-read message was opened. They showed:

- `ilias.php?baseClass=ilMailGUI` lands on the inbox: `baseClass=ilmailgui&cmdClass=ilMailFolderGUI`.
- The inbox is a KS Data Table (`table.c-table-data__table`) with the headers `"", Status, Avatar, Sender, Subject, Attachments, Date, Actions`. Its cells use `c-table-data__cell` modifiers: `row-selection`, `--status`, `--status`, `--text` (sender), `--link` (subject), `--status` (attachments), `--date` and `rowaction`.
- Read state is an icon in the status cell: `<img class="icon mailr small">` means read and `<img class="icon mailu small">` means unread.
- **The subject link is a table action, not `showMail`.** Its keys are `baseClass, cmdNode, cmdClass, cmd, mobj_id, rtoken, ilMailFolderGUI_action, ilMailFolderGUI_mail_id, ilMailFolderGUI_target_folder`, with `cmd=executeTableAction`, `ilMailFolderGUI_action=show` and a 64-hex CSRF `rtoken`. `executeTableAction` is the same command that marks, moves and deletes mail.
- The same page also carries write routes: `executeTableAction` (87 times), `cmd=post&fallbackCmd=showFolder`, and tabs to `ilMailFormGUI` (compose), `ilContactGUI`, `ilMailAttachmentGUI` and `ilMailOptionsGUI`.
- Dashboard `block_pdmail` items link to `cmd=showMail` with only the keys `baseClass, cmdNode, cmdClass, cmd, mobj_id, mail_id`.
- A constructed `ilias.php?baseClass=ilmailgui&cmdClass=ilMailFolderGUI&cmd=showMail&mobj_id={mobj}&mail_id={mail}` (no `rtoken`, no `cmdNode`) lands on `cmd=showMail` and renders the message.
- The message view is `#il_center_col form.form-horizontal` → `div.ilFormHeader > h2.ilHeader` (subject heading), then `div.form-group.row` rows. Each row has a `<label>` reading `From:`, `To:`, `CC:`, `Subject:`, `Date:` or `Message:`, plus a sibling value `div`. The From value has a `span.il-avatar` image before the name. The Message value is text with `<br>` line breaks.
- In ILIAS, opening a message with `showMail` marks it as read.

## Decision

Two tools, both confirm-gated (`confirm: true`, or accepted elicitation per ADR 0019):

- **`adam_list_mail`** returns the first page of the inbox ADAM opens. Each row has `folderId` (`mobj_id`), `mailId`, `subject`, `sender` (display name), `dateText` / `sentAt`, `status` (`read` | `unread` | `unknown`) and `hasAttachments`. It never returns a body. Senders and subjects are personal correspondence, so the headers need the same student-ok as bodies; there is no ungated summary mode. Listing does not mark anything read. Results page with `cursor` / `limit` over one snapshot of the inbox table.
- **`adam_read_mail`** takes `folderId` and `mailId` from one listed row. It returns `body` as untrusted text (with `<br>` mapped to newlines, capped at `MAX_PAGE_CHARS`, and `truncated` when capped), `sender` / `recipients` display names (CC appended as `CC: …`), and `attachments` as names and size labels only. Attachments are never downloaded.

Navigation:

- The only fixed route is `https://adam.unibas.ch/ilias.php?baseClass=ilMailGUI`. The landing page must be `baseClass=ilmailgui`, otherwise the call fails with `provider_unavailable`.
- **Row links are never requested or kept.** From a subject link the parser reads only two numeric ids: `mobj_id` and `ilMailFolderGUI_mail_id`. It does this only when the link is on the pinned origin with `/ilias.php`, `baseClass=ilmailgui`, `cmdClass=ilMailFolderGUI`, `cmd=executeTableAction`, `ilMailFolderGUI_action=show` and no duplicate keys, userinfo or fragment. A plain `showMail` link, like the Dashboard's, is accepted with allowlisted keys and its `mail_id`. The href and its `rtoken` are discarded, so neither reaches the model, logs or caches. Rows whose link gives no ids are skipped and counted in `notice`.
- **The read route is built from the two validated ids** (precedent: ADR 0026, forum threads from requested ids). The route is `baseClass=ilmailgui&cmdClass=ilMailFolderGUI&cmd=showMail&mobj_id={folderId}&mail_id={mailId}` on the pinned origin. Non-decimal ids are rejected with `stale_id` before any navigation. A read opens only that one URL, without re-reading the inbox.
- The landing page must be `cmd=showMail` with exactly one numeric `mobj_id` and one `mail_id`, both equal to the request; otherwise the call returns `stale_id`. Extra ILIAS keys on the landing URL are tolerated because it is only read, never followed. Any other landing, such as a redirect back to the folder, returns `not_found`.
- Table actions, compose, contacts, attachment delivery, options and form posts are never requested. The tools take no URL, command, token or action input.

Privacy: sender and recipient strings go through `redactText`, which replaces email addresses with `[redacted-email]`. `deepRedact` applies again at the MCP layer. No ADAM route or token is returned to the model.

### Mark-as-read

Opening a message in ILIAS marks it read. That is the same effect as the student opening it in a browser, and it is the only state change. The tool description, the `confirm` field help and the elicitation prompt all say so ("ADAM will mark it as read, as opening it in a browser does"). Nothing tries to restore the unread flag, because that would need `executeTableAction`, which is a write. The tools keep `READ_ONLY_ANNOTATIONS`: they add no write capability. Opening a forum thread with `adam_get_forum` has the same kind of view-tracking side effect.

### Parsing

- **Inbox:** header labels (EN/DE) map to columns when the header count matches the cell count. Otherwise the parser falls back to the KS cell modifiers. Status comes from the `mailr` / `mailu` icon class. If neither class is present, the icon's text, `alt`, `title` or `aria-label` (Read/Unread, Gelesen/Ungelesen) decides, and the status is `unknown` when nothing says. If ADAM shows a total larger than the parsed page ("1 - 20 of 57"), the notice says only the first page is listed. `listingState` is `empty` for a table with no rows. It is `unknown` when there is no table, or when every row was skipped; that is not proof the inbox is empty.
- **Message:** `form-group` rows with a `<label>` and the value that follows it; the trailing `:` is stripped from labels. The labels are From/Von, To/An, CC/Kopie, Subject/Betreff, Date/Datum, Message/Nachricht and Attachments/Anhänge. The subject falls back to `h2.ilHeader`. KS characteristic values, KS item properties and `<dt>/<dd>` are also accepted. Without a labelled body the call fails closed with `not_found` and no body is invented. Scripts, the avatar image and link targets are dropped.

## Consequences

- The tool list grows by `adam_list_mail` and `adam_read_mail`. The fixture provider has a synthetic two-message inbox in which reading flips `unread` → `read`. SOAP and HTML providers fail closed.
- Only the first inbox page and only the inbox are covered. Other folders (sent, drafts, trash, custom), ILIAS-side paging and the Dashboard `block_pdmail` are out of this slice.
- Still worth confirming live: the attachment list markup in the message view (no live message with attachments was opened) and the "x - y of n" total text.
- Mail sending, replying, moving, deleting and marking stay out of scope (see `docs/scope.md`).
