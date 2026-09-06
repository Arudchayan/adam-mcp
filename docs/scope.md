# Scope

Community connector for a student’s own MCP host against ADAM (ILIAS 10 at `https://adam.unibas.ch`).

## Ships

**Tools:** `adam_session_status`, `adam_login`, `adam_list_courses`, `adam_get_course`, `adam_list_children`, `adam_read_page` (confirm), `adam_list_files`, `adam_get_file`, `adam_extract_file_text` (confirm; text only), `adam_get_exercise` (no submit), `adam_search`, `adam_list_calendar`, `adam_list_news`.

**Resources:** `adam://me/courses`, `adam://crs/{refId}`, `adam://fold/{refId}`, `adam://file/{refId}`, `adam://exc/{refId}`.

**Prompts:** `prepare_my_week`, `what_changed`, `study_this`.

Live search/calendar/news walk enrolled objects. They are not ADAM’s global search or calendar GUI (`robots.txt`).

### Confirm vs elicitation

`confirm: true` is an **interim schema gate** after the student asked to read: a required tool argument so the host can show it. It is **not** an OS permission dialog, **not** MCP elicitation, and **not** equated to tool annotations alone. Real confirms and future writes → MCP **elicitation** when the host supports MRTR. See [architecture.md](architecture.md#confirm-vs-elicitation-a3).

## Does not ship

Writes (submit, forum, mail, enroll). Exam taking (`tst` denied). File bytes/base64 to the model. Generic URL fetch. Hosted HTTP MCP. Gradebook. Member gallery. OCR for scanned PDFs.

## Install

Clone this repo. `npm run setup` prints host JSON. npm registry publish is a later step; do not document `npx adam-mcp` as if it already works.

## Changes that need an ADR

Session/allowlist, new tools, enabling SOAP/HTML, file extract behavior. A README sentence is not a control.
