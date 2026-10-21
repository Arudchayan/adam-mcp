# Scope

Community connector for a student’s own MCP host against ADAM (ILIAS 10 at `https://adam.unibas.ch`).

## Ships

**Tools:** `adam_session_status`, `adam_login`, `adam_list_courses`, `adam_get_course`, `adam_list_children`, `adam_read_page` (confirm), `adam_list_files`, `adam_get_file`, `adam_extract_file_text` (confirm; text only), `adam_get_exercise` (confirm; instruction bodies; no submit), `adam_get_forum` (confirm when thread posts; no post/reply), `adam_search`, `adam_list_calendar`, `adam_list_news`.

**Resources:** `adam://me/courses`, `adam://crs/{refId}`, `adam://fold/{refId}`, `adam://file/{refId}`, `adam://exc/{refId}` (exercise metadata only — no instruction bodies; use `adam_get_exercise` + confirm), `adam://frm/{refId}` (forum meta + thread summaries; no post bodies).

**Prompts:** `prepare_my_week`, `what_changed`, `study_this`.

Live search/calendar/news walk enrolled objects. They are not ADAM’s global search or calendar GUI (`robots.txt`).

### Confirm vs elicitation

`confirm: true` is an **interim schema gate** after the student asked to read: the explicit fallback for hosts without elicitation support. It is **not** an OS permission dialog, **not** MCP elicitation, and **not** equated to tool annotations alone. The existing runtime also accepts approved boolean confirmation through MCP **elicitation** when the host supports MRTR (ADR 0019). Omission without that capability, decline, and cancel return no bodies. Future writes need separate review. See [architecture.md](architecture.md#confirm-vs-elicitation-a3).

Spike behavior (both eras, shim default-on, `confirm: true` fallback intact): [ADR 0019](adr/0019-elicitation-spike.md).

## Does not ship

Writes (submit, forum, mail, enroll). Exam taking (`tst` denied). File bytes/base64 to the model. Generic URL fetch. Hosted HTTP MCP. Gradebook. Member gallery. OCR for scanned PDFs.

### Local CLI download (0.3.0 candidate)

`adam-mcp download FILE_ID --output-dir DIRECTORY --confirm` saves one selected
file into an existing directory outside Git. This is a local filesystem action,
not an ADAM write or MCP tool. It streams at most 256 MiB within 120 seconds;
it returns a path and digest, never file bytes to the model. No batch or recursive
downloads. See [ADR 0027](adr/0027-selected-local-downloads.md).

## Install

Published version: `adam-mcp@0.2.0`; see the [publication record](audit/2026-10-21-npm-publication.md).
Source targets `0.3.0`, currently unreleased. Build source to try candidate features;
do not claim they are available in the published 0.2.0 package.

## Changes that need an ADR

Session/allowlist, new tools, enabling SOAP/HTML, file extract behavior. A README sentence is not a control.
